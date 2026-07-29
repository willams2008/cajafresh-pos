/**
 * provisionar-cortes.js - Controlador UI de Nesting y Worker
 * Orquestador que conecta CAD -> Worker -> Resultados -> Costos
 */
(function() {
    var worker = null;
    var $btnCalcular = null;
    var $contenedorResultados = null;

    window.ProvisionarCortes = {
        init() {
            $btnCalcular = document.getElementById('btn-ejecutar-nesting');
            $contenedorResultados = document.getElementById('nesting-resultados-container');

            this.initWorker();
            this.bindEvents();
            console.log('[ProvisionarCortes] Modulo de Cortes e hilo Worker listos.');
        },

        initWorker() {
            try {
                worker = new Worker('src/modules/provisionar/provisionar-worker.js');

                worker.onmessage = (e) => {
                    var resultado = e.data;
                    this.onNestingCompletado(resultado);
                };

                worker.onerror = (err) => {
                    console.error('[ProvisionarCortes] Error en Worker:', err);
                    alert('Ocurrio un error calculando el patron de corte.');
                };
            } catch (err) {
                console.error('[ProvisionarCortes] No se pudo inicializar el Worker:', err);
            }
        },

        bindEvents() {
            if ($btnCalcular) {
                $btnCalcular.addEventListener('click', async () => {
                    await this.ejecutarNesting();
                });
            }
        },

        async ejecutarNesting() {
            var datosCAD = window.ProvisionarCAD.obtenerPiezasParaCorte();
            if (!datosCAD.materialId) {
                alert('Por favor selecciona un material antes de procesar el corte.');
                return;
            }

            if (!datosCAD.piezas || datosCAD.piezas.length === 0) {
                alert('No hay piezas vectoriales cargadas en el lienzo CAD.');
                return;
            }

            var lamina = await window.ProvisionarDB.obtenerMaterialPorId(datosCAD.materialId);
            if (!lamina) {
                alert('El material seleccionado ya no existe en el inventario.');
                return;
            }

            if ($btnCalcular) {
                $btnCalcular.disabled = true;
                $btnCalcular.innerText = 'Calculando Optimizacion...';
            }

            worker.postMessage({
                piezas: datosCAD.piezas,
                lamina: lamina,
                opciones: {
                    kerf: 3,
                    margenBorde: 10
                }
            });
        },

        onNestingCompletado(resultado) {
            if ($btnCalcular) {
                $btnCalcular.disabled = false;
                $btnCalcular.innerText = 'Optimizar Corte';
            }

            console.log('[ProvisionarCortes] Nesting procesado:', resultado);
            this.renderResumen(resultado);

            document.dispatchEvent(new CustomEvent('provisionar:corte-completado', {
                detail: resultado
            }));
        },

        renderResumen(resultado) {
            if (!$contenedorResultados) return;

            var html = '<div class="card-nesting-resumen" style="padding: 15px; background: #f8f9fa; border-radius: 8px;">';
            html += '<h4>Resultado del Acople</h4>';
            html += '<p><strong>Planchas Necesarias:</strong> ' + resultado.totalPlanchas + '</p>';
            html += '<p><strong>Piezas sin colocar:</strong> ' + resultado.piezasSinColocar.length + '</p>';
            html += '<hr>';

            for (var i = 0; i < resultado.planchas.length; i++) {
                var p = resultado.planchas[i];
                html += '<div class="plancha-info" style="margin-bottom: 8px;">';
                html += '<span><strong>Plancha #' + p.id + ':</strong> Aprovechamiento ' + p.porcentajeAprovechamiento + '% | Desperdicio ' + p.porcentajeDesperdicio + '%</span>';
                html += '</div>';
            }

            html += '</div>';
            $contenedorResultados.innerHTML = html;
        }
    };
})();
