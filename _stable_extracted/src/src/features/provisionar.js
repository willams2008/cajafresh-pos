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
    var capasCAD = []; // Múltiples archivos cargados simultáneamente (Capas)
    var piezasCAD = []; // Lista consolidada de piezas de todas las capas visibles
    var resultadoCortes = null;
    var cotizaciones = [];
    var tabActivo = 'materiales';

    // ─── Cámara Virtual del Visor CAD ────────────────────────
    var cadCam = { panX: 0, panY: 0, zoom: 1 };
    var cadDrag = { active: false, startX: 0, startY: 0, mode: 'pan', capaIdx: -1, pieceIdx: -1, type: null }; // mode: 'pan' o 'piece'
    var planchasActivas = []; // Almacena los materiales arrastrados al lienzo

    // ─── Cámara Virtual del Layout de Cortes ─────────────────
    var layoutCam = { zoom: 1, panX: 0, panY: 0 };

    // ─── Inicialización ──────────────────────────────────────
    function init() {
        cargarEstado();
        renderMateriales();
        renderSelectMateriales();
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

                // Drag: mousedown
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
                        var mat = materiales.find(function(m) { return m.id === matId; });
                        if (mat) {
                            var rect = cadCanvas.getBoundingClientRect();
                            var screenX = e.clientX - rect.left;
                            var screenY = e.clientY - rect.top;

                            var info = getCADTransformInfo();
                            if (!info) {
                                // If no CAD loaded yet, default transform
                                info = { scale: 1, offsetX: canvas.width/2, offsetY: canvas.height/2 };
                            }

                            var s = info.scale * cadCam.zoom;
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
                                originalX: worldX,
                                originalY: -worldY, // SVG/canvas Y inversion
                                offsetX: 0,
                                offsetY: 0,
                                color: mat.color || '#e28743'
                            });
                            redibujarCanvasCAD();
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

    function renderMateriales() {
        var tbody = document.getElementById('materiales-table-body');
        if (!tbody) return;
        if (!materiales.length) {
            tbody.innerHTML = '<tr id="materiales-empty-row"><td colspan="10" class="py-12 text-center text-slate-400">' +
                '<i class="fas fa-box-open text-3xl mb-2 block"></i>' +
                '<p class="font-medium">No hay materiales registrados</p>' +
                '<p class="text-xs">Agrega materia prima para empezar a cotizar</p></td></tr>';
            return;
        }

        var html = '';
        materiales.forEach(function(m) {
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
                '<td class="py-3 px-4 font-bold text-slate-700">' + escHtml(m.nombre) + '</td>' +
                '<td class="py-3 px-4 text-slate-500 text-xs">' + escHtml(m.propiedades) + '</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-slate-700">' + m.largo + '</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-slate-700">' + m.ancho + '</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-slate-700">' + m.espesor + '</td>' +
                '<td class="py-3 px-4 text-right font-mono font-bold text-emerald-600">$' + m.costoM2.toFixed(2) + '</td>' +
                '<td class="py-3 px-4 text-center">' +
                '<span class="px-2.5 py-0.5 ' + (m.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700') + ' rounded-full text-xs font-bold">' + m.stock + ' planchas</span>' +
                (totalSobrantes > 0 ? '<div class="text-[9px] text-amber-600 font-bold mt-0.5">+' + totalSobrantes + ' retales</div>' : '') +
                '</td>' +
                '<td class="py-3 px-4 text-center">' +
                '<button onclick="window.Provisionar.abrirModalNuevoMaterial(' + JSON.stringify(m).replace(/"/g, '&quot;') + ')" class="text-brand-600 hover:text-brand-800 mr-3" title="Editar"><i class="fas fa-pen"></i></button>' +
                '<button onclick="window.Provisionar.eliminarMaterial(\'' + m.id + '\')" class="text-rose-400 hover:text-rose-600" title="Eliminar"><i class="fas fa-trash-can"></i></button>' +
                '</td>' +
                '</tr>';

            // Fila de acordeón colapsable
            var sobrantesHtml = '';
            if (totalSobrantes === 0) {
                sobrantesHtml = '<div class="text-slate-400 italic text-xs py-2">No hay material sobrante (retales) disponible</div>';
            } else {
                sobrantesHtml = '<div class="space-y-1.5">';
                m.sobrantes.forEach(function(sob, sIdx) {
                    sobrantesHtml += '<div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs">' +
                        '<span class="font-bold text-slate-700"><i class="fas fa-recycle text-amber-500 mr-1.5"></i>Retal #' + (sIdx + 1) + ': ' + sob.largo + 'x' + sob.ancho + ' mm</span>' +
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
        renderCADMaterialPalette();
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

        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        rects.forEach(function(r) {
            var x = parseFloat(r.getAttribute('x') || 0);
            var y = parseFloat(r.getAttribute('y') || 0);
            var w = parseFloat(r.getAttribute('width') || 0);
            var h = parseFloat(r.getAttribute('height') || 0);
            if (w > 0 && h > 0) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + w);
                maxY = Math.max(maxY, y + h);
            }
        });

        if (paths.length > 0) {
            var tempContainer = document.createElement('div');
            tempContainer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;visibility:hidden;';
            document.body.appendChild(tempContainer);
            var tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            tempSvg.setAttribute('width', '0');
            tempSvg.setAttribute('height', '0');
            tempContainer.appendChild(tempSvg);

            paths.forEach(function(p) {
                try {
                    var cloned = document.importNode(p, true);
                    tempSvg.appendChild(cloned);
                    var bbox = cloned.getBBox();
                    if (bbox.width > 0 && bbox.height > 0) {
                        minX = Math.min(minX, bbox.x);
                        minY = Math.min(minY, bbox.y);
                        maxX = Math.max(maxX, bbox.x + bbox.width);
                        maxY = Math.max(maxY, bbox.y + bbox.height);
                    }
                    tempSvg.removeChild(cloned);
                } catch(e) { }
            });
            document.body.removeChild(tempContainer);
        }

        if (minX !== Infinity) {
            capa.piezas.push({
                id: capa.id + '_svg_group',
                width: maxX - minX,
                height: maxY - minY,
                originalX: minX,
                originalY: minY,
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
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        entities.forEach(function(ent) {
            if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length >= 2) {
                ent.vertices.forEach(function(v) {
                    minX = Math.min(minX, v.x);
                    maxX = Math.max(maxX, v.x);
                    minY = Math.min(minY, v.y);
                    maxY = Math.max(maxY, v.y);
                });
            } else if (ent.type === 'CIRCLE') {
                minX = Math.min(minX, ent.cx - ent.radius);
                maxX = Math.max(maxX, ent.cx + ent.radius);
                minY = Math.min(minY, ent.cy - ent.radius);
                maxY = Math.max(maxY, ent.cy + ent.radius);
            } else if (ent.type === 'LINE') {
                minX = Math.min(minX, ent.x1, ent.x2);
                maxX = Math.max(maxX, ent.x1, ent.x2);
                minY = Math.min(minY, ent.y1, ent.y2);
                maxY = Math.max(maxY, ent.y1, ent.y2);
            }
        });

        if (minX !== Infinity) {
            capa.piezas = [{
                id: capa.id + '_dxf_group',
                width: maxX - minX,
                height: maxY - minY,
                originalX: minX,
                originalY: minY,
                label: capa.nombre,
                qty: 1,
                selected: true,
                materialId: null
            }];
        }
    }

    function solapanOCercano(a, b, tol) {
        return !(a.x + a.w + tol < b.x || b.x + b.w + tol < a.x ||
                 a.y + a.h + tol < b.y || b.y + b.h + tol < a.y);
    }

    function actualizarPiezasCAD() {
        var tbody = document.getElementById('cad-pieces-table-body');
        if (!tbody) return;

        // Consolidar piezas de todas las capas visibles
        piezasCAD = [];
        capasCAD.forEach(function(c) {
            if (c.visible) {
                c.piezas.forEach(function(p) {
                    p.capaNombre = c.nombre; // Registrar origen de la capa
                    piezasCAD.push(p);
                });
            }
        });

        if (piezasCAD.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-400 italic">No hay piezas cargadas</td></tr>';
            document.getElementById('cad-entities-count').textContent = '0 piezas';
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

            ctx.fillStyle = hexToRgba(pl.color, isDragging ? 0.9 : 0.8);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = (isDragging ? 3 : 1) / cadCam.zoom;

            var rx = px * scale + offsetX;
            var ry = -py * scale + offsetY;
            var rw = pl.width * scale;
            var rh = -pl.height * scale;

            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);

            // Texto descriptivo del material
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold ' + Math.max(8, 12 / cadCam.zoom) + 'px sans-serif';
            ctx.fillText(pl.nombre, rx + (5/cadCam.zoom), ry + (15/cadCam.zoom));
            
            ctx.font = 'normal ' + Math.max(8, 10 / cadCam.zoom) + 'px monospace';
            ctx.fillText(pl.width + 'x' + pl.height + 'mm', rx + (5/cadCam.zoom), ry + (30/cadCam.zoom));
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
    function optimizarCortes() {
        var kerf = parseFloat(document.getElementById('opt-kerf').value) || 0;
        var costoHora = parseFloat(document.getElementById('opt-costo-hora').value) || 0;

        // 1. Agrupar piezas seleccionadas por material asignado
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
                        originalH: p.height
                    });
                }
            }
        });

        var materialIds = Object.keys(piezasPorMaterial);
        if (materialIds.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin asignaciones',
                text: 'Asigna al menos un material a tus piezas activas en la tabla de Configuración de Piezas.'
            });
            return;
        }

        nestingResultados = {};

        // 2. Procesar el nesting de forma independiente por cada material
        materialIds.forEach(function(matId) {
            var mat = materiales.find(function(m) { return m.id === matId; });
            if (!mat) return;

            var laminaLargo = mat.largo;
            var laminaAncho = mat.ancho;
            var piezasACortar = piezasPorMaterial[matId];

            // Ordenar por área descendente
            piezasACortar.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

            // Algoritmo Guillotine (Shelf) con Rotación inteligente
            var planchas = [];
            var planchaActual = [];
            var espacioRestanteX = laminaAncho;
            var espacioRestanteY = laminaLargo;
            var currentX = 0;
            var currentY = 0;
            var rowHeight = 0;

            piezasACortar.forEach(function(pieza) {
                var w = pieza.w;
                var h = pieza.h;
                var originalW = pieza.originalW;
                var originalH = pieza.originalH;

                // Probar en fila actual
                if (w <= espacioRestanteX && h <= espacioRestanteY) {
                    planchaActual.push({
                        x: currentX, y: currentY,
                        w: originalW, h: originalH,
                        label: pieza.label
                    });
                    currentX += w;
                    espacioRestanteX -= w;
                    rowHeight = Math.max(rowHeight, h);
                } else if (h <= espacioRestanteX && w <= espacioRestanteY) {
                    planchaActual.push({
                        x: currentX, y: currentY,
                        w: originalH, h: originalW,
                        label: pieza.label + ' (Rotada)'
                    });
                    currentX += h;
                    espacioRestanteX -= h;
                    rowHeight = Math.max(rowHeight, w);
                } else {
                    // Nueva fila
                    currentY += rowHeight;
                    espacioRestanteY -= rowHeight;
                    currentX = 0;
                    espacioRestanteX = laminaAncho;
                    rowHeight = 0;

                    if (w <= laminaAncho && h <= espacioRestanteY) {
                        planchaActual.push({
                            x: currentX, y: currentY,
                            w: originalW, h: originalH,
                            label: pieza.label
                        });
                        currentX += w;
                        espacioRestanteX -= w;
                        rowHeight = Math.max(rowHeight, h);
                    } else if (h <= laminaAncho && w <= espacioRestanteY) {
                        planchaActual.push({
                            x: currentX, y: currentY,
                            w: originalH, h: originalW,
                            label: pieza.label + ' (Rotada)'
                        });
                        currentX += h;
                        espacioRestanteX -= h;
                        rowHeight = Math.max(rowHeight, w);
                    } else {
                        // Nueva plancha
                        if (planchaActual.length) planchas.push(planchaActual);

                        currentX = 0;
                        currentY = 0;
                        espacioRestanteX = laminaAncho;
                        espacioRestanteY = laminaLargo;
                        rowHeight = 0;

                        if (w <= laminaAncho && h <= laminaLargo) {
                            planchaActual = [{
                                x: currentX, y: currentY,
                                w: originalW, h: originalH,
                                label: pieza.label
                            }];
                            currentX += w;
                            espacioRestanteX -= w;
                            rowHeight = Math.max(rowHeight, h);
                        } else if (h <= laminaAncho && w <= laminaLargo) {
                            planchaActual = [{
                                x: currentX, y: currentY,
                                w: originalH, h: originalW,
                                label: pieza.label + ' (Rotada)'
                            }];
                            currentX += h;
                            espacioRestanteX -= h;
                            rowHeight = Math.max(rowHeight, w);
                        } else {
                            planchaActual = [{
                                x: currentX, y: currentY,
                                w: originalW, h: originalH,
                                label: pieza.label,
                                noCabe: true
                            }];
                        }
                    }
                }
            });
            if (planchaActual.length) planchas.push(planchaActual);

            // Calcular métricas del material
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

            // Tiempo y costos
            var perimetroTotal = 0;
            planchas.forEach(function(p) {
                p.forEach(function(piece) {
                    perimetroTotal += 2 * (piece.w + piece.h);
                });
            });
            var tiempoCorteSeg = (perimetroTotal / 20) + (totalPlanchas * 5);
            var costoOperativo = (tiempoCorteSeg / 3600) * costoHora;

            nestingResultados[matId] = {
                material: mat,
                planchas: planchasDetalle,
                totalPiezas: totalPiezas,
                totalPlanchas: totalPlanchas,
                areaUsadaTotal: areaUsadaTotal,
                usoPct: usoTotalPct,
                desperdicioPct: 100 - usoTotalPct,
                costoOperativo: costoOperativo
            };
        });

        // 3. Inicializar el material activo para visualización
        activeNestingMaterialId = materialIds[0];
        activeNestingPlanchaIndex = 0;

        renderResultadosMultimaterial();
        actualizarResultadosMaterialActivo();

        Swal.fire({
            icon: 'success',
            title: 'Optimización completada',
            text: 'Se procesaron ' + materialIds.length + ' materiales diferentes.',
            timer: 2000,
            showConfirmButton: false
        });
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
        var laminaLargo = mat.largo;
        var laminaAncho = mat.ancho;

        canvas.width = wrapper.clientWidth || 600;
        canvas.height = 400;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo oscuro estilo blueprint
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calcular escala base para encajar la lámina
        var scale = Math.min(canvas.width / laminaAncho, canvas.height / laminaLargo) * 0.88;
        var offsetX = (canvas.width - laminaAncho * scale) / 2;
        var offsetY = (canvas.height - laminaLargo * scale) / 2;

        // Aplicar transformaciones de la cámara
        ctx.save();
        ctx.translate(layoutCam.panX, layoutCam.panY);
        ctx.scale(layoutCam.zoom, layoutCam.zoom);

        // Dibujar lámina física de material
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(offsetX, offsetY, laminaAncho * scale, laminaLargo * scale);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5 / layoutCam.zoom;
        ctx.strokeRect(offsetX, offsetY, laminaAncho * scale, laminaLargo * scale);

        // Dibujar un grid fino dentro de la plancha
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.15)';
        ctx.lineWidth = 0.5 / layoutCam.zoom;
        var spacing = 100;
        for (var sx = spacing; sx < laminaAncho; sx += spacing) {
            ctx.beginPath();
            ctx.moveTo(offsetX + sx * scale, offsetY);
            ctx.lineTo(offsetX + sx * scale, offsetY + laminaLargo * scale);
            ctx.stroke();
        }
        for (var sy = spacing; sy < laminaLargo; sy += spacing) {
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + sy * scale);
            ctx.lineTo(offsetX + laminaAncho * scale, offsetY + sy * scale);
            ctx.stroke();
        }

        // Color del material
        var colorMaterial = mat.color || '#e28743';

        // Dibujar las piezas colocadas
        plancha.piezas.forEach(function(piece) {
            if (piece.noCabe) {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
                ctx.strokeStyle = '#ef4444';
            } else {
                ctx.fillStyle = hexToRgba(colorMaterial, 0.18);
                ctx.strokeStyle = colorMaterial;
            }
            ctx.lineWidth = 1.5 / layoutCam.zoom;

            var rx = offsetX + piece.x * scale;
            var ry = offsetY + piece.y * scale;
            var rw = piece.w * scale;
            var rh = piece.h * scale;

            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);

            // Nombre y dimensiones de la pieza
            var fontSize = Math.max(7, 9 / layoutCam.zoom);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold ' + fontSize + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            var lbl = piece.label.length > 10 ? piece.label.substr(0, 8) + '..' : piece.label;
            ctx.fillText(lbl, rx + rw / 2, ry + rh / 2 - fontSize * 0.5);
            ctx.fillStyle = hexToRgba(colorMaterial, 0.9);
            ctx.font = (fontSize * 0.85) + 'px monospace';
            ctx.fillText(piece.w.toFixed(0) + 'x' + piece.h.toFixed(0), rx + rw / 2, ry + rh / 2 + fontSize * 0.5);
        });

        ctx.restore();

        // Info fuera de la transformación
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Plancha ' + plancha.index + '/' + res.totalPlanchas + ' | Uso: ' + plancha.usoPct.toFixed(1) + '% | Zoom: ' + (layoutCam.zoom * 100).toFixed(0) + '%', 8, 14);
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

        // Calcular la coordenada Y máxima de las piezas colocadas
        var maxY = 0;
        plancha.piezas.forEach(function(p) {
            if (!p.noCabe) {
                maxY = Math.max(maxY, p.y + p.h);
            }
        });

        // El largo del retal rectangular restante al final del eje Y
        var retalLargo = laminaLargo - maxY;
        var retalAncho = laminaAncho;
        var generaRetal = retalLargo >= 150; // Mínimo 15cm para ser útil

        var textoRetal = generaRetal 
            ? '<br><span class="text-emerald-600 font-bold"><i class="fas fa-recycle mr-1"></i> Se generará un retal reutilizable de ' + Math.round(retalLargo) + 'x' + Math.round(retalAncho) + ' mm.</span>'
            : '<br><span class="text-rose-500 font-medium">El espacio restante es muy pequeño para ser catalogado como retal útil.</span>';

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
                    if (matOriginal.stock <= 0) {
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
                        matOriginal.sobrantes.push({
                            id: 'retal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                            largo: Math.round(retalLargo),
                            ancho: Math.round(retalAncho),
                            fecha: new Date().toISOString()
                        });
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
                // Redibujar después de entrar a pantalla completa
                setTimeout(function() {
                    if (elementId === 'cad-preview-canvas') redibujarCanvasCAD();
                    if (elementId === 'opt-layout-canvas-wrapper') dibujarLayoutCortes();
                }, 200);
            }).catch(function() {});
        }
        // Listener para redibujar al salir
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
        toggleFullscreen: toggleFullscreen
    };

})();
