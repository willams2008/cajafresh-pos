/**
 * Provisionar — Módulo de Materia Prima, CAD, Cortes y Costeo
 *
 * Funcionalidad:
 * - Inventario de materia prima con longitudes, propiedades, precios
 * - Carga de archivos CAD (DXF, SVG, PDF) con previsualización
 * - Identificación de piezas y asignación de materiales
 * - Optimización de cortes (rectángulos en láminas) — via Web Worker
 * - Costeo y cotización con márgenes de ganancia
 * - Persistencia en IndexedDB (Dexie.js) con migración automática desde localStorage
 */

window.Provisionar = (function() {

    // ─── Estado ──────────────────────────────────────────────
    var materiales = [];
    var capasCAD = []; // Múltiples archivos cargados simultáneamente (Capas)
    var piezasCAD = []; // Lista consolidada de piezas de todas las capas visibles
    var resultadoCortes = null;
    var cotizaciones = [];
    var tabActivo = 'materiales';
    var _filtroMaterialesTipo = 'enteras'; // 'enteras' o 'sobrantes'
    var _modoVistaLayout = 'cad'; // 'cad' o 'boxes'

    // ─── Estado del Diseñador Visual ──────────────────────────
    var _disenoMat = null; // material seleccionado
    var _disenoPiezas = []; // {id, label, w, h, x, y, color}
    var _disenoDrag = { active: false, idx: -1, startX: 0, startY: 0, origX: 0, origY: 0 };
    var _disenoCam = { zoom: 1, panX: 0, panY: 0 };
    var _disenoIdCounter = 0;

    function toggleModoVistaLayout() {
        _modoVistaLayout = (_modoVistaLayout === 'cad' ? 'boxes' : 'cad');
        var btn = document.getElementById('btn-toggle-modo-vista');
        var lbl = document.getElementById('lbl-toggle-modo-vista');
        if (btn && lbl) {
            if (_modoVistaLayout === 'cad') {
                lbl.textContent = 'Vista: Vectores CAD';
                btn.className = 'bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 px-3 rounded text-xs flex items-center gap-1.5 transition-all';
            } else {
                lbl.textContent = 'Vista: Cajas de Ocupación';
                btn.className = 'bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 font-bold py-1 px-3 rounded text-xs flex items-center gap-1.5 transition-all';
            }
        }
        dibujarLayoutCortes();
    }

    // ─── Web Worker para Nesting ──────────────────────────────
    var _nestingWorker = null;
    var _nestingEnCurso = false;

    // ─── IndexedDB (Dexie.js) ────────────────────────────────
    var _db = null;

    // ─── Cámara Virtual del Visor CAD ────────────────────────
    var cadCam = { panX: 0, panY: 0, zoom: 1 };
    var cadDrag = { active: false, startX: 0, startY: 0, mode: 'pan', capaIdx: -1, pieceIdx: -1, type: null }; // mode: 'pan' o 'piece'
    var planchasActivas = []; // Almacena los materiales arrastrados al lienzo

    // ─── Cámara Virtual del Layout de Cortes ─────────────────
    var layoutCam = { zoom: 1, panX: 0, panY: 0 };

    // ─── Inicialización ──────────────────────────────────────
    async function init() {
        initNestingWorker();
        await initDB();
        _cargarCapaDePrueba(); // Inyectar piezas demo si la DB estaba vacía
        renderMateriales();
        renderSelectMateriales();
        renderPlanchasActivas();
        initCADDropZone();
        if (tabActivo) switchTab(tabActivo);

        // ─── Event Listeners para el Canvas CAD ──────────────
        setTimeout(function() {
            var cadCanvas = document.getElementById('cad-canvas');
            if (cadCanvas) {
                // Zoom con rueda del ratón
                cadCanvas.addEventListener('wheel', function(e) {
                    e.preventDefault();
                    var factor = e.deltaY < 0 ? 1.12 : 0.88;
                    var rect = cadCanvas.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;
                    // Zoom centrado en el cursor
                    cadCam.panX = mx - (mx - cadCam.panX) * factor;
                    cadCam.panY = my - (my - cadCam.panY) * factor;
                    cadCam.zoom *= factor;
                    redibujarCanvasCAD();
                }, { passive: false });

                // Click: mousedown
                cadCanvas.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    var rect = cadCanvas.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;

                    if (e.button === 0) {
                        // Click izquierdo: intentar seleccionar pieza para arrastrar
                        var hit = hitTestPieza(mx, my);
                        if (hit) {
                            cadDrag = { active: true, startX: mx, startY: my, mode: 'piece', type: hit.type, pieceIdx: hit.pieceIdx, capaIdx: hit.capaIdx };
                            cadCanvas.style.cursor = 'grabbing';
                        } else {
                            // Si no hay pieza, iniciar paneo
                            cadDrag = { active: true, startX: mx, startY: my, mode: 'pan', pieceIdx: -1, capaIdx: -1 };
                            cadCanvas.style.cursor = 'move';
                        }
                    } else if (e.button === 1) {
                        // Click medio: siempre paneo
                        cadDrag = { active: true, startX: mx, startY: my, mode: 'pan', pieceIdx: -1, capaIdx: -1 };
                        cadCanvas.style.cursor = 'move';
                    }
                });

                // Click derecho (contextmenu) para borrar planchas del lienzo
                cadCanvas.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    var rect = cadCanvas.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;
                    var hit = hitTestPieza(mx, my);
                    if (hit && hit.type === 'plancha') {
                        var idx = hit.pieceIdx;
                        var pl = planchasActivas[idx];
                        Swal.fire({
                            title: '¿Eliminar plancha del lienzo?',
                            text: 'Se removerá "' + pl.nombre + '" de la vista de diseño CAD.',
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonColor: '#ef4444',
                            confirmButtonText: 'Eliminar',
                            cancelButtonText: 'Cancelar'
                        }).then(function(r) {
                            if (r.isConfirmed) {
                                planchasActivas.splice(idx, 1);
                                redibujarCanvasCAD();
                            }
                        });
                    }
                });

                cadCanvas.addEventListener('mousemove', function(e) {
                    if (!cadDrag.active) {
                        // Cambiar cursor según si está sobre una pieza
                        var rect = cadCanvas.getBoundingClientRect();
                        var mx = e.clientX - rect.left;
                        var my = e.clientY - rect.top;
                        var hit = hitTestPieza(mx, my);
                        cadCanvas.style.cursor = hit ? 'grab' : 'default';
                        return;
                    }

                    var rect = cadCanvas.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;
                    var dx = mx - cadDrag.startX;
                    var dy = my - cadDrag.startY;

                    if (cadDrag.mode === 'pan') {
                        cadCam.panX += dx;
                        cadCam.panY += dy;
                        cadDrag.startX = mx;
                        cadDrag.startY = my;
                        redibujarCanvasCAD();
                    } else if (cadDrag.mode === 'piece' && cadDrag.type === 'piece') {
                        // Mover pieza: convertir delta en coordenadas virtuales
                        var capa = capasCAD[cadDrag.capaIdx];
                        if (capa && capa.piezas[cadDrag.pieceIdx]) {
                            var p = capa.piezas[cadDrag.pieceIdx];
                            var info = getCADTransformInfo();
                            if (info) {
                                var mmDx = dx / (info.scale * cadCam.zoom);
                                var mmDy = -dy / (info.scale * cadCam.zoom);
                                if (!p.offsetX) p.offsetX = 0;
                                if (!p.offsetY) p.offsetY = 0;
                                p.offsetX += mmDx;
                                p.offsetY += mmDy;
                                cadDrag.startX = mx;
                                cadDrag.startY = my;
                                redibujarCanvasCAD();
                            }
                        }
                    } else if (cadDrag.mode === 'piece' && cadDrag.type === 'plancha') {
                        // Mover plancha
                        var plancha = planchasActivas[cadDrag.pieceIdx];
                        if (plancha) {
                            var info = getCADTransformInfo();
                            if (info) {
                                var mmDx = dx / (info.scale * cadCam.zoom);
                                var mmDy = -dy / (info.scale * cadCam.zoom);
                                plancha.offsetX += mmDx;
                                plancha.offsetY += mmDy;
                                cadDrag.startX = mx;
                                cadDrag.startY = my;
                                redibujarCanvasCAD();
                            }
                        }
                    }
                });

                cadCanvas.addEventListener('mouseup', function() {
                    cadDrag.active = false;
                    cadDrag.mode = 'none';
                    cadCanvas.style.cursor = 'default';
                });

                cadCanvas.addEventListener('mouseleave', function() {
                    cadDrag.active = false;
                    cadDrag.mode = 'none';
                    cadCanvas.style.cursor = 'default';
                });

                // Drop listeners for material palette
                cadCanvas.addEventListener('dragover', function(e) {
                    e.preventDefault();
                });

                cadCanvas.addEventListener('drop', function(e) {
                    e.preventDefault();
                    var matId = e.dataTransfer.getData('text/plain');
                    if (matId) {
                        // BLOQUE 3: Guardia — no permitir arrastrar material sin CAD cargado
                        if (capasCAD.length === 0) {
                            Swal.fire({ icon: 'warning', title: 'Sin archivo CAD', text: 'Carga primero un archivo CAD (DXF, SVG o PDF) antes de arrastrar un material al lienzo.', timer: 3000, showConfirmButton: false });
                            return;
                        }
                        var mat = materiales.find(function(m) { return m.id === matId; });
                        if (mat) {
                            var rect = cadCanvas.getBoundingClientRect();
                            var screenX = e.clientX - rect.left;
                            var screenY = e.clientY - rect.top;

                            var info = getCADTransformInfo();
                            if (!info) {
                                info = { scale: 1, offsetX: cadCanvas.width/2, offsetY: cadCanvas.height/2 };
                            }

                            var cx = (screenX - cadCam.panX) / cadCam.zoom;
                            var cy = (screenY - cadCam.panY) / cadCam.zoom;

                            var worldX = (cx - info.offsetX) / info.scale;
                            var worldY = (info.offsetY - cy) / info.scale;

                            planchasActivas.push({
                                id: 'plancha_' + Date.now(),
                                materialId: mat.id,
                                nombre: mat.nombre,
                                width: mat.largo,
                                height: mat.ancho,
                                cutoutW: mat.cutoutW || 0,
                                cutoutH: mat.cutoutH || 0,
                                originalX: worldX,
                                originalY: -worldY, // SVG/canvas Y inversion
                                offsetX: 0,
                                offsetY: 0,
                                color: mat.color || '#e28743'
                            });
                            redibujarCanvasCAD();
                            renderPlanchasActivas();
                        }
                    }
                });
            }

            // ─── Event Listeners para el Canvas de Layout ────────
            var optCanvas = document.getElementById('opt-canvas');
            if (optCanvas) {
                optCanvas.addEventListener('wheel', function(e) {
                    e.preventDefault();
                    var factor = e.deltaY < 0 ? 1.12 : 0.88;
                    var rect = optCanvas.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;
                    layoutCam.panX = mx - (mx - layoutCam.panX) * factor;
                    layoutCam.panY = my - (my - layoutCam.panY) * factor;
                    layoutCam.zoom *= factor;
                    dibujarLayoutCortes();
                }, { passive: false });

                var layoutDrag = { active: false, startX: 0, startY: 0 };
                optCanvas.addEventListener('mousedown', function(e) {
                    if (_layoutEditMode) return; // No mover la cámara si estamos editando posiciones de piezas
                    var rect = optCanvas.getBoundingClientRect();
                    layoutDrag = { active: true, startX: e.clientX - rect.left, startY: e.clientY - rect.top };
                    optCanvas.style.cursor = 'move';
                });
                optCanvas.addEventListener('mousemove', function(e) {
                    if (!layoutDrag.active) return;
                    var rect = optCanvas.getBoundingClientRect();
                    var mx = e.clientX - rect.left;
                    var my = e.clientY - rect.top;
                    layoutCam.panX += mx - layoutDrag.startX;
                    layoutCam.panY += my - layoutDrag.startY;
                    layoutDrag.startX = mx;
                    layoutDrag.startY = my;
                    dibujarLayoutCortes();
                });
                optCanvas.addEventListener('mouseup', function() {
                    layoutDrag.active = false;
                    optCanvas.style.cursor = 'default';
                });
                optCanvas.addEventListener('mouseleave', function() {
                    layoutDrag.active = false;
                    optCanvas.style.cursor = 'default';
                });
            }
        }, 300);
    }

    // ─── IndexedDB — Inicialización ───────────────────────────
    async function initDB() {
        try {
            _db = new Dexie('CajaFresh_ProvisionarDB');
            _db.version(1).stores({
                materiales: '++_iid, id, nombre, tipo, espesor',
                cotizaciones: '++_iid, id, cliente, fecha'
            });
            await _db.open();
            console.log('[Provisionar] IndexedDB lista.');
            await _migrarDesdeLocalStorage();
            // Cargar datos en memoria
            var rows = await _db.materiales.toArray();
            if (rows.length > 0) {
                materiales = rows;
            } else {
                // Fallback: intentar cargar desde localStorage si la DB está vacía
                var saved = null;
                try { saved = localStorage.getItem('provisionar_materiales'); } catch(e) {}
                if (saved) {
                    try { materiales = JSON.parse(saved); } catch(e) {}
                }
                // Si sigue vacío, cargar datos de prueba
                if (materiales.length === 0) {
                    await _cargarDatosDePrueba();
                }
            }
            var savedCot = localStorage.getItem('provisionar_cotizaciones');
            if (savedCot) { try { cotizaciones = JSON.parse(savedCot); } catch(e) {} }
            renderMateriales();
            renderSelectMateriales();
            if (typeof window.registrarMaterialEspecialEnInventario === 'function') {
                materiales.forEach(function(m) {
                    window.registrarMaterialEspecialEnInventario(m);
                });
            }
        } catch (err) {
            console.error('[Provisionar] Error iniciando IndexedDB, usando localStorage como fallback:', err);
            _db = null;
            // Fallback a localStorage
            try {
                var saved = localStorage.getItem('provisionar_materiales');
                if (saved) materiales = JSON.parse(saved);
                else await _cargarDatosDePrueba();
                var savedCot = localStorage.getItem('provisionar_cotizaciones');
                if (savedCot) cotizaciones = JSON.parse(savedCot);
                if (typeof window.registrarMaterialEspecialEnInventario === 'function') {
                    materiales.forEach(function(m) {
                        window.registrarMaterialEspecialEnInventario(m);
                    });
                }
            } catch(e) { console.warn('[Provisionar] Error cargando estado:', e); }
        }
    }

    // ─── Datos de Prueba ──────────────────────────────────────────
    async function _cargarDatosDePrueba() {
        var materialesDePrueba = [
            { id: 'mat_acr_trans_ent',  nombre: 'Acrílico Transparente Entera',  tipo: 'Transparente', largo: 1220, ancho: 610, espesor: 3,  costoPlancha: 55,  stock: 10, color: '#38bdf8', sobrantes: [], usados: [] },
            { id: 'mat_acr_trans_18',   nombre: 'Acrílico Transparente 1/8',     tipo: 'Transparente', largo: 600,  ancho: 400, espesor: 3,  costoPlancha: 12,  stock: 20, color: '#7dd3fc', sobrantes: [], usados: [] },
            { id: 'mat_acr_trans_14',   nombre: 'Acrílico Transparente 1/4',     tipo: 'Transparente', largo: 600,  ancho: 400, espesor: 6,  costoPlancha: 22,  stock: 15, color: '#0ea5e9', sobrantes: [], usados: [] },
            { id: 'mat_acr_trans_12',   nombre: 'Acrílico Transparente 1/2',     tipo: 'Transparente', largo: 600,  ancho: 400, espesor: 12, costoPlancha: 35,  stock: 10, color: '#0284c7', sobrantes: [], usados: [] },
            { id: 'mat_acr_col_ent',    nombre: 'Acrílico Color Entera',         tipo: 'Color',        largo: 1220, ancho: 610, espesor: 3,  costoPlancha: 85,  stock: 8,  color: '#f97316', sobrantes: [], usados: [] },
            { id: 'mat_acr_col_18',     nombre: 'Acrílico Color 1/8',            tipo: 'Color',        largo: 600,  ancho: 400, espesor: 3,  costoPlancha: 15,  stock: 15, color: '#fb923c', sobrantes: [], usados: [] },
            { id: 'mat_acr_col_14',     nombre: 'Acrílico Color 1/4',            tipo: 'Color',        largo: 600,  ancho: 400, espesor: 6,  costoPlancha: 25,  stock: 12, color: '#f59e0b', sobrantes: [], usados: [] },
            { id: 'mat_acr_col_12',     nombre: 'Acrílico Color 1/2',            tipo: 'Color',        largo: 600,  ancho: 400, espesor: 12, costoPlancha: 45,  stock: 8,  color: '#d97706', sobrantes: [], usados: [] },
            { id: 'mat_acr_esp_ent',    nombre: 'Acrílico Espejo Entera',        tipo: 'Espejo',       largo: 1220, ancho: 610, espesor: 3,  costoPlancha: 100, stock: 5,  color: '#94a3b8', sobrantes: [], usados: [] },
            { id: 'mat_acr_esp_18',     nombre: 'Acrílico Espejo 1/8',           tipo: 'Espejo',       largo: 600,  ancho: 400, espesor: 3,  costoPlancha: 20,  stock: 10, color: '#cbd5e1', sobrantes: [], usados: [] },
            { id: 'mat_acr_esp_14',     nombre: 'Acrílico Espejo 1/4',           tipo: 'Espejo',       largo: 600,  ancho: 400, espesor: 6,  costoPlancha: 35,  stock: 8,  color: '#64748b', sobrantes: [], usados: [] },
            { id: 'mat_acr_esp_med',    nombre: 'Acrílico Espejo Media',         tipo: 'Espejo',       largo: 600,  ancho: 610, espesor: 12, costoPlancha: 55,  stock: 6,  color: '#475569', sobrantes: [], usados: [] }
        ];

        materiales = materialesDePrueba;

        // Guardar en DB si está disponible
        if (_db) {
            for (var i = 0; i < materialesDePrueba.length; i++) {
                try { await _db.materiales.add(materialesDePrueba[i]); } catch(e) {}
            }
        } else {
            localStorage.setItem('provisionar_materiales', JSON.stringify(materialesDePrueba));
        }

        console.log('[Provisionar] Datos de prueba cargados: ' + materialesDePrueba.length + ' materiales.');
    }

    function _cargarCapaDePrueba() {
        // Solo cargar si no hay capas ya cargadas
        if (capasCAD.length > 0) return;
        // Solo cargar si existen materiales de demo
        var tieneDemoMats = materiales.some(function(m) { return m.id && (m.id.startsWith('mat_acr_') || m.id.startsWith('demo_mat_')); });
        if (!tieneDemoMats) return;

        var capaDePrueba = {
            id: 'demo_cad_001',
            nombre: 'Letrero DEMO.svg',
            tipo: 'svg',
            visible: true,
            svgContent: null,
            entities: [],
            piezas: [
                { id: 'demo_p1', width: 400,  height: 200,  originalX: 0,   originalY: 0,   label: 'Base Frontal',      qty: 1, selected: true, materialId: 'mat_acr_col_ent', shapeType: 'polygon', vertices: [{x:0,y:0},{x:400,y:0},{x:380,y:200},{x:20,y:200}] },
                { id: 'demo_p2', width: 400,  height: 200,  originalX: 410, originalY: 0,   label: 'Base Trasera',      qty: 1, selected: true, materialId: 'mat_acr_col_ent', shapeType: 'polygon', vertices: [{x:20,y:0},{x:380,y:0},{x:400,y:200},{x:0,y:200}] },
                { id: 'demo_p3', width: 380,  height: 60,   originalX: 0,   originalY: 210, label: 'Panel Superior',    qty: 2, selected: true, materialId: 'mat_acr_trans_ent', shapeType: 'polygon', vertices: [{x:0,y:0},{x:380,y:0},{x:380,y:60},{x:0,y:60}] },
                { id: 'demo_p4', width: 180,  height: 180,  originalX: 820, originalY: 0,   label: 'Logo Acrílico',     qty: 3, selected: true, materialId: 'mat_acr_trans_ent', shapeType: 'circle' },
                { id: 'demo_p5', width: 350,  height: 120,  originalX: 0,   originalY: 280, label: 'Soporte Color',     qty: 2, selected: true, materialId: 'mat_acr_esp_ent', shapeType: 'polygon', vertices: [{x:0,y:20},{x:30,y:0},{x:320,y:0},{x:350,y:20},{x:350,y:100},{x:320,y:120},{x:30,y:120},{x:0,y:100}] },
                { id: 'demo_p6', width: 250,  height: 250,  originalX: 360, originalY: 210, label: 'Tapa Lateral',      qty: 4, selected: true, materialId: 'mat_acr_col_ent', shapeType: 'polygon', vertices: [{x:30,y:0},{x:220,y:0},{x:250,y:30},{x:250,y:220},{x:220,y:250},{x:30,y:250},{x:0,y:220},{x:0,y:30}] }
            ]
        };

        capasCAD = [capaDePrueba];
        actualizarPiezasCAD();
        redibujarCanvasCAD();
        renderCapas();
        console.log('[Provisionar] Capa de prueba cargada: ' + capaDePrueba.piezas.length + ' piezas.');
    }


    async function _migrarDesdeLocalStorage() {
        var clave = 'provisionar_migrado_indexedDB_v1';
        if (localStorage.getItem(clave)) return;
        var viejos = localStorage.getItem('provisionar_materiales');
        if (viejos) {
            try {
                var items = JSON.parse(viejos);
                if (Array.isArray(items) && items.length > 0) {
                    // Verificar si ya hay datos en DB para no duplicar
                    var existentes = await _db.materiales.count();
                    if (existentes === 0) {
                        for (var i = 0; i < items.length; i++) {
                            await _db.materiales.add(items[i]);
                        }
                        console.log('[Provisionar] Migrados ' + items.length + ' materiales de localStorage → IndexedDB.');
                    }
                }
            } catch(e) { console.error('[Provisionar] Error en migración:', e); }
        }
        localStorage.setItem(clave, 'true');
    }

    async function guardarMateriales() {
        if (_db) {
            try {
                await _db.materiales.clear();
                for (var i = 0; i < materiales.length; i++) {
                    await _db.materiales.add(materiales[i]);
                }
            } catch(e) {
                console.warn('[Provisionar] Error guardando en IndexedDB, usando localStorage:', e);
                localStorage.setItem('provisionar_materiales', JSON.stringify(materiales));
            }
        } else {
            localStorage.setItem('provisionar_materiales', JSON.stringify(materiales));
        }
        
        // Sincronizar todos los materiales con el Inventario General POS en "Material Especial"
        if (typeof window.registrarMaterialEspecialEnInventario === 'function') {
            materiales.forEach(function(m) {
                window.registrarMaterialEspecialEnInventario(m);
            });
        }
        marcarDirty(false);
    }

    function marcarDirty(dirty) {
        var el = document.getElementById('provisionar-dirty-indicator');
        if (el) {
            if (dirty) { el.classList.remove('hidden'); }
            else { el.classList.add('hidden'); }
        }
    }

    // ─── Tabs ────────────────────────────────────────────────
    function switchTab(tab) {
        tabActivo = tab;
        var tabs = ['materiales', 'cad', 'cortes', 'diseno', 'costos'];
        tabs.forEach(function(t) {
            var btn = document.getElementById('provisionar-tab-' + t);
            var content = document.getElementById('provisionar-content-' + t);
            if (btn) {
                btn.classList.remove('border-amber-600', 'text-amber-600');
                btn.classList.add('border-transparent', 'text-slate-400');
            }
            if (content) content.classList.add('hidden');
        });
        var activeBtn = document.getElementById('provisionar-tab-' + tab);
        var activeContent = document.getElementById('provisionar-content-' + tab);
        if (activeBtn) {
            activeBtn.classList.remove('border-transparent', 'text-slate-400');
            activeBtn.classList.add('border-amber-600', 'text-amber-600');
        }
        if (activeContent) activeContent.classList.remove('hidden');
        if (tab === 'diseno') initDiseno();
    }

    // ─── Materia Prima CRUD ──────────────────────────────────
    function abrirModalNuevoMaterial(materialParaEditar) {
        var esEdicion = !!materialParaEditar;
        var title = esEdicion ? 'Editar Material' : 'Nuevo Material';
        var defaultNombre = esEdicion ? materialParaEditar.nombre : '';
        var defaultPropiedades = esEdicion ? materialParaEditar.propiedades : '';
        var defaultLargo = esEdicion ? materialParaEditar.largo : 2440;
        var defaultAncho = esEdicion ? materialParaEditar.ancho : 1220;
        var defaultEspesor = esEdicion ? materialParaEditar.espesor : 3;
        var defaultCosto = esEdicion ? materialParaEditar.costoM2 : 0;
        var defaultStock = esEdicion ? materialParaEditar.stock : 1;
        var defaultColor = esEdicion ? (materialParaEditar.color || '#e28743') : '#e28743';

        Swal.fire({
            title: title,
            html:
                '<div class="space-y-3 text-left">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Nombre del Material</label>' +
                '<input id="swal-mat-nombre" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultNombre + '" placeholder="Ej. Acrílico 3mm"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Propiedades</label>' +
                '<input id="swal-mat-propiedades" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultPropiedades + '" placeholder="Ej. Transparente, alto impacto"></div>' +
                '<div class="grid grid-cols-2 gap-3">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Largo (mm)</label>' +
                '<input id="swal-mat-largo" type="number" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultLargo + '"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Ancho (mm)</label>' +
                '<input id="swal-mat-ancho" type="number" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultAncho + '"></div>' +
                '</div>' +
                '<div class="grid grid-cols-3 gap-3">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Espesor (mm)</label>' +
                '<input id="swal-mat-espesor" type="number" step="0.1" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultEspesor + '"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Costo x m² ($)</label>' +
                '<input id="swal-mat-costo" type="number" step="0.01" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultCosto + '"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Stock (planchas)</label>' +
                '<input id="swal-mat-stock" type="number" class="w-full px-4 py-2.5 border-2 border-slate-200 rounded-xl font-bold text-slate-700 focus:border-amber-500 outline-none" value="' + defaultStock + '"></div>' +
                '</div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Color Identificador (Bordes)</label>' +
                '<input id="swal-mat-color" type="color" class="w-full h-10 p-1 bg-white border-2 border-slate-200 rounded-xl outline-none cursor-pointer" value="' + defaultColor + '"></div>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: esEdicion ? 'Guardar Cambios' : 'Agregar Material',
            cancelButtonText: 'Cancelar',
            preConfirm: function() {
                var nombre = document.getElementById('swal-mat-nombre').value.trim();
                var propiedades = document.getElementById('swal-mat-propiedades').value.trim();
                var largo = parseFloat(document.getElementById('swal-mat-largo').value);
                var ancho = parseFloat(document.getElementById('swal-mat-ancho').value);
                var espesor = parseFloat(document.getElementById('swal-mat-espesor').value);
                var costoM2 = parseFloat(document.getElementById('swal-mat-costo').value);
                var stock = parseInt(document.getElementById('swal-mat-stock').value);
                var color = document.getElementById('swal-mat-color').value;
                if (!nombre) { Swal.showValidationMessage('El nombre es obligatorio'); return; }
                if (!largo || !ancho) { Swal.showValidationMessage('Largo y ancho son obligatorios'); return; }
                return { nombre: nombre, propiedades: propiedades || '-', largo: largo, ancho: ancho, espesor: espesor || 0, costoM2: costoM2 || 0, stock: stock || 1, color: color };
            }
        }).then(function(result) {
            if (result.isConfirmed) {
                var data = result.value;
                data.id = esEdicion ? materialParaEditar.id : Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
                data.areaM2 = (data.largo * data.ancho) / 1000000;
                data.costoPlancha = data.areaM2 * data.costoM2;
                data.sobrantes = esEdicion ? (materialParaEditar.sobrantes || []) : [];
                data.usados = esEdicion ? (materialParaEditar.usados || []) : [];

                if (esEdicion) {
                    var idx = materiales.findIndex(function(m) { return m.id === materialParaEditar.id; });
                    if (idx >= 0) materiales[idx] = data;
                } else {
                    materiales.push(data);
                }
                guardarMateriales();
                renderMateriales();
                renderSelectMateriales();

                // Registrar en Inventario General POS
                if (typeof window.registrarMaterialEspecialEnInventario === 'function') {
                    window.registrarMaterialEspecialEnInventario(data);
                }

                Swal.fire({ icon: 'success', title: esEdicion ? 'Material actualizado en Inventario' : 'Material agregado al Inventario General', timer: 1400, showConfirmButton: false });
            }
        });
    }

    function eliminarMaterial(id) {
        Swal.fire({
            title: '¿Eliminar material?',
            text: 'Se removerá también de Provisionar y del Inventario General',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar'
        }).then(function(r) {
            if (r.isConfirmed) {
                materiales = materiales.filter(function(m) { return m.id !== id; });
                guardarMateriales();
                renderMateriales();
                renderSelectMateriales();

                if (typeof window.eliminarMaterialEspecialDeInventario === 'function') {
                    window.eliminarMaterialEspecialDeInventario(id);
                }

                Swal.fire({ icon: 'success', title: 'Eliminado del inventario', timer: 1000, showConfirmButton: false });
            }
        });
    }

    function renderCADMaterialPalette() {
        var palette = document.getElementById('cad-material-palette');
        if (!palette) return;

        if (!materiales.length) {
            palette.innerHTML = '<div class="text-center py-4 text-xs text-slate-400 italic">No hay materiales registrados</div>';
            return;
        }

        palette.innerHTML = materiales.map(function(m) {
            var color = m.color || '#e28743';
            return '<div draggable="true" ondragstart="event.dataTransfer.setData(\'text/plain\', \'' + m.id + '\')" ' +
                'class="bg-white border border-slate-200 rounded-lg p-2 cursor-grab active:cursor-grabbing hover:border-amber-400 hover:shadow-sm transition-all flex items-center gap-2">' +
                '<span class="inline-block w-4 h-4 rounded-full flex-shrink-0" style="background-color:' + color + ';"></span>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="text-xs font-bold text-slate-700 truncate" title="' + escHtml(m.nombre) + '">' + escHtml(m.nombre) + '</div>' +
                '<div class="text-[9px] text-slate-400">' + m.largo + 'x' + m.ancho + ' mm</div>' +
                '</div>' +
                '<i class="fas fa-grip-vertical text-slate-300 text-xs flex-shrink-0"></i>' +
                '</div>';
        }).join('');
    }

    function filtrarTipoMaterial(tipo) {
        _filtroMaterialesTipo = tipo;
        var btnEnteras = document.getElementById('mat-subtab-enteras');
        var btnSobrantes = document.getElementById('mat-subtab-sobrantes');

        if (btnEnteras && btnSobrantes) {
            if (tipo === 'enteras') {
                btnEnteras.className = 'py-2.5 px-4 font-bold text-xs border-b-2 border-amber-600 text-amber-600 flex items-center gap-2 transition-all';
                btnSobrantes.className = 'py-2.5 px-4 font-bold text-xs border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 transition-all';
            } else {
                btnSobrantes.className = 'py-2.5 px-4 font-bold text-xs border-b-2 border-emerald-600 text-emerald-600 flex items-center gap-2 transition-all';
                btnEnteras.className = 'py-2.5 px-4 font-bold text-xs border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 transition-all';
            }
        }
        renderMateriales();
    }

    function abrirModalNuevoSobrante() {
        var opcionesMateriales = materiales.filter(function(m) { return !m.esSobrante; }).map(function(m) {
            return '<option value="' + m.id + '">' + escHtml(m.nombre) + '</option>';
        }).join('');

        Swal.fire({
            title: 'Registrar Retazo / Sobrante',
            html:
                '<div class="space-y-3 text-left">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Material Base de Origen</label>' +
                '<select id="swal-sob-mat" class="w-full px-3 py-2 border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none">' +
                (opcionesMateriales || '<option value="">Material genérico</option>') +
                '</select></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Nombre del Retazo</label>' +
                '<input id="swal-sob-nombre" class="w-full px-3 py-2 border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none" placeholder="Ej. Retazo Acrílico 3mm (1220x600)"></div>' +
                '<div class="grid grid-cols-2 gap-3">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Largo (mm)</label>' +
                '<input id="swal-sob-largo" type="number" class="w-full px-3 py-2 border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none" value="1220"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Ancho (mm)</label>' +
                '<input id="swal-sob-ancho" type="number" class="w-full px-3 py-2 border-2 border-slate-200 rounded-xl font-bold text-slate-700 outline-none" value="600"></div>' +
                '</div>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Guardar Retazo',
            cancelButtonText: 'Cancelar',
            preConfirm: function() {
                var matId = document.getElementById('swal-sob-mat').value;
                var nombre = document.getElementById('swal-sob-nombre').value.trim();
                var largo = parseFloat(document.getElementById('swal-sob-largo').value) || 0;
                var ancho = parseFloat(document.getElementById('swal-sob-ancho').value) || 0;

                var baseMat = materiales.find(function(m) { return m.id === matId; });
                var nombreFinal = nombre || (baseMat ? ('Retazo: ' + baseMat.nombre + ' (' + largo + 'x' + ancho + 'mm)') : ('Retazo Sobrante ' + largo + 'x' + ancho + 'mm'));
                var espesor = baseMat ? baseMat.espesor : 3;
                var costoM2 = baseMat ? baseMat.costoM2 : 20;

                if (!largo || !ancho) { Swal.showValidationMessage('Largo y ancho son obligatorios'); return; }
                return {
                    id: 'retazo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    nombre: nombreFinal,
                    propiedades: 'Retazo sobrante reutilizable registrado manualmente',
                    largo: largo,
                    ancho: ancho,
                    espesor: espesor,
                    costoM2: costoM2,
                    costoPlancha: (largo * ancho / 1000000) * costoM2,
                    stock: 1,
                    color: '#10b981',
                    esSobrante: true,
                    materialOriginalId: matId || null,
                    tipo: 'Sobrante / Retazo'
                };
            }
        }).then(function(r) {
            if (r.isConfirmed && r.value) {
                materiales.push(r.value);
                guardarMateriales();
                _filtroMaterialesTipo = 'sobrantes';
                renderMateriales();
                renderSelectMateriales();
                renderCADMaterialPalette();

                if (typeof window.registrarMaterialEspecialEnInventario === 'function') {
                    window.registrarMaterialEspecialEnInventario(r.value);
                }

                Swal.fire({ icon: 'success', title: 'Retazo Guardado', text: 'El sobrante se añadió a tu inventario y al POS.', timer: 1500, showConfirmButton: false });
            }
        });
    }

    function renderMateriales() {
        var tbody = document.getElementById('materiales-table-body');
        if (!tbody) return;

        var enteras = materiales.filter(function(m) { return !m.esSobrante; });
        var sobrantes = materiales.filter(function(m) { return m.esSobrante === true; });

        var badgeEnteras = document.getElementById('badge-count-enteras');
        var badgeSobrantes = document.getElementById('badge-count-sobrantes');
        if (badgeEnteras) badgeEnteras.textContent = enteras.length;
        if (badgeSobrantes) badgeSobrantes.textContent = sobrantes.length;

        var listaMostrar = _filtroMaterialesTipo === 'enteras' ? enteras : sobrantes;

        if (!listaMostrar.length) {
            tbody.innerHTML = '<tr id="materiales-empty-row"><td colspan="10" class="py-12 text-center text-slate-400">' +
                '<i class="fas fa-box-open text-3xl mb-2 block"></i>' +
                '<p class="font-medium">No hay ' + (_filtroMaterialesTipo === 'enteras' ? 'láminas enteras' : 'sobrantes o retazos') + ' registrados</p>' +
                '<p class="text-xs">Registra nuevos elementos para empezar a utilizarlos</p></td></tr>';
            return;
        }

        var html = '';
        listaMostrar.forEach(function(m) {
            var color = m.color || '#e28743';
            var totalSobrantes = (m.sobrantes || []).length;
            var totalUsados = (m.usados || []).length;

            // Fila principal
            html += '<tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">' +
                '<td class="py-3 px-4 text-center">' +
                '<button onclick="window.toggleMaterialAccordion(\'' + m.id + '\')" class="text-slate-400 hover:text-slate-700 focus:outline-none">' +
                '<i id="accordion-icon-' + m.id + '" class="fas fa-chevron-right text-xs transition-transform"></i>' +
                '</button>' +
                '</td>' +
                '<td class="py-3 px-4 text-center">' +
                '<span class="inline-block w-5 h-5 rounded-full border border-slate-200" style="background-color:' + color + ';"></span>' +
                '</td>' +
                '<td class="py-3 px-4 font-bold text-slate-700">' + escHtml(m.nombre) +
                (m.esSobrante ? ' <span class="ml-1.5 px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-extrabold rounded-full">RETAZO</span>' : '') +
                '</td>' +
                '<td class="py-3 px-4 text-slate-500 text-xs">' + escHtml(m.propiedades) + '</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-slate-700">' + m.largo + ' x ' + m.ancho + ' mm</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-slate-700">' + m.espesor + ' mm</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-emerald-600">$' + (m.costoPlancha ? m.costoPlancha.toFixed(2) : (m.costoM2 || 0).toFixed(2)) + '</td>' +
                '<td class="py-3 px-4 text-center">' +
                '<span class="px-2.5 py-0.5 ' + (m.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700') + ' rounded-full text-xs font-bold">' + m.stock + ' ' + (m.esSobrante ? 'piezas' : 'planchas') + '</span>' +
                '</td>' +
                '<td class="py-3 px-4 text-center">' +
                '<button onclick="window.Provisionar.abrirModalNuevoMaterial(' + JSON.stringify(m).replace(/"/g, '&quot;') + ')" class="text-brand-600 hover:text-brand-800 mr-3" title="Editar"><i class="fas fa-pen"></i></button>' +
                '<button onclick="window.Provisionar.eliminarMaterial(\'' + m.id + '\')" class="text-rose-400 hover:text-rose-600" title="Eliminar"><i class="fas fa-trash-can"></i></button>' +
                '</td>' +
                '</tr>';

            // Fila de acordeón colapsable
            var cutPreviewHtml = '';
            if (m.esSobrante && m.cutLayout) {
                cutPreviewHtml = '<canvas id="cut-preview-' + m.id + '" width="260" height="100" ' +
                    'style="display:block;border-radius:8px;border:1px solid #e2e8f0;background:#1e293b;margin-bottom:8px;" ' +
                    'data-layout="' + escHtml(JSON.stringify(m.cutLayout)) + '"></canvas>';
            }
            var sobrantesHtml = '';
            if (totalSobrantes === 0) {
                sobrantesHtml = '<div class="text-slate-400 italic text-xs py-2">No hay material sobrante (retales) disponible</div>';
            } else {
                sobrantesHtml = '<div class="space-y-1.5">';
                m.sobrantes.forEach(function(sob, sIdx) {
                    var dimLabel = sob.largo + 'x' + sob.ancho + ' mm';
                    if (sob.cutoutW && sob.cutoutH) {
                        dimLabel += ' (forma L, muesca ' + sob.cutoutW + 'x' + sob.cutoutH + ')';
                    }
                    sobrantesHtml += '<div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs">' +
                        '<span class="font-bold text-slate-700"><i class="fas fa-recycle text-amber-500 mr-1.5"></i>Retal #' + (sIdx + 1) + ': ' + dimLabel + '</span>' +
                        '<div class="flex items-center gap-2">' +
                        '<span class="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-bold text-[9px]">Listo para usar</span>' +
                        '<button onclick="window.Provisionar.eliminarRetal(\'' + m.id + '\', ' + sIdx + ')" class="text-rose-400 hover:text-rose-600 p-1"><i class="fas fa-trash-can"></i></button>' +
                        '</div>' +
                        '</div>';
                });
                sobrantesHtml += '</div>';
            }

            var usadosHtml = '';
            if (totalUsados === 0) {
                usadosHtml = '<div class="text-slate-400 italic text-xs py-2">No hay registros de uso previo</div>';
            } else {
                usadosHtml = '<div class="space-y-1.5 max-h-[150px] overflow-y-auto custom-scrollbar">';
                m.usados.forEach(function(usd, uIdx) {
                    var fechaFormato = usd.fecha ? new Date(usd.fecha).toLocaleString() : 'Fecha de uso';
                    usadosHtml += '<div class="flex items-center justify-between border-b border-slate-100 py-1.5 text-[11px]">' +
                        '<span class="text-slate-600 font-medium"><i class="fas fa-clock text-slate-400 mr-1.5"></i>' + fechaFormato + '</span>' +
                        '<span class="font-mono text-slate-500">Uso: ' + (usd.areaUsadaPct || 100).toFixed(1) + '%</span>' +
                        '<span class="font-bold ' + (usd.retalGenerado ? 'text-emerald-600' : 'text-slate-400') + '">' + (usd.retalGenerado ? 'Retal creado' : 'Consumido') + '</span>' +
                        '</div>';
                });
                usadosHtml += '</div>';
            }

            html += '<tr id="accordion-row-' + m.id + '" class="hidden bg-slate-50/50">' +
                '<td colspan="10" class="py-4 px-8 border-b border-slate-200">' +
                (cutPreviewHtml ? '<div class="mb-4"><h5 class="text-xs font-black uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-2"><i class="fas fa-scissors text-rose-400"></i>Vista del Corte Realizado</h5>' + cutPreviewHtml + '</div>' : '') +
                '<div class="grid grid-cols-1 md:grid-cols-2 gap-8">' +
                '<!-- Sección Sobrantes -->' +
                '<div>' +
                '<h5 class="text-xs font-black uppercase text-slate-500 tracking-wider mb-2.5 flex items-center justify-between">' +
                '<span><i class="fas fa-recycle text-amber-500 mr-1.5"></i>Retales Sobrantes</span>' +
                '<span class="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-bold text-[9px]">' + totalSobrantes + ' piezas</span>' +
                '</h5>' +
                sobrantesHtml +
                '</div>' +
                '<!-- Sección Historial Usados -->' +
                '<div>' +
                '<h5 class="text-xs font-black uppercase text-slate-500 tracking-wider mb-2.5 flex items-center justify-between">' +
                '<span><i class="fas fa-history text-slate-500 mr-1.5"></i>Historial de Cortes</span>' +
                '<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold text-[9px]">' + totalUsados + ' veces</span>' +
                '</h5>' +
                usadosHtml +
                '</div>' +
                '</div>' +
                '</td>' +
                '</tr>';
        });

        tbody.innerHTML = html;
        // Pintar los mini canvas de preview de corte (en retazos que ya tienen cutLayout)
        setTimeout(function() { dibujarCutPreviews(); }, 50);
        renderCADMaterialPalette();
    }

    function dibujarCutPreviews() {
        var canvases = document.querySelectorAll('[id^="cut-preview-"]');
        canvases.forEach(function(canvas) {
            var raw = canvas.getAttribute('data-layout');
            if (!raw) return;
            var layout;
            try { layout = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')); } catch(e) { return; }
            dibujarUnCutPreview(canvas, layout);
        });
    }

    function dibujarUnCutPreview(canvas, layout) {
        var ctx = canvas.getContext('2d');
        var W = canvas.width;
        var H = canvas.height;
        var lL = layout.laminaLargo || 2440;
        var lA = layout.laminaAncho || 1220;
        var margin = 6;
        var scaleX = (W - margin * 2) / lL;
        var scaleY = (H - margin * 2) / lA;
        var sc = Math.min(scaleX, scaleY);
        var offX = margin + (W - margin * 2 - lL * sc) / 2;
        var offY = margin + (H - margin * 2 - lA * sc) / 2;

        ctx.clearRect(0, 0, W, H);

        // Ejes cruzados: cutoutW = maxX (dim ancho → vertical), cutoutH = maxY (dim largo → horizontal)
        var cutHpx = (layout.cutoutH || 0) * sc; // horizontal (largo dimension)
        var cutWpx = (layout.cutoutW || 0) * sc; // vertical (ancho dimension)
        var sheetW = lL * sc;
        var sheetH = lA * sc;

        if (cutHpx > 0 && cutWpx > 0) {
            // Marco completo punteado de la lámina original
            ctx.strokeStyle = '#475569';
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.strokeRect(offX, offY, sheetW, sheetH);
            ctx.setLineDash([]);

            // Muesca recortada (rojo) — esquina superior izquierda
            ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.lineWidth = 1;
            ctx.fillRect(offX, offY, cutHpx, cutWpx);
            ctx.strokeRect(offX, offY, cutHpx, cutWpx);

            // Silueta en L del retazo útil (verde)
            ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(offX, offY + cutWpx);          // izquierda, debajo del cutout
            ctx.lineTo(offX + cutHpx, offY + cutWpx); // esquina interior de la L
            ctx.lineTo(offX + cutHpx, offY);           // sube al borde superior
            ctx.lineTo(offX + sheetW, offY);           // borde superior derecho
            ctx.lineTo(offX + sheetW, offY + sheetH); // baja al fondo derecho
            ctx.lineTo(offX, offY + sheetH);           // fondo izquierdo
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Etiquetas
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 8px sans-serif';
            ctx.fillText('RETAZO (forma L)', offX + cutHpx + 4, offY + 10);
            ctx.fillStyle = '#fca5a5';
            ctx.font = '7px sans-serif';
            ctx.fillText('Cortado', offX + 3, offY + cutWpx / 2 + 3);
        } else {
            // Retazo rectangular (sin muesca)
            ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
            ctx.fillRect(offX, offY, sheetW, sheetH);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(offX, offY, sheetW, sheetH);
        }
    }

    function eliminarRetal(materialId, index) {
        var mat = materiales.find(function(m) { return m.id === materialId; });
        if (mat && mat.sobrantes) {
            mat.sobrantes.splice(index, 1);
            guardarMateriales();
            renderMateriales();
            renderSelectMateriales();
        }
    }

    window.toggleMaterialAccordion = function(id) {
        var el = document.getElementById('accordion-row-' + id);
        var icon = document.getElementById('accordion-icon-' + id);
        if (el) {
            if (el.classList.contains('hidden')) {
                el.classList.remove('hidden');
                if (icon) icon.classList.replace('fa-chevron-right', 'fa-chevron-down');
            } else {
                el.classList.add('hidden');
                if (icon) icon.classList.replace('fa-chevron-down', 'fa-chevron-right');
            }
        }
    };

    function renderSelectMateriales() {
        var select = document.getElementById('opt-material-select');
        if (!select) return;
        select.innerHTML = '<option value="">-- Seleccionar material --</option>' +
            materiales.map(function(m) {
                return '<option value="' + m.id + '">' + escHtml(m.nombre) + ' (' + m.largo + 'x' + m.ancho + 'mm, $' + m.costoM2.toFixed(2) + '/m²)</option>';
            }).join('');
        // También actualizar costo de plancha
        select.onchange = function() {
            var mat = materiales.find(function(m) { return m.id === select.value; });
            if (mat) {
                document.getElementById('opt-lamina-largo').value = mat.largo;
                document.getElementById('opt-lamina-ancho').value = mat.ancho;
                document.getElementById('costeo-costo-plancha').value = mat.costoPlancha.toFixed(2);
            }
        };
    }

    // ─── CAD File Handling (Multi-capas) ──────────────────────
    function initCADDropZone() {
        var dropzone = document.getElementById('cad-dropzone');
        var input = document.getElementById('cad-file-input');
        if (!dropzone || !input) return;

        dropzone.onclick = function() { input.click(); };

        dropzone.ondragover = function(e) { e.preventDefault(); dropzone.classList.add('border-amber-500', 'bg-amber-50/50'); };
        dropzone.ondragleave = function(e) { dropzone.classList.remove('border-amber-500', 'bg-amber-50/50'); };
        dropzone.ondrop = function(e) {
            e.preventDefault();
            dropzone.classList.remove('border-amber-500', 'bg-amber-50/50');
            if (e.dataTransfer.files.length) procesarArchivosCAD(e.dataTransfer.files);
        };

        input.onchange = function() {
            if (input.files.length) procesarArchivosCAD(input.files);
        };
    }

    function procesarArchivosCAD(files) {
        var promises = [];
        Array.from(files).forEach(function(file) {
            var ext = file.name.split('.').pop().toLowerCase();
            var capa = {
                id: 'capa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                nombre: file.name,
                ext: ext,
                size: file.size,
                visible: true,
                piezas: [],
                entities: []
            };

            var p = new Promise(function(resolve) {
                var reader = new FileReader();
                reader.onload = function(e) {
                    var content = e.target.result;
                    if (ext === 'dxf') {
                        parsearDXF(content, capa);
                    } else if (ext === 'svg') {
                        parsearSVG(content, capa);
                    } else if (ext === 'pdf') {
                        parsearPDF(content, capa);
                    } else {
                        parsearDXF(content, capa);
                    }
                    capasCAD.push(capa);
                    resolve();
                };

                if (ext === 'svg' || ext === 'dxf') {
                    reader.readAsText(file);
                } else {
                    reader.readAsDataURL(file);
                }
            });
            promises.push(p);
        });

        Promise.all(promises).then(function() {
            renderCapas();
            actualizarPiezasCAD();
            redibujarCanvasCAD();
            // Limpiar input file
            var input = document.getElementById('cad-file-input');
            if (input) input.value = '';
        });
    }

    function renderCapas() {
        var list = document.getElementById('cad-layers-list');
        if (!list) return;
        document.getElementById('cad-layers-count').textContent = capasCAD.length;
        if (capasCAD.length === 0) {
            list.innerHTML = '<div class="text-center py-4 text-xs text-slate-400 italic">No hay archivos cargados</div>';
            return;
        }
        list.innerHTML = capasCAD.map(function(c) {
            var icon = 'fa-file-code';
            if (c.ext === 'dxf') icon = 'fa-pen-ruler';
            if (c.ext === 'svg') icon = 'fa-circle-dot';
            if (c.ext === 'pdf') icon = 'fa-file-pdf';
            var eyeIcon = c.visible ? 'fa-eye text-amber-500' : 'fa-eye-slash text-slate-400';
            return '<div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs">' +
                '<div class="flex items-center gap-2 overflow-hidden flex-1 mr-2">' +
                '<i class="fas ' + icon + ' text-slate-500 text-sm"></i>' +
                '<div class="truncate">' +
                '<span class="font-bold text-slate-700 block truncate" title="' + escHtml(c.nombre) + '">' + escHtml(c.nombre) + '</span>' +
                '<span class="text-[9px] text-slate-400 font-mono">' + c.piezas.length + ' piezas | ' + (c.size / 1024).toFixed(1) + ' KB</span>' +
                '</div>' +
                '</div>' +
                '<div class="flex items-center gap-1.5 shrink-0">' +
                '<button onclick="window.toggleCapaVisibilidad(\'' + c.id + '\')" class="p-1 hover:bg-slate-200 rounded" title="Alternar visibilidad"><i class="fas ' + eyeIcon + '"></i></button>' +
                '<button onclick="window.eliminarCapa(\'' + c.id + '\')" class="p-1 hover:bg-slate-200 rounded text-rose-500 hover:text-rose-700" title="Eliminar"><i class="fas fa-trash-can"></i></button>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    window.toggleCapaVisibilidad = function(capaId) {
        var c = capasCAD.find(function(l) { return l.id === capaId; });
        if (c) {
            c.visible = !c.visible;
            renderCapas();
            actualizarPiezasCAD();
            redibujarCanvasCAD();
        }
    };

    window.eliminarCapa = function(capaId) {
        capasCAD = capasCAD.filter(function(l) { return l.id !== capaId; });
        renderCapas();
        actualizarPiezasCAD();
        redibujarCanvasCAD();
    };

    function renderPlanchasActivas() {
        var list = document.getElementById('cad-planchas-list');
        if (!list) return;
        document.getElementById('cad-planchas-count').textContent = planchasActivas.length;
        if (planchasActivas.length === 0) {
            list.innerHTML = '<div class="text-center py-4 text-xs text-slate-400 italic">No hay planchas de material arrastradas</div>';
            return;
        }
        list.innerHTML = planchasActivas.map(function(p, idx) {
            return '<div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs">' +
                '<div class="flex items-center gap-2 overflow-hidden flex-1 mr-2">' +
                '<span class="inline-block w-3.5 h-3.5 rounded-full border border-slate-200" style="background-color:' + p.color + ';"></span>' +
                '<div class="truncate">' +
                '<span class="font-bold text-slate-700 block truncate" title="' + escHtml(p.nombre) + '">' + escHtml(p.nombre) + '</span>' +
                '<span class="text-[9px] text-slate-400 font-mono">' + p.width + ' x ' + p.height + ' mm</span>' +
                '</div>' +
                '</div>' +
                '<div class="flex items-center shrink-0">' +
                '<button onclick="window.eliminarPlancha(\'' + p.id + '\')" class="p-1 hover:bg-slate-200 rounded text-rose-500 hover:text-rose-700" title="Eliminar plancha"><i class="fas fa-trash-can"></i></button>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    window.eliminarPlancha = function(planchaId) {
        planchasActivas = planchasActivas.filter(function(p) { return p.id !== planchaId; });
        redibujarCanvasCAD();
        renderPlanchasActivas();
    };

    // ─── DXF Parser (Por Capa) ────────────────────────────────
    function parsearDXF(content, capa) {
        capa.piezas = [];
        var lines = content.split('\n');
        var i = 0;
        var currentEntity = null;
        var entities = [];
        var pendingX = null;

        while (i < lines.length) {
            var code = lines[i] ? lines[i].trim() : '';
            var value = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
            i += 2;

            if (code === '0') {
                if (currentEntity) { pendingX = null; }
                if (value === 'LWPOLYLINE') {
                    currentEntity = { type: 'LWPOLYLINE', vertices: [], closed: false };
                    entities.push(currentEntity);
                } else if (value === 'POLYLINE') {
                    currentEntity = { type: 'LWPOLYLINE', vertices: [], closed: false };
                    entities.push(currentEntity);
                } else if (value === 'VERTEX') {
                    if (currentEntity && currentEntity.type === 'LWPOLYLINE') { pendingX = null; }
                } else if (value === 'CIRCLE') {
                    currentEntity = { type: 'CIRCLE', cx: 0, cy: 0, radius: 0 };
                    entities.push(currentEntity);
                } else if (value === 'ARC') {
                    currentEntity = { type: 'CIRCLE', cx: 0, cy: 0, radius: 0 };
                    entities.push(currentEntity);
                } else if (value === 'LINE') {
                    currentEntity = { type: 'LINE', x1: 0, y1: 0, x2: 0, y2: 0 };
                    entities.push(currentEntity);
                } else if (value === 'SEQEND' || value === 'ENDSEC' || value === 'EOF') {
                    currentEntity = null;
                    pendingX = null;
                } else {
                    currentEntity = null;
                    pendingX = null;
                }
                continue;
            }

            if (!currentEntity) continue;

            if (currentEntity.type === 'LWPOLYLINE') {
                if (code === '10') {
                    pendingX = parseFloat(value) || 0;
                } else if (code === '20') {
                    var vy = parseFloat(value) || 0;
                    if (pendingX !== null) {
                        currentEntity.vertices.push({ x: pendingX, y: vy });
                        pendingX = null;
                    }
                } else if (code === '70') {
                    currentEntity.closed = (parseInt(value) & 1) === 1;
                }
            } else if (currentEntity.type === 'CIRCLE') {
                if (code === '10') currentEntity.cx = parseFloat(value) || 0;
                if (code === '20') currentEntity.cy = parseFloat(value) || 0;
                if (code === '40') currentEntity.radius = parseFloat(value) || 0;
            } else if (currentEntity.type === 'LINE') {
                if (code === '10') currentEntity.x1 = parseFloat(value) || 0;
                if (code === '20') currentEntity.y1 = parseFloat(value) || 0;
                if (code === '11') currentEntity.x2 = parseFloat(value) || 0;
                if (code === '21') currentEntity.y2 = parseFloat(value) || 0;
            }
        }

        capa.entities = entities;
        extraerPiezasDeEntidades(entities, capa);
    }

    // ─── SVG Parser (Por Capa) ────────────────────────────────
    function parsearSVG(content, capa) {
        capa.piezas = [];
        var parser = new DOMParser();
        var svgDoc = parser.parseFromString(content, 'image/svg+xml');
        var rects = svgDoc.querySelectorAll('rect');
        var paths = svgDoc.querySelectorAll('path');
        var circles = svgDoc.querySelectorAll('circle');

        // Extraer rectángulos individuales
        rects.forEach(function(r, idx) {
            var w = parseFloat(r.getAttribute('width') || 0);
            var h = parseFloat(r.getAttribute('height') || 0);
            if (w > 2 && h > 2) {
                capa.piezas.push({
                    id: capa.id + '_rect_' + idx,
                    width: w,
                    height: h,
                    originalX: parseFloat(r.getAttribute('x') || 0),
                    originalY: parseFloat(r.getAttribute('y') || 0),
                    label: r.getAttribute('id') || (capa.nombre + ' - Figura ' + (capa.piezas.length + 1)),
                    qty: 1,
                    selected: true,
                    materialId: null,
                    shapeType: 'rect'
                });
            }
        });

        // Extraer círculos individuales
        circles.forEach(function(c, idx) {
            var r = parseFloat(c.getAttribute('r') || 0);
            if (r > 1) {
                var cx = parseFloat(c.getAttribute('cx') || 0);
                var cy = parseFloat(c.getAttribute('cy') || 0);
                capa.piezas.push({
                    id: capa.id + '_circle_' + idx,
                    width: r * 2,
                    height: r * 2,
                    originalX: cx - r,
                    originalY: cy - r,
                    label: c.getAttribute('id') || (capa.nombre + ' - Círculo ' + (capa.piezas.length + 1)),
                    qty: 1,
                    selected: true,
                    materialId: null,
                    shapeType: 'circle'
                });
            }
        });

        // Extraer trayectos/letras individuales
        if (paths.length > 0) {
            var tempContainer = document.createElement('div');
            tempContainer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;visibility:hidden;';
            document.body.appendChild(tempContainer);
            var tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            tempSvg.setAttribute('width', '0');
            tempSvg.setAttribute('height', '0');
            tempContainer.appendChild(tempSvg);

            paths.forEach(function(p, idx) {
                try {
                    var cloned = document.importNode(p, true);
                    tempSvg.appendChild(cloned);
                    var bbox = cloned.getBBox();
                    if (bbox.width > 2 && bbox.height > 2) {
                        capa.piezas.push({
                            id: capa.id + '_path_' + idx,
                            width: bbox.width,
                            height: bbox.height,
                            originalX: bbox.x,
                            originalY: bbox.y,
                            label: p.getAttribute('id') || (capa.nombre + ' - Elemento ' + (capa.piezas.length + 1)),
                            qty: 1,
                            selected: true,
                            materialId: null,
                            shapeType: 'path',
                            pathD: p.getAttribute('d'),
                            bboxX: bbox.x,
                            bboxY: bbox.y,
                            bboxW: bbox.width,
                            bboxH: bbox.height
                        });
                    }
                    tempSvg.removeChild(cloned);
                } catch(e) { }
            });
            document.body.removeChild(tempContainer);
        }

        // Fallback si no se pudieron desglosar elementos individuales
        if (capa.piezas.length === 0) {
            capa.piezas.push({
                id: capa.id + '_svg_group',
                width: 300,
                height: 200,
                originalX: 0,
                originalY: 0,
                label: capa.nombre,
                qty: 1,
                selected: true,
                materialId: null
            });
        }
    }

    function parsearPDF(content, capa) {
        capa.piezas = [];
        Swal.fire({ icon: 'info', title: 'PDF cargado', text: 'La extracción automática de geometría desde PDF requiere procesamiento en el servidor. Agrega las piezas manualmente para este archivo.', confirmButtonText: 'Entendido' }).then(function() {
            abrirModalPiezaManual(capa);
        });
        // Mostrar como preview en placeholder
        document.getElementById('cad-preview-placeholder').innerHTML = '<iframe src="' + content + '" class="w-full h-full absolute inset-0" style="min-height:300px"></iframe>';
        document.getElementById('cad-preview-placeholder').classList.remove('hidden');
    }

    function abrirModalPiezaManual(capa) {
        Swal.fire({
            title: 'Agregar Pieza Manual',
            html:
                '<div class="space-y-3 text-left">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Nombre / Identificador</label>' +
                '<input id="swal-manual-name" class="w-full px-3 py-2 border rounded-xl font-bold text-slate-700 outline-none" placeholder="Letra H, Placa base, etc."></div>' +
                '<div class="grid grid-cols-2 gap-3">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Largo (mm)</label>' +
                '<input id="swal-manual-w" type="number" class="w-full px-3 py-2 border rounded-xl font-bold text-slate-700 outline-none" value="100"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Ancho (mm)</label>' +
                '<input id="swal-manual-h" type="number" class="w-full px-3 py-2 border rounded-xl font-bold text-slate-700 outline-none" value="100"></div>' +
                '</div>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Añadir',
            preConfirm: function() {
                var name = document.getElementById('swal-manual-name').value.trim();
                var w = parseFloat(document.getElementById('swal-manual-w').value) || 0;
                var h = parseFloat(document.getElementById('swal-manual-h').value) || 0;
                if (!name) return Swal.showValidationMessage('El nombre es requerido');
                if (w <= 0 || h <= 0) return Swal.showValidationMessage('El ancho y alto deben ser mayores a 0');
                return { name: name, w: w, h: h };
            }
        }).then(function(r) {
            if (r.isConfirmed) {
                capa.piezas.push({
                    id: capa.id + '_man_' + capa.piezas.length,
                    width: r.value.w,
                    height: r.value.h,
                    originalX: 0,
                    originalY: 0,
                    label: r.value.name,
                    qty: 1,
                    selected: true,
                    materialId: null
                });
                actualizarPiezasCAD();
                redibujarCanvasCAD();
            }
        });
    }

    function extraerPiezasDeEntidades(entities, capa) {
        if (!capa.piezas) capa.piezas = [];
        var piezasExtraidas = [];

        if (entities && entities.length > 0) {
            // 1. Extraer polígonos, letras y figuras independientes del DXF
            entities.forEach(function(ent, i) {
                if (!ent) return;
                var type = (ent.type || '').toUpperCase();

                if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && ent.vertices && ent.vertices.length >= 2) {
                    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    ent.vertices.forEach(function(v) {
                        if (v && !isNaN(v.x) && !isNaN(v.y)) {
                            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
                            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
                        }
                    });
                    var w = maxX - minX;
                    var h = maxY - minY;
                    if (w > 2 && h > 2) {
                        var relVerts = ent.vertices.map(function(v) {
                            return { x: v.x - minX, y: v.y - minY };
                        });
                        piezasExtraidas.push({
                            id: capa.id + '_poly_' + i,
                            width: w,
                            height: h,
                            originalX: minX,
                            originalY: minY,
                            label: (ent.layer ? (capa.nombre + ' (' + ent.layer + ')') : capa.nombre) + ' - Pieza ' + (piezasExtraidas.length + 1),
                            qty: 1,
                            selected: true,
                            materialId: null,
                            shapeType: 'polygon',
                            vertices: relVerts,
                            entities: [ent],
                            minX: minX,
                            minY: minY
                        });
                    }
                } else if (type === 'CIRCLE' || type === 'ARC') {
                    var r = ent.radius || 10;
                    var cx = ent.cx !== undefined ? ent.cx : (ent.x || 0);
                    var cy = ent.cy !== undefined ? ent.cy : (ent.y || 0);
                    if (r > 1) {
                        piezasExtraidas.push({
                            id: capa.id + '_circle_' + i,
                            width: r * 2,
                            height: r * 2,
                            originalX: cx - r,
                            originalY: cy - r,
                            label: capa.nombre + ' - Círculo ' + (piezasExtraidas.length + 1),
                            qty: 1,
                            selected: true,
                            materialId: null,
                            shapeType: 'circle',
                            entities: [ent],
                            minX: cx - r,
                            minY: cy - r
                        });
                    }
                }
            });
        }

        // Si se encontraron figuras independientes, usarlas. De lo contrario, usar el contenedor global.
        if (piezasExtraidas.length > 0) {
            capa.piezas = piezasExtraidas;
        } else {
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            if (entities) {
                entities.forEach(function(ent) {
                    if (ent.vertices) {
                        ent.vertices.forEach(function(v) {
                            if (v && !isNaN(v.x) && !isNaN(v.y)) {
                                minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
                                minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
                            }
                        });
                    } else {
                        var x = ent.x !== undefined ? ent.x : (ent.x1 !== undefined ? ent.x1 : ent.cx);
                        var y = ent.y !== undefined ? ent.y : (ent.y1 !== undefined ? ent.y1 : ent.cy);
                        if (x !== undefined && !isNaN(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
                        if (y !== undefined && !isNaN(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
                    }
                });
            }
            var width = (minX !== Infinity && maxX !== -Infinity && (maxX - minX) > 0) ? (maxX - minX) : 250;
            var height = (minY !== Infinity && maxY !== -Infinity && (maxY - minY) > 0) ? (maxY - minY) : 150;
            var origX = minX !== Infinity ? minX : 0;
            var origY = minY !== Infinity ? minY : 0;

            capa.piezas = [{
                id: capa.id + '_pieza_group',
                width: width,
                height: height,
                originalX: origX,
                originalY: origY,
                label: capa.nombre || 'Pieza Vectorial',
                qty: 1,
                selected: true,
                materialId: null,
                entities: entities || [],
                minX: origX,
                minY: origY
            }];
        }
    }

    function solapanOCercano(a, b, tol) {
        return !(a.x + a.w + tol < b.x || b.x + b.w + tol < a.x ||
                 a.y + a.h + tol < b.y || b.y + b.h + tol < a.y);
    }

    function actualizarPiezasCAD() {
        // 1. Consolidar incondicionalmente piezasCAD de todas las capas
        piezasCAD = [];
        capasCAD.forEach(function(c) {
            if (c.visible !== false) {
                // Si la capa no tiene piezas, extraer de sus entidades o crear fallback
                if (!c.piezas || c.piezas.length === 0) {
                    extraerPiezasDeEntidades(c.entities || [], c);
                }
                if (c.piezas && c.piezas.length > 0) {
                    c.piezas.forEach(function(p) {
                        p.capaNombre = c.nombre;
                        piezasCAD.push(p);
                    });
                }
            }
        });

        // 2. Renderizar en el DOM si el elemento existe
        var tbody = document.getElementById('cad-pieces-table-body');
        var countEl = document.getElementById('cad-entities-count');

        if (countEl) {
            countEl.textContent = piezasCAD.length + ' piezas';
        }

        if (!tbody) return;

        if (piezasCAD.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-400 italic">No hay piezas cargadas</td></tr>';
            return;
        }

        document.getElementById('cad-entities-count').textContent = piezasCAD.length + ' piezas';

        tbody.innerHTML = piezasCAD.map(function(p, i) {
            var materialOptions = '<option value="">Sin asignar</option>' +
                materiales.map(function(m) { return '<option value="' + m.id + '"' + (p.materialId === m.id ? ' selected' : '') + '>' + escHtml(m.nombre) + '</option>'; }).join('');
            
            var matColor = '#64748b'; // color gris por defecto
            if (p.materialId) {
                var activeMat = materiales.find(function(m) { return m.id === p.materialId; });
                if (activeMat) matColor = activeMat.color || '#e28743';
            }

            var checkedAttr = p.selected !== false ? 'checked' : '';

            return '<tr class="hover:bg-slate-50 transition-colors border-l-4" style="border-left-color:' + matColor + ';">' +
                '<td class="py-2.5 px-3 text-center"><input type="checkbox" class="rounded text-amber-600 focus:ring-amber-500" ' + checkedAttr + ' onchange="window.Provisionar.togglePieza(' + i + ', this.checked)"></td>' +
                '<td class="py-2.5 px-3 font-medium text-slate-700">' +
                '<span class="font-bold text-slate-800">' + escHtml(p.label) + '</span>' +
                '<span class="block text-[9px] text-slate-400 truncate">Origen: ' + escHtml(p.capaNombre) + '</span>' +
                '<span class="block font-mono text-[9px] text-slate-500 mt-0.5">' + p.width.toFixed(1) + ' x ' + p.height.toFixed(1) + ' mm</span>' +
                '</td>' +
                '<td class="py-2.5 px-3 text-center"><input type="number" value="' + (p.qty || 1) + '" min="1" class="w-12 px-1 py-0.5 border border-slate-200 rounded-lg text-center font-bold text-slate-700" onchange="window.Provisionar.setPiezaQty(' + i + ', this.value)"></td>' +
                '<td class="py-2.5 px-3"><select class="w-full px-1.5 py-0.5 border border-slate-200 rounded-lg font-bold text-slate-700 text-xs" onchange="window.Provisionar.asignarMaterial(' + i + ', this.value)">' + materialOptions + '</select></td>' +
                '</tr>';
        }).join('');
    }

    function togglePieza(idx, active) {
        if (piezasCAD[idx]) {
            piezasCAD[idx].selected = active;
            actualizarPiezasCAD();
            redibujarCanvasCAD();
        }
    }

    function setPiezaQty(idx, qty) {
        if (piezasCAD[idx]) {
            piezasCAD[idx].qty = Math.max(1, parseInt(qty) || 1);
            actualizarPiezasCAD();
            redibujarCanvasCAD();
        }
    }

    function asignarMaterial(idx, materialId) {
        if (piezasCAD[idx]) {
            piezasCAD[idx].materialId = materialId || null;
            actualizarPiezasCAD();
            redibujarCanvasCAD();
        }
    }

    // ─── Transformación de coordenadas del Visor CAD ──────────
    // Calcula la escala base y offsets para el contenido (sin cámara)
    function getCADTransformInfo() {
        var capasVisibles = capasCAD.filter(function(c) { return c.visible; });
        if (capasVisibles.length === 0) return null;

        var allX = [], allY = [];
        capasVisibles.forEach(function(c) {
            if (c.entities) {
                c.entities.forEach(function(ent) {
                    if (ent.type === 'LWPOLYLINE' && ent.vertices) {
                        ent.vertices.forEach(function(v) { allX.push(v.x); allY.push(v.y); });
                    } else if (ent.type === 'CIRCLE') {
                        allX.push(ent.cx - ent.radius); allX.push(ent.cx + ent.radius);
                        allY.push(ent.cy - ent.radius); allY.push(ent.cy + ent.radius);
                    } else if (ent.type === 'LINE') {
                        allX.push(ent.x1); allX.push(ent.x2);
                        allY.push(ent.y1); allY.push(ent.y2);
                    }
                });
            }
            if (c.piezas) {
                c.piezas.forEach(function(p) {
                    var ox = (p.originalX || 0) + (p.offsetX || 0);
                    var oy = (p.originalY || 0) + (p.offsetY || 0);
                    allX.push(ox); allX.push(ox + p.width);
                    allY.push(oy); allY.push(oy + p.height);
                });
            }
        });

        planchasActivas.forEach(function(pl) {
            var ox = pl.originalX + pl.offsetX;
            var oy = pl.originalY + pl.offsetY;
            allX.push(ox); allX.push(ox + pl.width);
            allY.push(oy); allY.push(oy + pl.height);
        });

        if (allX.length === 0) return null;

        var canvas = document.getElementById('cad-canvas');
        if (!canvas) return null;

        var minX = Math.min.apply(null, allX);
        var maxX = Math.max.apply(null, allX);
        var minY = Math.min.apply(null, allY);
        var maxY = Math.max.apply(null, allY);
        var rangeX = maxX - minX || 1;
        var rangeY = maxY - minY || 1;

        var scale = Math.min(canvas.width / rangeX, canvas.height / rangeY) * 0.82;
        var offsetX = (canvas.width - rangeX * scale) / 2 - minX * scale;
        var offsetY = (canvas.height + rangeY * scale) / 2 - maxY * scale;

        return { scale: scale, offsetX: offsetX, offsetY: offsetY, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    }

    // Detectar si el ratón está sobre una pieza (en coordenadas de pantalla)
    function hitTestPieza(screenX, screenY) {
        var info = getCADTransformInfo();
        if (!info) return null;

        var s = info.scale * cadCam.zoom;

        // 1. Iterar las piezas de cada capa visible (prioridad alta: arriba)
        for (var ci = capasCAD.length - 1; ci >= 0; ci--) {
            var c = capasCAD[ci];
            if (!c.visible) continue;
            for (var pi = c.piezas.length - 1; pi >= 0; pi--) {
                var p = c.piezas[pi];
                if (p.selected === false) continue;

                var px = (p.originalX || 0) + (p.offsetX || 0);
                var py = (p.originalY || 0) + (p.offsetY || 0);

                var rx = (px * info.scale + info.offsetX) * cadCam.zoom + cadCam.panX;
                var ry = (-py * info.scale + info.offsetY) * cadCam.zoom + cadCam.panY;
                var rw = p.width * s;
                var rh = -p.height * s;

                var left = Math.min(rx, rx + rw);
                var right = Math.max(rx, rx + rw);
                var top = Math.min(ry, ry + rh);
                var bottom = Math.max(ry, ry + rh);

                if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
                    return { type: 'piece', capaIdx: ci, pieceIdx: pi };
                }
            }
        }

        // 2. Iterar planchasActivas (fondo)
        for (var i = planchasActivas.length - 1; i >= 0; i--) {
            var pl = planchasActivas[i];
            var px = pl.originalX + pl.offsetX;
            var py = pl.originalY + pl.offsetY;

            var rx = (px * info.scale + info.offsetX) * cadCam.zoom + cadCam.panX;
            var ry = (-py * info.scale + info.offsetY) * cadCam.zoom + cadCam.panY;
            var rw = pl.width * s;
            var rh = -pl.height * s; // Invertir Y

            var left = Math.min(rx, rx + rw);
            var right = Math.max(rx, rx + rw);
            var top = Math.min(ry, ry + rh);
            var bottom = Math.max(ry, ry + rh);

            if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
                return { type: 'plancha', capaIdx: -1, pieceIdx: i };
            }
        }
        
        return null;
    }

    // ─── Preview Dibujo (Superposición Multi-capas + Cámara) ─
    function redibujarCanvasCAD() {
        var canvas = document.getElementById('cad-canvas');
        if (!canvas) return;
        var container = document.getElementById('cad-preview-canvas');
        if (!container) return;

        canvas.width = container.clientWidth || 500;
        canvas.height = container.clientHeight || 400;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Filtrar capas visibles
        var capasVisibles = capasCAD.filter(function(c) { return c.visible; });

        if (capasVisibles.length === 0) {
            document.getElementById('cad-preview-placeholder').classList.remove('hidden');
            return;
        }
        document.getElementById('cad-preview-placeholder').classList.add('hidden');

        // Fondo oscuro estilo CAD Blueprint
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        var info = getCADTransformInfo();
        if (!info) return;
        var scale = info.scale;
        var offsetX = info.offsetX;
        var offsetY = info.offsetY;

        // Aplicar transformaciones de la cámara
        ctx.save();
        ctx.translate(cadCam.panX, cadCam.panY);
        ctx.scale(cadCam.zoom, cadCam.zoom);

        // Dibujar Grid (Rejilla de fondo)
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.5 / cadCam.zoom;
        var gridSpacing = 50;
        var startGridX = Math.floor(info.minX / gridSpacing) * gridSpacing;
        var endGridX = Math.ceil(info.maxX / gridSpacing) * gridSpacing;
        var startGridY = Math.floor(info.minY / gridSpacing) * gridSpacing;
        var endGridY = Math.ceil(info.maxY / gridSpacing) * gridSpacing;

        for (var gx = startGridX; gx <= endGridX; gx += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(gx * scale + offsetX, -10000);
            ctx.lineTo(gx * scale + offsetX, 10000);
            ctx.stroke();
        }
        for (var gy = startGridY; gy <= endGridY; gy += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(-10000, -gy * scale + offsetY);
            ctx.lineTo(10000, -gy * scale + offsetY);
            ctx.stroke();
        }

        // Dibujar planchas de material arrastradas
        planchasActivas.forEach(function(pl, i) {
            var isDragging = cadDrag.active && cadDrag.mode === 'piece' && cadDrag.type === 'plancha' && cadDrag.pieceIdx === i;
            var px = pl.originalX + pl.offsetX;
            var py = pl.originalY + pl.offsetY;

            var rx = px * scale + offsetX;
            var ry = -py * scale + offsetY;
            var rw = pl.width * scale;
            var rh = -pl.height * scale;

            var mat = materiales.find(function(m) { return m.id === pl.materialId || m.id === pl.id; });
            if (mat && mat.cutLayout) {
                var cl = mat.cutLayout;
                // Dibujar marco de la plancha original de donde salió el retazo
                ctx.strokeStyle = '#64748b';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1 / cadCam.zoom;
                var origW = cl.laminaAncho * scale;
                var origH = -cl.laminaLargo * scale;
                ctx.strokeRect(rx, ry, origW, origH);
                ctx.setLineDash([]);

                // Dibujar marcas de piezas cortadas previamente en rojo desvanecido
                if (cl.piezas && cl.piezas.length > 0) {
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
                    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                    ctx.lineWidth = 1 / cadCam.zoom;
                    cl.piezas.forEach(function(cp) {
                        var cpx = rx + cp.x * scale;
                        var cpy = ry - cp.y * scale;
                        var cpw = cp.w * scale;
                        var cph = -cp.h * scale;
                        ctx.fillRect(cpx, cpy, cpw, cph);
                        ctx.strokeRect(cpx, cpy, cpw, cph);
                    });
                }
            }

            // Dibujar área del retazo / material activo
            ctx.fillStyle = hexToRgba(pl.color || '#10b981', isDragging ? 0.9 : 0.75);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = (isDragging ? 3 : 1.5) / cadCam.zoom;

            // Si es un retazo con muesca (L-shape), dibujar polígono en L
            // IMPORTANTE: ejes están cruzados entre optimización y CAD canvas:
            //   pl.width = mat.largo (horizontal en CAD), pl.height = mat.ancho (vertical en CAD)
            //   cutoutW = maxX (dimensión ancho → vertical en CAD)
            //   cutoutH = maxY (dimensión largo → horizontal en CAD)
            var cutH_px = (pl.cutoutH || 0) * scale; // horizontal extent of cutout
            var cutW_px = (pl.cutoutW || 0) * scale; // vertical extent of cutout

            if (cutH_px > 0 && cutW_px > 0 && ((pl.cutoutH || 0) < pl.width || (pl.cutoutW || 0) < pl.height)) {
                // Coordenadas absolutas del rectángulo de la lámina
                var top   = ry + rh; // rh es negativo → top está arriba
                var bot   = ry;      // bottom
                var left  = rx;
                var right = rx + rw;

                // La muesca (cutout) está en la esquina superior-izquierda de la lámina
                var cutRight = left + cutH_px;   // borde derecho del cutout
                var cutBot   = top + cutW_px;    // borde inferior del cutout

                // Polígono L (verde): toda la lámina menos la muesca sup-izq
                ctx.beginPath();
                ctx.moveTo(left, cutBot);      // izquierda, al nivel inferior del cutout
                ctx.lineTo(cutRight, cutBot);  // esquina interior de la L
                ctx.lineTo(cutRight, top);     // sube al borde superior
                ctx.lineTo(right, top);        // borde superior derecho
                ctx.lineTo(right, bot);        // baja al fondo derecho
                ctx.lineTo(left, bot);         // fondo izquierdo
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Muesca (área cortada) en rojo translúcido
                ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                ctx.setLineDash([3, 3]);
                ctx.lineWidth = 1 / cadCam.zoom;
                ctx.fillRect(left, top, cutH_px, cutW_px);
                ctx.strokeRect(left, top, cutH_px, cutW_px);
                ctx.setLineDash([]);
            } else {
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeRect(rx, ry, rw, rh);
            }

            // Texto descriptivo del material
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold ' + Math.max(8, 11 / cadCam.zoom) + 'px sans-serif';
            ctx.fillText(pl.nombre, rx + (5/cadCam.zoom), ry + (15/cadCam.zoom));
            
            ctx.font = 'normal ' + Math.max(7, 9 / cadCam.zoom) + 'px monospace';
            ctx.fillText(pl.width + 'x' + pl.height + 'mm', rx + (5/cadCam.zoom), ry + (28/cadCam.zoom));
        });

        // Dibujar el contenido de cada capa
        capasVisibles.forEach(function(c, ci) {
            var pieza = c.piezas && c.piezas.length > 0 ? c.piezas[0] : null;
            var isDragging = cadDrag.active && cadDrag.mode === 'piece' && cadDrag.capaIdx === ci;
            var dragOffsetX = pieza ? (pieza.offsetX || 0) : 0;
            var dragOffsetY = pieza ? (pieza.offsetY || 0) : 0;

            // Dibujar entidades de la capa (Diseño Real) si existen
            if (c.entities && c.entities.length > 0) {
                ctx.strokeStyle = isDragging ? '#e28743' : '#e2e8f0'; // Destacar si se arrastra
                ctx.lineWidth = (isDragging ? 2 : 1) / cadCam.zoom;
                ctx.beginPath();
                c.entities.forEach(function(ent) {
                    if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length >= 2) {
                        ctx.moveTo((ent.vertices[0].x + dragOffsetX) * scale + offsetX, -(ent.vertices[0].y + dragOffsetY) * scale + offsetY);
                        for (var k = 1; k < ent.vertices.length; k++) {
                            ctx.lineTo((ent.vertices[k].x + dragOffsetX) * scale + offsetX, -(ent.vertices[k].y + dragOffsetY) * scale + offsetY);
                        }
                        if (ent.closed) ctx.closePath();
                    } else if (ent.type === 'CIRCLE') {
                        ctx.arc((ent.cx + dragOffsetX) * scale + offsetX, -(ent.cy + dragOffsetY) * scale + offsetY, ent.radius * scale, 0, Math.PI * 2);
                    } else if (ent.type === 'LINE') {
                        ctx.moveTo((ent.x1 + dragOffsetX) * scale + offsetX, -(ent.y1 + dragOffsetY) * scale + offsetY);
                        ctx.lineTo((ent.x2 + dragOffsetX) * scale + offsetX, -(ent.y2 + dragOffsetY) * scale + offsetY);
                    }
                });
                ctx.stroke();
            }

            // Si no tiene entidades (ej: es un PDF o manual), dibujar la caja roja
            if (!c.entities || c.entities.length === 0) {
                if (pieza) {
                    var px = (pieza.originalX || 0) + dragOffsetX;
                    var py = (pieza.originalY || 0) + dragOffsetY;

                    ctx.fillStyle = hexToRgba('#ef4444', isDragging ? 0.25 : 0.12);
                    ctx.strokeStyle = '#ef4444';
                    ctx.lineWidth = (isDragging ? 3 : 2) / cadCam.zoom;

                    var rx = px * scale + offsetX;
                    var ry = -py * scale + offsetY;
                    var rw = pieza.width * scale;
                    var rh = -pieza.height * scale;

                    ctx.fillRect(rx, ry, rw, rh);
                    ctx.strokeRect(rx, ry, rw, rh);

                    ctx.fillStyle = '#ef4444';
                    ctx.font = 'bold ' + Math.max(8, 12 / cadCam.zoom) + 'px sans-serif';
                    ctx.fillText(pieza.label, rx + (5/cadCam.zoom), ry - (5/cadCam.zoom));
                }
            }
        });

        ctx.restore();

        // Indicador de nivel de zoom (esquina superior izquierda, fuera de la transformación)
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Zoom: ' + (cadCam.zoom * 100).toFixed(0) + '%', 8, 8);
    }

    // Helper para convertir color HEX a RGBA
    function hexToRgba(hex, alpha) {
        var c;
        if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
            c= hex.substring(1).split('');
            if(c.length== 3){
                c= [c[0], c[0], c[1], c[1], c[2], c[2]];
            }
            c= '0x' + c.join('');
            return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
        }
        return 'rgba(100,100,100,'+alpha+')';
    }

    // Variables de estado adicionales para el Nesting Multimaterial
    var nestingResultados = {};
    var activeNestingMaterialId = null;
    var activeNestingPlanchaIndex = 0;

    // ─── Optimización de Cortes (Nesting Multimaterial 2D) ───
    // ─── Web Worker — Inicialización ─────────────────────────
    function initNestingWorker() {
        try {
            _nestingWorker = new Worker('src/modules/provisionar/provisionar-worker.js');

            _nestingWorker.onmessage = function(e) {
                _nestingEnCurso = false;
                _setBtnOptimizar(false);

                if (!e.data.ok) {
                    console.error('[Provisionar] Worker error:', e.data.error);
                    Swal.fire({ icon: 'error', title: 'Error en optimización', text: e.data.error });
                    return;
                }

                var r = e.data.resultado;
                nestingResultados = r.nestingResultados;
                activeNestingMaterialId = r.activeNestingMaterialId;
                activeNestingPlanchaIndex = 0;

                renderResultadosMultimaterial();
                actualizarResultadosMaterialActivo();

                var optContainer = document.getElementById('opt-material-result-content');
                if (optContainer) {
                    optContainer.classList.remove('hidden');
                    setTimeout(function() {
                        optContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                }

                var numMats = Object.keys(nestingResultados).length;
                Swal.fire({
                    icon: 'success',
                    title: 'Optimización completada',
                    text: 'Se procesaron ' + numMats + ' material' + (numMats !== 1 ? 'es' : '') + '.',
                    timer: 2000,
                    showConfirmButton: false
                });
            };

            _nestingWorker.onerror = function(err) {
                _nestingEnCurso = false;
                _setBtnOptimizar(false);
                console.error('[Provisionar] Worker onerror:', err);
                Swal.fire({ icon: 'error', title: 'Error en el hilo de optimización', text: err.message });
            };

            console.log('[Provisionar] Web Worker de nesting listo.');
        } catch (err) {
            console.warn('[Provisionar] No se pudo iniciar el Web Worker:', err.message);
            _nestingWorker = null;
        }
    }

    function _setBtnOptimizar(enCurso) {
        var btn = document.getElementById('btn-optimizar-cortes');
        if (!btn) return;
        btn.disabled = enCurso;
        btn.innerHTML = enCurso
            ? '<i class="fas fa-spinner fa-spin mr-2"></i>Calculando...'
            : '<i class="fas fa-bolt mr-2"></i>Optimizar Corte';
    }

    function optimizarCortes() {
        var kerf = parseFloat(document.getElementById('opt-kerf').value) || 0;
        var costoHora = parseFloat(document.getElementById('opt-costo-hora').value) || 0;

        // 1. Consolidar de forma inmediata las piezasCAD activas
        actualizarPiezasCAD();

        if (piezasCAD.length === 0) {
            // Si hay capas cargadas pero piezasCAD estaba vacío, forzar extracción
            if (capasCAD.length > 0) {
                capasCAD.forEach(function(c) {
                    extraerPiezasDeEntidades(c.entities || [], c);
                });
                actualizarPiezasCAD();
            }
            
            // Si aun así está vacío, no hay piezas que mostrar (el usuario debe cargar un archivo CAD)
            if (piezasCAD.length === 0) {
                actualizarPiezasCAD();
            }
        }

        // 2. Garantizar que existe al menos 1 material registrado
        if (materiales.length === 0) {
            var matDef = {
                id: 'mat_default_auto',
                nombre: 'Acrílico 3mm',
                largo: 2440,
                ancho: 1220,
                espesor: 3,
                costoM2: 25,
                areaM2: (2440 * 1220) / 1000000,
                costoPlancha: ((2440 * 1220) / 1000000) * 25,
                stock: 5,
                color: '#e28743',
                propiedades: 'Auto-creado para optimización'
            };
            materiales.push(matDef);
            guardarMateriales();
            renderMateriales();
            renderSelectMateriales();
        }

        // 3. Determinar el material por defecto más idóneo (Plancha activa o Primer material)
        var defaultMatId = planchasActivas.length > 0 ? planchasActivas[0].materialId : materiales[0].id;

        // 4. Auto-asignación robusta e infalible para todas las capas y piezas
        capasCAD.forEach(function(c) {
            c.piezas.forEach(function(p) {
                var existeMat = materiales.some(function(m) { return m.id === p.materialId; });
                if (!p.materialId || !existeMat) {
                    p.materialId = defaultMatId;
                }
                if (p.selected === undefined) p.selected = true;
            });
        });

        actualizarPiezasCAD();
        redibujarCanvasCAD();

        // 5. Agrupar piezas seleccionadas por material asignado
        var piezasPorMaterial = {};
        piezasCAD.forEach(function(p) {
            if (p.selected !== false && p.materialId) {
                if (!piezasPorMaterial[p.materialId]) {
                    piezasPorMaterial[p.materialId] = [];
                }
                for (var q = 0; q < (p.qty || 1); q++) {
                    piezasPorMaterial[p.materialId].push({
                        w: p.width + kerf,
                        h: p.height + kerf,
                        label: p.label,
                        originalW: p.width,
                        originalH: p.height,
                        shapeType: p.shapeType,
                        vertices: p.vertices,
                        pathD: p.pathD,
                        bboxX: p.bboxX,
                        bboxY: p.bboxY,
                        bboxW: p.bboxW,
                        bboxH: p.bboxH,
                        entities: p.entities,
                        minX: p.minX,
                        minY: p.minY
                    });
                }
            }
        });

        var materialIds = Object.keys(piezasPorMaterial);
        
        // Fallback defensivo si todas las piezas estaban desmarcadas
        if (materialIds.length === 0) {
            piezasCAD.forEach(function(p) {
                p.selected = true;
                p.materialId = defaultMatId;
                if (!piezasPorMaterial[defaultMatId]) piezasPorMaterial[defaultMatId] = [];
                for (var q = 0; q < (p.qty || 1); q++) {
                    piezasPorMaterial[defaultMatId].push({
                        w: p.width + kerf,
                        h: p.height + kerf,
                        label: p.label,
                        originalW: p.width,
                        originalH: p.height,
                        shapeType: p.shapeType,
                        vertices: p.vertices,
                        pathD: p.pathD,
                        bboxX: p.bboxX,
                        bboxY: p.bboxY,
                        bboxW: p.bboxW,
                        bboxH: p.bboxH,
                        entities: p.entities,
                        minX: p.minX,
                        minY: p.minY
                    });
                }
            });
            materialIds = Object.keys(piezasPorMaterial);
        }

        if (_nestingEnCurso) return; // Evitar doble envío

        // 2. Construir mapa de materiales por ID para el worker
        var materialesMap = {};
        materialIds.forEach(function(matId) {
            var mat = materiales.find(function(m) { return m.id === matId; });
            if (mat) materialesMap[matId] = mat;
        });

        nestingResultados = {};

        // 3. Si hay worker disponible, delegar al hilo secundario
        if (_nestingWorker) {
            _nestingEnCurso = true;
            _setBtnOptimizar(true);
            _nestingWorker.postMessage({
                materialIds: materialIds,
                piezasPorMaterial: piezasPorMaterial,
                materialesMap: materialesMap,
                kerf: kerf,
                costoHora: costoHora
            });
        } else {
            // Fallback: ejecutar en el hilo principal si el Worker no está disponible
            console.warn('[Provisionar] Worker no disponible — ejecutando nesting en hilo principal.');
            _optimizarCortesSincrono(materialIds, piezasPorMaterial, materialesMap, kerf, costoHora);
        }
    }

    // Fallback síncrono (mismo algoritmo que el worker, usado si Worker falla)
    function _optimizarCortesSincrono(materialIds, piezasPorMaterial, materialesMap, kerf, costoHora) {
        materialIds.forEach(function(matId) {
            var mat = materialesMap[matId];
            if (!mat) return;

            var laminaX = mat.largo;
            var laminaY = mat.ancho;
            var piezasACortar = piezasPorMaterial[matId];

            piezasACortar.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

            var cutoutH = mat.cutoutH || 0; // extensión horizontal del cutout (largo)
            var cutoutW = mat.cutoutW || 0; // extensión vertical del cutout (ancho)

            var startX = function(y) { return y < cutoutW ? cutoutH : 0; };
            var widthAvail = function(y) { return y < cutoutW ? Math.max(0, laminaX - cutoutH) : laminaX; };

            var planchas = [];
            var planchaActual = [];
            var currentY = 0;
            var currentX = startX(currentY);
            var espacioRestanteX = widthAvail(currentY);
            var espacioRestanteY = laminaY;
            var rowHeight = 0;

            function _crearPiezaColocada(x, y, w, h, pieza, labelSuffix) {
                return {
                    x: x, y: y, w: w, h: h,
                    label: pieza.label + (labelSuffix ? (' ' + labelSuffix) : ''),
                    shapeType: pieza.shapeType,
                    vertices: pieza.vertices,
                    pathD: pieza.pathD,
                    bboxX: pieza.bboxX, bboxY: pieza.bboxY, bboxW: pieza.bboxW, bboxH: pieza.bboxH,
                    originalW: pieza.originalW, originalH: pieza.originalH,
                    entities: pieza.entities,
                    minX: pieza.minX,
                    minY: pieza.minY
                };
            }

            piezasACortar.forEach(function(pieza) {
                var w = pieza.w, h = pieza.h;
                var originalW = pieza.originalW, originalH = pieza.originalH;

                if (w <= espacioRestanteX && h <= espacioRestanteY) {
                    planchaActual.push(_crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, ''));
                    currentX += w; espacioRestanteX -= w; rowHeight = Math.max(rowHeight, h);
                } else if (h <= espacioRestanteX && w <= espacioRestanteY) {
                    planchaActual.push(_crearPiezaColocada(currentX, currentY, originalH, originalW, pieza, '(Rotada)'));
                    currentX += h; espacioRestanteX -= h; rowHeight = Math.max(rowHeight, w);
                } else {
                    currentY += rowHeight; espacioRestanteY -= rowHeight;
                    currentX = startX(currentY); espacioRestanteX = widthAvail(currentY); rowHeight = 0;
                    var maxWRow = widthAvail(currentY);
                    if (w <= maxWRow && h <= espacioRestanteY) {
                        planchaActual.push(_crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, ''));
                        currentX += w; espacioRestanteX -= w; rowHeight = Math.max(rowHeight, h);
                    } else if (h <= maxWRow && w <= espacioRestanteY) {
                        planchaActual.push(_crearPiezaColocada(currentX, currentY, originalH, originalW, pieza, '(Rotada)'));
                        currentX += h; espacioRestanteX -= h; rowHeight = Math.max(rowHeight, w);
                    } else {
                        if (planchaActual.length) planchas.push(planchaActual);
                        currentY = 0; currentX = startX(currentY); espacioRestanteX = widthAvail(currentY); espacioRestanteY = laminaY; rowHeight = 0;
                        if (w <= maxWRow && h <= laminaY) {
                            planchaActual = [_crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, '')];
                            currentX += w; espacioRestanteX -= w; rowHeight = Math.max(rowHeight, h);
                        } else if (h <= maxWRow && w <= laminaY) {
                            planchaActual = [_crearPiezaColocada(currentX, currentY, originalH, originalW, pieza, '(Rotada)')];
                            currentX += h; espacioRestanteX -= h; rowHeight = Math.max(rowHeight, w);
                        } else {
                            var pNo = _crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, '');
                            pNo.noCabe = true;
                            planchaActual = [pNo];
                        }
                    }
                }
            });
            if (planchaActual.length) planchas.push(planchaActual);

            var totalPiezas = piezasACortar.length;
            var totalPlanchas = planchas.length;
            var areaTotalPlancha = (cutoutW > 0 && cutoutH > 0)
                ? ((laminaX * laminaY) - (cutoutW * cutoutH))
                : (laminaX * laminaY);
            var areaUsadaTotal = 0;
            var planchasDetalle = planchas.map(function(p, idx) {
                var areaUsada = p.reduce(function(s, pc) { return s + pc.w * pc.h; }, 0);
                areaUsadaTotal += areaUsada;
                return { index: idx + 1, piezas: p, areaUsada: areaUsada, areaTotal: areaTotalPlancha, desperdicio: areaTotalPlancha - areaUsada, usoPct: (areaUsada / areaTotalPlancha * 100) };
            });
            var usoTotalPct = totalPlanchas > 0 ? (areaUsadaTotal / (totalPlanchas * areaTotalPlancha)) * 100 : 0;
            var perimetroTotal = 0;
            planchas.forEach(function(p) { p.forEach(function(pc) { perimetroTotal += 2 * (pc.w + pc.h); }); });
            var costoOperativo = ((perimetroTotal / 20 + totalPlanchas * 5) / 3600) * costoHora;

            nestingResultados[matId] = {
                material: mat, planchas: planchasDetalle,
                totalPiezas: totalPiezas, totalPlanchas: totalPlanchas,
                areaUsadaTotal: areaUsadaTotal, usoPct: usoTotalPct,
                desperdicioPct: 100 - usoTotalPct, costoOperativo: costoOperativo
            };
        });

        activeNestingMaterialId = materialIds[0];
        activeNestingPlanchaIndex = 0;
        renderResultadosMultimaterial();
        actualizarResultadosMaterialActivo();
        var numMats = Object.keys(nestingResultados).length;
        Swal.fire({ icon: 'success', title: 'Optimización completada', text: 'Se procesaron ' + numMats + ' material' + (numMats !== 1 ? 'es' : '') + '.', timer: 2000, showConfirmButton: false });
    }

    function renderResultadosMultimaterial() {
        var tabs = document.getElementById('opt-materials-tabs');
        if (!tabs) return;

        var matIds = Object.keys(nestingResultados);
        if (matIds.length === 0) {
            tabs.innerHTML = '<div class="text-slate-400 text-xs italic py-2">Realiza la optimización para ver los resultados</div>';
            return;
        }

        tabs.innerHTML = matIds.map(function(matId) {
            var res = nestingResultados[matId];
            var color = res.material.color || '#e28743';
            var activeClass = (matId === activeNestingMaterialId)
                ? 'border-amber-600 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';

            return '<button onclick="window.Provisionar.cambiarMaterialOptimizado(\'' + matId + '\')" class="flex items-center gap-2 px-4 py-2 border rounded-xl font-bold text-xs transition-all whitespace-nowrap ' + activeClass + '">' +
                '<span class="w-2.5 h-2.5 rounded-full" style="background-color:' + color + ';"></span>' +
                escHtml(res.material.nombre) +
                '<span class="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[9px]">' + res.totalPlanchas + ' Planchas</span>' +
                '</button>';
        }).join('');
    }

    function cambiarMaterialOptimizado(matId) {
        activeNestingMaterialId = matId;
        activeNestingPlanchaIndex = 0;
        renderResultadosMultimaterial();
        actualizarResultadosMaterialActivo();
    }

    function actualizarResultadosMaterialActivo() {
        var content = document.getElementById('opt-material-result-content');
        if (!content) return;

        var res = nestingResultados[activeNestingMaterialId];
        if (!res) {
            content.classList.add('hidden');
            return;
        }

        content.classList.remove('hidden');

        // Métricas
        document.getElementById('opt-mat-total-piezas').textContent = res.totalPiezas;
        document.getElementById('opt-mat-planchas-necesarias').textContent = res.totalPlanchas;
        document.getElementById('opt-mat-uso-pct').textContent = res.usoPct.toFixed(1) + '%';
        document.getElementById('opt-mat-desperdicio-pct').textContent = res.desperdicioPct.toFixed(1) + '%';

        // Título del material y paginador
        document.getElementById('opt-layout-material-title').textContent = res.material.nombre;
        document.getElementById('opt-layout-material-title').style.backgroundColor = res.material.color || '#e28743';
        document.getElementById('opt-plancha-page').textContent = 'Plancha ' + (activeNestingPlanchaIndex + 1) + '/' + res.totalPlanchas;

        // Redibujar plancha
        dibujarLayoutCortes();

        // Llenar tabla detallada
        var tbody = document.getElementById('opt-planchas-table-body');
        tbody.innerHTML = res.planchas.map(function(p) {
            var colorClass = p.usoPct > 70 ? 'text-emerald-600' : (p.usoPct > 40 ? 'text-amber-600' : 'text-rose-600');
            return '<tr class="hover:bg-slate-50 border-b border-slate-100">' +
                '<td class="py-2 px-4 font-bold text-slate-700">Plancha #' + p.index + '</td>' +
                '<td class="py-2 px-4 text-right font-mono font-bold text-slate-700">' + res.material.largo + 'x' + res.material.ancho + ' mm</td>' +
                '<td class="py-2 px-4 text-right font-mono font-bold text-emerald-600">' + (p.areaUsada / 1000000).toFixed(3) + ' m²</td>' +
                '<td class="py-2 px-4 text-right font-mono font-bold text-slate-500">' + ((p.areaTotal - p.areaUsada) / 1000000).toFixed(3) + ' m²</td>' +
                '<td class="py-2 px-4 text-right font-mono font-bold ' + colorClass + '">' + p.usoPct.toFixed(1) + '%</td>' +
                '</tr>';
        }).join('');

        // Sincronizar con pestaña de Cotizaciones (Suma total de todos los materiales)
        var totalCostoMateriales = 0;
        var totalCostoCortes = 0;
        Object.keys(nestingResultados).forEach(function(mId) {
            var r = nestingResultados[mId];
            totalCostoMateriales += r.totalPlanchas * r.material.costoPlancha;
            totalCostoCortes += r.costoOperativo;
        });

        // Actualizar los inputs de la pestaña costeo de la app
        var matCostoInput = document.getElementById('costeo-costo-plancha');
        var corteCostoInput = document.getElementById('costeo-costo-corte');
        if (matCostoInput) matCostoInput.value = totalCostoMateriales.toFixed(2);
        if (corteCostoInput) corteCostoInput.value = totalCostoCortes.toFixed(2);

        // Crear una versión consolidada del resultadoCortes global para los reportes de cotización
        resultadoCortes = {
            totalPlanchas: Object.keys(nestingResultados).reduce(function(sum, mId) { return sum + nestingResultados[mId].totalPlanchas; }, 0),
            totalPiezas: Object.keys(nestingResultados).reduce(function(sum, mId) { return sum + nestingResultados[mId].totalPiezas; }, 0),
            areaUsadaTotal: Object.keys(nestingResultados).reduce(function(sum, mId) { return sum + nestingResultados[mId].areaUsadaTotal; }, 0),
            usoPct: Object.keys(nestingResultados).reduce(function(sum, mId) { return sum + nestingResultados[mId].usoPct; }, 0) / Object.keys(nestingResultados).length,
            costoOperativo: totalCostoCortes,
            materialId: activeNestingMaterialId // para mantener fallback
        };

        actualizarCotizacion();
    }

    function cambiarPlancha(dir) {
        var res = nestingResultados[activeNestingMaterialId];
        if (!res) return;
        activeNestingPlanchaIndex = Math.max(0, Math.min(res.totalPlanchas - 1, activeNestingPlanchaIndex + dir));
        document.getElementById('opt-plancha-page').textContent = 'Plancha ' + (activeNestingPlanchaIndex + 1) + '/' + res.totalPlanchas;
        dibujarLayoutCortes();
    }

    function dibujarLayoutCortes() {
        var canvas = document.getElementById('opt-canvas');
        if (!canvas) return;
        var wrapper = document.getElementById('opt-layout-canvas-wrapper');
        if (!wrapper) return;

        var res = nestingResultados[activeNestingMaterialId];
        if (!res || !res.planchas.length) return;

        var plancha = res.planchas[activeNestingPlanchaIndex];
        var mat = res.material;
        var laminaX = mat.largo;
        var laminaY = mat.ancho;

        canvas.width = wrapper.clientWidth || 600;
        canvas.height = 400;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo oscuro estilo blueprint
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calcular escala base para encajar la lámina (orientación horizontal unificada: X=largo, Y=ancho)
        var scale = Math.min(canvas.width / laminaX, canvas.height / laminaY) * 0.88;
        var offsetX = (canvas.width - laminaX * scale) / 2;
        var offsetY = (canvas.height - laminaY * scale) / 2;

        // Aplicar transformaciones de la cámara
        ctx.save();
        ctx.translate(layoutCam.panX, layoutCam.panY);
        ctx.scale(layoutCam.zoom, layoutCam.zoom);

        // Dibujar lámina física de material (L-Shape o Rectangular)
        var cH = mat.cutoutH || (mat.cutLayout ? mat.cutLayout.cutoutH : 0) || 0; // extensión horizontal (largo)
        var cW = mat.cutoutW || (mat.cutLayout ? mat.cutLayout.cutoutW : 0) || 0; // extensión vertical (ancho)

        if (cH > 0 && cW > 0) {
            var cHpx = cH * scale;
            var cWpx = cW * scale;
            var sheetWpx = laminaX * scale;
            var sheetHpx = laminaY * scale;

            // Muesca recortada previamente (rojo translúcido punteado)
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1 / layoutCam.zoom;
            ctx.fillRect(offsetX, offsetY, cHpx, cWpx);
            ctx.strokeRect(offsetX, offsetY, cHpx, cWpx);
            ctx.setLineDash([]);

            // Polígono L de la lámina útil (fondo blueprint)
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.5 / layoutCam.zoom;

            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + cWpx);                // izquierda, debajo del cutout
            ctx.lineTo(offsetX + cHpx, offsetY + cWpx);         // esquina interior de la L
            ctx.lineTo(offsetX + cHpx, offsetY);                // sube al borde superior
            ctx.lineTo(offsetX + sheetWpx, offsetY);            // borde superior derecho
            ctx.lineTo(offsetX + sheetWpx, offsetY + sheetHpx); // abajo derecha
            ctx.lineTo(offsetX, offsetY + sheetHpx);            // abajo izquierda
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(offsetX, offsetY, laminaX * scale, laminaY * scale);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.5 / layoutCam.zoom;
            ctx.strokeRect(offsetX, offsetY, laminaX * scale, laminaY * scale);
        }

        // Dibujar un grid fino dentro de la plancha
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.15)';
        ctx.lineWidth = 0.5 / layoutCam.zoom;
        var spacing = 100;
        for (var sx = spacing; sx < laminaX; sx += spacing) {
            ctx.beginPath();
            ctx.moveTo(offsetX + sx * scale, offsetY);
            ctx.lineTo(offsetX + sx * scale, offsetY + laminaY * scale);
            ctx.stroke();
        }
        for (var sy = spacing; sy < laminaY; sy += spacing) {
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + sy * scale);
            ctx.lineTo(offsetX + laminaX * scale, offsetY + sy * scale);
            ctx.stroke();
        }

        // Color del material
        var colorMaterial = mat.color || '#e28743';

        // Dibujar las piezas colocadas
        plancha.piezas.forEach(function(piece) {
            var rx = offsetX + piece.x * scale;
            var ry = offsetY + piece.y * scale;
            var rw = piece.w * scale;
            var rh = piece.h * scale;

            ctx.save();

            if (piece.noCabe) {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
                ctx.strokeStyle = '#ef4444';
            } else {
                ctx.fillStyle = hexToRgba(colorMaterial, 0.15);
                ctx.strokeStyle = colorMaterial;
            }
            if (_modoVistaLayout === 'boxes') {
                // Modo Cajas de Ocupación: cuadros sólidos
                ctx.fillStyle = hexToRgba(colorMaterial, 0.45);
                ctx.strokeStyle = colorMaterial;
                ctx.lineWidth = 1.5 / layoutCam.zoom;
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeRect(rx, ry, rw, rh);
            } else {
                // Modo Vectores CAD: siluetas vectoriales reales
                ctx.fillStyle = hexToRgba(colorMaterial, 0.1);
                ctx.strokeStyle = hexToRgba(colorMaterial, 0.3);
                ctx.lineWidth = 1 / layoutCam.zoom;
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeRect(rx, ry, rw, rh);

                if (!piece.noCabe) {
                    _dibujarSiluetaCADPieza(ctx, piece, rx, ry, rw, rh, colorMaterial);
                }
            }

            // Nombre y dimensiones de la pieza (escalado correcto de fuente con zoom)
            var screenRw = rw * layoutCam.zoom;
            var screenRh = rh * layoutCam.zoom;
            if (screenRw >= 28 && screenRh >= 16) {
                var fontInWorld = Math.min(rh * 0.3, 11 / layoutCam.zoom);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold ' + fontInWorld + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                var lbl = piece.label.length > 12 ? piece.label.substr(0, 10) + '..' : piece.label;
                ctx.fillText(lbl, rx + rw / 2, ry + rh / 2 - fontInWorld * 0.55);
                ctx.fillStyle = hexToRgba(colorMaterial, 0.95);
                ctx.font = (fontInWorld * 0.8) + 'px monospace';
                ctx.fillText(piece.w.toFixed(0) + 'x' + piece.h.toFixed(0), rx + rw / 2, ry + rh / 2 + fontInWorld * 0.55);
            }

            ctx.restore();
        });

        ctx.restore();

        // Info fuera de la transformación
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        var modoTexto = _modoVistaLayout === 'cad' ? 'Vectores CAD' : 'Cajas de Ocupación';
        ctx.fillText('Plancha ' + plancha.index + '/' + res.totalPlanchas + ' | Modo: ' + modoTexto + ' | Uso: ' + plancha.usoPct.toFixed(1) + '% | Zoom: ' + (layoutCam.zoom * 100).toFixed(0) + '%', 8, 14);
    }

    function _dibujarSiluetaCADPieza(ctx, piece, rx, ry, rw, rh, colorMaterial) {
        ctx.fillStyle = hexToRgba(colorMaterial, 0.45);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / layoutCam.zoom;

        if (piece.entities && piece.entities.length > 0) {
            var origW = piece.originalW || piece.w || 1;
            var origH = piece.originalH || piece.h || 1;
            var mX = piece.minX || 0;
            var mY = piece.minY || 0;

            piece.entities.forEach(function(ent) {
                var type = (ent.type || '').toUpperCase();
                if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && ent.vertices && ent.vertices.length >= 2) {
                    ctx.beginPath();
                    ent.vertices.forEach(function(v, vIdx) {
                        var vx = rx + ((v.x - mX) / origW) * rw;
                        var vy = ry + ((v.y - mY) / origH) * rh;
                        if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
                    });
                    if (ent.closed) ctx.closePath();
                    ctx.stroke();
                } else if (type === 'CIRCLE') {
                    ctx.beginPath();
                    var cx = rx + ((ent.cx - mX) / origW) * rw;
                    var cy = ry + ((ent.cy - mY) / origH) * rh;
                    var rad = (ent.radius / origW) * rw;
                    ctx.arc(cx, cy, Math.max(1, rad), 0, Math.PI * 2);
                    ctx.stroke();
                } else if (type === 'LINE') {
                    ctx.beginPath();
                    var lx1 = rx + ((ent.x1 - mX) / origW) * rw;
                    var ly1 = ry + ((ent.y1 - mY) / origH) * rh;
                    var lx2 = rx + ((ent.x2 - mX) / origW) * rw;
                    var ly2 = ry + ((ent.y2 - mY) / origH) * rh;
                    ctx.moveTo(lx1, ly1);
                    ctx.lineTo(lx2, ly2);
                    ctx.stroke();
                }
            });
        } else if (piece.shapeType === 'polygon' && piece.vertices && piece.vertices.length >= 2) {
            ctx.beginPath();
            piece.vertices.forEach(function(v, vIdx) {
                var vx = rx + (v.x / (piece.originalW || piece.w || 1)) * rw;
                var vy = ry + (v.y / (piece.originalH || piece.h || 1)) * rh;
                if (vIdx === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else if (piece.shapeType === 'circle' || (piece.label && piece.label.toLowerCase().includes('círculo'))) {
            ctx.beginPath();
            ctx.arc(rx + rw / 2, ry + rh / 2, Math.min(rw, rh) / 2 - 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (piece.shapeType === 'path' && piece.pathD) {
            try {
                ctx.save();
                ctx.translate(rx, ry);
                var scW = rw / (piece.bboxW || piece.w || 1);
                var scH = rh / (piece.bboxH || piece.h || 1);
                ctx.scale(scW, scH);
                ctx.translate(-(piece.bboxX || 0), -(piece.bboxY || 0));
                var path2d = new Path2D(piece.pathD);
                ctx.fillStyle = hexToRgba(colorMaterial, 0.45);
                ctx.fill(path2d);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = (1.5 / layoutCam.zoom) / Math.max(scW, scH);
                ctx.stroke(path2d);
                ctx.restore();
            } catch(e) {
                _dibujarShapeFallback(ctx, piece, rx, ry, rw, rh, colorMaterial);
            }
        } else {
            _dibujarShapeFallback(ctx, piece, rx, ry, rw, rh, colorMaterial);
        }
    }

    function _dibujarShapeFallback(ctx, piece, rx, ry, rw, rh, colorMaterial) {
        ctx.fillStyle = hexToRgba(colorMaterial, 0.4);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / layoutCam.zoom;
        var chamfer = Math.min(rw, rh) * 0.15;
        ctx.beginPath();
        ctx.moveTo(rx + chamfer, ry);
        ctx.lineTo(rx + rw - chamfer, ry);
        ctx.lineTo(rx + rw, ry + chamfer);
        ctx.lineTo(rx + rw, ry + rh - chamfer);
        ctx.lineTo(rx + rw - chamfer, ry + rh);
        ctx.lineTo(rx + chamfer, ry + rh);
        ctx.lineTo(rx, ry + rh - chamfer);
        ctx.lineTo(rx, ry + chamfer);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        var holeR = Math.min(rw, rh) * 0.08;
        if (holeR > 2) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1 / layoutCam.zoom;
            ctx.beginPath();
            ctx.arc(rx + chamfer + holeR, ry + chamfer + holeR, holeR, 0, Math.PI * 2);
            ctx.arc(rx + rw - chamfer - holeR, ry + chamfer + holeR, holeR, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // ─── Costeo y Cotización ──────────────────────────────────
    function actualizarCotizacion() {
        var costoPlancha = parseFloat(document.getElementById('costeo-costo-plancha').value) || 0;
        var costoCorte = parseFloat(document.getElementById('costeo-costo-corte').value) || 0;
        var gastosAdicionales = parseFloat(document.getElementById('costeo-gastos-adicionales').value) || 0;

        // BLOQUE 5: Márgenes separados (persistidos en localStorage)
        var margenMat = parseFloat(document.getElementById('costeo-margen-mat').value) || 0;
        var margenMO = parseFloat(document.getElementById('costeo-margen-mo').value) || 0;
        var margenFijo = parseFloat(document.getElementById('costeo-margen-fijo').value) || 0;
        // Guardar perfil de márgenes
        try { localStorage.setItem('prov_margen_perfil', JSON.stringify({ margenMat: margenMat, margenMO: margenMO, margenFijo: margenFijo })); } catch(e) {}
        // Compatibilidad: margen global = promedio simple para el reporte
        var margen = Math.round((margenMat + margenMO) / 2);

        var totalPlanchas = 1;
        var costoTotalMaterial = 0;

        if (resultadoCortes && resultadoCortes.totalPlanchas) {
            totalPlanchas = resultadoCortes.totalPlanchas;
            costoTotalMaterial = costoPlancha * totalPlanchas;
            document.getElementById('costeo-resumen-material').innerHTML = 
                '<p class="text-xs text-slate-700 font-bold"><i class="fas fa-circle-check text-emerald-500 mr-1.5"></i>Optimización Real Activa</p>' +
                '<p class="text-[11px] text-slate-500">Planchas requeridas: ' + totalPlanchas + '</p>';
        } else {
            var piezasActivas = piezasCAD.filter(function(p) { return p.selected !== false; });
            if (piezasActivas.length === 0) {
                document.getElementById('costeo-tarjeta').classList.add('hidden');
                document.getElementById('costeo-placeholder').classList.remove('hidden');
                return;
            }
            var areaPiezasM2 = piezasActivas.reduce(function(sum, p) { 
                return sum + ((p.width * p.height * (p.qty || 1)) / 1000000); 
            }, 0);
            var matPrincipal = materiales[0] || { largo: 2440, ancho: 1220 };
            var areaPlanchaM2 = (matPrincipal.largo * matPrincipal.ancho) / 1000000;
            totalPlanchas = Math.ceil(areaPiezasM2 / (areaPlanchaM2 * 0.8)) || 1;
            if (costoPlancha > 0) {
                costoTotalMaterial = costoPlancha * totalPlanchas;
            } else {
                costoPlancha = matPrincipal.costoPlancha || (areaPlanchaM2 * (matPrincipal.costoM2 || 0)) || 0;
                document.getElementById('costeo-costo-plancha').value = costoPlancha.toFixed(2);
                costoTotalMaterial = costoPlancha * totalPlanchas;
            }
            document.getElementById('costeo-resumen-material').innerHTML = 
                '<p class="text-xs text-amber-600 font-bold"><i class="fas fa-calculator mr-1.5"></i>Estimación de Área (Sin Optimizar)</p>' +
                '<p class="text-[11px] text-slate-500">Planchas estimadas: ~' + totalPlanchas + ' (Área total: ' + areaPiezasM2.toFixed(2) + ' m²)</p>';
        }

        // Fórmula de márgenes separados
        var materialConMargen = costoTotalMaterial * (1 + margenMat / 100);
        var corteConMargen = costoCorte * (1 + margenMO / 100);
        var costoProduccion = costoTotalMaterial + costoCorte + gastosAdicionales;
        var precioVenta = materialConMargen + corteConMargen + gastosAdicionales + margenFijo;
        var ganancia = precioVenta - costoProduccion;

        document.getElementById('costeo-tarjeta').classList.remove('hidden');
        document.getElementById('costeo-placeholder').classList.add('hidden');

        document.getElementById('costeo-total-material').textContent = '$' + costoTotalMaterial.toFixed(2);
        document.getElementById('costeo-total-corte').textContent = '$' + costoCorte.toFixed(2);
        document.getElementById('costeo-total-adicionales').textContent = '$' + gastosAdicionales.toFixed(2);
        document.getElementById('costeo-total-produccion').textContent = '$' + costoProduccion.toFixed(2);
        document.getElementById('costeo-margen-aplicado').textContent = margenMat + '% / ' + margenMO + '%';
        document.getElementById('costeo-ganancia-estimada').textContent = '$' + ganancia.toFixed(2);
        document.getElementById('costeo-precio-venta').textContent = '$' + precioVenta.toFixed(2);

        window._cotizacionActiva = {
            costoMaterial: costoTotalMaterial,
            costoCorte: costoCorte,
            gastosAdicionales: gastosAdicionales,
            costoProduccion: costoProduccion,
            margen: margen,
            ganancia: ganancia,
            precioVenta: precioVenta,
            totalPlanchas: totalPlanchas
        };
    }

    function guardarCotizacion() {
        var c = window._cotizacionActiva;
        if (!c) {
            Swal.fire({ icon: 'warning', title: 'Sin cotización', text: 'Carga piezas o materiales para calcular los costos primero.' });
            return;
        }

        var materialUsado = null;
        if (resultadoCortes && resultadoCortes.materialId) {
            materialUsado = materiales.find(function(m) { return m.id === resultadoCortes.materialId; });
        } else {
            materialUsado = materiales[0];
        }

        var cotizacion = {
            id: Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
            fecha: new Date().toISOString(),
            material: materialUsado,
            piezas: piezasCAD.filter(function(p) { return p.selected !== false; }),
            resultadoCortes: {
                totalPiezas: piezasCAD.filter(function(p) { return p.selected !== false; }).length,
                totalPlanchas: c.totalPlanchas,
                usoPct: resultadoCortes ? resultadoCortes.usoPct : 80,
                desperdicioPct: resultadoCortes ? resultadoCortes.desperdicioPct : 20
            },
            cotizacion: c
        };
        cotizaciones.push(cotizacion);
        localStorage.setItem('provisionar_cotizaciones', JSON.stringify(cotizaciones));
        Swal.fire({ icon: 'success', title: 'Cotización guardada', text: '$' + c.precioVenta.toFixed(2), timer: 2000, showConfirmButton: false });
    }

    function imprimirCotizacion() {
        var c = window._cotizacionActiva;
        if (!c) return;
        var win = window.open('', '_blank');
        win.document.write('<html><head><title>Cotización</title>');
        win.document.write('<style>body{font-family:monospace;padding:40px;max-width:600px;margin:auto}' +
            'h1{font-size:24px;border-bottom:3px solid #000;padding-bottom:8px}' +
            '.row{display:flex;justify-content:space-between;padding:6px 0}' +
            '.total{border-top:2px solid #000;font-weight:bold;font-size:18px;padding-top:8px;margin-top:8px}' +
            '.label{color:#666}' +
            '</style></head><body>');
        win.document.write('<h1>COTIZACIÓN</h1>');
        win.document.write('<p>Fecha: ' + new Date().toLocaleDateString() + '</p>');
        win.document.write('<div class="row"><span class="label">Costo Material (' + c.totalPlanchas + ' plancha/s):</span><span>$' + c.costoMaterial.toFixed(2) + '</span></div>');
        win.document.write('<div class="row"><span class="label">Costo Corte:</span><span>$' + c.costoCorte.toFixed(2) + '</span></div>');
        win.document.write('<div class="row"><span class="label">Gastos Adicionales:</span><span>$' + c.gastosAdicionales.toFixed(2) + '</span></div>');
        win.document.write('<div class="row total"><span>Costo Producción:</span><span>$' + c.costoProduccion.toFixed(2) + '</span></div>');
        win.document.write('<div class="row"><span class="label">Margen:</span><span>' + c.margen + '%</span></div>');
        win.document.write('<div class="row"><span class="label">Ganancia:</span><span>$' + c.ganancia.toFixed(2) + '</span></div>');
        win.document.write('<div class="row" style="font-size:22px;font-weight:bold;border-top:3px solid #000;padding-top:10px;margin-top:10px"><span>PRECIO DE VENTA</span><span>$' + c.precioVenta.toFixed(2) + '</span></div>');
        win.document.write('<p style="margin-top:40px;color:#999;font-size:11px">Generado por Caja Fresh POS - Módulo Provisionar</p>');
        win.document.write('</body></html>');
        win.document.close();
        win.print();
    }

    function confirmarRegistroDeCorte() {
        var res = nestingResultados[activeNestingMaterialId];
        if (!res || !res.planchas.length) {
            Swal.fire({ icon: 'warning', title: 'Sin planchas', text: 'No hay planchas calculadas para registrar.' });
            return;
        }

        var plancha = res.planchas[activeNestingPlanchaIndex];
        var mat = res.material;
        var laminaLargo = mat.largo;
        var laminaAncho = mat.ancho;

        // Calcular el mayor rectángulo libre desocupado
        var maxX = 0, maxY = 0;
        plancha.piezas.forEach(function(p) {
            if (!p.noCabe) {
                maxX = Math.max(maxX, p.x + p.w);
                maxY = Math.max(maxY, p.y + p.h);
            }
        });

        // ─── Retazo en forma de L ───────────────────────────────
        var laminaX = mat.largo;
        var laminaY = mat.ancho;
        var prevCutoutH = mat.cutoutH || 0;
        var prevCutoutW = mat.cutoutW || 0;

        var cutoutH = Math.max(prevCutoutH, Math.round(maxX)); // extensión horizontal (largo)
        var cutoutW = Math.max(prevCutoutW, Math.round(maxY)); // extensión vertical (ancho)

        var bandaInfAncho = laminaY - cutoutW;
        var bandaInfLargo = laminaX;
        var bandaDerAncho = laminaY;
        var bandaDerLargo = laminaX - cutoutH;

        var tieneInf = bandaInfLargo >= 150 && bandaInfAncho >= 150;
        var tieneDer = bandaDerLargo >= 150 && bandaDerAncho >= 150;
        var generaRetal = tieneInf || tieneDer;

        var retalLargo = laminaX;
        var retalAncho = laminaY;
        var areaRetazoMM2 = (laminaX * laminaY) - (cutoutH * cutoutW);

        var textoRetal = generaRetal 
            ? '<br><span class="text-emerald-600 font-bold"><i class="fas fa-recycle mr-1"></i> Se generará un retal en forma de L (' + Math.round(laminaX) + 'x' + Math.round(laminaY) + ' mm, muesca ' + Math.round(cutoutH) + 'x' + Math.round(cutoutW) + ' mm).</span>'
            : '<br><span class="text-rose-500 font-medium">El espacio restante no alcanza las dimensiones mínimas para ser catalogado como retal reutilizable.</span>';

        Swal.fire({
            title: '¿Confirmar registro de corte?',
            html: 'Se registrará el corte de la <strong>Plancha #' + plancha.index + '</strong> de <strong>' + escHtml(mat.nombre) + '</strong>.' +
                '<br>Uso de material: <strong>' + plancha.usoPct.toFixed(1) + '%</strong>.' +
                textoRetal +
                '<br><br>Se descontará 1 plancha del inventario y se registrará en el historial.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Registrar Corte',
            cancelButtonText: 'Cancelar'
        }).then(function(r) {
            if (r.isConfirmed) {
                // Descontar plancha
                var matOriginal = materiales.find(function(m) { return m.id === mat.id; });
                if (matOriginal) {
                    if (matOriginal.esSobrante) {
                        matOriginal.stock = 0;
                        matOriginal.consumido = true;
                    } else if (matOriginal.stock <= 0) {
                        Swal.fire({
                            icon: 'warning',
                            title: 'Stock en cero',
                            text: 'El material original no tiene stock registrado, pero se registrará el uso de igual manera.',
                            timer: 2000,
                            showConfirmButton: false
                        });
                    } else {
                        matOriginal.stock = Math.max(0, matOriginal.stock - 1);
                    }

                    // Registrar retal si aplica
                    if (generaRetal) {
                        if (!matOriginal.sobrantes) matOriginal.sobrantes = [];
                        var retalId = 'retal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                        var retalObj = {
                            id: retalId,
                            largo: Math.round(retalLargo),
                            ancho: Math.round(retalAncho),
                            cutoutW: Math.round(cutoutW),
                            cutoutH: Math.round(cutoutH),
                            fecha: new Date().toISOString()
                        };
                        matOriginal.sobrantes.push(retalObj);

                        // Crear material sobrante de primer nivel para que aparezca en la sub-pestaña
                        var areaM2 = areaRetazoMM2 / 1000000;
                        var costoM2 = matOriginal.costoM2 || 0;
                        // Guardar snapshot del layout de corte para visualización
                        var cutLayoutSnapshot = {
                            laminaLargo: laminaLargo,
                            laminaAncho: laminaAncho,
                            cutoutW: Math.round(cutoutW),
                            cutoutH: Math.round(cutoutH),
                            piezas: plancha.piezas.filter(function(p) { return !p.noCabe; }).map(function(p) {
                                return { x: p.x, y: p.y, w: p.w, h: p.h, label: p.label || '' };
                            })
                        };
                        var retazoMaterial = {
                            id: retalId,
                            nombre: 'Retazo L: ' + matOriginal.nombre + ' (' + Math.round(retalLargo) + 'x' + Math.round(retalAncho) + ', muesca ' + Math.round(cutoutW) + 'x' + Math.round(cutoutH) + ' mm)',
                            propiedades: 'Retazo en L sobrante reutilizable derivado de corte',
                            largo: Math.round(retalLargo),
                            ancho: Math.round(retalAncho),
                            cutoutW: Math.round(cutoutW),
                            cutoutH: Math.round(cutoutH),
                            espesor: matOriginal.espesor || 3,
                            costoM2: costoM2,
                            costoPlancha: areaM2 * costoM2,
                            stock: 1,
                            color: '#10b981',
                            esSobrante: true,
                            materialOriginalId: matOriginal.id,
                            tipo: 'Sobrante / Retazo',
                            fecha: new Date().toISOString(),
                            cutLayout: cutLayoutSnapshot
                        };
                        materiales.push(retazoMaterial);

                        // Sincronizar con inventario POS (Material Especial)
                        if (typeof window.registrarMaterialEspecialEnInventario === 'function') {
                            window.registrarMaterialEspecialEnInventario(retazoMaterial);
                        }

                        // BLOQUE 7a: Decrementar stock del producto en POS si existe
                        if (window.products && Array.isArray(window.products)) {
                            var prodPOS = window.products.find(function(p) { return p.id === matOriginal.id || p.name === matOriginal.nombre; });
                            if (prodPOS && prodPOS.stock > 0) {
                                prodPOS.stock = Math.max(0, (prodPOS.stock || 1) - 1);
                                if (typeof window.saveProducts === 'function') window.saveProducts();
                                // Alerta de stock bajo
                                if (prodPOS.stock <= 2) {
                                    Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: '⚠️ Stock bajo: ' + matOriginal.nombre, text: 'Solo quedan ' + prodPOS.stock + ' plancha(s). ¡Reponer pronto!', timer: 5000, showConfirmButton: false });
                                }
                            }
                        }
                    }

                    // Registrar bitácora de usados
                    if (!matOriginal.usados) matOriginal.usados = [];
                    matOriginal.usados.push({
                        fecha: new Date().toISOString(),
                        areaUsadaPct: plancha.usoPct,
                        retalGenerado: generaRetal
                    });

                    guardarMateriales();
                    renderMateriales();
                    renderSelectMateriales();

                    // BLOQUE 7c: Notificar al Jefe (costo + precio venta del corte)
                    var cotActiva = window._cotizacionActiva;
                    if (cotActiva && typeof window._enviarEventoJefe === 'function') {
                        window._enviarEventoJefe({
                            tipo: 'corte_registrado',
                            material: mat.nombre,
                            costoCorte: cotActiva.costoCorte || 0,
                            precioVenta: cotActiva.precioVenta || 0,
                            timestamp: new Date().toISOString()
                        });
                    }
                }

                // Quitar esta plancha de los resultados locales
                res.planchas.splice(activeNestingPlanchaIndex, 1);
                res.totalPlanchas = res.planchas.length;

                // Actualizar índices de las planchas restantes
                res.planchas.forEach(function(p, i) {
                    p.index = i + 1;
                });

                if (res.planchas.length === 0) {
                    // Ya no quedan planchas para este material
                    delete nestingResultados[activeNestingMaterialId];
                    var remainingIds = Object.keys(nestingResultados);
                    if (remainingIds.length === 0) {
                        activeNestingMaterialId = null;
                        resultadoCortes = null;
                        Swal.fire({ icon: 'success', title: '¡Todo completado!', text: 'Se han registrado todas las planchas del proyecto.', timer: 2000, showConfirmButton: false });
                    } else {
                        activeNestingMaterialId = remainingIds[0];
                        activeNestingPlanchaIndex = 0;
                        Swal.fire({ icon: 'success', title: 'Plancha registrada', text: 'Cortes completados para este material.', timer: 1500, showConfirmButton: false });
                    }
                } else {
                    // Volver a la primera plancha restante
                    activeNestingPlanchaIndex = 0;
                    Swal.fire({ icon: 'success', title: 'Plancha registrada', text: 'El stock y retales se han actualizado.', timer: 1500, showConfirmButton: false });
                }

                renderResultadosMultimaterial();
                actualizarResultadosMaterialActivo();
            }
        });
    }

    // ─── Controles de Cámara del Visor CAD ───────────────────
    function zoomCAD(factor) {
        var canvas = document.getElementById('cad-canvas');
        if (!canvas) return;
        var cx = canvas.width / 2;
        var cy = canvas.height / 2;
        cadCam.panX = cx - (cx - cadCam.panX) * factor;
        cadCam.panY = cy - (cy - cadCam.panY) * factor;
        cadCam.zoom *= factor;
        redibujarCanvasCAD();
    }

    function resetearVistaCAD() {
        cadCam = { zoom: 1, panX: 0, panY: 0 };
        redibujarCanvasCAD();
    }

    // ─── Controles de Cámara del Layout de Cortes ────────────
    function zoomLayout(factor) {
        var canvas = document.getElementById('opt-canvas');
        if (!canvas) return;
        var cx = canvas.width / 2;
        var cy = canvas.height / 2;
        layoutCam.panX = cx - (cx - layoutCam.panX) * factor;
        layoutCam.panY = cy - (cy - layoutCam.panY) * factor;
        layoutCam.zoom *= factor;
        dibujarLayoutCortes();
    }

    function resetearVistaLayout() {
        layoutCam = { zoom: 1, panX: 0, panY: 0 };
        dibujarLayoutCortes();
    }

    // ─── Pantalla Completa ───────────────────────────────────
    function toggleFullscreen(elementId) {
        var el = document.getElementById(elementId);
        if (!el) return;
        if (document.fullscreenElement === el) {
            document.exitFullscreen();
        } else {
            el.requestFullscreen().then(function() {
                setTimeout(function() {
                    if (elementId === 'cad-preview-canvas') redibujarCanvasCAD();
                    if (elementId === 'opt-layout-canvas-wrapper') dibujarLayoutCortes();
                }, 200);
            }).catch(function() {});
        }
        document.addEventListener('fullscreenchange', function onFsChange() {
            if (!document.fullscreenElement) {
                setTimeout(function() {
                    redibujarCanvasCAD();
                    dibujarLayoutCortes();
                }, 200);
                document.removeEventListener('fullscreenchange', onFsChange);
            }
        });
    }

    // ─── BLOQUE 4: Edición Manual del Layout de Cortes ────────
    var _layoutEditMode = false;
    var _layoutDrag = { active: false, piezaIdx: -1, startX: 0, startY: 0, origPX: 0, origPY: 0 };

    function toggleLayoutEditMode() {
        _layoutEditMode = !_layoutEditMode;
        var btn = document.getElementById('btn-edit-layout');
        var badge = document.getElementById('layout-edit-badge');
        var tableWrapper = document.getElementById('layout-edit-table-wrapper');
        if (_layoutEditMode) {
            if (btn) { btn.classList.remove('bg-amber-600'); btn.classList.add('bg-rose-600', 'hover:bg-rose-700'); btn.innerHTML = '<i class="fas fa-xmark"></i> Cancelar Edición'; }
            if (badge) badge.classList.remove('hidden');
            if (tableWrapper) tableWrapper.classList.remove('hidden');
            renderLayoutEditTable();
            _initLayoutDragEvents();
        } else {
            if (btn) { btn.classList.remove('bg-rose-600', 'hover:bg-rose-700'); btn.classList.add('bg-amber-600'); btn.innerHTML = '<i class="fas fa-pen"></i> Editar Layout'; }
            if (badge) badge.classList.add('hidden');
            if (tableWrapper) tableWrapper.classList.add('hidden');
        }
        dibujarLayoutCortes();
    }

    function renderLayoutEditTable() {
        var tbody = document.getElementById('layout-edit-tbody');
        if (!tbody) return;
        var res = nestingResultados[activeNestingMaterialId];
        if (!res || !res.planchas || !res.planchas[activeNestingPlanchaIndex]) { tbody.innerHTML = ''; return; }
        var plancha = res.planchas[activeNestingPlanchaIndex];
        var html = '';
        plancha.piezas.forEach(function(p, idx) {
            html += '<tr class="border-b border-slate-100 hover:bg-amber-50/30">' +
                '<td class="py-1.5 px-3 font-bold text-slate-700">' + escHtml(p.label || 'Pieza ' + (idx + 1)) + '</td>' +
                '<td class="py-1.5 px-3 text-right font-mono text-slate-500">' + Math.round(p.w) + '</td>' +
                '<td class="py-1.5 px-3 text-right font-mono text-slate-500">' + Math.round(p.h) + '</td>' +
                '<td class="py-1.5 px-3 text-right"><input type="number" value="' + Math.round(p.x) + '" onchange="window.Provisionar.updatePiezaPosFromTable(' + idx + ', \'x\', this.value)" class="w-16 px-2 py-0.5 border rounded text-right font-mono text-xs font-bold text-slate-700 focus:border-amber-500 outline-none"></td>' +
                '<td class="py-1.5 px-3 text-right"><input type="number" value="' + Math.round(p.y) + '" onchange="window.Provisionar.updatePiezaPosFromTable(' + idx + ', \'y\', this.value)" class="w-16 px-2 py-0.5 border rounded text-right font-mono text-xs font-bold text-slate-700 focus:border-amber-500 outline-none"></td>' +
                '</tr>';
        });
        tbody.innerHTML = html;
    }

    function updatePiezaPosFromTable(idx, axis, val) {
        var res = nestingResultados[activeNestingMaterialId];
        if (!res || !res.planchas || !res.planchas[activeNestingPlanchaIndex]) return;
        var plancha = res.planchas[activeNestingPlanchaIndex];
        if (idx < 0 || idx >= plancha.piezas.length) return;
        var v = parseFloat(val) || 0;
        var mat = res.material;
        if (axis === 'x') { plancha.piezas[idx].x = Math.max(0, Math.min(v, mat.largo - plancha.piezas[idx].w)); }
        if (axis === 'y') { plancha.piezas[idx].y = Math.max(0, Math.min(v, mat.ancho - plancha.piezas[idx].h)); }
        dibujarLayoutCortes();
    }

    function confirmarCambiosLayout() {
        var res = nestingResultados[activeNestingMaterialId];
        if (!res || !res.planchas || !res.planchas[activeNestingPlanchaIndex]) return;
        var plancha = res.planchas[activeNestingPlanchaIndex];
        var mat = res.material;
        var piezas = plancha.piezas;
        var hayError = false;
        for (var i = 0; i < piezas.length && !hayError; i++) {
            for (var j = i + 1; j < piezas.length && !hayError; j++) {
                if (solapanOCercano(piezas[i], piezas[j], 0)) {
                    hayError = true;
                    Swal.fire({ icon: 'warning', title: 'Solapamiento detectado', html: '<b>' + escHtml(piezas[i].label) + '</b> se superpone con <b>' + escHtml(piezas[j].label) + '</b>. Ajusta las posiciones antes de confirmar.' });
                }
            }
        }
        if (hayError) return;
        var areaUsada = piezas.reduce(function(s, p) { return s + p.w * p.h; }, 0);
        var areaTotal = mat.largo * mat.ancho;
        plancha.areaUsada = areaUsada;
        plancha.usoPct = (areaUsada / areaTotal) * 100;
        plancha.desperdicio = areaTotal - areaUsada;
        _layoutEditMode = false;
        toggleLayoutEditMode();
        actualizarResultadosMaterialActivo();
        Swal.fire({ icon: 'success', title: 'Layout actualizado', text: 'Las posiciones de las piezas se han confirmado. Uso: ' + plancha.usoPct.toFixed(1) + '%', timer: 2000, showConfirmButton: false });
    }

    function _initLayoutDragEvents() {
        var canvas = document.getElementById('opt-canvas');
        if (!canvas || canvas._layoutDragInit) return;
        canvas._layoutDragInit = true;

        function getSheetCoords(e, mat) {
            var rect = canvas.getBoundingClientRect();
            var cw = canvas.width || rect.width;
            var ch = canvas.height || 400;
            var scale = Math.min(cw / mat.largo, ch / mat.ancho) * 0.88;
            var ox = (cw - mat.largo * scale) / 2;
            var oy = (ch - mat.ancho * scale) / 2;

            var mx = (e.clientX - rect.left) * (cw / rect.width);
            var my = (e.clientY - rect.top) * (ch / rect.height);

            var unzoomedX = (mx - layoutCam.panX) / layoutCam.zoom;
            var unzoomedY = (my - layoutCam.panY) / layoutCam.zoom;

            return {
                x: (unzoomedX - ox) / scale,
                y: (unzoomedY - oy) / scale,
                scale: scale
            };
        }

        canvas.addEventListener('mousedown', function(e) {
            if (!_layoutEditMode) return;
            var res = nestingResultados[activeNestingMaterialId];
            if (!res || !res.planchas || !res.planchas[activeNestingPlanchaIndex]) return;
            var plancha = res.planchas[activeNestingPlanchaIndex];
            var mat = res.material;
            var pos = getSheetCoords(e, mat);

            for (var i = plancha.piezas.length - 1; i >= 0; i--) {
                var p = plancha.piezas[i];
                if (pos.x >= p.x && pos.x <= p.x + p.w && pos.y >= p.y && pos.y <= p.y + p.h) {
                    _layoutDrag = {
                        active: true,
                        piezaIdx: i,
                        startLx: pos.x,
                        startLy: pos.y,
                        origPX: p.x,
                        origPY: p.y
                    };
                    canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        });

        canvas.addEventListener('mousemove', function(e) {
            if (!_layoutEditMode) return;
            var res = nestingResultados[activeNestingMaterialId];
            if (!res || !res.planchas || !res.planchas[activeNestingPlanchaIndex]) return;
            var plancha = res.planchas[activeNestingPlanchaIndex];
            var mat = res.material;

            if (_layoutDrag.active) {
                var p = plancha.piezas[_layoutDrag.piezaIdx];
                if (!p) return;
                var pos = getSheetCoords(e, mat);
                var dx = pos.x - _layoutDrag.startLx;
                var dy = pos.y - _layoutDrag.startLy;

                p.x = Math.max(0, Math.min(_layoutDrag.origPX + dx, mat.largo - p.w));
                p.y = Math.max(0, Math.min(_layoutDrag.origPY + dy, mat.ancho - p.h));

                dibujarLayoutCortes();
                renderLayoutEditTable();
            } else {
                var hoverPos = getSheetCoords(e, mat);
                var hit = plancha.piezas.some(function(p) {
                    return hoverPos.x >= p.x && hoverPos.x <= p.x + p.w && hoverPos.y >= p.y && hoverPos.y <= p.y + p.h;
                });
                canvas.style.cursor = hit ? 'grab' : 'default';
            }
        });

        canvas.addEventListener('mouseup', function() {
            if (_layoutDrag.active) {
                _layoutDrag.active = false;
                canvas.style.cursor = _layoutEditMode ? 'grab' : 'default';
                renderLayoutEditTable();
            }
        });

        canvas.addEventListener('mouseleave', function() {
            if (_layoutDrag.active) {
                _layoutDrag.active = false;
                canvas.style.cursor = 'default';
                renderLayoutEditTable();
            }
        });
    }

    // ─── Diseñador Visual (Nesting Manual) ────────────────────
    function initDiseno() {
        renderDisenoMateriales();
        if (_disenoMat) renderDisenoPiezas();
        dibujarDiseno();
        _initDisenoCanvasEvents();
    }

    function renderDisenoMateriales() {
        var select = document.getElementById('diseno-mat-select');
        if (!select) return;
        select.innerHTML = '<option value="">-- Seleccionar material --</option>' +
            materiales.filter(function(m) { return !m.esSobrante; }).map(function(m) {
                return '<option value="' + m.id + '">' + escHtml(m.nombre) + ' (' + m.largo + 'x' + m.ancho + 'mm)</option>';
            }).join('');

        select.onchange = function() {
            var id = select.value;
            _disenoMat = id ? materiales.find(function(m) { return m.id === id; }) : null;
            _disenoPiezas = [];
            var largoEl = document.getElementById('diseno-largo');
            var anchoEl = document.getElementById('diseno-ancho');
            var titleEl = document.getElementById('diseno-plancha-title');
            if (_disenoMat) {
                if (largoEl) largoEl.value = _disenoMat.largo;
                if (anchoEl) anchoEl.value = _disenoMat.ancho;
                if (titleEl) titleEl.textContent = _disenoMat.nombre;
            } else {
                if (largoEl) largoEl.value = '';
                if (anchoEl) anchoEl.value = '';
                if (titleEl) titleEl.textContent = 'Sin material';
            }
            _disenoCam = { zoom: 1, panX: 0, panY: 0 };
            renderDisenoPiezas();
            dibujarDiseno();
            renderDisenoStats();
        };
    }

    function renderDisenoPiezas() {
        var list = document.getElementById('diseno-piezas-list');
        var count = document.getElementById('diseno-piezas-count');
        if (!list) return;
        if (count) count.textContent = _disenoPiezas.length;
        if (!_disenoPiezas.length) {
            list.innerHTML = '<div class="text-center py-4 text-xs text-slate-400 italic">No hay piezas agregadas</div>';
            return;
        }
        list.innerHTML = _disenoPiezas.map(function(p, idx) {
            var color = p.color || '#e28743';
            return '<div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs">' +
                '<div class="flex items-center gap-2 overflow-hidden flex-1 mr-1">' +
                '<span class="inline-block w-3 h-3 rounded border border-slate-300 shrink-0" style="background:' + color + '"></span>' +
                '<div class="truncate">' +
                '<span class="font-bold text-slate-700 block truncate">' + escHtml(p.label || 'Pieza ' + (idx + 1)) + '</span>' +
                '<span class="text-[9px] text-slate-400 font-mono">' + Math.round(p.w) + ' x ' + Math.round(p.h) + ' mm</span>' +
                '</div></div>' +
                '<button onclick="window.Provisionar.eliminarPiezaDiseno(' + idx + ')" class="p-1 hover:bg-slate-200 rounded text-rose-500 hover:text-rose-700 shrink-0" title="Eliminar"><i class="fas fa-trash-can"></i></button>' +
                '</div>';
        }).join('');
    }

    function renderDisenoStats() {
        var el = document.getElementById('diseno-stats');
        if (!el) return;
        if (!_disenoMat || !_disenoPiezas.length) {
            el.innerHTML = '<div class="text-center py-3 text-xs text-slate-400 italic">Agrega piezas para ver estadísticas</div>';
            return;
        }
        var areaTotal = _disenoMat.largo * _disenoMat.ancho;
        var areaUsada = _disenoPiezas.reduce(function(s, p) { return s + p.w * p.h; }, 0);
        var usoPct = (areaUsada / areaTotal) * 100;
        var desperdicio = areaTotal - areaUsada;
        var piezasQueCaben = areaTotal / (_disenoPiezas.length ? (_disenoPiezas.reduce(function(s, p) { return s + p.w * p.h; }, 0) / _disenoPiezas.length) : 1);
        el.innerHTML =
            '<div class="grid grid-cols-2 gap-2">' +
            '<div class="p-2 bg-slate-50 rounded-lg border border-slate-200">' +
            '<p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Área Total</p>' +
            '<p class="text-sm font-black text-slate-700">' + areaTotal.toLocaleString() + ' mm²</p>' +
            '</div>' +
            '<div class="p-2 bg-amber-50 rounded-lg border border-amber-100">' +
            '<p class="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Uso</p>' +
            '<p class="text-sm font-black text-amber-700">' + usoPct.toFixed(1) + '%</p>' +
            '</div>' +
            '<div class="p-2 bg-emerald-50 rounded-lg border border-emerald-100">' +
            '<p class="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Área Usada</p>' +
            '<p class="text-sm font-black text-emerald-700">' + areaUsada.toLocaleString() + ' mm²</p>' +
            '</div>' +
            '<div class="p-2 bg-rose-50 rounded-lg border border-rose-100">' +
            '<p class="text-[9px] font-bold text-rose-600 uppercase tracking-wider">Desperdicio</p>' +
            '<p class="text-sm font-black text-rose-700">' + desperdicio.toLocaleString() + ' mm²</p>' +
            '</div>' +
            '</div>';
    }

    function abrirModalNuevaPiezaDiseno() {
        if (!_disenoMat) {
            Swal.fire({ icon: 'warning', title: 'Selecciona un material', text: 'Primero elige una plancha/material en el selector.', confirmButtonColor: '#f59e0b' });
            return;
        }
        Swal.fire({
            title: 'Nueva Pieza',
            html:
                '<div class="space-y-3 text-left">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Nombre / Etiqueta</label>' +
                '<input id="swal-pieza-label" class="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm font-bold text-slate-700 focus:border-amber-500 outline-none" placeholder="Ej: Repisa 250mm" value="Pieza ' + (_disenoPiezas.length + 1) + '"></div>' +
                '<div class="grid grid-cols-2 gap-3">' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Ancho (mm)</label>' +
                '<input id="swal-pieza-w" type="number" class="w-full px-3 py-2 border-2 border-slate-200 rounded-lg font-bold text-slate-700 text-sm focus:border-amber-500 outline-none" placeholder="0" value="250" min="1"></div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Alto (mm)</label>' +
                '<input id="swal-pieza-h" type="number" class="w-full px-3 py-2 border-2 border-slate-200 rounded-lg font-bold text-slate-700 text-sm focus:border-amber-500 outline-none" placeholder="0" value="120" min="1"></div>' +
                '</div>' +
                '<div><label class="block text-xs font-bold text-slate-500 mb-1">Color</label>' +
                '<input id="swal-pieza-color" type="color" class="w-full h-10 px-1 border-2 border-slate-200 rounded-lg cursor-pointer" value="#e28743"></div>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Agregar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#f59e0b',
            reverseButtons: true,
            preConfirm: function() {
                var label = document.getElementById('swal-pieza-label').value.trim() || 'Pieza';
                var w = parseFloat(document.getElementById('swal-pieza-w').value) || 0;
                var h = parseFloat(document.getElementById('swal-pieza-h').value) || 0;
                var color = document.getElementById('swal-pieza-color').value;
                if (w < 1 || h < 1) {
                    Swal.showValidationMessage('Las dimensiones deben ser mayores a 0');
                    return false;
                }
                if (w > _disenoMat.largo || h > _disenoMat.ancho) {
                    Swal.showValidationMessage('La pieza es más grande que la plancha');
                    return false;
                }
                return { label: label, w: w, h: h, color: color };
            }
        }).then(function(r) {
            if (r.isConfirmed && r.value) {
                _disenoIdCounter++;
                var p = r.value;
                p.id = 'diseno_' + _disenoIdCounter;
                p.x = 0;
                p.y = 0;
                _disenoPiezas.push(p);
                renderDisenoPiezas();
                dibujarDiseno();
                renderDisenoStats();
            }
        });
    }

    function eliminarPiezaDiseno(idx) {
        if (idx < 0 || idx >= _disenoPiezas.length) return;
        _disenoPiezas.splice(idx, 1);
        renderDisenoPiezas();
        dibujarDiseno();
        renderDisenoStats();
    }

    function dibujarDiseno() {
        var canvas = document.getElementById('diseno-canvas');
        if (!canvas) return;
        var wrapper = document.getElementById('diseno-canvas-wrapper');
        if (!wrapper) return;

        canvas.width = wrapper.clientWidth || 600;
        canvas.height = 500;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo oscuro
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!_disenoMat) {
            ctx.fillStyle = '#475569';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Selecciona un material para comenzar', canvas.width / 2, canvas.height / 2);
            return;
        }

        var laminaX = _disenoMat.largo;
        var laminaY = _disenoMat.ancho;
        var scale = Math.min(canvas.width / laminaX, canvas.height / laminaY) * 0.88;
        var offsetX = (canvas.width - laminaX * scale) / 2;
        var offsetY = (canvas.height - laminaY * scale) / 2;

        ctx.save();
        ctx.translate(_disenoCam.panX, _disenoCam.panY);
        ctx.scale(_disenoCam.zoom, _disenoCam.zoom);

        // Sombra de la plancha
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(offsetX, offsetY, laminaX * scale, laminaY * scale);
        ctx.shadowColor = 'transparent';

        // Borde de plancha
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2 / _disenoCam.zoom;
        ctx.strokeRect(offsetX, offsetY, laminaX * scale, laminaY * scale);

        // Grid interno (cada 100mm)
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.12)';
        ctx.lineWidth = 0.5 / _disenoCam.zoom;
        for (var sx = 100; sx < laminaX; sx += 100) {
            ctx.beginPath();
            ctx.moveTo(offsetX + sx * scale, offsetY);
            ctx.lineTo(offsetX + sx * scale, offsetY + laminaY * scale);
            ctx.stroke();
        }
        for (var sy = 100; sy < laminaY; sy += 100) {
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + sy * scale);
            ctx.lineTo(offsetX + laminaX * scale, offsetY + sy * scale);
            ctx.stroke();
        }

        // Medidas en los bordes
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.font = 'bold ' + (11 / _disenoCam.zoom) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(laminaX + ' mm', offsetX + (laminaX * scale) / 2, offsetY + laminaY * scale + 6 / _disenoCam.zoom);
        ctx.save();
        ctx.translate(offsetX - 6 / _disenoCam.zoom, offsetY + (laminaY * scale) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(laminaY + ' mm', 0, 0);
        ctx.restore();

        // Dibujar piezas
        _disenoPiezas.forEach(function(p, idx) {
            var rx = offsetX + p.x * scale;
            var ry = offsetY + p.y * scale;
            var rw = p.w * scale;
            var rh = p.h * scale;
            var color = p.color || '#e28743';

            ctx.fillStyle = hexToRgba(color, 0.25);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2 / _disenoCam.zoom;
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);

            // Etiqueta y dimensiones dentro de la pieza
            var screenRw = rw * _disenoCam.zoom;
            var screenRh = rh * _disenoCam.zoom;
            if (screenRw >= 30 && screenRh >= 20) {
                var fontSize = Math.min(rh * 0.25, 12 / _disenoCam.zoom);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold ' + fontSize + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var lbl = p.label.length > 15 ? p.label.substr(0, 13) + '..' : p.label;
                ctx.fillText(lbl, rx + rw / 2, ry + rh / 2 - fontSize * 0.5);
                ctx.fillStyle = hexToRgba(color, 0.9);
                ctx.font = (fontSize * 0.8) + 'px monospace';
                ctx.fillText(Math.round(p.w) + 'x' + Math.round(p.h), rx + rw / 2, ry + rh / 2 + fontSize * 0.6);
            }
        });

        ctx.restore();
    }

    function _initDisenoCanvasEvents() {
        var canvas = document.getElementById('diseno-canvas');
        if (!canvas || canvas._disenoInit) return;
        canvas._disenoInit = true;

        function getDisenoCoords(e) {
            var rect = canvas.getBoundingClientRect();
            var cw = canvas.width || rect.width;
            var ch = canvas.height || 500;
            if (!_disenoMat) return null;
            var laminaX = _disenoMat.largo;
            var laminaY = _disenoMat.ancho;
            var scale = Math.min(cw / laminaX, ch / laminaY) * 0.88;
            var ox = (cw - laminaX * scale) / 2;
            var oy = (ch - laminaY * scale) / 2;

            var mx = (e.clientX - rect.left) * (cw / rect.width);
            var my = (e.clientY - rect.top) * (ch / rect.height);

            var unzoomedX = (mx - _disenoCam.panX) / _disenoCam.zoom;
            var unzoomedY = (my - _disenoCam.panY) / _disenoCam.zoom;

            return {
                x: (unzoomedX - ox) / scale,
                y: (unzoomedY - oy) / scale,
                scale: scale
            };
        }

        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var factor = e.deltaY < 0 ? 1.12 : 0.88;
            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            _disenoCam.panX = mx - (mx - _disenoCam.panX) * factor;
            _disenoCam.panY = my - (my - _disenoCam.panY) * factor;
            _disenoCam.zoom *= factor;
            dibujarDiseno();
        }, { passive: false });

        canvas.addEventListener('mousedown', function(e) {
            if (!_disenoMat || !_disenoPiezas.length) return;
            var pos = getDisenoCoords(e);
            if (!pos) return;

            // Check if clicking on a piece (reverse order for z-index)
            for (var i = _disenoPiezas.length - 1; i >= 0; i--) {
                var p = _disenoPiezas[i];
                if (pos.x >= p.x && pos.x <= p.x + p.w && pos.y >= p.y && pos.y <= p.y + p.h) {
                    _disenoDrag = { active: true, idx: i, startX: pos.x, startY: pos.y, origX: p.x, origY: p.y };
                    canvas.style.cursor = 'grabbing';
                    return;
                }
            }
            // If no piece, start pan
            _disenoDrag = { active: true, idx: -1, startX: e.clientX, startY: e.clientY, origX: _disenoCam.panX, origY: _disenoCam.panY };
        });

        canvas.addEventListener('mousemove', function(e) {
            if (!_disenoMat) return;
            if (_disenoDrag.active) {
                if (_disenoDrag.idx >= 0) {
                    // Dragging a piece
                    var pos = getDisenoCoords(e);
                    if (!pos) return;
                    var p = _disenoPiezas[_disenoDrag.idx];
                    if (!p) return;
                    var dx = pos.x - _disenoDrag.startX;
                    var dy = pos.y - _disenoDrag.startY;
                    p.x = Math.max(0, Math.min(_disenoDrag.origX + dx, _disenoMat.largo - p.w));
                    p.y = Math.max(0, Math.min(_disenoDrag.origY + dy, _disenoMat.ancho - p.h));
                    dibujarDiseno();
                } else {
                    // Panning
                    var dx2 = e.clientX - _disenoDrag.startX;
                    var dy2 = e.clientY - _disenoDrag.startY;
                    _disenoCam.panX = _disenoDrag.origX + dx2;
                    _disenoCam.panY = _disenoDrag.origY + dy2;
                    dibujarDiseno();
                }
            } else {
                // Hover effect
                var pos2 = getDisenoCoords(e);
                if (!pos2) return;
                var overPiece = _disenoPiezas.some(function(p) {
                    return pos2.x >= p.x && pos2.x <= p.x + p.w && pos2.y >= p.y && pos2.y <= p.y + p.h;
                });
                canvas.style.cursor = overPiece ? 'grab' : 'default';
            }
        });

        canvas.addEventListener('mouseup', function() {
            if (_disenoDrag.active) {
                _disenoDrag.active = false;
                canvas.style.cursor = 'default';
                if (_disenoDrag.idx >= 0) renderDisenoStats();
            }
        });

        canvas.addEventListener('mouseleave', function() {
            if (_disenoDrag.active) {
                _disenoDrag.active = false;
                canvas.style.cursor = 'default';
                if (_disenoDrag.idx >= 0) renderDisenoStats();
            }
        });
    }

    function zoomDiseno(factor) {
        _disenoCam.zoom *= factor;
        dibujarDiseno();
    }

    function resetDiseno() {
        _disenoCam = { zoom: 1, panX: 0, panY: 0 };
        // Reset piece positions too
        _disenoPiezas.forEach(function(p) { p.x = 0; p.y = 0; });
        dibujarDiseno();
        renderDisenoStats();
    }

    // ─── Helpers ──────────────────────────────────────────────
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── API Pública ──────────────────────────────────────────
    return {
        init: init,
        switchTab: switchTab,
        _getMateriales: function() { return materiales; },
        abrirModalNuevoMaterial: abrirModalNuevoMaterial,
        eliminarMaterial: eliminarMaterial,
        renderMateriales: renderMateriales,
        renderSelectMateriales: renderSelectMateriales,
        procesarArchivoCAD: procesarArchivosCAD,
        procesarArchivosCAD: procesarArchivosCAD,
        eliminarRetal: eliminarRetal,
        renderCapas: renderCapas,
        cambiarPlancha: cambiarPlancha,
        cambiarMaterialOptimizado: cambiarMaterialOptimizado,
        confirmarRegistroDeCorte: confirmarRegistroDeCorte,
        removerArchivoCAD: function() {
            capasCAD = [];
            piezasCAD = [];
            renderCapas();
            actualizarPiezasCAD();
            redibujarCanvasCAD();
        },
        togglePieza: togglePieza,
        setPiezaQty: setPiezaQty,
        asignarMaterial: asignarMaterial,
        optimizarCortes: optimizarCortes,
        actualizarCotizacion: actualizarCotizacion,
        guardarCotizacion: guardarCotizacion,
        imprimirCotizacion: imprimirCotizacion,
        // Controles interactivos del canvas
        zoomCAD: zoomCAD,
        zoomLayout: zoomLayout,
        resetearVistaCAD: resetearVistaCAD,
        resetearVistaLayout: resetearVistaLayout,
        toggleFullscreen: toggleFullscreen,
        // Filtros y sobrantes
        filtrarTipoMaterial: filtrarTipoMaterial,
        abrirModalNuevoSobrante: abrirModalNuevoSobrante,
        // Bloque 4: Edición manual del layout
        toggleLayoutEditMode: toggleLayoutEditMode,
        updatePiezaPosFromTable: updatePiezaPosFromTable,
        confirmarCambiosLayout: confirmarCambiosLayout,
        toggleModoVistaLayout: toggleModoVistaLayout,
        // Diseñador Visual
        abrirModalNuevaPiezaDiseno: abrirModalNuevaPiezaDiseno,
        eliminarPiezaDiseno: eliminarPiezaDiseno,
        zoomDiseno: zoomDiseno,
        resetDiseno: resetDiseno
    };

})();
