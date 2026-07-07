/**
 * Reports Module — Namespace para Reporte de Caja
 * Wrapper + mejoras: filtro por fecha, desglose por método, cuadre de caja.
 */

window.Reports = window.Reports || {};

(function() {
    var NS = window.Reports;

    NS.render = function(filteredSales) {
        if (typeof window.renderReports === 'function') {
            window.renderReports();
        }
        if (filteredSales) {
            NS._renderWithFilter(filteredSales);
        }
    };

    // ── Filtro por rango de fecha ──

    var dateFilterVisible = false;

    /**
     * Agrega el selector de fecha al header de Reporte de Caja.
     */
    NS.initDateFilter = function() {
        var header = document.querySelector('#view-reports header');
        if (!header || document.getElementById('reports-date-filter')) return;

        var filterContainer = document.createElement('div');
        filterContainer.id = 'reports-date-filter';
        filterContainer.className = 'reports-date-filter';
        filterContainer.innerHTML =
            '<div class="date-filter-inner">' +
                '<label class="date-filter-label">Desde:</label>' +
                '<input type="date" id="report-date-start" class="date-filter-input">' +
                '<label class="date-filter-label">Hasta:</label>' +
                '<input type="date" id="report-date-end" class="date-filter-input">' +
                '<button id="report-date-apply" class="date-filter-btn date-filter-btn-apply">' +
                    '<i class="fas fa-filter"></i> Filtrar' +
                '</button>' +
                '<button id="report-date-reset" class="date-filter-btn date-filter-btn-reset">' +
                    '<i class="fas fa-undo"></i> Hoy' +
                '</button>' +
                '<span id="report-date-range-label" class="date-filter-range-label"></span>' +
            '</div>';

        var btnGroup = header.querySelector('.flex.gap-3, .flex.flex-wrap');
        if (btnGroup) {
            btnGroup.parentNode.insertBefore(filterContainer, btnGroup);
        } else {
            header.appendChild(filterContainer);
        }

        // Hoy por defecto
        var today = new Date().toISOString().slice(0, 10);
        document.getElementById('report-date-start').value = today;
        document.getElementById('report-date-end').value = today;

        // Eventos
        document.getElementById('report-date-apply').addEventListener('click', function() {
            NS.applyDateFilter();
        });

        document.getElementById('report-date-reset').addEventListener('click', function() {
            document.getElementById('report-date-start').value = today;
            document.getElementById('report-date-end').value = today;
            NS.applyDateFilter();
        });

        // Enter en los inputs aplica filtro
        document.getElementById('report-date-start').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') NS.applyDateFilter();
        });
        document.getElementById('report-date-end').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') NS.applyDateFilter();
        });

        NS.injectDateFilterStyles();
    };

    NS.applyDateFilter = function() {
        var startVal = document.getElementById('report-date-start').value;
        var endVal = document.getElementById('report-date-end').value;
        if (!startVal || !endVal) return;

        var start = new Date(startVal + 'T00:00:00');
        var end = new Date(endVal + 'T23:59:59');

        var filtered = (window.sales || []).filter(function(s) {
            var d = new Date(s.date);
            return d >= start && d <= end && s.status !== 'voided' && s.status !== 'void';
        });

        var label = document.getElementById('report-date-range-label');
        if (label) {
            var days = Math.round((end - start) / 86400000) + 1;
            label.textContent = filtered.length + ' ventas · ' + days + ' día(s)';
        }

        NS._renderWithFilter(filtered);
    };

    NS._renderWithFilter = function(filteredSales) {
        if (typeof window.renderReports !== 'function') return;

        // Sobrescribir temporalmente sales para renderReports
        var originalSales = window.sales;
        window.sales = filteredSales;
        window.renderReports();
        window.sales = originalSales;
    };

    // ── Desglose por método de pago ──

    NS.showPaymentBreakdown = function(salesList) {
        salesList = salesList || window.sales || [];

        var breakdown = {};
        salesList.forEach(function(s) {
            if (s.status === 'voided' || s.status === 'void') return;
            var method = s.method || 'other';
            if (!breakdown[method]) breakdown[method] = { totalUSD: 0, totalVES: 0, count: 0 };
            breakdown[method].totalUSD += Number(s.totalUSD) || 0;
            breakdown[method].totalVES += Number(s.totalVES) || 0;
            breakdown[method].count++;
        });

        return breakdown;
    };

    // ── Cuadre de Caja Formal ──

    /**
     * Abre modal de cuadre de caja con desglose por método y diferencia.
     */
    NS.openCashReconciliation = function() {
        var today = new Date().toISOString().slice(0, 10);
        var todaySales = (window.sales || []).filter(function(s) {
            var d = s.date ? s.date.slice(0, 10) : '';
            return d === today && s.status !== 'voided' && s.status !== 'void';
        });

        var expected = NS.showPaymentBreakdown(todaySales);

        var totalExpectedUSD = todaySales.reduce(function(s, sale) { return s + (Number(sale.totalUSD) || 0); }, 0);
        var totalExpectedVES = todaySales.reduce(function(s, sale) { return s + (Number(sale.totalVES) || 0); }, 0);

        var methodNames = {
            'cash-usd': 'Efectivo USD',
            'cash-ves': 'Efectivo BS',
            'card-ves': 'Punto BS',
            'pago-movil': 'Pago Móvil',
            'cash-eur': 'Euros',
            'Credito': 'Crédito/Fiado'
        };

        var breakdownHtml = Object.keys(expected).map(function(m) {
            var e = expected[m];
            var name = methodNames[m] || m;
            return '<div class="rec-line">' +
                '<span class="rec-method">' + name + '</span>' +
                '<span class="rec-count">' + e.count + ' ven.</span>' +
                '<span class="rec-amount">$' + e.totalUSD.toFixed(2) + '</span>' +
                '<span class="rec-amount-ves">Bs ' + e.totalVES.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,') + '</span>' +
            '</div>';
        }).join('');

        Swal.fire({
            title: 'Cuadre de Caja',
            width: 520,
            html:
                '<div class="rec-container">' +
                    '<div class="rec-header">' +
                        '<span>Resumen del día ' + today + '</span>' +
                    '</div>' +
                    '<div class="rec-totals">' +
                        '<div class="rec-total-box">' +
                            '<span class="rec-total-label">Total USD</span>' +
                            '<span class="rec-total-value">$' + totalExpectedUSD.toFixed(2) + '</span>' +
                        '</div>' +
                        '<div class="rec-total-box">' +
                            '<span class="rec-total-label">Total Bs</span>' +
                            '<span class="rec-total-value">Bs ' + totalExpectedVES.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,') + '</span>' +
                        '</div>' +
                        '<div class="rec-total-box">' +
                            '<span class="rec-total-label">Tickets</span>' +
                            '<span class="rec-total-value">' + todaySales.length + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="rec-breakdown">' +
                        '<div class="rec-breakdown-title">Desglose por método</div>' +
                        breakdownHtml +
                    '</div>' +
                    '<div class="rec-inputs">' +
                        '<div class="rec-input-row">' +
                            '<label>Efectivo USD en caja (físico):</label>' +
                            '<input type="number" step="0.01" id="rec-cash-usd" class="swal2-input rec-input" placeholder="0.00">' +
                        '</div>' +
                        '<div class="rec-input-row">' +
                            '<label>Efectivo BS en caja (físico):</label>' +
                            '<input type="number" step="0.01" id="rec-cash-ves" class="swal2-input rec-input" placeholder="0.00">' +
                        '</div>' +
                        '<div class="rec-input-row">' +
                            '<label>Tarjeta / Punto (según voucher):</label>' +
                            '<input type="number" step="0.01" id="rec-card-total" class="swal2-input rec-input" placeholder="0.00">' +
                        '</div>' +
                    '</div>' +
                    '<div id="rec-difference" class="rec-difference"></div>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Cerrar Cuadre',
            cancelButtonText: 'Cancelar',
            didOpen: function() {
                // Calcular diferencia en vivo
                ['rec-cash-usd', 'rec-cash-ves', 'rec-card-total'].forEach(function(id) {
                    document.getElementById(id).addEventListener('input', function() {
                        NS._calcDifference(expected);
                    });
                });
            },
            preConfirm: function() {
                var diffEl = document.getElementById('rec-difference');
                if (!diffEl) return true;

                // Si hay diferencias grandes, preguntar si está seguro
                var diffText = diffEl.textContent || '';
                if (diffText.includes('$0.00') || diffText.includes('Bs 0') || diffText === '') {
                    return true;
                }
                // Si hay diferencia, igual permitimos cerrar
                return true;
            }
        });
    };

    NS._calcDifference = function(expected) {
        var cashUSD = parseFloat(document.getElementById('rec-cash-usd').value) || 0;
        var cashVES = parseFloat(document.getElementById('rec-cash-ves').value) || 0;
        var cardTotal = parseFloat(document.getElementById('rec-card-total').value) || 0;

        var expectedUSD = (expected['cash-usd']?.totalUSD || 0) + (expected['cash-eur']?.totalUSD || 0);
        var expectedVES = (expected['cash-ves']?.totalVES || 0) + (expected['card-ves']?.totalVES || 0) + (expected['pago-movil']?.totalVES || 0);

        var rate = (window.settings && window.settings.exchangeRate) || 1;

        var diffUSD = cashUSD - expectedUSD;
        var diffVES = cashVES - expectedVES;

        var diffEl = document.getElementById('rec-difference');
        if (!diffEl) return;

        var html = '';
        if (expectedUSD > 0) {
            var signUSD = diffUSD >= 0 ? '+' : '';
            var colorUSD = Math.abs(diffUSD) < 1 ? 'var(--green)' : (diffUSD >= 0 ? 'var(--amber)' : 'var(--red)');
            html += '<div class="diff-line" style="color:' + colorUSD + '">' +
                'Diferencia USD: <strong>' + signUSD + '$' + diffUSD.toFixed(2) + '</strong>' +
                (Math.abs(diffUSD) > 5 ? ' ⚠️ Revisar' : ' ✓') +
            '</div>';
        }
        if (expectedVES > 0) {
            var diffVESConv = diffVES / rate;
            var signVES = diffVES >= 0 ? '+' : '';
            var colorVES = Math.abs(diffVESConv) < 1 ? 'var(--green)' : (diffVES >= 0 ? 'var(--amber)' : 'var(--red)');
            html += '<div class="diff-line" style="color:' + colorVES + '">' +
                'Diferencia BS: <strong>' + signVES + 'Bs ' + diffVES.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,') + '</strong>' +
                (Math.abs(diffVESConv) > 5 ? ' ⚠️ Revisar' : ' ✓') +
            '</div>';
        }

        diffEl.innerHTML = html || '<div class="diff-line" style="color:var(--green)">✓ Sin diferencias — cuadre perfecto</div>';
    };

    // ── Estilos ──

    NS.injectDateFilterStyles = function() {
        if (document.getElementById('reports-ext-styles')) return;
        var css = document.createElement('style');
        css.id = 'reports-ext-styles';
        css.textContent = `
            .reports-date-filter {
                display: flex;
                align-items: center;
                gap: 8px;
                background: #f8fafc;
                padding: 8px 14px;
                border-radius: 12px;
                border: 1px solid #e2e8f0;
                flex-wrap: wrap;
            }
            .dark .reports-date-filter {
                background: #1e293b;
                border-color: #334155;
            }
            .date-filter-inner {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
            }
            .date-filter-label {
                font-size: 10px;
                font-weight: 700;
                color: #64748b;
                text-transform: uppercase;
            }
            .date-filter-input {
                padding: 4px 8px;
                border-radius: 6px;
                border: 1px solid #cbd5e1;
                font-size: 12px;
                background: white;
                color: #1e293b;
                max-width: 140px;
            }
            .dark .date-filter-input {
                background: #0f172a;
                border-color: #475569;
                color: #e2e8f0;
            }
            .date-filter-btn {
                padding: 5px 12px;
                border-radius: 8px;
                border: none;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.15s;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .date-filter-btn-apply {
                background: #6366f1;
                color: white;
            }
            .date-filter-btn-apply:hover {
                background: #4f46e5;
            }
            .date-filter-btn-reset {
                background: #e2e8f0;
                color: #475569;
            }
            .dark .date-filter-btn-reset {
                background: #334155;
                color: #94a3b8;
            }
            .date-filter-range-label {
                font-size: 11px;
                font-weight: 600;
                color: #6366f1;
                margin-left: 4px;
            }

            /* Cuadre de Caja Styles */
            .rec-container { text-align: left; }
            .rec-header { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
            .rec-totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
            .rec-total-box { background: #f1f5f9; padding: 10px; border-radius: 10px; text-align: center; }
            .dark .rec-total-box { background: #1e293b; }
            .rec-total-label { display: block; font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
            .rec-total-value { display: block; font-size: 18px; font-weight: 800; color: #1e293b; margin-top: 2px; }
            .dark .rec-total-value { color: #e2e8f0; }
            .rec-breakdown { margin-bottom: 16px; }
            .rec-breakdown-title { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 6px; text-transform: uppercase; }
            .rec-line { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
            .dark .rec-line { border-color: #1e293b; }
            .rec-method { font-weight: 600; color: #334155; }
            .dark .rec-method { color: #cbd5e1; }
            .rec-count { font-size: 10px; color: #94a3b8; }
            .rec-amount { font-weight: 800; color: #059669; }
            .rec-amount-ves { font-weight: 600; color: #64748b; font-size: 11px; }
            .rec-inputs { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
            .rec-input-row { display: flex; align-items: center; gap: 8px; }
            .rec-input-row label { font-size: 11px; font-weight: 600; color: #475569; min-width: 160px; }
            .dark .rec-input-row label { color: #94a3b8; }
            .rec-input { flex: 1; height: 36px !important; font-size: 14px !important; }
            .rec-difference { background: #f8fafc; padding: 10px; border-radius: 10px; border: 1px solid #e2e8f0; margin-top: 8px; }
            .dark .rec-difference { background: #0f172a; border-color: #334155; }
            .diff-line { font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; padding: 4px 0; }
            .dark .diff-line { color: #e2e8f0 !important; }
        `;
        document.head.appendChild(css);
    };

})();
