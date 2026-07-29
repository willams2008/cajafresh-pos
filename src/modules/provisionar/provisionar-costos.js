/**
 * provisionar-costos.js - Modulo de Cotizacion, Margenes y PDF
 */
(function() {
    var ultimoResultadoCorte = null;
    var materialUsado = null;

    var configCostos = {
        costoHoraMaquina: 25.00,
        velocidadCorte: 1500,
        margenGanancia: 35.00,
        impuesto: 16.00
    };

    window.ProvisionarCostos = {
        init() {
            this.bindEventsGlobales();
            this.bindEventsUI();
            console.log('[ProvisionarCostos] Modulo de Costeo listo.');
        },

        bindEventsGlobales() {
            document.addEventListener('provisionar:corte-completado', async (e) => {
                ultimoResultadoCorte = e.detail;

                var datosCAD = window.ProvisionarCAD.obtenerPiezasParaCorte();
                if (datosCAD.materialId) {
                    materialUsado = await window.ProvisionarDB.obtenerMaterialPorId(datosCAD.materialId);
                }

                this.calcularCostos();
            });
        },

        bindEventsUI() {
            var $inputMargen = document.getElementById('costo-margen-input');
            var $inputHora = document.getElementById('costo-hora-input');
            var $btnPDF = document.getElementById('btn-generar-pdf');
            var $btnRecalcular = document.getElementById('btn-recalcular-costo');

            if ($inputMargen) {
                $inputMargen.addEventListener('input', (e) => {
                    configCostos.margenGanancia = parseFloat(e.target.value) || 0;
                    this.calcularCostos();
                });
            }

            if ($inputHora) {
                $inputHora.addEventListener('input', (e) => {
                    configCostos.costoHoraMaquina = parseFloat(e.target.value) || 0;
                    this.calcularCostos();
                });
            }

            if ($btnRecalcular) {
                $btnRecalcular.addEventListener('click', () => {
                    this.calcularCostos();
                });
            }

            if ($btnPDF) {
                $btnPDF.addEventListener('click', () => {
                    this.exportarPDF();
                });
            }
        },

        calcularCostos() {
            if (!ultimoResultadoCorte || !materialUsado) {
                var $container = document.getElementById('costos-resumen-container');
                if ($container) {
                    $container.innerHTML = '<div style="padding: 15px; background: #fff3cd; border-radius: 8px; color: #856404;">Primero ejecuta un corte en la pestana CAD (agrega piezas, selecciona material y presiona Optimizar Corte).</div>';
                }
                return;
            }

            var numPlanchas = ultimoResultadoCorte.totalPlanchas;
            var costoPlanchaUnitaria = materialUsado.precio || 0;
            var costoMateriaPrimaTotal = numPlanchas * costoPlanchaUnitaria;

            var perimetroTotalMM = 0;
            for (var i = 0; i < ultimoResultadoCorte.planchas.length; i++) {
                var plancha = ultimoResultadoCorte.planchas[i];
                for (var j = 0; j < plancha.piezasUbicadas.length; j++) {
                    var p = plancha.piezasUbicadas[j];
                    perimetroTotalMM += (p.anchoColocado + p.largoColocado) * 2;
                }
            }

            var minutosEstimados = (perimetroTotalMM / configCostos.velocidadCorte) + (numPlanchas * 2);
            var horasEstimadas = minutosEstimados / 60;
            var costoMecanizado = horasEstimadas * configCostos.costoHoraMaquina;

            var costoDirectoTotal = costoMateriaPrimaTotal + costoMecanizado;

            var ganancia = costoDirectoTotal * (configCostos.margenGanancia / 100);
            var subtotal = costoDirectoTotal + ganancia;
            var impuesto = subtotal * (configCostos.impuesto / 100);
            var precioVentaTotal = subtotal + impuesto;

            this.renderCotizacion({
                numPlanchas: numPlanchas,
                costoPlanchaUnitaria: costoPlanchaUnitaria,
                costoMateriaPrimaTotal: costoMateriaPrimaTotal,
                minutosEstimados: minutosEstimados.toFixed(1),
                costoMecanizado: costoMecanizado,
                costoDirectoTotal: costoDirectoTotal,
                margenAplicado: configCostos.margenGanancia,
                ganancia: ganancia,
                subtotal: subtotal,
                impuesto: impuesto,
                precioVentaTotal: precioVentaTotal
            });
        },

        renderCotizacion(c) {
            var $container = document.getElementById('costos-resumen-container');
            if (!$container) return;

            $container.innerHTML =
                '<div class="cotizacion-card" style="border: 1px solid #ddd; padding: 20px; border-radius: 8px; background: #fff;">' +
                    '<h3 style="margin-top:0;">Cotizacion Consolidada</h3>' +
                    '<table style="width:100%; text-align:left; border-collapse: collapse;">' +
                        '<tr>' +
                            '<td>Material (' + c.numPlanchas + ' lamina/s):</td>' +
                            '<td style="text-align:right;">$' + c.costoMateriaPrimaTotal.toFixed(2) + '</td>' +
                        '</tr>' +
                        '<tr>' +
                            '<td>Mecanizado/Corte (~' + c.minutosEstimados + ' min):</td>' +
                            '<td style="text-align:right;">$' + c.costoMecanizado.toFixed(2) + '</td>' +
                        '</tr>' +
                        '<tr style="border-top: 1px solid #eee;">' +
                            '<td><strong>Costo Directo Produccion:</strong></td>' +
                            '<td style="text-align:right;"><strong>$' + c.costoDirectoTotal.toFixed(2) + '</strong></td>' +
                        '</tr>' +
                        '<tr>' +
                            '<td>Margen de Utilidad (' + c.margenAplicado + '%):</td>' +
                            '<td style="text-align:right; color: #27ae60;">+$' + c.ganancia.toFixed(2) + '</td>' +
                        '</tr>' +
                        '<tr>' +
                            '<td>IVA / Impuestos (' + configCostos.impuesto + '%):</td>' +
                            '<td style="text-align:right;">+$' + c.impuesto.toFixed(2) + '</td>' +
                        '</tr>' +
                        '<tr style="border-top: 2px solid #333; font-size: 1.2em;">' +
                            '<td><strong>Precio Venta Sugerido:</strong></td>' +
                            '<td style="text-align:right; color: #2c3e50;"><strong>$' + c.precioVentaTotal.toFixed(2) + '</strong></td>' +
                        '</tr>' +
                    '</table>' +
                '</div>';
        },

        exportarPDF() {
            if (!ultimoResultadoCorte) {
                alert('No hay un calculo de corte activo para exportar.');
                return;
            }
            window.print();
        }
    };
})();
