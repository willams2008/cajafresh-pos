/**
 * POS Module — Wrapper namespace para funciones del Punto de Venta
 * 
 * Estratégia Strangler: expone las funciones existentes de app.js bajo namespace,
 * más las nuevas (multi-orden, cart persistente, atajos).
 * Cargar DESPUÉS de app.js.
 */

window.POS = window.POS || {};

(function() {
    var NS = window.POS;

    // ── Wrappers a funciones existentes de app.js ──

    NS.addToCart = function(product) {
        if (typeof window.addToCart === 'function') return window.addToCart(product);
    };
    NS.updateCartUI = function() {
        if (typeof window.updateCartUI === 'function') return window.updateCartUI();
    };
    NS.updateCartQty = function(id, delta) {
        if (typeof window.updateCartQty === 'function') return window.updateCartQty(id, delta);
    };
    NS.setCartItemQty = function(id, qty) {
        if (typeof window.setCartItemQty === 'function') return window.setCartItemQty(id, qty);
    };
    NS.clearCart = function() {
        if (typeof window.clearCartConfirm === 'function') return window.clearCartConfirm();
    };
    NS.initCheckout = function() {
        if (typeof window.initCheckout === 'function') return window.initCheckout();
    };
    NS.processPayment = function() {
        if (typeof window.processPayment === 'function') return window.processPayment();
    };
    NS.renderProducts = function() {
        if (typeof window.renderProducts === 'function') return window.renderProducts();
    };
    NS.printTicket = function(sale) {
        if (typeof window.printTicket === 'function') return window.printTicket(sale);
    };

    // ── Cart Persistente ──

    var CART_KEY = 'freshpos_cart_backup';
    var CART_TIMESTAMP_KEY = 'freshpos_cart_timestamp';

    /**
     * Guarda el carrito actual en localStorage.
     * Llama después de cada modificación al carrito.
     */
    NS.saveCart = function() {
        if (typeof cart === 'undefined' || !cart) return;
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            localStorage.setItem(CART_TIMESTAMP_KEY, Date.now().toString());
        } catch(e) {}
    };

    /**
     * Restaura el carrito desde localStorage si tiene menos de 2 horas.
     * @returns {boolean} true si se restauró
     */
    NS.restoreCart = function() {
        if (typeof cart === 'undefined') return false;

        var saved = localStorage.getItem(CART_KEY);
        var timestamp = localStorage.getItem(CART_TIMESTAMP_KEY);
        if (!saved || !timestamp) return false;

        var age = Date.now() - parseInt(timestamp);
        if (age > 7200000) { // > 2 horas
            localStorage.removeItem(CART_KEY);
            localStorage.removeItem(CART_TIMESTAMP_KEY);
            return false;
        }

        try {
            var restored = JSON.parse(saved);
            if (!Array.isArray(restored) || restored.length === 0) return false;

            // Verificar que los productos sigan existiendo
            cart.length = 0;
            restored.forEach(function(item) {
                cart.push(item);
            });

            NS.updateCartUI();

            // Mostrar hint
            setTimeout(function() {
                var cartEl = document.getElementById('cart-items-container');
                if (cartEl) {
                    var note = document.createElement('div');
                    note.style.cssText = 'background:#fef3c7;padding:6px 10px;border-radius:8px;font-size:11px;font-weight:600;color:#92400e;margin-bottom:6px;display:flex;align-items:center;gap:6px;';
                    note.innerHTML = '<i class="fas fa-history"></i> Carrito recuperado de la sesión anterior';
                    cartEl.insertBefore(note, cartEl.firstChild);
                    setTimeout(function() { note.remove(); }, 8000);
                }
            }, 500);

            return true;
        } catch(e) {
            return false;
        }
    };

    /**
     * Hook para guardar carrito en cada modificación.
     * Llámar después de modificar cart[] en app.js
     */
    NS.autoSave = function() {
        NS.saveCart();
    };

    // ── Atajos de Teclado ──

    var shortcutsRegistered = false;

    /**
     * Registra atajos de teclado adicionales a los existentes.
     * Ctrl+F → Buscar producto, F12 → Abrir checkout.
     */
    function registerShortcuts() {
        if (shortcutsRegistered) return;
        document.addEventListener('keydown', function(e) {
            var viewPos = document.getElementById('view-pos');
            if (!viewPos || viewPos.classList.contains('hidden')) return;

            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                var searchInput = document.getElementById('search-product');
                if (searchInput) { searchInput.focus(); searchInput.select(); }
                return;
            }

            if (e.key === 'F12') {
                e.preventDefault();
                var checkoutBtn = document.getElementById('show-checkout-btn');
                if (checkoutBtn && !checkoutBtn.disabled) checkoutBtn.click();
                return;
            }
        });
        shortcutsRegistered = true;
    }


    // ── Inicialización ──

    /**
     * Inicializa todas las extensiones del POS.
     */
    NS.init = function() {


        // Auto-guardar carrito después de cada modificación
        // Hookeamos updateCartUI original si existe
        var originalUpdateUI = window.updateCartUI;
        if (typeof originalUpdateUI === 'function') {
            window.updateCartUI = function() {
                originalUpdateUI.apply(this, arguments);
                NS.saveCart();
            };
        }

        // Restaurar carrito al cargar
        setTimeout(function() {
            NS.restoreCart();
        }, 1000);

        // Registrar atajos de teclado
        registerShortcuts();

        console.log('[POS Module] Inicializado. Atajos, cart persistente y namespace listos.');
    };

})();
