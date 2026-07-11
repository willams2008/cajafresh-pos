/**
 * Provisionar — Módulo de Materia Prima, CAD, Cortes y Costeo
 *
 * Funcionalidad:
 * - Inventario de materia prima con longitudes, propiedades, precios
 * - Carga de archivos CAD (DXF, SVG, PDF) con previsualización
 * - Identificación de piezas y asignación de materiales
 * - Optimización de cortes (rectángulos en láminas)
 * - Costeo y cotización con márgenes de ganancia
 */

window.Provisionar = (function() {

    // ─── Estado ──────────────────────────────────────────────
    var materiales = [];
    var archivoCAD = null;
    var piezasCAD = [];
    var resultadoCortes = null;
    var cotizaciones = [];
    var tabActivo = 'materiales';

    // ─── Inicialización ──────────────────────────────────────
    function init() {
        cargarEstado();
        renderMateriales();
        renderSelectMateriales();
        initCADDropZone();
        if (tabActivo) switchTab(tabActivo);
        // Resize handler for canvases
        window.addEventListener('resize', function() {
            if (archivoCAD && piezasCAD.length) {
                var canvas = document.getElementById('cad-canvas');
                if (canvas && !canvas._skipResize) {
                    // Re-draw will happen on next interaction
                }
            }
        });
    }

    function cargarEstado() {
        try {
            var saved = localStorage.getItem('provisionar_materiales');
            if (saved) materiales = JSON.parse(saved);
            var savedCot = localStorage.getItem('provisionar_cotizaciones');
            if (savedCot) cotizaciones = JSON.parse(savedCot);
        } catch(e) { console.warn('[Provisionar] Error cargando estado:', e); }
    }

    function guardarMateriales() {
        localStorage.setItem('provisionar_materiales', JSON.stringify(materiales));
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
        var tabs = ['materiales', 'cad', 'cortes', 'costos'];
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
                if (!nombre) { Swal.showValidationMessage('El nombre es obligatorio'); return; }
                if (!largo || !ancho) { Swal.showValidationMessage('Largo y ancho son obligatorios'); return; }
                return { nombre: nombre, propiedades: propiedades || '-', largo: largo, ancho: ancho, espesor: espesor || 0, costoM2: costoM2 || 0, stock: stock || 1 };
            }
        }).then(function(result) {
            if (result.isConfirmed) {
                var data = result.value;
                data.id = esEdicion ? materialParaEditar.id : Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
                data.areaM2 = (data.largo * data.ancho) / 1000000;
                data.costoPlancha = data.areaM2 * data.costoM2;

                if (esEdicion) {
                    var idx = materiales.findIndex(function(m) { return m.id === materialParaEditar.id; });
                    if (idx >= 0) materiales[idx] = data;
                } else {
                    materiales.push(data);
                }
                guardarMateriales();
                renderMateriales();
                renderSelectMateriales();
                Swal.fire({ icon: 'success', title: esEdicion ? 'Material actualizado' : 'Material agregado', timer: 1200, showConfirmButton: false });
            }
        });
    }

    function eliminarMaterial(id) {
        Swal.fire({
            title: '¿Eliminar material?',
            text: 'Esta acción no se puede deshacer',
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
                Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1000, showConfirmButton: false });
            }
        });
    }

    function renderMateriales() {
        var tbody = document.getElementById('materiales-table-body');
        if (!tbody) return;
        if (!materiales.length) {
            tbody.innerHTML = '<tr id="materiales-empty-row"><td colspan="8" class="py-12 text-center text-slate-400">' +
                '<i class="fas fa-box-open text-3xl mb-2 block"></i>' +
                '<p class="font-medium">No hay materiales registrados</p>' +
                '<p class="text-xs">Agrega materia prima para empezar a cotizar</p></td></tr>';
            return;
        }
        tbody.innerHTML = materiales.map(function(m) {
            return '<tr class="hover:bg-slate-50 transition-colors">' +
                '<td class="py-4 px-6 font-bold text-slate-700">' + escHtml(m.nombre) + '</td>' +
                '<td class="py-4 px-6 text-slate-500 text-xs">' + escHtml(m.propiedades) + '</td>' +
                '<td class="py-4 px-6 text-right font-mono font-bold text-slate-700">' + m.largo + '</td>' +
                '<td class="py-4 px-6 text-right font-mono font-bold text-slate-700">' + m.ancho + '</td>' +
                '<td class="py-4 px-6 text-right font-mono font-bold text-slate-700">' + m.espesor + '</td>' +
                '<td class="py-4 px-6 text-right font-mono font-bold text-emerald-600">$' + m.costoM2.toFixed(2) + '</td>' +
                '<td class="py-4 px-6 text-center"><span class="px-3 py-1 ' + (m.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700') + ' rounded-full text-xs font-bold">' + m.stock + '</span></td>' +
                '<td class="py-4 px-6 text-center">' +
                '<button onclick="window.Provisionar.abrirModalNuevoMaterial(' + JSON.stringify(m).replace(/"/g, '&quot;') + ')" class="text-brand-600 hover:text-brand-800 mr-3" title="Editar"><i class="fas fa-pen"></i></button>' +
                '<button onclick="window.Provisionar.eliminarMaterial(\'' + m.id + '\')" class="text-rose-400 hover:text-rose-600" title="Eliminar"><i class="fas fa-trash-can"></i></button>' +
                '</td></tr>';
        }).join('');
    }

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

    // ─── CAD File Handling ────────────────────────────────────
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
            if (e.dataTransfer.files.length) procesarArchivoCAD(e.dataTransfer.files[0]);
        };

        input.onchange = function() {
            if (input.files.length) procesarArchivoCAD(input.files[0]);
        };
    }

    function procesarArchivoCAD(file) {
        var ext = file.name.split('.').pop().toLowerCase();
        archivoCAD = { file: file, name: file.name, size: file.size, ext: ext };

        // Mostrar info
        document.getElementById('cad-file-info').classList.remove('hidden');
        document.getElementById('cad-filename').textContent = file.name;
        document.getElementById('cad-filesize').textContent = (file.size / 1024).toFixed(1) + ' KB';

        // Leer y procesar
        var reader = new FileReader();
        reader.onload = function(e) {
            var content = e.target.result;
            if (ext === 'dxf') {
                parsearDXF(content);
            } else if (ext === 'svg') {
                parsearSVG(content);
            } else if (ext === 'pdf') {
                parsearPDF(content);
            } else {
                // Intento genérico: tratar como DXF
                parsearDXF(content);
            }
        };

        if (ext === 'svg' || ext === 'dxf') {
            reader.readAsText(file);
        } else {
            reader.readAsDataURL(file);
        }
    }

    function removerArchivoCAD() {
        archivoCAD = null;
        piezasCAD = [];
        document.getElementById('cad-file-info').classList.add('hidden');
        document.getElementById('cad-file-input').value = '';
        document.getElementById('cad-preview-placeholder').classList.remove('hidden');
        document.getElementById('cad-entities-count').textContent = '0 entidades';
        document.getElementById('cad-materials-section').classList.add('hidden');
        document.getElementById('cad-pieces-table-body').innerHTML = '';
        var canvas = document.getElementById('cad-canvas');
        if (canvas) {
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    // ─── DXF Parser (Ligero) ──────────────────────────────────
    function parsearDXF(content) {
        piezasCAD = [];
        var lines = content.split('\n');
        var i = 0;
        var currentEntity = null;
        var polylines = [];

        while (i < lines.length) {
            var code = lines[i].trim();
            var value = lines[i + 1] ? lines[i + 1].trim() : '';
            i += 2;

            if (code === '0' && value === 'LWPOLYLINE') {
                currentEntity = { type: 'LWPOLYLINE', vertices: [], closed: false };
                polylines.push(currentEntity);
            } else if (code === '0' && value === 'CIRCLE') {
                currentEntity = { type: 'CIRCLE', cx: 0, cy: 0, radius: 0 };
                polylines.push(currentEntity);
            } else if (code === '0' && value === 'LINE') {
                currentEntity = { type: 'LINE', x1: 0, y1: 0, x2: 0, y2: 0 };
                polylines.push(currentEntity);
            } else if (code === '0') {
                currentEntity = null;
            }

            if (currentEntity) {
                if (code === '10') currentEntity.x1 = parseFloat(value) || currentEntity.cx || 0;
                if (code === '20') currentEntity.y1 = parseFloat(value) || currentEntity.cy || 0;
                if (code === '11') currentEntity.x2 = parseFloat(value);
                if (code === '21') currentEntity.y2 = parseFloat(value);
                if (code === '40') currentEntity.radius = parseFloat(value);
                if (code === '70') currentEntity.closed = parseInt(value) & 1;
                if (code === '90') { /* number of vertices */ }
                if (code === '42') { /* bulge */ }
            }
        }

        // Extraer bounding boxes como piezas rectangulares
        extraerPiezasDeEntidades(polylines);
    }

    function parsearSVG(content) {
        piezasCAD = [];
        var parser = new DOMParser();
        var svgDoc = parser.parseFromString(content, 'image/svg+xml');
        var rects = svgDoc.querySelectorAll('rect');
        var paths = svgDoc.querySelectorAll('path');

        rects.forEach(function(r) {
            var x = parseFloat(r.getAttribute('x') || 0);
            var y = parseFloat(r.getAttribute('y') || 0);
            var w = parseFloat(r.getAttribute('width') || 0);
            var h = parseFloat(r.getAttribute('height') || 0);
            if (w > 0 && h > 0) {
                piezasCAD.push({ id: 'svg_' + piezasCAD.length, width: w, height: h, label: r.id || 'Rect ' + (piezasCAD.length + 1) });
            }
        });

        if (rects.length === 0) {
            // Intentar extraer de paths como bounding box
            paths.forEach(function(p) {
                var bbox = p.getBBox();
                if (bbox.width > 0 && bbox.height > 0) {
                    piezasCAD.push({ id: 'svg_' + piezasCAD.length, width: bbox.width, height: bbox.height, label: p.id || 'Path ' + (piezasCAD.length + 1) });
                }
            });
        }

        // Preview SVG
        dibujarPreviewSVG(content);
        actualizarPiezasCAD();
    }

    function parsearPDF(content) {
        // PDF no se puede parsear directamente en el frontend para extraer geometría
        piezasCAD = [];
        Swal.fire({ icon: 'info', title: 'PDF cargado', text: 'La extracción automática de geometría desde PDF requiere procesamiento en servidor. Puedes dibujar las piezas manualmente.', confirmButtonText: 'Entendido' }).then(function() {
            abrirModalPiezaManual();
        });
        // Mostrar el PDF como preview
        document.getElementById('cad-preview-placeholder').innerHTML = '<iframe src="' + content + '" class="w-full h-full absolute inset-0" style="min-height:300px"></iframe>';
        document.getElementById('cad-preview-placeholder').classList.remove('hidden');
        document.getElementById('cad-entities-count').textContent = 'PDF (vista previa)';
    }

    function extraerPiezasDeEntidades(entities) {
        // Encontrar bounding boxes de todas las entidades
        var bounds = [];
        entities.forEach(function(ent) {
            if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length >= 4) {
                var xs = ent.vertices.map(function(v) { return v.x; });
                var ys = ent.vertices.map(function(v) { return v.y; });
                var minX = Math.min.apply(null, xs);
                var maxX = Math.max.apply(null, xs);
                var minY = Math.min.apply(null, ys);
                var maxY = Math.max.apply(null, ys);
                bounds.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
            } else if (ent.type === 'CIRCLE') {
                var d = ent.radius * 2;
                bounds.push({ x: ent.cx - ent.radius, y: ent.cy - ent.radius, w: d, h: d });
            } else if (ent.type === 'LINE') {
                var minX = Math.min(ent.x1, ent.x2);
                var maxX = Math.max(ent.x1, ent.x2);
                var minY = Math.min(ent.y1, ent.y2);
                var maxY = Math.max(ent.y1, ent.y2);
                bounds.push({ x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1 });
            }
        });

        // Agrupar piezas cerradas por proximidad
        var used = {};
        bounds.forEach(function(b, i) {
            if (used[i]) return;
            // Buscar bounds que se solapen o estén muy cerca
            var group = { x: b.x, y: b.y, w: b.w, h: b.h, indices: [i] };
            used[i] = true;
            bounds.forEach(function(b2, j) {
                if (used[j]) return;
                if (solapanOCercano(b, b2, 10)) {
                    group.x = Math.min(group.x, b2.x);
                    group.y = Math.min(group.y, b2.y);
                    group.w = Math.max(group.x + group.w, b2.x + b2.w) - group.x;
                    group.h = Math.max(group.y + group.h, b2.y + b2.h) - group.y;
                    used[j] = true;
                    group.indices.push(j);
                }
            });
            if (group.w > 5 && group.h > 5) {
                piezasCAD.push({
                    id: 'piece_' + piezasCAD.length,
                    width: Math.round(group.w * 100) / 100,
                    height: Math.round(group.h * 100) / 100,
                    label: 'Pieza ' + (piezasCAD.length + 1),
                    qty: 1
                });
            }
        });

        dibujarPreviewDXF(entities);
        actualizarPiezasCAD();
    }

    function solapanOCercano(a, b, tol) {
        return !(a.x + a.w + tol < b.x || b.x + b.w + tol < a.x ||
                 a.y + a.h + tol < b.y || b.y + b.h + tol < a.y);
    }

    function actualizarPiezasCAD() {
        var section = document.getElementById('cad-materials-section');
        var tbody = document.getElementById('cad-pieces-table-body');
        if (!section || !tbody) return;

        if (!piezasCAD.length) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        document.getElementById('cad-entities-count').textContent = piezasCAD.length + ' piezas';

        tbody.innerHTML = piezasCAD.map(function(p, i) {
            var opts = '<option value="">Sin asignar</option>' +
                materiales.map(function(m) { return '<option value="' + m.id + '"' + (p.materialId === m.id ? ' selected' : '') + '>' + escHtml(m.nombre) + '</option>'; }).join('');
            return '<tr>' +
                '<td class="py-3 px-6"><input type="checkbox" class="rounded text-amber-600 focus:ring-amber-500" checked onchange="window.Provisionar.togglePieza(' + i + ', this.checked)"></td>' +
                '<td class="py-3 px-6 font-bold text-slate-700">' + escHtml(p.label) + '</td>' +
                '<td class="py-3 px-6 text-right font-mono font-bold text-slate-700">' + p.width.toFixed(1) + '</td>' +
                '<td class="py-3 px-6 text-right font-mono font-bold text-slate-700">' + p.height.toFixed(1) + '</td>' +
                '<td class="py-3 px-6 text-right"><input type="number" value="' + (p.qty || 1) + '" min="1" class="w-16 px-2 py-1 border border-slate-200 rounded-lg text-center font-bold text-slate-700" onchange="window.Provisionar.setPiezaQty(' + i + ', this.value)"></td>' +
                '<td class="py-3 px-6"><select class="w-full px-2 py-1 border border-slate-200 rounded-lg font-bold text-slate-700 text-sm" onchange="window.Provisionar.asignarMaterial(' + i + ', this.value)">' + opts + '</select></td>' +
                '</tr>';
        }).join('');
    }

    function togglePieza(idx, active) {
        if (piezasCAD[idx]) piezasCAD[idx].selected = active;
    }

    function setPiezaQty(idx, qty) {
        if (piezasCAD[idx]) piezasCAD[idx].qty = Math.max(1, parseInt(qty) || 1);
    }

    function asignarMaterial(idx, materialId) {
        if (piezasCAD[idx]) piezasCAD[idx].materialId = materialId || null;
    }

    // ─── Preview Dibujo ───────────────────────────────────────
    function dibujarPreviewDXF(entities) {
        var canvas = document.getElementById('cad-canvas');
        if (!canvas) return;
        var container = document.getElementById('cad-preview-canvas');
        if (!container) return;

        canvas.width = container.clientWidth || 400;
        canvas.height = container.clientHeight || 300;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;

        // Calcular bounds
        var allX = [], allY = [];
        entities.forEach(function(ent) {
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

        if (!allX.length) { document.getElementById('cad-preview-placeholder').classList.remove('hidden'); return; }
        document.getElementById('cad-preview-placeholder').classList.add('hidden');

        var minX = Math.min.apply(null, allX);
        var maxX = Math.max.apply(null, allX);
        var minY = Math.min.apply(null, allY);
        var maxY = Math.max.apply(null, allY);
        var rangeX = maxX - minX || 1;
        var rangeY = maxY - minY || 1;

        var scale = Math.min(canvas.width / rangeX, canvas.height / rangeY) * 0.85;
        var offsetX = (canvas.width - rangeX * scale) / 2 - minX * scale;
        var offsetY = (canvas.height + rangeY * scale) / 2 - maxY * scale;

        ctx.beginPath();
        entities.forEach(function(ent) {
            if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length >= 2) {
                ctx.moveTo(ent.vertices[0].x * scale + offsetX, -ent.vertices[0].y * scale + offsetY);
                for (var k = 1; k < ent.vertices.length; k++) {
                    ctx.lineTo(ent.vertices[k].x * scale + offsetX, -ent.vertices[k].y * scale + offsetY);
                }
                if (ent.closed) ctx.closePath();
            } else if (ent.type === 'CIRCLE') {
                ctx.arc(ent.cx * scale + offsetX, -ent.cy * scale + offsetY, ent.radius * scale, 0, Math.PI * 2);
            } else if (ent.type === 'LINE') {
                ctx.moveTo(ent.x1 * scale + offsetX, -ent.y1 * scale + offsetY);
                ctx.lineTo(ent.x2 * scale + offsetX, -ent.y2 * scale + offsetY);
            }
        });
        ctx.stroke();

        // Colorear áreas de piezas detectadas
        ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        piezasCAD.forEach(function(p) {
            if (p.width > 0 && p.height > 0) {
                ctx.fillRect(0 * scale + offsetX, 0 * scale + offsetY, p.width * scale, -p.height * scale);
                ctx.strokeRect(0 * scale + offsetX, 0 * scale + offsetY, p.width * scale, -p.height * scale);
            }
        });
    }

    function dibujarPreviewSVG(content) {
        var container = document.getElementById('cad-preview-canvas');
        if (!container) return;
        document.getElementById('cad-preview-placeholder').classList.add('hidden');
        container.innerHTML = '<div class="w-full h-full flex items-center justify-center p-4">' + content + '</div>';
    }

    // ─── Optimización de Cortes (2D Bin Packing) ──────────────
    function optimizarCortes() {
        var materialId = document.getElementById('opt-material-select').value;
        if (!materialId) {
            Swal.fire({ icon: 'warning', title: 'Selecciona un material', text: 'Debes elegir un material de la lista' });
            return;
        }

        var laminaLargo = parseFloat(document.getElementById('opt-lamina-largo').value);
        var laminaAncho = parseFloat(document.getElementById('opt-lamina-ancho').value);
        var kerf = parseFloat(document.getElementById('opt-kerf').value) || 0;
        var costoHora = parseFloat(document.getElementById('opt-costo-hora').value) || 0;

        if (!laminaLargo || !laminaAncho) {
            Swal.fire({ icon: 'warning', title: 'Dimensiones inválidas', text: 'Revisa las dimensiones de la lámina' });
            return;
        }

        // Filtrar piezas seleccionadas con material asignado
        var piezasACortar = [];
        piezasCAD.forEach(function(p) {
            if (p.selected !== false && p.materialId === materialId) {
                for (var q = 0; q < (p.qty || 1); q++) {
                    piezasACortar.push({ w: p.width + kerf, h: p.height + kerf, label: p.label, originalW: p.width, originalH: p.height });
                }
            }
        });

        if (!piezasACortar.length) {
            Swal.fire({ icon: 'warning', title: 'Sin piezas', text: 'No hay piezas seleccionadas con el material indicado. Asigna materiales en la pestaña CAD.' });
            return;
        }

        // Ordenar por área descendente (mejor para bin packing)
        piezasACortar.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

        // Algoritmo Guillotine (Shelf) simplificado
        var planchas = [];
        var planchaActual = [];
        var espacioRestanteX = laminaAncho;
        var espacioRestanteY = laminaLargo;
        var currentX = 0;
        var currentY = 0;
        var rowHeight = 0;

        piezasACortar.forEach(function(pieza) {
            // Si cabe en la fila actual
            if (pieza.w <= espacioRestanteX && pieza.h <= espacioRestanteY) {
                planchaActual.push({
                    x: currentX, y: currentY,
                    w: pieza.originalW, h: pieza.originalH,
                    label: pieza.label
                });
                currentX += pieza.w;
                espacioRestanteX -= pieza.w;
                rowHeight = Math.max(rowHeight, pieza.h);
            } else if (pieza.h <= espacioRestanteY && pieza.w <= laminaAncho) {
                // Nueva fila
                currentY += rowHeight;
                espacioRestanteY -= rowHeight;
                if (currentY + pieza.h > laminaLargo) {
                    planchas.push(planchaActual);
                    planchaActual = [];
                    currentX = 0;
                    currentY = 0;
                    espacioRestanteX = laminaAncho;
                    espacioRestanteY = laminaLargo;
                    rowHeight = 0;
                } else {
                    currentX = 0;
                    espacioRestanteX = laminaAncho;
                    rowHeight = 0;
                }
                if (pieza.w <= laminaAncho && pieza.h <= laminaLargo) {
                    planchaActual.push({
                        x: currentX, y: currentY,
                        w: pieza.originalW, h: pieza.originalH,
                        label: pieza.label
                    });
                    currentX += pieza.w;
                    espacioRestanteX -= pieza.w;
                    rowHeight = Math.max(rowHeight, pieza.h);
                } else {
                    // Pieza no cabe rotada ni nada - agregarla como no colocada
                    planchaActual.push({
                        x: currentX, y: currentY,
                        w: pieza.originalW, h: pieza.originalH,
                        label: pieza.label, noCabe: true
                    });
                }
            } else {
                // No cabe en esta plancha, nueva plancha
                if (planchaActual.length) planchas.push(planchaActual);
                planchaActual = [{
                    x: 0, y: 0,
                    w: pieza.originalW, h: pieza.originalH,
                    label: pieza.label,
                    noCabe: pieza.w > laminaAncho || pieza.h > laminaLargo
                }];
                currentX = pieza.w;
                currentY = 0;
                espacioRestanteX = laminaAncho - pieza.w;
                espacioRestanteY = laminaLargo;
                rowHeight = pieza.h;
            }
        });
        if (planchaActual.length) planchas.push(planchaActual);

        // Calcular estadísticas
        var totalPiezas = piezasACortar.length;
        var totalPlanchas = planchas.length;
        var areaTotalPlancha = laminaLargo * laminaAncho;
        var areaUsadaTotal = 0;
        var planchasDetalle = planchas.map(function(p, idx) {
            var areaUsada = p.reduce(function(sum, piece) { return sum + (piece.w * piece.h); }, 0);
            areaUsadaTotal += areaUsada;
            return {
                index: idx + 1,
                piezas: p,
                areaUsada: areaUsada,
                areaTotal: areaTotalPlancha,
                desperdicio: areaTotalPlancha - areaUsada,
                usoPct: (areaUsada / areaTotalPlancha * 100)
            };
        });

        var usoTotalPct = (areaUsadaTotal / (totalPlanchas * areaTotalPlancha)) * 100;

        // Calcular tiempo de corte estimado (velocidad de corte típica: 20mm/s para láser)
        var perimetroTotal = 0;
        planchas.forEach(function(p) {
            p.forEach(function(piece) {
                perimetroTotal += 2 * (piece.w + piece.h);
            });
        });
        var tiempoCorteSeg = (perimetroTotal / 20) + (totalPlanchas * 5); // 5s de posicionamiento por plancha
        var costoOperativo = (tiempoCorteSeg / 3600) * costoHora;

        resultadoCortes = {
            materialId: materialId,
            planchas: planchasDetalle,
            totalPiezas: totalPiezas,
            totalPlanchas: totalPlanchas,
            areaUsadaTotal: areaUsadaTotal,
            areaTotalDisponible: totalPlanchas * areaTotalPlancha,
            usoPct: usoTotalPct,
            desperdicioPct: 100 - usoTotalPct,
            tiempoCorteSeg: tiempoCorteSeg,
            costoOperativo: costoOperativo
        };

        mostrarResultadosCortes(laminaLargo, laminaAncho);
        switchTab('cortes');
        Swal.fire({ icon: 'success', title: 'Optimización completada', text: totalPlanchas + ' plancha(s) necesaria(s) - ' + usoTotalPct.toFixed(1) + '% de uso', timer: 2000, showConfirmButton: false });
    }

    function mostrarResultadosCortes(laminaLargo, laminaAncho) {
        if (!resultadoCortes) return;

        document.getElementById('opt-resumen').classList.remove('hidden');
        document.getElementById('opt-total-piezas').textContent = resultadoCortes.totalPiezas;
        document.getElementById('opt-planchas-necesarias').textContent = resultadoCortes.totalPlanchas;
        document.getElementById('opt-uso-pct').textContent = resultadoCortes.usoPct.toFixed(1) + '%';
        document.getElementById('opt-desperdicio-pct').textContent = resultadoCortes.desperdicioPct.toFixed(1) + '%';

        // Tabla
        document.getElementById('opt-resultados-tabla').classList.remove('hidden');
        var tbody = document.getElementById('opt-planchas-table-body');
        tbody.innerHTML = resultadoCortes.planchas.map(function(p) {
            var colorClass = p.usoPct > 70 ? 'text-emerald-600' : (p.usoPct > 40 ? 'text-amber-600' : 'text-rose-600');
            return '<tr class="hover:bg-slate-50">' +
                '<td class="py-3 px-6 font-bold text-slate-700">Plancha #' + p.index + '</td>' +
                '<td class="py-3 px-6 text-right font-mono font-bold text-slate-700">' + p.areaTotal.toFixed(0) + '</td>' +
                '<td class="py-3 px-6 text-right font-mono font-bold text-emerald-600">' + p.areaUsada.toFixed(0) + '</td>' +
                '<td class="py-3 px-6 text-right font-mono font-bold text-rose-600">' + p.desperdicio.toFixed(0) + '</td>' +
                '<td class="py-3 px-6 text-right font-mono font-bold ' + colorClass + '">' + p.usoPct.toFixed(1) + '%</td></tr>';
        }).join('');

        // Layout canvas
        document.getElementById('opt-layout-container').classList.remove('hidden');
        dibujarLayoutCortes(laminaLargo, laminaAncho);

        // Pre-costos
        var mat = materiales.find(function(m) { return m.id === resultadoCortes.materialId; });
        if (mat) {
            document.getElementById('costeo-costo-plancha').value = mat.costoPlancha.toFixed(2);
        }
        document.getElementById('costeo-costo-corte').value = resultadoCortes.costoOperativo.toFixed(2);

        // Actualizar costeo
        actualizarCotizacion();
    }

    function dibujarLayoutCortes(laminaLargo, laminaAncho) {
        var canvas = document.getElementById('opt-canvas');
        if (!canvas) return;
        var wrapper = document.getElementById('opt-layout-canvas-wrapper');
        if (!wrapper) return;

        canvas.width = wrapper.clientWidth || 600;
        canvas.height = 400;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!resultadoCortes || !resultadoCortes.planchas.length) return;

        var plancha = resultadoCortes.planchas[0]; // Mostrar primera plancha
        var scale = Math.min(canvas.width / laminaAncho, canvas.height / laminaLargo) * 0.9;
        var offsetX = (canvas.width - laminaAncho * scale) / 2;
        var offsetY = (canvas.height - laminaLargo * scale) / 2;

        // Fondo plancha
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(offsetX, offsetY, laminaAncho * scale, laminaLargo * scale);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.strokeRect(offsetX, offsetY, laminaAncho * scale, laminaLargo * scale);

        // Piezas
        var colores = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4'];
        plancha.piezas.forEach(function(piece, i) {
            var color = colores[i % colores.length];
            ctx.fillStyle = color + '33';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.fillRect(offsetX + piece.y * scale, offsetY + piece.x * scale, piece.h * scale, piece.w * scale);
            ctx.strokeRect(offsetX + piece.y * scale, offsetY + piece.x * scale, piece.h * scale, piece.w * scale);

            // Label
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(piece.label, offsetX + (piece.y + piece.h / 2) * scale, offsetY + (piece.x + piece.w / 2) * scale + 3);
        });

        // Info
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Plancha 1/' + resultadoCortes.totalPlanchas + ' | ' + laminaLargo + 'x' + laminaAncho + 'mm | Uso: ' + plancha.usoPct.toFixed(1) + '%', 10, 16);
    }

    // ─── Costeo y Cotización ──────────────────────────────────
    function actualizarCotizacion() {
        var costoPlancha = parseFloat(document.getElementById('costeo-costo-plancha').value) || 0;
        var costoCorte = parseFloat(document.getElementById('costeo-costo-corte').value) || 0;
        var gastosAdicionales = parseFloat(document.getElementById('costeo-gastos-adicionales').value) || 0;
        var margen = parseInt(document.getElementById('costeo-margen').value) || 30;

        if (!resultadoCortes || !resultadoCortes.totalPlanchas) {
            document.getElementById('costeo-tarjeta').classList.add('hidden');
            document.getElementById('costeo-placeholder').classList.remove('hidden');
            return;
        }

        document.getElementById('costeo-margen-label').textContent = margen + '%';

        var totalPlanchas = resultadoCortes.totalPlanchas;
        var costoTotalMaterial = costoPlancha * totalPlanchas;
        var costoCorteTotal = costoCorte;
        var costoProduccion = costoTotalMaterial + costoCorteTotal + gastosAdicionales;
        var ganancia = costoProduccion * (margen / 100);
        var precioVenta = costoProduccion + ganancia;

        // Mostrar tarjeta
        document.getElementById('costeo-tarjeta').classList.remove('hidden');
        document.getElementById('costeo-placeholder').classList.add('hidden');

        document.getElementById('costeo-total-material').textContent = '$' + costoTotalMaterial.toFixed(2);
        document.getElementById('costeo-total-corte').textContent = '$' + costoCorteTotal.toFixed(2);
        document.getElementById('costeo-total-adicionales').textContent = '$' + gastosAdicionales.toFixed(2);
        document.getElementById('costeo-total-produccion').textContent = '$' + costoProduccion.toFixed(2);
        document.getElementById('costeo-margen-aplicado').textContent = margen + '%';
        document.getElementById('costeo-ganancia-estimada').textContent = '$' + ganancia.toFixed(2);
        document.getElementById('costeo-precio-venta').textContent = '$' + precioVenta.toFixed(2);

        // Guardar datos de cotización
        resultadoCortes.cotizacion = {
            costoMaterial: costoTotalMaterial,
            costoCorte: costoCorteTotal,
            gastosAdicionales: gastosAdicionales,
            costoProduccion: costoProduccion,
            margen: margen,
            ganancia: ganancia,
            precioVenta: precioVenta
        };
    }

    function guardarCotizacion() {
        if (!resultadoCortes || !resultadoCortes.cotizacion) {
            Swal.fire({ icon: 'warning', title: 'Sin cotización', text: 'Ejecuta la optimización primero' });
            return;
        }
        var cotizacion = {
            id: Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
            fecha: new Date().toISOString(),
            material: materiales.find(function(m) { return m.id === resultadoCortes.materialId; }),
            piezas: piezasCAD.filter(function(p) { return p.selected !== false && p.materialId === resultadoCortes.materialId; }),
            resultadoCortes: {
                totalPiezas: resultadoCortes.totalPiezas,
                totalPlanchas: resultadoCortes.totalPlanchas,
                usoPct: resultadoCortes.usoPct,
                desperdicioPct: resultadoCortes.desperdicioPct
            },
            cotizacion: resultadoCortes.cotizacion
        };
        cotizaciones.push(cotizacion);
        localStorage.setItem('provisionar_cotizaciones', JSON.stringify(cotizaciones));
        Swal.fire({ icon: 'success', title: 'Cotización guardada', text: '$' + resultadoCortes.cotizacion.precioVenta.toFixed(2), timer: 2000, showConfirmButton: false });
    }

    function imprimirCotizacion() {
        if (!resultadoCortes || !resultadoCortes.cotizacion) return;
        var c = resultadoCortes.cotizacion;
        var win = window.open('', '_blank');
        win.document.write('<html><head><title>Cotización</title>');
        win.document.write('<style>body{font-family:monospace;padding:40px;max-width:600px;margin:auto}' +
            'h1{font-size:24px;border-bottom:3px solid #000;padding-bottom:8px}' +
            '.row{display:flex;justify-content:space-between;padding:6px 0}' +
            '.total{border-top:2px solid #000;font-weight:bold;font-size:18px;padding-top:8px;margin-top:8px}' +
            '.label{color:#666}' +
            '</style></head><body>');
        win.document.write('<h1>COTIZACIÓN</h1>');
        win.document.write('<p>Fecha: ' + new Date().toLocaleDateString('es-VE') + '</p>');
        win.document.write('<div class="row"><span class="label">Costo Material:</span><span>$' + c.costoMaterial.toFixed(2) + '</span></div>');
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

    // ─── Helpers ──────────────────────────────────────────────
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── API Pública ──────────────────────────────────────────
    return {
        init: init,
        switchTab: switchTab,
        abrirModalNuevoMaterial: abrirModalNuevoMaterial,
        eliminarMaterial: eliminarMaterial,
        renderMateriales: renderMateriales,
        renderSelectMateriales: renderSelectMateriales,
        procesarArchivoCAD: procesarArchivoCAD,
        removerArchivoCAD: removerArchivoCAD,
        togglePieza: togglePieza,
        setPiezaQty: setPiezaQty,
        asignarMaterial: asignarMaterial,
        optimizarCortes: optimizarCortes,
        actualizarCotizacion: actualizarCotizacion,
        guardarCotizacion: guardarCotizacion,
        imprimirCotizacion: imprimirCotizacion
    };

})();
