/**
 * Estado global de la aplicación renderer.
 * Centraliza todas las variables de estado del frontend.
 */

// @ts-check

export const state = {
    products: [],
    sales: [],
    cart: [],
    clients: [],
    ingredients: [],
    recipes: [],
    suppliers: [],
    expenses: [],
    payables: [],
    categories: ['Gaseosas', 'Aguas', 'Jugos', 'Energizantes'],
    auditLogs: [],
    dailyHistory: [],
    currentView: 'view-pos',
    currentCategory: 'Todos',
    isInitialDataLoaded: false,
    onboardingState: {
        welcome: false,
        sidebar: false,
        pos: false,
        scanner: false,
        analytics: false,
        server: false,
    },
    // Provisionar - Materia prima, CAD, cortes
    provisionarMateriales: [],
    provisionarCotizaciones: [],
};

/** Carga inicial desde localStorage */
export function loadPersistentState() {
    const sid = getStoreId();
    const prefix = sid ? `${sid}_` : '';

    state.categories = _safeParse(localStorage.getItem(`${prefix}freshpos_categories`), state.categories);
    state.suppliers  = _safeParse(localStorage.getItem(`${prefix}freshpos_suppliers`), []);
    state.expenses   = _safeParse(localStorage.getItem(`${prefix}freshpos_expenses`), []);
    state.payables   = _safeParse(localStorage.getItem(`${prefix}freshpos_payables`), []);
    state.auditLogs  = _safeParse(localStorage.getItem(`${prefix}freshpos_audit_logs`), []);
    state.dailyHistory = _safeParse(localStorage.getItem(`${prefix}freshpos_history`), []).map(d => ({
        ...d,
        salesUSD: Number(d.salesUSD) || 0,
        profitUSD: Number(d.profitUSD) || 0,
        expensesUSD: Number(d.expensesUSD) || 0,
    }));
    state.onboardingState = _safeParse(localStorage.getItem(`${prefix}freshpos_onboarding`), state.onboardingState);

    const savedCategory = localStorage.getItem(`${prefix}freshpos_current_category`);
    if (savedCategory) state.currentCategory = savedCategory;
}

function _safeParse(json, fallback) {
    try { return JSON.parse(json) || fallback; } catch (e) { return fallback; }
}

export function saveCategories() {
    const sid = getStoreId();
    const prefix = sid ? `${sid}_` : '';
    localStorage.setItem(`${prefix}freshpos_categories`, JSON.stringify(state.categories));
}

export function saveOnboarding() {
    const sid = getStoreId();
    const prefix = sid ? `${sid}_` : '';
    localStorage.setItem(`${prefix}freshpos_onboarding`, JSON.stringify(state.onboardingState));
}

export function getStoreId() {
    if (typeof window !== 'undefined' && window.FRESH_TENANT && window.FRESH_TENANT.storeId) {
        return window.FRESH_TENANT.storeId;
    }
    try {
        const s = JSON.parse(localStorage.getItem('freshpos_settings') || '{}');
        return s.storeId || '';
    } catch (e) { return ''; }
}

export function tenantKey(baseKey) {
    const sid = getStoreId();
    return sid ? `${baseKey}_${sid}` : baseKey;
}

export function tenantGet(baseKey) {
    const namespacedKey = tenantKey(baseKey);
    const val = localStorage.getItem(namespacedKey);
    if (val !== null) return val;
    return localStorage.getItem(baseKey);
}

export function tenantSet(baseKey, value) {
    localStorage.setItem(tenantKey(baseKey), value);
}

export function tenantRemove(baseKey) {
    localStorage.removeItem(tenantKey(baseKey));
    localStorage.removeItem(baseKey);
}

/** Resetea el estado a valores iniciales (útil para tests) */
export function resetState() {
    state.products = [];
    state.sales = [];
    state.cart = [];
    state.clients = [];
    state.ingredients = [];
    state.recipes = [];
    state.expenses = [];
    state.payables = [];
    state.currentView = 'view-pos';
    state.currentCategory = 'Todos';
    state.isInitialDataLoaded = false;
}

/** Obtiene copia del carrito */
export function getCart() {
    return state.cart;
}
