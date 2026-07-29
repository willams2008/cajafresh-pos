/**
 * MultiOrder — Sistema de Órdenes Múltiples estilo "Papa's Pizzeria"
 *
 * Permite atender varios clientes simultáneamente:
 *   - Orden activa se opera en el POS
 *   - Órdenes en espera se deslizan a un costado
 *   - Timer visual por orden para saber quién espera más
 *   - Coexiste con cart[] original: swapea items al cambiar de orden
 *
 * Uso:
 *   <script src="src/features/multi-orden.js"></script>
 *   MultiOrder.init();
 */

window.MultiOrder = (function() {

    // ──────────────────────────────────────────────
    // ESTADO
    // ──────────────────────────────────────────────

    /** @type {Array<{id: string, customerName: string, items: Array, createdAt: number, status: string, notes: string}>} */
    var orders = [];
    var activeOrderId = null;
    var timers = {};       // timerId por orden (para limpiar)
    var uiInjected = false;
    var orderBarEl = null;

    // Callback cuando cambia la orden activa
    var onOrderChange = null;

    // ──────────────────────────────────────────────
    // INICIALIZACIÓN
    // ──────────────────────────────────────────────

    /**
     * Inicializa el sistema multi-orden.
     * Inyecta la barra de órdenes en el DOM si no existe.
     * @param {Object} options
     * @param {Function} options.onSwitch - Callback(items) cuando se activa una orden
     * @param {string} options.containerId - ID del contenedor para la barra (default 'order-bar-container')
     */
    function init(options) {
        options = options || {};
        onOrderChange = options.onSwitch || null;

        var containerId = options.containerId || 'order-bar-container';
        var container = document.getElementById(containerId);

        if (!container) {
            // Crear contenedor en view-pos si no existe
            container = document.createElement('div');
            container.id = containerId;
            container.className = 'order-bar-container';

            var posView = document.getElementById('view-pos');
            if (posView) {
                var productsCol = posView.querySelector('.flex-col') || posView.firstElementChild;
                if (productsCol) {
                    productsCol.insertBefore(container, productsCol.firstChild);
                } else {
                    posView.insertBefore(container, posView.firstChild);
                }
            } else {
                document.body.appendChild(container);
            }
            injectStyles();
        }

        orderBarEl = container;
        uiInjected = true;

        // Escuchar teclado: Ctrl+N = nueva orden
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                newOrder();
            }
        });
    }

    // ──────────────────────────────────────────────
    // CRUD DE ÓRDENES
    // ──────────────────────────────────────────────

    /**
     * Crea una nueva orden y la activa.
     * @param {string} customerName
     * @returns {Object} la orden creada
     */
    function newOrder(customerName) {
        if (!customerName) {
            // Pedir nombre con prompt inline
            Swal.fire({
                title: 'Nuevo Cliente',
                input: 'text',
                inputPlaceholder: 'Nombre del cliente (opcional)',
                showCancelButton: true,
                confirmButtonText: 'Crear Orden',
                cancelButtonText: 'Cancelar',
                inputValidator: function(value) {
                    return null; // Opcional, permitimos vacío
                }
            }).then(function(res) {
                if (res.isConfirmed) {
                    return _createOrder(res.value || 'Cliente ' + (orders.length + 1));
                }
            });
            return null;
        }

        return _createOrder(customerName);
    }

    function _createOrder(customerName) {
        var order = {
            id: 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            customerName: customerName || 'Cliente ' + (orders.length + 1),
            items: [],
            createdAt: Date.now(),
            status: 'waiting',
            notes: '',
            itemCount: 0,
            totalUSD: 0
        };

        orders.push(order);

        // Si es la primera orden o no hay activa, activarla
        if (!activeOrderId || orders.length === 1) {
            _activateOrder(order.id);
        }

        _startTimer(order.id);
        _renderBar();
        _playSound('order-in');

        return order;
    }

    /**
     * Activa una orden: guarda cart actual en la orden anterior,
     * carga los items de la nueva orden en cart.
     */
    function _activateOrder(orderId) {
        var prevOrder = _getActiveOrder();

        // Guardar cart actual en la orden anterior
        if (prevOrder && typeof cart !== 'undefined') {
            prevOrder.items = JSON.parse(JSON.stringify(cart));
            prevOrder.itemCount = cart.reduce(function(sum, item) { return sum + (Number(item.qty) || 0); }, 0);
            prevOrder.totalUSD = cart.reduce(function(sum, item) { return sum + ((Number(item.priceUSD) || Number(item.price) || 0) * (Number(item.qty) || 0)); }, 0);
            prevOrder.status = 'waiting';
        }

        var order = _findOrder(orderId);
        if (!order) return;

        activeOrderId = orderId;
        order.status = 'active';

        // Cargar items de la nueva orden en cart
        if (typeof cart !== 'undefined') {
            cart.length = 0;
            (order.items || []).forEach(function(item) {
                cart.push(JSON.parse(JSON.stringify(item)));
            });

            // Refrescar UI
            if (typeof updateCartUI === 'function') updateCartUI();
        }

        if (typeof onOrderChange === 'function') {
            onOrderChange(order.items || []);
        }

        _renderBar();
    }

    /**
     * Mueve una orden a espera (deslizar).
     * @param {string} orderId
     */
    function waitOrder(orderId) {
        var order = _findOrder(orderId);
        if (!order || order.id === activeOrderId) return;

        order.status = 'waiting';
        _renderBar();
    }

    /**
     * Elimina una orden (si se cancela o el cliente se fue).
     * @param {string} orderId
     */
    function removeOrder(orderId) {
        var order = _findOrder(orderId);
        if (!order) return;

        if (order.id === activeOrderId) {
            // Guardar cart en la orden antes de borrar
            if (typeof cart !== 'undefined') {
                order.items = JSON.parse(JSON.stringify(cart));
            }
        }

        // Limpiar timer
        _stopTimer(orderId);

        var idx = orders.findIndex(function(o) { return o.id === orderId; });
        if (idx > -1) orders.splice(idx, 1);

        // Si la orden eliminada era la activa, activar la siguiente
        if (order.id === activeOrderId) {
            var nextOrder = orders[0];
            if (nextOrder) {
                _activateOrder(nextOrder.id);
            } else {
                activeOrderId = null;
                // Limpiar carrito
                if (typeof cart !== 'undefined') {
                    cart.length = 0;
                    if (typeof updateCartUI === 'function') updateCartUI();
                }
            }
        }

        _renderBar();
    }

    /**
     * Procesa checkout de la orden activa.
     * @param {Function} checkoutFn - función de checkout existente (processPayment o initCheckout)
     */
    function checkoutActive(checkoutFn) {
        var order = _getActiveOrder();
        if (!order) {
            Swal.fire('Sin orden activa', 'No hay ninguna orden seleccionada.', 'info');
            return;
        }

        if (!order.items || order.items.length === 0) {
            Swal.fire('Carrito vacío', 'Agrega productos antes de cobrar.', 'warning');
            return;
        }

        // Verificar que cart tenga los items
        if (typeof cart !== 'undefined' && cart.length === 0) {
            // Restaurar items a cart
            order.items.forEach(function(item) {
                cart.push(JSON.parse(JSON.stringify(item)));
            });
            if (typeof updateCartUI === 'function') updateCartUI();
        }

        // Llamar a la función de checkout existente
        // Envuelta: cuando termine, remover la orden
        if (typeof checkoutFn === 'function') {
            checkoutFn();

            // La orden se removerá después del checkout exitoso
            // Esto se engancha desde fuera con onCheckoutComplete
        } else {
            // Fallback: abrir modal checkout nativo
            if (typeof initCheckout === 'function') {
                initCheckout();
            }
        }
    }

    /**
     * Marca una orden como completada (llamar después del checkout exitoso).
     * @param {string} orderId
     */
    function completeOrder(orderId) {
        var order = _findOrder(orderId);
        if (!order) return;

        _stopTimer(orderId);
        var idx = orders.findIndex(function(o) { return o.id === orderId; });
        if (idx > -1) orders.splice(idx, 1);

        // Si era la activa, activar la siguiente
        if (orderId === activeOrderId) {
            if (typeof cart !== 'undefined') {
                cart.length = 0;
                if (typeof updateCartUI === 'function') updateCartUI();
            }

            var next = orders[0];
            if (next) {
                _activateOrder(next.id);
            } else {
                activeOrderId = null;
            }
        }

        _renderBar();
        _playSound('order-out');
    }

    // ──────────────────────────────────────────────
    // CONSULTAS
    // ──────────────────────────────────────────────

    function _getActiveOrder() {
        return activeOrderId ? _findOrder(activeOrderId) : null;
    }

    function _findOrder(id) {
        for (var i = 0; i < orders.length; i++) {
            if (orders[i].id === id) return orders[i];
        }
        return null;
    }

    function getActiveOrder() {
        return JSON.parse(JSON.stringify(_getActiveOrder() || null));
    }

    function getAllOrders() {
        return JSON.parse(JSON.stringify(orders));
    }

    function getOrdersCount() {
        return orders.length;
    }

    // ──────────────────────────────────────────────
    // TIMERS
    // ──────────────────────────────────────────────

    function _startTimer(orderId) {
        _stopTimer(orderId);
        timers[orderId] = setInterval(function() {
            _updateTimerDisplay(orderId);
        }, 1000);
    }

    function _stopTimer(orderId) {
        if (timers[orderId]) {
            clearInterval(timers[orderId]);
            delete timers[orderId];
        }
    }

    function _updateTimerDisplay(orderId) {
        var el = document.querySelector('[data-order-id="' + orderId + '"] .order-timer');
        if (!el) return;

        var order = _findOrder(orderId);
        if (!order) return;

        var elapsed = Math.floor((Date.now() - order.createdAt) / 1000);
        var mins = Math.floor(elapsed / 60);
        var secs = elapsed % 60;
        el.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;

        // Color por tiempo
        if (elapsed > 600) { // >10 min
            el.style.color = '#ef4444';
        } else if (elapsed > 300) { // >5 min
            el.style.color = '#f59e0b';
        } else {
            el.style.color = '#64748b';
        }
    }

    function getOrderWaitTime(orderId) {
        var order = _findOrder(orderId);
        if (!order) return 0;
        return Math.floor((Date.now() - order.createdAt) / 1000);
    }

    // ──────────────────────────────────────────────
    // UI: BARRA DE ÓRDENES
    // ──────────────────────────────────────────────

    function _renderBar() {
        if (!orderBarEl || !uiInjected) return;

        if (orders.length === 0) {
            orderBarEl.innerHTML = '';
            orderBarEl.style.display = 'none';
            return;
        }

        orderBarEl.style.display = 'block';
        orderBarEl.innerHTML = '';

        var wrapper = document.createElement('div');
        wrapper.className = 'multiorder-wrapper';

        // Botón nueva orden +
        var btnNew = document.createElement('button');
        btnNew.className = 'multiorder-btn-new';
        btnNew.innerHTML = '<i class="fas fa-plus"></i>';
        btnNew.title = 'Nuevo Cliente (Ctrl+N)';
        btnNew.onclick = function() { newOrder(); };
        wrapper.appendChild(btnNew);

        // Contenedor de tarjetas (scroll horizontal)
        var cardsContainer = document.createElement('div');
        cardsContainer.className = 'multiorder-cards';

        orders.forEach(function(order) {
            var isActive = order.id === activeOrderId;
            var elapsed = Math.floor((Date.now() - order.createdAt) / 1000);
            var mins = Math.floor(elapsed / 60);
            var secs = elapsed % 60;
            var timerClass = elapsed > 600 ? 'timer-critical' : (elapsed > 300 ? 'timer-warn' : 'timer-ok');

            var itemsTotal = order.items ? order.items.reduce(function(sum, item) {
                return sum + ((Number(item.priceUSD) || Number(item.price) || 0) * (Number(item.qty) || 0));
            }, 0) : 0;

            var card = document.createElement('div');
            card.className = 'multiorder-card' + (isActive ? ' active' : '') + ' status-' + order.status;
            card.setAttribute('data-order-id', order.id);
            card.title = isActive ? 'Orden activa' : 'Click para activar';

            card.innerHTML =
                '<div class="order-header">' +
                    '<span class="order-name">' + escapeHTML(order.customerName) + '</span>' +
                    '<span class="order-timer ' + timerClass + '">' +
                        mins + ':' + (secs < 10 ? '0' : '') + secs +
                    '</span>' +
                '</div>' +
                '<div class="order-info">' +
                    '<span class="order-items">' + (order.items ? order.items.length : 0) + ' items</span>' +
                    '<span class="order-total">$' + itemsTotal.toFixed(2) + '</span>' +
                '</div>' +
                '<div class="order-actions">' +
                    (isActive
                        ? '<button class="order-btn order-btn-checkout" title="Cobrar"><i class="fas fa-cash-register"></i></button>' +
                          '<button class="order-btn order-btn-del" title="Cancelar orden"><i class="fas fa-times"></i></button>'
                        : '<button class="order-btn order-btn-activate" title="Activar"><i class="fas fa-play"></i></button>' +
                          '<button class="order-btn order-btn-del" title="Descartar"><i class="fas fa-trash-alt"></i></button>'
                    ) +
                '</div>';

            // Eventos
            if (!isActive) {
                card.addEventListener('click', function(e) {
                    if (e.target.closest('.order-btn')) return;
                    _activateOrder(order.id);
                });

                card.querySelector('.order-btn-activate').addEventListener('click', function(e) {
                    e.stopPropagation();
                    _activateOrder(order.id);
                });
            } else {
                card.querySelector('.order-btn-checkout').addEventListener('click', function(e) {
                    e.stopPropagation();
                    // Disparar checkout nativo
                    checkoutActive(window.initCheckout);
                });

                card.querySelector('.order-btn-del').addEventListener('click', function(e) {
                    e.stopPropagation();
                    Swal.fire({
                        title: '¿Cancelar orden de ' + order.customerName + '?',
                        text: 'Se perderán los productos agregados.',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#ef4444',
                        confirmButtonText: 'Cancelar Orden',
                        cancelButtonText: 'No'
                    }).then(function(res) {
                        if (res.isConfirmed) removeOrder(order.id);
                    });
                });
            }

            card.querySelectorAll('.order-btn-del').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (order.id !== activeOrderId) {
                        Swal.fire({
                            title: '¿Descartar orden?',
                            text: 'Se eliminará la orden de ' + order.customerName,
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonColor: '#ef4444',
                            confirmButtonText: 'Descartar',
                            cancelButtonText: 'No'
                        }).then(function(res) {
                            if (res.isConfirmed) removeOrder(order.id);
                        });
                    }
                });
            });

            cardsContainer.appendChild(card);
        });

        wrapper.appendChild(cardsContainer);
        orderBarEl.appendChild(wrapper);

        // Scroll al final (donde está la nueva orden)
        setTimeout(function() {
            cardsContainer.scrollLeft = cardsContainer.scrollWidth;
        }, 50);
    }

    // ──────────────────────────────────────────────
    // SONIDOS (web audio API, sin archivos externos)
    // ──────────────────────────────────────────────

    function _playSound(type) {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'order-in') {
                osc.frequency.value = 523.25; // C5
                osc.type = 'sine';
                osc.start();
                osc.stop(ctx.currentTime + 0.12);
            } else if (type === 'order-out') {
                osc.frequency.value = 659.25; // E5
                osc.type = 'sine';
                osc.start();
                osc.stop(ctx.currentTime + 0.15);
            }
        } catch(e) {}
    }

    // ──────────────────────────────────────────────
    // CSS INYECTADO
    // ──────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById('multiorder-styles')) return;

        var css = document.createElement('style');
        css.id = 'multiorder-styles';
        css.textContent = `
            .order-bar-container {
                width: 100%;
                background: linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fbbf24 100%);
                border-bottom: 3px solid #d97706;
                padding: 10px 16px;
                z-index: 50;
                position: relative;
                box-shadow: 0 4px 12px rgba(217,119,6,0.15);
            }
            .multiorder-wrapper {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .multiorder-btn-new {
                width: 52px;
                height: 60px;
                border-radius: 10px;
                border: 3px dashed #b45309;
                background: rgba(255,255,255,0.5);
                color: #92400e;
                font-size: 22px;
                cursor: pointer;
                flex-shrink: 0;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .multiorder-btn-new:hover {
                border-color: #78350f;
                color: #78350f;
                background: rgba(255,255,255,0.85);
                transform: scale(1.05);
            }
            .multiorder-cards {
                display: flex;
                gap: 10px;
                overflow-x: auto;
                flex: 1;
                padding: 4px 0;
                scroll-behavior: smooth;
            }
            .multiorder-cards::-webkit-scrollbar {
                height: 5px;
            }
            .multiorder-cards::-webkit-scrollbar-track {
                background: rgba(180,83,9,0.1);
                border-radius: 4px;
            }
            .multiorder-cards::-webkit-scrollbar-thumb {
                background: #b45309;
                border-radius: 4px;
            }
            .multiorder-card {
                min-width: 150px;
                max-width: 180px;
                background: #fffbeb;
                border-radius: 4px;
                padding: 10px 12px;
                cursor: pointer;
                transition: all 0.25s;
                border: 2px solid #d97706;
                flex-shrink: 0;
                position: relative;
                user-select: none;
                box-shadow: 2px 3px 8px rgba(0,0,0,0.12);
                /* Ticket zigzag bottom */
                clip-path: polygon(
                    0% 0%, 100% 0%, 100% calc(100% - 6px),
                    95% 100%, 90% calc(100% - 6px), 85% 100%, 80% calc(100% - 6px),
                    75% 100%, 70% calc(100% - 6px), 65% 100%, 60% calc(100% - 6px),
                    55% 100%, 50% calc(100% - 6px), 45% 100%, 40% calc(100% - 6px),
                    35% 100%, 30% calc(100% - 6px), 25% 100%, 20% calc(100% - 6px),
                    15% 100%, 10% calc(100% - 6px), 5% 100%, 0% calc(100% - 6px)
                );
            }
            .multiorder-card:hover {
                background: #fef9e7;
                transform: translateY(-3px);
                box-shadow: 3px 6px 16px rgba(0,0,0,0.18);
            }
            .multiorder-card.active {
                background: #fff;
                border-color: #059669;
                box-shadow: 0 0 0 3px rgba(5,150,105,0.25), 3px 6px 16px rgba(0,0,0,0.15);
                transform: translateY(-4px);
            }
            .multiorder-card.active::before {
                content: '▼';
                position: absolute;
                bottom: 8px;
                left: 50%;
                transform: translateX(-50%);
                color: #059669;
                font-size: 8px;
                animation: bounce-arrow 1s infinite;
            }
            @keyframes bounce-arrow {
                0%, 100% { transform: translateX(-50%) translateY(0); }
                50% { transform: translateX(-50%) translateY(-3px); }
            }
            .multiorder-card.status-waiting {
                opacity: 0.9;
            }
            .multiorder-card.status-waiting:hover {
                opacity: 1;
            }
            .order-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 4px;
                border-bottom: 1px dashed #d97706;
                padding-bottom: 4px;
            }
            .order-name {
                font-size: 12px;
                font-weight: 900;
                color: #78350f;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 90px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .order-timer {
                font-size: 11px;
                font-weight: 700;
                font-family: 'Courier New', monospace;
                color: #92400e;
                transition: color 0.5s;
                background: rgba(217,119,6,0.1);
                padding: 1px 5px;
                border-radius: 4px;
            }
            .order-timer.timer-warn { color: #ea580c; background: rgba(234,88,12,0.1); }
            .order-timer.timer-critical { color: #dc2626; background: rgba(220,38,38,0.1); animation: pulse-warning 1s infinite; }
            @keyframes pulse-warning {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            .order-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 10px;
                color: #92400e;
                margin-top: 2px;
            }
            .order-total {
                font-weight: 800;
                color: #059669;
                font-size: 12px;
            }
            .order-actions {
                display: flex;
                gap: 4px;
                margin-top: 6px;
                justify-content: flex-end;
            }
            .order-btn {
                width: 26px;
                height: 26px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                font-size: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .order-btn-checkout {
                background: #059669;
                color: white;
            }
            .order-btn-checkout:hover {
                background: #047857;
                transform: scale(1.15);
            }
            .order-btn-activate {
                background: #d97706;
                color: white;
            }
            .order-btn-activate:hover {
                background: #b45309;
                transform: scale(1.15);
            }
            .order-btn-del {
                background: transparent;
                color: #b45309;
            }
            .order-btn-del:hover {
                background: #fca5a5;
                color: #991b1b;
            }
        `;
        document.head.appendChild(css);
    }

    // ──────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────

    function escapeHTML(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ──────────────────────────────────────────────
    // API PÚBLICA
    // ──────────────────────────────────────────────

    return {
        init: init,
        newOrder: newOrder,
        removeOrder: removeOrder,
        waitOrder: waitOrder,
        checkoutActive: checkoutActive,
        completeOrder: completeOrder,
        getActiveOrder: getActiveOrder,
        getAllOrders: getAllOrders,
        getOrdersCount: getOrdersCount,
        getOrderWaitTime: getOrderWaitTime
    };

})();
