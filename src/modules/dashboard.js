/**
 * Dashboard Module — Vista de inicio con resumen del día
 */

window.Dashboard = window.Dashboard || {};

(function() {
    var NS = window.Dashboard;

    NS.render = function() {
        var container = document.getElementById('view-dashboard-content');
        if (!container) {
            console.warn('[Dashboard] #view-dashboard-content no existe');
            return;
        }

        var today = new Date().toISOString().slice(0, 10);
        var allSales = window.sales || [];
        var todaySales = allSales.filter(function(s) {
            return s.date && s.date.slice(0, 10) === today && s.status !== 'voided' && s.status !== 'void';
        });

        var grossUSD = todaySales.reduce(function(s, sale) { return s + (Number(sale.totalUSD) || 0); }, 0);
        var grossVES = todaySales.reduce(function(s, sale) { return s + (Number(sale.totalVES) || 0); }, 0);
        var totalCost = todaySales.reduce(function(s, sale) { return s + (Number(sale.totalCostUSD) || 0); }, 0);
        var grossProfit = grossUSD - totalCost;
        var totalTickets = todaySales.length;
        var totalItems = todaySales.reduce(function(s, sale) {
            return s + (Array.isArray(sale.items) ? sale.items.reduce(function(a, i) { return a + (Number(i.qty) || 0); }, 0) : 0);
        }, 0);

        var expenses = window.expenses || [];
        var expTotal = expenses.reduce(function(s, e) { return s + (Number(e.amountUSD) || 0); }, 0);

        var products = window.products || [];
        var lowStock = products.filter(function(p) { return Number(p.stock) <= Number(p.minStock); });

        var pending = allSales.filter(function(s) { return s.status === 'pending'; });
        var pendingTotal = pending.reduce(function(s, sale) { return s + (Number(sale.totalUSD) || 0); }, 0);

        var hour = new Date().getHours();
        var greeting = hour < 12 ? 'Buenos días' : (hour < 18 ? 'Buenas tardes' : 'Buenas noches');
        var storeName = (window.settings && window.settings.storeName) || 'Punto Pila';

        container.innerHTML =
            '<div class="dash-greeting">' +
                '<div>' +
                    '<h2 class="dash-greeting-title">' + greeting + ' 👋</h2>' +
                    '<p class="dash-greeting-subtitle">' + storeName + ' — ' + new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</p>' +
                '</div>' +
                '<div class="dash-actions">' +
                    '<button class="dash-btn dash-btn-primary" onclick="document.getElementById(\'nav-pos\').click()">' +
                        '<i class="fas fa-cash-register"></i> Ir a POS' +
                    '</button>' +
                    '<button class="dash-btn dash-btn-secondary" onclick="Reports.openCashReconciliation()">' +
                        '<i class="fas fa-calculator"></i> Cuadre de Caja' +
                    '</button>' +
                '</div>' +
            '</div>' +

            '<div class="dash-kpis">' +
                '<div class="dash-kpi dash-kpi-sales">' +
                    '<div class="dash-kpi-icon"><i class="fas fa-dollar-sign"></i></div>' +
                    '<div class="dash-kpi-body">' +
                        '<span class="dash-kpi-value">$' + grossUSD.toFixed(2) + '</span>' +
                        '<span class="dash-kpi-label">Ventas USD</span>' +
                    '</div>' +
                '</div>' +
                '<div class="dash-kpi dash-kpi-ves">' +
                    '<div class="dash-kpi-icon"><i class="fas fa-bolt"></i></div>' +
                    '<div class="dash-kpi-body">' +
                        '<span class="dash-kpi-value">Bs ' + grossVES.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,') + '</span>' +
                        '<span class="dash-kpi-label">Ventas Bs</span>' +
                    '</div>' +
                '</div>' +
                '<div class="dash-kpi dash-kpi-profit">' +
                    '<div class="dash-kpi-icon"><i class="fas fa-chart-line"></i></div>' +
                    '<div class="dash-kpi-body">' +
                        '<span class="dash-kpi-value">$' + Math.max(0, grossProfit).toFixed(2) + '</span>' +
                        '<span class="dash-kpi-label">Ganancia Bruta</span>' +
                    '</div>' +
                '</div>' +
                '<div class="dash-kpi dash-kpi-tickets">' +
                    '<div class="dash-kpi-icon"><i class="fas fa-receipt"></i></div>' +
                    '<div class="dash-kpi-body">' +
                        '<span class="dash-kpi-value">' + totalTickets + '</span>' +
                        '<span class="dash-kpi-label">Tickets · ' + totalItems + ' artículos</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<div class="dash-grid">' +
                '<div class="dash-section">' +
                    '<div class="dash-section-header">' +
                        '<h3><i class="fas fa-clock-rotate"></i> Últimas Ventas</h3>' +
                        '<span class="dash-section-badge">' + Math.min(5, todaySales.length) + ' de ' + todaySales.length + '</span>' +
                    '</div>' +
                    '<div class="dash-section-body">' +
                        NS._renderRecentSales(todaySales) +
                    '</div>' +
                '</div>' +
                '<div class="dash-section">' +
                    '<div class="dash-section-header">' +
                        '<h3><i class="fas fa-triangle-exclamation"></i> Alertas</h3>' +
                    '</div>' +
                    '<div class="dash-section-body">' +
                        NS._renderAlerts(lowStock, pending, pendingTotal, expTotal, grossProfit) +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<div class="dash-calc-section">' +
                '<div id="calculadora-container"></div>' +
            '</div>';
    };

    NS._renderRecentSales = function(todaySales) {
        var recent = todaySales.slice(-5).reverse();
        if (recent.length === 0) {
            return '<div class="dash-empty">Sin ventas hoy. ¡A vender!</div>';
        }

        return recent.map(function(s) {
            var time = s.date ? new Date(s.date).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '';
            return '<div class="dash-sale-row">' +
                '<div class="dash-sale-left">' +
                    '<span class="dash-sale-ticket">#' + (s.ticket || s.id) + '</span>' +
                    '<span class="dash-sale-time">' + time + '</span>' +
                '</div>' +
                '<div class="dash-sale-center">' +
                    '<span class="dash-sale-client">' + (s.client?.name || 'Cliente Final') + '</span>' +
                '</div>' +
                '<div class="dash-sale-right">' +
                    '<span class="dash-sale-amount">$' + (Number(s.totalUSD) || 0).toFixed(2) + '</span>' +
                    '<span class="dash-sale-method dash-method-' + (s.method || 'cash-usd') + '">' + (s.method || 'Efec') + '</span>' +
                '</div>' +
            '</div>';
        }).join('');
    };

    NS._renderAlerts = function(lowStock, pending, pendingTotal, expTotal, grossProfit) {
        var alerts = [];

        if (lowStock.length > 0) {
            alerts.push({
                icon: '<i class="fas fa-box"></i>',
                bg: '#fef3c7',
                color: '#92400e',
                title: lowStock.length + ' producto(s) con stock bajo',
                text: lowStock.slice(0, 3).map(function(p) { return '<b>' + p.name + '</b>: ' + p.stock + ' (mín ' + p.minStock + ')'; }).join('<br>') +
                    (lowStock.length > 3 ? '<br>... y ' + (lowStock.length - 3) + ' más' : ''),
                action: 'Ir a Inventario',
                onClick: 'document.getElementById(\'nav-inventory\').click()'
            });
        }

        if (pending.length > 0) {
            alerts.push({
                icon: '<i class="fas fa-hand-holding-dollar"></i>',
                bg: '#fce4ec',
                color: '#c62828',
                title: pending.length + ' crédito(s) pendiente(s)',
                text: 'Total por cobrar: $' + pendingTotal.toFixed(2),
                action: 'Ir a Créditos',
                onClick: 'document.getElementById(\'nav-credits\').click()'
            });
        }

        var netProfit = grossProfit - expTotal;
        if (netProfit < 0) {
            alerts.push({
                icon: '<i class="fas fa-fire"></i>',
                bg: '#ffebee',
                color: '#b71c1c',
                title: 'Margen neto negativo',
                text: 'Gastos ($' + expTotal.toFixed(2) + ') superan la ganancia ($' + Math.max(0, grossProfit).toFixed(2) + ')',
                action: 'Revisar Gastos',
                onClick: 'document.getElementById(\'nav-expenses\').click()'
            });
        }

        if (alerts.length === 0) {
            return '<div class="dash-empty">✔ Todo en orden. Sin alertas.</div>';
        }

        return alerts.map(function(a) {
            return '<div class="dash-alert" style="background:' + a.bg + '">' +
                '<div class="dash-alert-icon" style="color:' + a.color + '">' + a.icon + '</div>' +
                '<div class="dash-alert-body">' +
                    '<div class="dash-alert-title" style="color:' + a.color + '">' + a.title + '</div>' +
                    '<div class="dash-alert-text">' + a.text + '</div>' +
                '</div>' +
                '<button class="dash-alert-action" onclick="' + a.onClick + '" style="color:' + a.color + '">' + a.action + '</button>' +
            '</div>';
        }).join('');
    };

})();
