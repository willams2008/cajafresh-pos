/**
 * Módulo POS — Punto de Venta, Carrito, Checkout.
 *
 * Funcionalidad:
 * - Catálogo visual de productos
 * - Carrito de compras (añadir/quitar/cantidad)
 * - Checkout con múltiples métodos de pago
 * - Cálculo de totales, impuestos, cambio
 * - Pagos mixtos (USD + VES + Transferencia)
 */

// @ts-check

import { state } from './state.js';
import { uid, formatMoney, calcCartTotal, roundTo, calcTax } from './utils.ts';

export function addToCart(product, qty = 1) {
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
        existing.qty += qty;
    } else {
        state.cart.push({
            id: product.id,
            sku: product.id,
            name: product.name,
            price: product.priceUSD || product.price || 0,
            priceVES: product.priceVES || 0,
            qty,
            img: product.img || '',
            category: product.category || '',
            tax_code: product.tax_code || 'IVA16',
        });
    }
    renderCart();
}

export function removeFromCart(productId) {
    state.cart = state.cart.filter(item => item.id !== productId);
    renderCart();
}

export function updateCartQty(productId, qty) {
    const item = state.cart.find(i => i.id === productId);
    if (item) {
        item.qty = Math.max(1, qty);
        renderCart();
    }
}

export function clearCart() {
    state.cart = [];
    renderCart();
}

export function renderCart() {
    const container = document.getElementById('cart-items');
    if (!container) return;

    if (state.cart.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-48 text-slate-400">
                <i class="fas fa-shopping-cart text-4xl mb-3 opacity-30"></i>
                <p class="text-sm font-medium">Carrito vacío</p>
                <p class="text-xs">Selecciona productos del catálogo</p>
            </div>
        `;
        updateCartSummary();
        return;
    }

    container.innerHTML = state.cart.map(item => `
        <div class="cart-item flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 mb-1.5 transition-all hover:shadow-sm" data-id="${item.id}">
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">${item.name}</p>
                <p class="text-[10px] text-slate-400">
                    $${formatMoney(item.price)} c/u
                </p>
            </div>
            <div class="flex items-center gap-2 ml-2">
                <div class="flex items-center bg-slate-100 dark:bg-slate-700 rounded-lg">
                    <button class="qty-btn min-w-[28px] h-7 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-l-lg transition-colors" onclick="posModule.updateQty('${item.id}', ${item.qty - 1})">−</button>
                    <span class="min-w-[28px] text-center text-xs font-black text-slate-800 dark:text-slate-100">${item.qty}</span>
                    <button class="qty-btn min-w-[28px] h-7 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-r-lg transition-colors" onclick="posModule.updateQty('${item.id}', ${item.qty + 1})">+</button>
                </div>
                <p class="text-sm font-black text-brand-600 dark:text-brand-400 min-w-[60px] text-right">
                    $${formatMoney(item.qty * item.price)}
                </p>
                <button class="text-rose-400 hover:text-rose-600 transition-colors text-xs p-1" onclick="posModule.removeFromCart('${item.id}')">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        </div>
    `).join('');

    updateCartSummary();
}

export function updateCartSummary() {
    const subtotalEl = document.getElementById('cart-subtotal');
    const totalEl = document.getElementById('cart-total');
    const itemsCount = document.getElementById('cart-items-count');

    const subtotal = calcCartTotal(state.cart);
    const tax = calcTax(subtotal);
    const total = roundTo(subtotal + tax, 2);

    if (subtotalEl) subtotalEl.textContent = `$${formatMoney(subtotal)}`;
    if (totalEl) totalEl.textContent = `$${formatMoney(total)}`;
    if (itemsCount) {
        const count = state.cart.reduce((s, i) => s + i.qty, 0);
        itemsCount.textContent = count;
        itemsCount.classList.toggle('hidden', count === 0);
    }
}

export async function checkout(paymentData) {
    if (state.cart.length === 0) {
        Swal.fire('Carrito vacío', 'Agrega productos antes de cobrar.', 'warning');
        return;
    }

    const subtotal = calcCartTotal(state.cart);
    const tax = calcTax(subtotal);
    const total = roundTo(subtotal + tax, 2);
    const sid = state.getStoreId ? state.getStoreId() : '';

    const sale = {
        id: uid('sale_'),
        date: new Date().toISOString(),
        timestamp: Date.now(),
        items: state.cart.map(item => ({
            id: item.id,
            name: item.name,
            qty: item.qty,
            price: item.price,
        })),
        subtotal,
        tax,
        totalUSD: total,
        totalVES: total * (paymentData.exchangeRate || 1),
        method: paymentData.method || 'Efectivo USD',
        payments: paymentData.payments || null,
        cashierName: state.cashierName || 'Cajero',
        status: 'paid',
    };

    try {
        await window.electronAPI.db.saveSale(sid, sale);
        clearCart();
        Swal.fire({
            icon: 'success',
            title: '¡Venta registrada!',
            text: `Total: $${formatMoney(total)}`,
            timer: 2000,
            showConfirmButton: false,
        });
        // Emitir evento para dashboard
        if (typeof loadSales === 'function') loadSales();
        if (window.io && window.io.emit) window.io.emit('new-sale', sale);
    } catch (err) {
        console.error('[POS] Error saving sale:', err);
        Swal.fire('Error', 'No se pudo guardar la venta: ' + err.message, 'error');
    }
}

// ─── Exportar a window para compatibilidad ─────────────────────

if (typeof window !== 'undefined') {
    window.posModule = {
        addToCart,
        removeFromCart,
        updateQty: updateCartQty,
        clearCart,
        renderCart,
        checkout,
    };
}
