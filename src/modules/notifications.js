/**
 * Notifications Module — Panel de notificaciones internas con badge
 */

window.Notifications = window.Notifications || {};

(function() {
    var NS = window.Notifications;
    var items = [];
    var badgeEl = null;
    var panelEl = null;

    /**
     * Inicializa: crea badge en sidebar + panel de notificaciones.
     */
    NS.init = function() {
        _createBadge();
        _createPanel();
        NS.refresh();
        setInterval(NS.refresh, 30000); // cada 30s
    };

    function _createBadge() {
        if (document.getElementById('notif-badge')) return;

        var navAnalytics = document.getElementById('nav-analytics');
        var target = navAnalytics ? navAnalytics.parentNode : document.querySelector('.sidebar-nav, nav');

        if (target) {
            badgeEl = document.createElement('span');
            badgeEl.id = 'notif-badge';
            badgeEl.style.cssText = 'display:none;position:absolute;top:8px;right:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:800;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:999px;padding:0 4px;cursor:pointer;z-index:50;box-shadow:0 2px 4px rgba(239,68,68,0.4);';
            badgeEl.textContent = '0';
            badgeEl.title = 'Notificaciones';
            badgeEl.onclick = function() { NS.togglePanel(); };

            // Insertar en el nav-dashboard como indicador relativo
            var dashboardNav = document.getElementById('nav-dashboard');
            if (dashboardNav) {
                dashboardNav.style.position = 'relative';
                dashboardNav.appendChild(badgeEl);
            } else if (target.firstChild) {
                target.firstChild.style.position = 'relative';
                target.firstChild.appendChild(badgeEl);
            }
        }

        // También agregar al header de analytics para acceso directo
        var analyticsHeader = document.querySelector('#view-analytics header');
        if (analyticsHeader) {
            var quickBtn = document.createElement('button');
            quickBtn.id = 'notif-quick-btn';
            quickBtn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:6px 12px;font-size:13px;color:#475569;cursor:pointer;transition:all 0.2s;';
            quickBtn.innerHTML = '<i class="fas fa-bell"></i> <span id="notif-quick-count" style="background:#ef4444;color:#fff;font-size:10px;font-weight:800;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:999px;padding:0 4px;">0</span>';
            quickBtn.title = 'Notificaciones';
            quickBtn.onclick = function() { NS.togglePanel(); };
            var actionsDiv = analyticsHeader.querySelector('.flex.gap-2');
            if (actionsDiv) {
                actionsDiv.appendChild(quickBtn);
            } else {
                analyticsHeader.appendChild(quickBtn);
            }
        }
    }

    function _createPanel() {
        if (document.getElementById('notif-panel')) return;

        panelEl = document.createElement('div');
        panelEl.id = 'notif-panel';
        panelEl.style.cssText = 'display:none;position:fixed;top:0;right:0;width:340px;height:100vh;background:#fff;box-shadow:-4px 0 20px rgba(0,0,0,0.12);z-index:9999;overflow-y:auto;transition:transform 0.3s ease;';
        panelEl.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">' +
                '<span style="font-weight:700;font-size:14px;color:#1e293b;display:flex;align-items:center;gap:8px;"><i class="fas fa-bell" style="color:#3b82f6;"></i> Notificaciones</span>' +
                '<button onclick="Notifications.togglePanel()" style="background:none;border:none;cursor:pointer;font-size:16px;color:#94a3b8;padding:4px;""><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div id="notif-panel-body" style="padding:12px 16px;">' +
                '<div style="text-align:center;padding:30px 0;color:#94a3b8;font-size:13px;">Sin notificaciones</div>' +
            '</div>';

        document.body.appendChild(panelEl);
    }

    NS.togglePanel = function() {
        if (!panelEl) return;
        var isHidden = panelEl.style.display === 'none';
        if (isHidden) {
            panelEl.style.display = 'block';
            _populatePanel();
        } else {
            panelEl.style.display = 'none';
        }
    };

    NS.closePanel = function() {
        if (panelEl) panelEl.style.display = 'none';
    };

    /**
     * Escanea el estado del sistema y genera notificaciones.
     */
    NS.refresh = function() {
        items = [];

        var products = window.products || [];
        var sales = window.sales || [];
        var expenses = window.expenses || [];
        var today = new Date().toISOString().slice(0, 10);

        // Stock bajo
        var lowStock = products.filter(function(p) {
            return Number(p.stock) <= Number(p.minStock) && Number(p.stock) > 0;
        });
        lowStock.forEach(function(p) {
            items.push({
                id: 'stock_' + p.id,
                type: 'warning',
                icon: '<i class="fas fa-box"></i>',
                title: 'Stock bajo: ' + p.name,
                text: p.stock + ' unidades (mín ' + p.minStock + ')',
                time: new Date().toISOString(),
                action: function() { document.getElementById('nav-inventory').click(); }
            });
        });

        // Agotados
        var outOfStock = products.filter(function(p) { return Number(p.stock) <= 0; });
        outOfStock.forEach(function(p) {
            items.push({
                id: 'out_' + p.id,
                type: 'critical',
                icon: '<i class="fas fa-circle-exclamation"></i>',
                title: 'Agotado: ' + p.name,
                text: 'Sin stock. Requiere reposición.',
                time: new Date().toISOString(),
                action: function() { document.getElementById('nav-inventory').click(); }
            });
        });

        // Créditos pendientes
        var pendingCredits = sales.filter(function(s) { return s.status === 'pending'; });
        if (pendingCredits.length > 0) {
            var totalPending = pendingCredits.reduce(function(s, sale) { return s + (Number(sale.totalUSD) || 0); }, 0);
            items.push({
                id: 'credits',
                type: 'warning',
                icon: '<i class="fas fa-hand-holding-dollar"></i>',
                title: pendingCredits.length + ' crédito(s) pendiente(s)',
                text: '$' + totalPending.toFixed(2) + ' por cobrar',
                time: new Date().toISOString(),
                action: function() { document.getElementById('nav-credits').click(); }
            });
        }

        // Margen neto negativo
        var todaySales = sales.filter(function(s) { return s.date && s.date.slice(0, 10) === today; });
        var grossProfit = todaySales.reduce(function(s, sale) { return s + (Number(s.totalUSD) || 0) - (Number(s.totalCostUSD) || 0); }, 0);
        var expToday = expenses.reduce(function(s, e) { return s + (Number(e.amountUSD) || 0); }, 0);
        if (grossProfit - expToday < 0 && grossProfit > 0) {
            items.push({
                id: 'negative_margin',
                type: 'critical',
                icon: '<i class="fas fa-fire"></i>',
                title: 'Margen neto negativo hoy',
                text: 'Gastos ($' + expToday.toFixed(2) + ') > Ganancia ($' + grossProfit.toFixed(2) + ')',
                time: new Date().toISOString(),
                action: function() { document.getElementById('nav-expenses').click(); }
            });
        }

        // Productos creados hoy (sin precio)
        var recentProducts = products.filter(function(p) {
            return !p.priceUSD && !p.price;
        });
        if (recentProducts.length > 0) {
            items.push({
                id: 'no_price',
                type: 'info',
                icon: '<i class="fas fa-tag"></i>',
                title: recentProducts.length + ' producto(s) sin precio',
                text: 'Falta configurar precio de venta',
                time: new Date().toISOString(),
                action: function() { document.getElementById('nav-inventory').click(); }
            });
        }

        _updateBadge();
    };

    function _updateBadge() {
        var critical = items.filter(function(i) { return i.type === 'critical'; }).length;
        var total = items.length;

        if (badgeEl) {
            if (total > 0) {
                badgeEl.style.display = 'flex';
                badgeEl.textContent = total;
                badgeEl.style.background = critical > 0 ? '#ef4444' : '#f59e0b';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        var quickCount = document.getElementById('notif-quick-count');
        if (quickCount) {
            quickCount.textContent = total;
            quickCount.style.display = total > 0 ? 'inline' : 'none';
        }
    }

    function _populatePanel() {
        var body = document.getElementById('notif-panel-body');
        if (!body) return;

        if (items.length === 0) {
            body.innerHTML = '<div class="notif-empty">✔ Todo en orden. Sin notificaciones.</div>';
            return;
        }

        body.innerHTML = items.sort(function(a, b) {
            return new Date(b.time) - new Date(a.time);
        }).map(function(item, i) {
            var timeAgo = _timeAgo(new Date(item.time));
            var colorMap = { critical: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
            var bgMap = { critical: '#fef2f2', warning: '#fffbeb', info: '#eef2ff' };
            var color = colorMap[item.type] || '#64748b';
            var bg = bgMap[item.type] || '#f8fafc';

            return '<div class="notif-item" style="border-left-color:' + color + ';background:' + bg + '">' +
                '<div class="notif-item-icon" style="color:' + color + '">' + item.icon + '</div>' +
                '<div class="notif-item-body">' +
                    '<div class="notif-item-title" style="color:' + color + '">' + item.title + '</div>' +
                    '<div class="notif-item-text">' + item.text + '</div>' +
                    '<div class="notif-item-time">' + timeAgo + '</div>' +
                '</div>' +
                (item.action ? '<button class="notif-item-action" onclick="Notifications._execAction(' + i + '); Notifications.closePanel();"><i class="fas fa-arrow-right"></i></button>' : '') +
            '</div>';
        }).join('');
    }

    NS._execAction = function(index) {
        if (items[index] && typeof items[index].action === 'function') {
            items[index].action();
        }
    };

    function _timeAgo(date) {
        var seconds = Math.floor((new Date() - date) / 1000);
        if (seconds < 60) return 'ahora';
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + ' min';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h';
        return Math.floor(hours / 24) + 'd';
    }

    // Click fuera del panel lo cierra
    document.addEventListener('click', function(e) {
        if (!panelEl) return;
        if (panelEl.classList.contains('hidden')) return;
        if (!panelEl.contains(e.target) && !e.target.closest('#notif-badge') && !e.target.closest('#notif-quick-btn')) {
            panelEl.classList.add('hidden');
        }
    });

})();
