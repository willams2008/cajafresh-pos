/**
 * provisionar-cad.js - Visualizador CAD 2D e Importador Vectorial
 */
(function() {
    var canvas = null;
    var ctx = null;
    var materialSeleccionadoId = null;

    var capasCAD = [];
    var piezasCAD = [];

    var cadCam = { panX: 20, panY: 20, zoom: 1 };
    var cadDrag = { active: false, startX: 0, startY: 0, mode: 'pan', pieceIdx: -1 };

    window.ProvisionarCAD = {
        init(canvasId) {
            if (!canvasId) canvasId = 'cad-canvas';
            canvas = document.getElementById(canvasId);
            if (!canvas) return;
            ctx = canvas.getContext('2d');

            this.bindEvents();
            this.bindEventsGlobales();
            this.initDropZone();
            this.redibujarCanvas();
            console.log('[ProvisionarCAD] Modulo CAD listo.');
        },

        bindEvents() {
            if (!canvas) return;

            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                var factor = e.deltaY < 0 ? 1.12 : 0.88;
                var rect = canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                cadCam.panX = mx - (mx - cadCam.panX) * factor;
                cadCam.panY = my - (my - cadCam.panY) * factor;
                cadCam.zoom *= factor;

                this.redibujarCanvas();
            }, { passive: false });

            canvas.addEventListener('mousedown', (e) => {
                e.preventDefault();
                var rect = canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                if (e.button === 0 || e.button === 1) {
                    var hitIdx = this.hitTestPieza(mx, my);
                    if (hitIdx !== -1) {
                        cadDrag.active = true;
                        cadDrag.mode = 'piece';
                        cadDrag.pieceIdx = hitIdx;
                        cadDrag.startX = mx;
                        cadDrag.startY = my;
                        canvas.style.cursor = 'grabbing';
                    } else {
                        cadDrag.active = true;
                        cadDrag.mode = 'pan';
                        cadDrag.startX = mx;
                        cadDrag.startY = my;
                        canvas.style.cursor = 'move';
                    }
                }
            });

            canvas.addEventListener('mousemove', (e) => {
                var rect = canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                if (!cadDrag.active) {
                    var hitIdx = this.hitTestPieza(mx, my);
                    canvas.style.cursor = hitIdx !== -1 ? 'grab' : 'default';
                    return;
                }

                var dx = mx - cadDrag.startX;
                var dy = my - cadDrag.startY;

                if (cadDrag.mode === 'pan') {
                    cadCam.panX += dx;
                    cadCam.panY += dy;
                } else if (cadDrag.mode === 'piece' && cadDrag.pieceIdx !== -1) {
                    var p = piezasCAD[cadDrag.pieceIdx];
                    p.x += dx / cadCam.zoom;
                    p.y += dy / cadCam.zoom;
                }

                cadDrag.startX = mx;
                cadDrag.startY = my;
                this.redibujarCanvas();
            });

            window.addEventListener('mouseup', () => {
                if (cadDrag.active) {
                    cadDrag.active = false;
                    cadDrag.pieceIdx = -1;
                    if (canvas) canvas.style.cursor = 'default';
                }
            });
        },

        bindEventsGlobales() {
            document.addEventListener('provisionar:materiales-actualizados', (e) => {
                var materiales = e.detail.materiales || [];
                this.actualizarSelectMateriales(materiales);
            });
        },

        actualizarSelectMateriales(materiales) {
            var $select = document.getElementById('cad-select-material');
            if (!$select) return;

            var html = '<option value="">-- Seleccionar Material para Corte --</option>';
            for (var i = 0; i < materiales.length; i++) {
                var m = materiales[i];
                html += '<option value="' + m.id + '">' + m.nombre + ' (' + m.ancho + 'x' + m.largo + 'mm - ' + m.espesor + 'mm)</option>';
            }
            $select.innerHTML = html;

            $select.addEventListener('change', (e) => {
                materialSeleccionadoId = e.target.value;
            });
        },

        // --- DROP ZONE: Drag & Drop + File Selector ---
        initDropZone() {
            var dropZone = document.getElementById('cad-drop-zone');
            var fileInput = document.getElementById('cad-file-input');

            if (!dropZone || !fileInput) return;

            dropZone.addEventListener('click', function() { fileInput.click(); });

            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                dropZone.style.background = '#d4efdf';
            });

            dropZone.addEventListener('dragleave', function() {
                dropZone.style.background = '#ebf5fb';
            });

            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                dropZone.style.background = '#ebf5fb';
                if (e.dataTransfer.files.length > 0) {
                    window.ProvisionarCAD.procesarArchivoVectorial(e.dataTransfer.files[0]);
                }
            });

            fileInput.addEventListener('change', function(e) {
                if (e.target.files.length > 0) {
                    window.ProvisionarCAD.procesarArchivoVectorial(e.target.files[0]);
                }
            });
        },

        // --- LECTOR DE ARCHIVOS VECTORIALES ---
        procesarArchivoVectorial(file) {
            var reader = new FileReader();
            var extension = file.name.split('.').pop().toLowerCase();

            reader.onload = function(e) {
                var contenido = e.target.result;
                if (extension === 'svg') {
                    window.ProvisionarCAD.parsearSVG(file.name, contenido);
                } else if (extension === 'dxf') {
                    window.ProvisionarCAD.parsearDXF(file.name, contenido);
                } else {
                    alert('Formato no soportado. Usa archivos .SVG o .DXF');
                }
            };

            reader.readAsText(file);
        },

        // --- PARSER SVG NATIVO ---
        parsearSVG(nombreArchivo, svgTexto) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(svgTexto, 'image/svg+xml');
            var svgEl = doc.querySelector('svg');

            if (!svgEl) {
                alert('El archivo SVG no tiene un formato valido.');
                return;
            }

            var width = parseFloat(svgEl.getAttribute('width')) || 100;
            var height = parseFloat(svgEl.getAttribute('height')) || 100;

            var viewBox = svgEl.getAttribute('viewBox');
            if (viewBox) {
                var parts = viewBox.split(/[\s,]+/).map(Number);
                if (parts.length === 4) {
                    width = parts[2];
                    height = parts[3];
                }
            }

            this.agregarPiezaCAD(nombreArchivo, width, height);
        },

        // --- PARSER DXF NATIVO (BBOX Extractor) ---
        parsearDXF(nombreArchivo, dxfTexto) {
            var lineas = dxfTexto.split(/\r\n|\r|\n/);
            var minX = Infinity, maxX = -Infinity;
            var minY = Infinity, maxY = -Infinity;

            var leyendoEntidades = false;

            for (var i = 0; i < lineas.length; i++) {
                var linea = lineas[i].trim();

                if (linea === 'ENTITIES') leyendoEntidades = true;
                if (linea === 'ENDSEC' && leyendoEntidades) break;

                if (leyendoEntidades) {
                    if (linea === '10' || linea === '11') {
                        var valX = parseFloat(lineas[i + 1]);
                        if (!isNaN(valX)) {
                            if (valX < minX) minX = valX;
                            if (valX > maxX) maxX = valX;
                        }
                    }
                    if (linea === '20' || linea === '21') {
                        var valY = parseFloat(lineas[i + 1]);
                        if (!isNaN(valY)) {
                            if (valY < minY) minY = valY;
                            if (valY > maxY) maxY = valY;
                        }
                    }
                }
            }

            var width = (maxX !== -Infinity && minX !== Infinity) ? (maxX - minX) : 100;
            var height = (maxY !== -Infinity && minY !== Infinity) ? (maxY - minY) : 100;

            this.agregarPiezaCAD(nombreArchivo, width, height);
        },

        // --- REGISTRAR PIEZA EN EL ESTADO INTERNO ---
        agregarPiezaCAD(nombre, ancho, largo) {
            var nuevaPieza = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                nombre: nombre,
                ancho: Math.round(ancho),
                largo: Math.round(largo),
                x: 10,
                y: 10,
                cantidad: 1
            };

            piezasCAD.push(nuevaPieza);
            this.redibujarCanvas();
            console.log('[ProvisionarCAD] Pieza agregada con exito:', nuevaPieza);
        },

        hitTestPieza(mx, my) {
            for (var i = piezasCAD.length - 1; i >= 0; i--) {
                var p = piezasCAD[i];
                var px = cadCam.panX + p.x * cadCam.zoom;
                var py = cadCam.panY + p.y * cadCam.zoom;
                var pw = p.ancho * cadCam.zoom;
                var ph = p.largo * cadCam.zoom;

                if (mx >= px && mx <= px + pw && my >= py && my <= py + ph) {
                    return i;
                }
            }
            return -1;
        },

        redibujarCanvas() {
            if (!ctx || !canvas) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            this.dibujarMalla();

            for (var i = 0; i < piezasCAD.length; i++) {
                var p = piezasCAD[i];
                var px = cadCam.panX + p.x * cadCam.zoom;
                var py = cadCam.panY + p.y * cadCam.zoom;
                var pw = p.ancho * cadCam.zoom;
                var ph = p.largo * cadCam.zoom;

                ctx.fillStyle = cadDrag.pieceIdx === i ? 'rgba(52, 152, 219, 0.4)' : 'rgba(46, 204, 113, 0.2)';
                ctx.strokeStyle = cadDrag.pieceIdx === i ? '#2980b9' : '#27ae60';
                ctx.lineWidth = 2;

                ctx.fillRect(px, py, pw, ph);
                ctx.strokeRect(px, py, pw, ph);

                ctx.fillStyle = '#2c3e50';
                ctx.font = '12px sans-serif';
                ctx.fillText(p.nombre + ' (' + p.ancho + 'x' + p.largo + 'mm)', px + 5, py + 18);
            }
        },

        dibujarMalla() {
            var paso = 50 * cadCam.zoom;
            ctx.strokeStyle = '#eef2f7';
            ctx.lineWidth = 1;

            for (var x = cadCam.panX % paso; x < canvas.width; x += paso) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (var y = cadCam.panY % paso; y < canvas.height; y += paso) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
        },

        obtenerPiezasParaCorte() {
            return {
                materialId: materialSeleccionadoId,
                piezas: piezasCAD
            };
        }
    };
})();
