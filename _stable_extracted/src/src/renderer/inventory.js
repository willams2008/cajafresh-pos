/**
 * Módulo de Inventario — Productos, Categorías, Ingredientes, Recetas.
 *
 * Funcionalidad:
 * - CRUD de productos con multi-moneda
 * - Gestión de categorías
 * - Control de stock y alertas
 * - Ingredientes y recetas (escandallos)
 * - Búsqueda y filtrado
 */

// @ts-check

import { state, saveCategories, tenantKey } from './state.js';
import { uid, formatMoney, safeParse, deepClone } from './utils.ts';

// ─── Categorías ────────────────────────────────────────────────

export function renderCategoryOptions() {
    const selects = ['product-category', 'filter-category', 'manual-carga-category'];
    const options = state.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');

    selects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'filter-category') {
            el.innerHTML = '<option value="all">Todas las Categorías</option>' + options;
        } else {
            el.innerHTML = options;
        }
    });

    const posContainer = document.getElementById('pos-categories-container');
    if (posContainer) {
        let html = `<button class="category-btn active px-4 py-1.5 rounded-full text-sm font-semibold transition-all" data-category="Todos">Todos</button>`;
        html += state.categories.map(cat =>
            `<button class="category-btn px-4 py-1.5 rounded-full text-sm font-semibold transition-all" data-category="${cat}">${cat}</button>`
        ).join('');
        posContainer.innerHTML = html;

        if (state.currentCategory) {
            const btns = posContainer.querySelectorAll('.category-btn');
            btns.forEach(b => b.classList.remove('active'));
            const active = posContainer.querySelector(`[data-category="${state.currentCategory}"]`);
            if (active) active.classList.add('active');
            else posContainer.querySelector('[data-category="Todos"]')?.classList.add('active');
        }
    }
}

export async function addCategory() {
    const { value: newCat } = await Swal.fire({
        title: 'Nueva Categoría',
        input: 'text',
        inputLabel: 'Nombre de la categoría',
        placeholder: 'Ej. Snacks, Dulces...',
        showCancelButton: true,
        inputValidator: (value) => {
            if (!value) return '¡Debes escribir algo!';
            if (state.categories.some(c => c.toLowerCase() === value.toLowerCase())) {
                return 'Esa categoría ya existe';
            }
        },
    });

    if (newCat) {
        const catName = newCat.trim();
        state.categories.push(catName);
        saveCategories();
        renderCategoryOptions();

        state.currentCategory = catName;
        if (typeof renderProducts === 'function') renderProducts();

        const catSelect = document.getElementById('product-category');
        if (catSelect) catSelect.value = catName;
        Swal.fire('Guardado', `Categoría "${catName}" añadida y seleccionada.`, 'success');
    }
}

export async function removeCategory() {
    const select = document.getElementById('product-category');
    const catToRemove = select?.value;
    if (!catToRemove) return;

    const { isConfirmed } = await Swal.fire({
        title: `¿Eliminar "${catToRemove}"?`,
        text: 'Esto no borrará los productos, pero ya no podrán seleccionarse en esta categoría.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
    });

    if (isConfirmed) {
        state.categories = state.categories.filter(c => c !== catToRemove);
        saveCategories();
        renderCategoryOptions();
        Swal.fire('Eliminada', 'La categoría ha sido removida.', 'success');
    }
}

// ─── Productos ─────────────────────────────────────────────────

export async function loadProducts() {
    try {
        const sid = state.getStoreId ? state.getStoreId() : '';
        state.products = await window.electronAPI.db.getProducts(sid);
        state.isInitialDataLoaded = true;
        renderProducts();
    } catch (err) {
        console.error('[INVENTORY] Error loading products:', err);
    }
}

export function renderProducts(filterText) {
    // Implementación pendiente de migración desde app.js
    console.warn('[INVENTORY] renderProducts() aún no migrado completamente');
}

export function renderProductCard(product) {
    // Implementación pendiente
    return `<div class="product-card" data-id="${product.id}">${product.name}</div>`;
}

export async function saveProduct(product) {
    try {
        const sid = state.getStoreId ? state.getStoreId() : '';
        await window.electronAPI.db.saveProduct(sid, product);
        await loadProducts();
        return { success: true };
    } catch (err) {
        console.error('[INVENTORY] Error saving product:', err);
        return { success: false, error: err.message };
    }
}

export async function deleteProduct(id) {
    try {
        const sid = state.getStoreId ? state.getStoreId() : '';
        await window.electronAPI.db.deleteProduct(sid, id);
        await loadProducts();
        return { success: true };
    } catch (err) {
        console.error('[INVENTORY] Error deleting product:', err);
        return { success: false, error: err.message };
    }
}

// ─── Exportar a window para compatibilidad ─────────────────────

if (typeof window !== 'undefined') {
    window.inventoryModule = {
        renderCategoryOptions,
        addCategory,
        removeCategory,
        loadProducts,
        renderProducts,
        renderProductCard,
        saveProduct,
        deleteProduct,
    };
}
