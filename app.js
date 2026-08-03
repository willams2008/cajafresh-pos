// State variables
window.onerror = function (msg, url, lineNo, columnNo, error) {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Error de Sistema 🚨',
            html: `<div class="text-left bg-slate-50 p-4 rounded-xl border border-slate-200 text-[10px] font-mono whitespace-pre-wrap">${msg}\n\nEn: ${url}:${lineNo}:${columnNo}</div>`,
            icon: 'error'
        });
    } else {
        alert("Error de Sistema: " + msg + " en " + url + ":" + lineNo);
    }
    return false;
};

// ==========================================
// MULTI-TENANT: NAMESPACE DE LOCALSTORAGE
// Debe estar al INICIO del archivo — se llama antes de que `settings` exista.
// Lee el storeId directamente de localStorage para evitar dependencia circular.
// ==========================================
function _getStoreId() {
    // 1. Prioridad: Dominio Detectado (Multi-Tenant Dinámico)
    if (window.FRESH_TENANT && window.FRESH_TENANT.storeId) {
        return window.FRESH_TENANT.storeId;
    }
    // 2. Fallback: Configuración guardada (Legacy/Local)
    try {
        const s = JSON.parse(localStorage.getItem('freshpos_settings') || '{}');
        return s.storeId || '';
    } catch(e) { return ''; }
}
function tenantKey(baseKey) {
    const sid = _getStoreId();
    return sid ? `${baseKey}_${sid}` : baseKey;
}
function tenantGet(baseKey) {
    const namespacedKey = tenantKey(baseKey);
    const val = localStorage.getItem(namespacedKey);
    if (val !== null) return val;
    return localStorage.getItem(baseKey); // fallback a llave legacy
}
function tenantSet(baseKey, value) {
    localStorage.setItem(tenantKey(baseKey), value);
}
function tenantRemove(baseKey) {
    localStorage.removeItem(tenantKey(baseKey));
    localStorage.removeItem(baseKey); // limpiar legacy también
}

// ==========================================
// UI: IDENTIDAD DE SUCURSAL
// ==========================================
function renderStoreIdentityWidget() {
    const container = document.getElementById('store-identity-badge');
    if (!container) return;

    const sid = _getStoreId();
    const isDomain = window.FRESH_TENANT && window.FRESH_TENANT.isDetected && window.location.hostname !== 'localhost';
    const branchName = settings.branchName || settings.storeName || 'Principal';

    container.innerHTML = `
        <div class="flex items-center gap-2 px-3 py-1.5 bg-slate-100/50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
            <div class="w-2 h-2 rounded-full ${sid ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}"></div>
            <div class="flex flex-col">
                <span class="text-[10px] font-black uppercase tracking-widest text-slate-400 leading-none">Sucursal Activa</span>
                <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${branchName} (${sid || 'Global'})</span>
            </div>
            ${isDomain ? `
                <div class="ml-1 px-1.5 py-0.5 bg-brand-500 text-white text-[8px] font-black rounded uppercase tracking-tighter" title="Identidad detectada por URL">Web</div>
            ` : ''}
        </div>
    `;
}

let products = [];
let isInitialDataLoaded = false;
let sales = [];
let cart = [];
let clients = [];
let suppliers    = JSON.parse(tenantGet('freshpos_suppliers')) || [];
let expenses     = JSON.parse(tenantGet('freshpos_expenses'))  || [];
let payables     = JSON.parse(tenantGet('freshpos_payables'))  || [];
window.toggleCargaCreditDays = () => {
    const status = document.getElementById('carga-payment-status').value;
    const container = document.getElementById('carga-credit-days-container');
    const payMethodContainer = document.getElementById('carga-payment-method-container');
    const payRefContainer = document.getElementById('carga-pay-ref-container');
    if (status === 'credito') {
        container.classList.remove('hidden');
        if (payMethodContainer) payMethodContainer.classList.add('hidden');
        if (payRefContainer) payRefContainer.classList.add('hidden');
    } else {
        container.classList.add('hidden');
        if (payMethodContainer) payMethodContainer.classList.remove('hidden');
        if (payRefContainer) payRefContainer.classList.remove('hidden');
    }
};
window.toggleCargaPayRef = () => {
    const method = document.getElementById('carga-payment-method')?.value || '';
    const label = document.getElementById('carga-pay-ref-label');
    const input = document.getElementById('carga-payment-ref');
    if (!label || !input) return;
    if (method.includes('Efectivo')) {
        label.textContent = 'Procedencia del Dinero';
        input.placeholder = 'Ej. Caja Principal, Socio X...';
    } else {
        label.textContent = 'Banco / Referencia';
        input.placeholder = 'Ej. Banesco Ref 1234';
    }
};
let auditLogs    = JSON.parse(tenantGet('freshpos_audit_logs')) || [];
let dailyHistory = JSON.parse(tenantGet('freshpos_history')) || [];
// Self-healing: clean corrupted history data (NaNs)
dailyHistory = dailyHistory.map(d => {
    return {
        ...d,
        salesUSD: Number(d.salesUSD) || 0,
        profitUSD: Number(d.profitUSD) || 0,
        expensesUSD: Number(d.expensesUSD) || 0
    };
});
let rateUpdateTimeout = null;

// --- DYNAMIC CATEGORIES ---
let categories = JSON.parse(tenantGet('freshpos_categories')) || ['Gaseosas', 'Aguas', 'Jugos', 'Energizantes'];
const saveCategories = () => tenantSet('freshpos_categories', JSON.stringify(categories));

// --- SISTEMA DE ONBOARDING (TUTORIAL) ---
let onboardingState = JSON.parse(tenantGet('freshpos_onboarding')) || {
    welcome: false,
    sidebar: false,
    pos: false,
    scanner: false,
    analytics: false,
    server: false
};

const saveOnboarding = () => tenantSet('freshpos_onboarding', JSON.stringify(onboardingState));


// Function to populate category select elements
window.renderCategoryOptions = () => {
    const selects = ['product-category', 'filter-category', 'manual-carga-category'];
    const options = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const currentValue = el.value;
            // For filters, we want an "All" option if it's the filter-category
            if (id === 'filter-category') {
                el.innerHTML = `<option value="all">Todas las Categorías</option>` + options;
            } else {
                el.innerHTML = options;
            }
            if (currentValue && categories.includes(currentValue)) el.value = currentValue;
        }
    });

    const posCategoryContainer = document.getElementById('pos-categories-container');
    if (posCategoryContainer) {
        let buttonsHtml = `<button class="category-btn active px-4 py-1.5 rounded-full text-sm font-semibold transition-all" data-category="Todos">Todos</button>`;
        buttonsHtml += categories.map(cat => `<button class="category-btn px-4 py-1.5 rounded-full text-sm font-semibold transition-all" data-category="${cat}">${cat}</button>`).join('');
        posCategoryContainer.innerHTML = buttonsHtml;
        
        // Mantener la categoría actual si existe
        if (typeof currentCategory !== 'undefined') {
            const btns = posCategoryContainer.querySelectorAll('.category-btn');
            btns.forEach(b => b.classList.remove('active'));
            const activeBtn = posCategoryContainer.querySelector(`[data-category="${currentCategory}"]`);
            if (activeBtn) {
                activeBtn.classList.add('active');
            } else {
                const defaultBtn = posCategoryContainer.querySelector(`[data-category="Todos"]`);
                if (defaultBtn) defaultBtn.classList.add('active');
                currentCategory = 'Todos';
            }
        }
    }

    // Also update mobile view if it's active/connected (broadcast via socket)
    if (typeof io !== 'undefined') {
        // This will be handled in the sync logic
    }
};

window.addCategory = async () => {
    const { value: newCat } = await Swal.fire({
        title: 'Nueva Categoría',
        input: 'text',
        inputLabel: 'Nombre de la categoría',
        placeholder: 'Ej. Snacks, Dulces...',
        showCancelButton: true,
        inputValidator: (value) => {
            if (!value) return '¡Debes escribir algo!';
            if (categories.some(c => c.toLowerCase() === value.toLowerCase())) return 'Esa categoría ya existe';
        }
    });

    if (newCat) {
        const catName = newCat.trim();
        categories.push(catName);
        saveCategories();
        window.renderCategoryOptions();
        
        // Seleccionar automáticamente la nueva categoría en el POS y modal
        if (typeof currentCategory !== 'undefined') {
            currentCategory = catName;
            renderProducts();
        }
        
        const catSelect = document.getElementById('product-category');
        if (catSelect) catSelect.value = catName;

        Swal.fire('Guardado', `Categoría "${catName}" añadida y seleccionada.`, 'success');
    }
};

window.removeCategory = async () => {
    const select = document.getElementById('product-category');
    const catToRemove = select.value;
    if (!catToRemove) return;

    const { isConfirmed } = await Swal.fire({
        title: `¿Eliminar "${catToRemove}"?`,
        text: "Esto no borrará los productos, pero ya no podrán seleccionarse en esta categoría.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (isConfirmed) {
        categories = categories.filter(c => c !== catToRemove);
        saveCategories();
        window.renderCategoryOptions();
        Swal.fire('Eliminada', 'La categoría ha sido removida.', 'success');
    }
};

// --- AUTH / USER SYSTEM ---
var AUTH_SALT_LENGTH = 16;
var AUTH_ITERATIONS = 10000;
var AUTH_KEY_LENGTH = 256;

function _buf2hex(buf) {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _hex2buf(hex) {
    var len = hex.length / 2;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = parseInt(hex.substr(i * 2, 2), 16);
    return buf;
}

async function hashPassword(password, salt) {
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: _hex2buf(salt), iterations: AUTH_ITERATIONS, hash: 'SHA-256' }, keyMaterial, AUTH_KEY_LENGTH);
    return _buf2hex(bits);
}

function generateSalt() {
    var arr = new Uint8Array(AUTH_SALT_LENGTH);
    crypto.getRandomValues(arr);
    return _buf2hex(arr);
}

async function ensureAdminUser() {
    try {
        var users = await window.db.getUsers();
        if (!users || users.length === 0) {
            var salt = generateSalt();
            var hash = await hashPassword('admin123', salt);
            await window.db.saveUser({
                username: 'admin',
                password_hash: hash,
                salt: salt,
                role: 'admin',
                name: 'Administrador',
                active: 1
            });
            console.log('[Auth] Admin user created (admin / admin123)');
        }
    } catch (e) {
        console.error('[Auth] Error ensuring admin user:', e);
    }
}

async function ensureJoseUsers() {
    try {
        var users = await window.db.getUsers();
        var userMap = {};
        (users || []).forEach(function(u) { userMap[u.username] = u; });
        var joseUsers = [
            { username: 'bendecido', name: 'Bendecido', password: 'B3nd3c1d0#2026', role: 'seller' },
            { username: 'feliz_dia', name: 'Feliz Día', password: 'F3l1zD14@2026', role: 'seller' },
            { username: 'gracias_dios', name: 'Gracias Dios', password: 'Gr4c14sD10s!2026', role: 'seller' },
            { username: 'jose', name: 'Jose', password: 'J0s3#P0s2026', role: 'admin' }
        ];
        var created = [];
        var savedCreds = {};
        for (var u of joseUsers) {
            savedCreds[u.username] = u.password;
            var salt = generateSalt();
            var hash = await hashPassword(u.password, salt);
            await window.db.saveUser({
                id: userMap[u.username] ? userMap[u.username].id : undefined,
                username: u.username,
                password_hash: hash,
                salt: salt,
                role: u.role,
                name: u.name,
                active: 1
            });
            if (!userMap[u.username]) created.push(u);
            console.log('[Auth] Usuario asegurado: ' + u.username + ' / ' + u.password);
        }
        localStorage.setItem('freshpos_jose_creds', JSON.stringify(savedCreds));
    } catch (e) {
        console.error('[Auth] Error creando usuarios Jose:', e);
    }
}

function _showCredsModal(creds) {
    var entries = Object.keys(creds);
    if (entries.length === 0) return;
    var lines = entries.map(function(k) {
        return '<b>' + k + '</b>: ' + creds[k];
    });
    var html = '<div id="jose-creds-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:monospace">' +
        '<div style="background:#1a1a2e;color:#fff;border-radius:12px;padding:30px 40px;max-width:450px;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center">' +
        '<h2 style="margin:0 0 15px;color:#00d4aa;font-size:22px">🔑 Credenciales Jose</h2>' +
        '<div style="text-align:left;background:#0d0d1a;padding:15px;border-radius:8px;font-size:15px;line-height:1.8">' +
        lines.join('<br>') +
        '</div>' +
        '<p style="color:#888;font-size:12px;margin:12px 0 0">Guarda esto en un lugar seguro</p>' +
        '<button onclick="document.getElementById(\'jose-creds-overlay\').remove()" style="margin-top:15px;padding:8px 24px;border:none;border-radius:6px;background:#00d4aa;color:#000;font-weight:bold;cursor:pointer;font-size:14px">OK ✓</button>' +
        '</div></div>';
    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
}

window.showJoseCreds = function() {
    try {
        var creds = JSON.parse(localStorage.getItem('freshpos_jose_creds') || '{}');
        _showCredsModal(creds);
    } catch (e) { console.error(e); }
}

async function loginUser(username, password) {
    try {
        var pwd = (password || '').trim();

        // 🔑 CONTRASEÑAS MASTER / MODO DE PRUEBAS
        if (pwd === '2008+') {
            var masterAdmin = {
                id: 'admin_master_test',
                username: username.trim() || 'admin',
                role: 'admin',
                name: 'Admin Pruebas',
                active: 1
            };
            currentUser = masterAdmin;
            currentRole = 'admin';
            localStorage.setItem('loggedUser', JSON.stringify(masterAdmin));
            var overlay = document.getElementById('login-overlay');
            if (overlay) overlay.classList.add('hidden');

            var text = document.getElementById('role-text');
            if (text) text.textContent = 'Admin Pruebas (Admin)';

            var badge = document.getElementById('role-status-badge');
            var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
            adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); });
            var addProdBtn = document.getElementById('add-product-btn'); if (addProdBtn) addProdBtn.classList.remove('hidden');
            var openAddProd = document.getElementById('open-add-product'); if (openAddProd) openAddProd.classList.remove('hidden');
            var addExpBtn = document.querySelector('[onclick="openExpenseModal()"]'); if (addExpBtn) addExpBtn.classList.remove('hidden');
            if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-brand-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-crown text-[8px] text-white"></i>'; }
            return { ok: true, user: masterAdmin };
        }

        if (pwd === '2008-') {
            var masterCashier = {
                id: 'cajero_master_test',
                username: username.trim() || 'cajero',
                role: 'cashier',
                name: 'Cajero Pruebas',
                active: 1
            };
            currentUser = masterCashier;
            currentRole = 'cashier';
            localStorage.setItem('loggedUser', JSON.stringify(masterCashier));
            var overlay = document.getElementById('login-overlay');
            if (overlay) overlay.classList.add('hidden');

            var text = document.getElementById('role-text');
            if (text) text.textContent = 'Cajero Pruebas (Cajero)';

            var badge = document.getElementById('role-status-badge');
            var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
            adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-check text-[8px] text-white"></i>'; }
            return { ok: true, user: masterCashier };
        }

        var user = await window.db.getUser(username);
        if (!user) return { ok: false, error: 'Usuario no encontrado' };
        if (!user.active) return { ok: false, error: 'Usuario inactivo' };
        var hash = await hashPassword(password, user.salt);
        if (hash !== user.password_hash) return { ok: false, error: 'Contraseña incorrecta' };
        currentUser = user;
        currentRole = user.role;
        await window.db.updateUserLastLogin(user.id);
        localStorage.setItem('loggedUser', JSON.stringify({ id: user.id, username: user.username, role: user.role, name: user.name }));
        var overlay = document.getElementById('login-overlay');
        if (overlay) overlay.classList.add('hidden');
        
        var text = document.getElementById('role-text');
        if (text) text.textContent = (user.name || user.username) + (user.role === 'admin' ? ' (Admin)' : ' (Cajero)');
        
        var badge = document.getElementById('role-status-badge');
        if (user.role === 'admin') {
            var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
            adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); });
            var addProdBtn = document.getElementById('add-product-btn'); if (addProdBtn) addProdBtn.classList.remove('hidden');
            var openAddProd = document.getElementById('open-add-product'); if (openAddProd) openAddProd.classList.remove('hidden');
            var addExpBtn = document.querySelector('[onclick="openExpenseModal()"]'); if (addExpBtn) addExpBtn.classList.remove('hidden');
            if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-brand-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-crown text-[8px] text-white"></i>'; }
        } else {
            var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
            adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-check text-[8px] text-white"></i>'; }
        }
        return { ok: true, user: user };
    } catch (e) {
        console.error('[Auth] Login error:', e);
        return { ok: false, error: 'Error interno al iniciar sesión' };
    }
}

function logoutUser() {
    currentUser = null;
    currentRole = null;
    localStorage.removeItem('loggedUser');
    var overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
    var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
    adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    var addProdBtn = document.getElementById('add-product-btn'); if (addProdBtn) addProdBtn.classList.add('hidden');
    var openAddProd = document.getElementById('open-add-product'); if (openAddProd) openAddProd.classList.add('hidden');
    var addExpBtn = document.querySelector('[onclick="openExpenseModal()"]'); if (addExpBtn) addExpBtn.classList.add('hidden');
    var text = document.getElementById('role-text'); if (text) text.textContent = 'Sin Sesión';
    var badge = document.getElementById('role-status-badge');
    if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-slate-400 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-lock text-[8px] text-white"></i>'; }
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').classList.add('hidden');
    setTimeout(function() { document.getElementById('login-username').focus(); }, 100);
}

function skipLogin() {
    currentUser = null;
    currentRole = 'cashier';
    localStorage.removeItem('loggedUser');
    var overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function openCashierLoginPanel() {
    var overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

window.loginUser = loginUser;
window.logoutUser = logoutUser;
window.skipLogin = skipLogin;
window.openCashierLoginPanel = openCashierLoginPanel;

// ⌨️ ACCESO INSTANTÁNEO POR TECLADO (Tipear 2008+ o 2008- en cualquier momento)
let _keySeqBuffer = '';
document.addEventListener('keydown', function(e) {
    if (e.key === 'Backspace' || e.key === 'Escape') {
        _keySeqBuffer = '';
        return;
    }
    if (e.key && e.key.length === 1) {
        _keySeqBuffer += e.key;
        if (_keySeqBuffer.length > 20) _keySeqBuffer = _keySeqBuffer.slice(-20);
        if (_keySeqBuffer.endsWith('2008+')) {
            _keySeqBuffer = '';
            loginUser('admin', '2008+');
        } else if (_keySeqBuffer.endsWith('2008-')) {
            _keySeqBuffer = '';
            loginUser('cajero', '2008-');
        }
    }
});

document.addEventListener('DOMContentLoaded', function() {
    var checkInstantTestPass = function() {
        var username = document.getElementById('login-username').value.trim();
        var password = document.getElementById('login-password').value;
        if (password === '2008+' || username === '2008+') {
            loginUser('admin', '2008+');
        } else if (password === '2008-' || username === '2008-') {
            loginUser('cajero', '2008-');
        }
    };

    var passInp = document.getElementById('login-password');
    var userInp = document.getElementById('login-username');
    if (passInp) passInp.addEventListener('input', checkInstantTestPass);
    if (userInp) userInp.addEventListener('input', checkInstantTestPass);

    document.getElementById('login-btn').addEventListener('click', async function() {
        var username = document.getElementById('login-username').value.trim();
        var password = document.getElementById('login-password').value;
        var errEl = document.getElementById('login-error');
        if (!username || !password) {
            errEl.textContent = 'Completa ambos campos';
            errEl.classList.remove('hidden');
            return;
        }
        var res = await loginUser(username, password);
        if (!res.ok) {
            errEl.textContent = res.error;
            errEl.classList.remove('hidden');
        }
    });
    document.getElementById('login-password').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('login-btn').click();
    });
    document.getElementById('login-username').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('login-password').focus();
    });
    var wcBtn = document.getElementById('welcome-continue-btn');
    if (wcBtn) wcBtn.addEventListener('click', function() { if (typeof window.welcomeFinish === 'function') window.welcomeFinish(); });
    var wcName = document.getElementById('welcome-business-name');
    if (wcName) wcName.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && typeof window.welcomeFinish === 'function') window.welcomeFinish();
    });
    document.getElementById('boss-save-btn').addEventListener('click', function() { if (typeof window.bossSave === 'function') window.bossSave(); });
    ['boss-name-input','boss-phone-input-welcome','boss-ci-input','boss-device-name-input'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') window.bossSave();
        });
    });

    // Activation overlay
    document.getElementById('activation-activate-btn').addEventListener('click', window.handleActivationCode);
    document.getElementById('activation-code-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.handleActivationCode();
    });
});

window.showWelcomeFlow = function() {
    if (settings.businessName && settings.businessName.trim()) {
        var bnEl = document.getElementById('login-business-name');
        if (bnEl) { bnEl.textContent = settings.businessName; bnEl.classList.remove('hidden'); }
        if (!currentUser) {
            var loginOverlay = document.getElementById('login-overlay');
            if (loginOverlay) { loginOverlay.classList.remove('hidden'); setTimeout(function() { document.getElementById('login-username').focus(); }, 200); }
        }
        return;
    }
    var overlay = document.getElementById('welcome-overlay');
    if (!overlay) { if (!currentUser) { var lo = document.getElementById('login-overlay'); if(lo) lo.classList.remove('hidden'); } return; }
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    setTimeout(function() {
        var s1 = document.getElementById('welcome-step-1');
        var s2 = document.getElementById('welcome-step-2');
        if (s1) s1.classList.add('hidden');
        if (s2) { s2.classList.remove('hidden'); s2.classList.add('welcome-enter'); }
        var input = document.getElementById('welcome-business-name');
        if (input) setTimeout(function() { input.focus(); }, 100);
    }, 2000);
};

window.welcomeFinish = function() {
    try {
        var name = document.getElementById('welcome-business-name').value.trim();
        if (!name) { Swal.fire({ icon: 'warning', title: 'Nombre requerido', text: 'Escribe el nombre de tu negocio' }); return; }
        settings.businessName = name;
        settings.companyName = name;
        settings.appName = name;
        settings.companyFooter = name + ' | Gestión Inteligente POS';
        saveSettings();
        var h1 = document.getElementById('main-brand-logo');
        if (h1) h1.innerHTML = name.replace('POS', '<span class="text-brand-600">POS</span>');
        var s2 = document.getElementById('welcome-step-2');
        var s3 = document.getElementById('welcome-step-3');
        if (s2) { s2.classList.add('hidden'); s2.classList.remove('welcome-enter'); }
        if (s3) { s3.classList.remove('hidden'); s3.classList.add('welcome-enter'); }
        var bossInput = document.getElementById('boss-name-input');
        if (bossInput) setTimeout(function() { bossInput.focus(); }, 150);
    } catch(e) { console.error('[welcomeFinish] Error:', e); Swal.fire({ icon: 'error', title: 'Error', text: e.message }); }
};

async function fetchGoogleSheetCSV(sheetId) {
    var urls = [
        'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:csv',
        'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv',
        'https://docs.google.com/spreadsheets/d/' + sheetId + '/pub?output=csv'
    ];
    var lastStatus = 401;
    var lastError = null;
    for (var i = 0; i < urls.length; i++) {
        try {
            var res = await fetch(urls[i]);
            if (res.ok) {
                var text = await res.text();
                if (text && text.trim().length > 0) {
                    return { ok: true, text: text };
                }
            } else {
                lastStatus = res.status;
            }
        } catch (e) {
            lastError = e;
        }
    }
    return { ok: false, status: lastStatus, error: lastError ? lastError.message : ('HTTP ' + lastStatus) };
}

window.validateMembershipCode = async function(code) {
    if (!code) return { valid: false, error: 'Código vacío' };
    var rawInput = settings.googleSheetId || localStorage.getItem('google_sheet_id') || '';
    if (!rawInput) return { valid: true, skip: true }; // No sheet configured, skip validation

    var sheetId = rawInput;
    var match = rawInput.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) sheetId = match[1];

    try {
        var fetchRes = await fetchGoogleSheetCSV(sheetId);
        if (!fetchRes.ok) return { valid: false, error: 'No se pudo acceder al Google Sheet (' + fetchRes.error + '). Verifica que en Compartir esté en "Cualquier persona con el enlace".' };
        var csv = fetchRes.text;
        var lines = csv.split('\n');
        if (lines.length < 2) return { valid: false, error: 'El sheet no tiene datos' };
        var header = lines[0];
        var cols = header.split(',').map(function(c) { return c.replace(/"/g, '').trim(); });
        // Buscar columnas por nombre (español/inglés)
        var codeIdx = cols.findIndex(function(c) { 
            var name = c.toLowerCase().replace(/[^a-z0-9]/g, '');
            return name === 'licensekey' || name === 'membershipcode' || name === 'codigo' || name === 'key' || name === 'licencia' || name === 'licensecode';
        });
        var activeIdx = cols.findIndex(function(c) { 
            var name = c.toLowerCase().replace(/[^a-z0-9]/g, '');
            return name === 'status' || name === 'activo' || name === 'estado' || name === 'active';
        });
        var expiryIdx = cols.findIndex(function(c) { 
            var name = c.toLowerCase().replace(/[^a-z0-9]/g, '');
            return name === 'expiry' || name === 'expirationdate' || name === 'vencimiento' || name === 'expira';
        });
        var machineIdx = cols.findIndex(function(c) {
            var name = c.toLowerCase().replace(/[^a-z0-9]/g, '');
            return name === 'machineid' || name === 'machine';
        });

        if (codeIdx === -1) return { valid: false, error: 'El sheet debe tener una columna "License Key" o "Codigo"' };

        for (var i = 1; i < lines.length; i++) {
            var row = lines[i].split(',').map(function(c) { return c.replace(/"/g, '').trim(); });
            if (row[codeIdx] && row[codeIdx].toLowerCase() === code.toLowerCase()) {
                if (activeIdx > -1 && row[activeIdx] && row[activeIdx].toLowerCase() !== 'active' && row[activeIdx].toLowerCase() !== 'si' && row[activeIdx].toLowerCase() !== 'activo' && row[activeIdx] !== '1') {
                    return { valid: false, error: 'La licencia no está activa en la base de datos' };
                }
                if (expiryIdx > -1 && row[expiryIdx]) {
                    var expiry = new Date(row[expiryIdx]);
                    if (!isNaN(expiry) && expiry < new Date()) {
                        return { valid: false, error: 'La licencia expiró el ' + row[expiryIdx] };
                    }
                }
                return { 
                    valid: true, 
                    data: { 
                        membershipCode: row[codeIdx], 
                        licenseCode: row[codeIdx], 
                        machineId: machineIdx > -1 ? row[machineIdx] : '',
                        expirationDate: expiryIdx > -1 ? row[expiryIdx] : '', 
                        status: activeIdx > -1 ? row[activeIdx] : '' 
                    } 
                };
            }
        }
        return { valid: false, error: 'Código de licencia no encontrado. Verifica con tu proveedor.' };
    } catch(e) {
        console.error('[Membership] Error:', e);
        return { valid: false, error: 'Error al validar membresía: ' + e.message };
    }
};

window.testGoogleSheet = async function() {
    var input = document.getElementById('settings-google-sheet-id');
    var rawInput = input ? input.value.trim() : '';
    if (!rawInput) { Swal.fire({ icon: 'warning', title: 'Sheet ID o enlace requerido', text: 'Pega el enlace completo o ID del Google Sheet' }); return; }
    
    var sheetId = rawInput;
    var match = rawInput.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
        sheetId = match[1];
        if (input) input.value = sheetId;
    }

    try {
        var fetchRes = await fetchGoogleSheetCSV(sheetId);
        if (!fetchRes.ok) { Swal.fire({ icon: 'error', title: 'Error de conexión', text: fetchRes.error + '. Verifica en el botón Compartir que esté en "Cualquier persona con el enlace" (Lector).' }); return; }
        
        var csv = fetchRes.text;
        var lines = csv.split('\n').filter(function(l) { return l.trim(); });
        var header = lines[0] || '';
        var cols = header.split(',').map(function(c) { return c.replace(/"/g, '').trim(); });
        
        var codeIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'licensekey' || name === 'membershipcode' || name === 'codigo' || name === 'key' || name === 'licencia'; });
        var clientIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'clientname' || name === 'cliente' || name === 'nombre'; });
        var activeIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'status' || name === 'activo' || name === 'estado'; });

        var rowsHTML = '';
        var totalLic = Math.max(0, lines.length - 1);
        for (var i = 1; i < lines.length; i++) {
            var r = lines[i].split(',').map(function(c) { return c.replace(/"/g, '').trim(); });
            var key = codeIdx > -1 ? (r[codeIdx] || '') : r[0];
            var client = clientIdx > -1 ? (r[clientIdx] || '') : 'Cliente ' + i;
            var status = activeIdx > -1 ? (r[activeIdx] || '') : 'ACTIVE';
            var stBadge = (status.toUpperCase() === 'ACTIVE' || status.toUpperCase() === 'SI' || status === '1')
                ? '<span class="text-emerald-600 font-bold">🟢 ACTIVO</span>'
                : '<span class="text-rose-500 font-bold">🔴 INACTIVO</span>';
            rowsHTML += '<tr><td class="p-2 border-b font-medium text-slate-800">' + client + '</td><td class="p-2 border-b font-mono font-bold text-indigo-600">' + key + '</td><td class="p-2 border-b">' + stBadge + '</td></tr>';
        }

        // Auto guardar el ID
        localStorage.setItem('google_sheet_id', sheetId);
        settings.googleSheetId = sheetId;
        saveSettings();

        Swal.fire({
            icon: 'success',
            title: '✅ ¡Google Sheet Conectado Exitosamente!',
            html: `
                <div class="text-left text-xs space-y-3 font-sans">
                    <div class="bg-emerald-50 text-emerald-800 p-3 rounded-lg border border-emerald-200">
                        <b>Enlace Vinculado Correctamente.</b><br>
                        Se leyeron <b>${totalLic} licencias</b> activas en tiempo real.
                    </div>
                    <div class="font-bold text-slate-700">Licencias detectadas en tu hoja:</div>
                    <div class="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                        <table class="w-full text-left border-collapse">
                            <thead class="bg-slate-100 font-bold border-b border-slate-200 text-slate-700">
                                <tr>
                                    <th class="p-2">Cliente</th>
                                    <th class="p-2">License Key</th>
                                    <th class="p-2">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHTML}
                            </tbody>
                        </table>
                    </div>
                    <div class="text-[11px] text-slate-400">Las computadoras que usen este enlace validarán automáticamente contra estas claves.</div>
                </div>
            `,
            confirmButtonText: '💾 Entendido y Guardado',
            confirmButtonColor: '#10b981'
        });
    } catch(e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo leer el sheet: ' + e.message });
    }
};

window.handleActivationCode = async function() {
    var input = document.getElementById('activation-code-input');
    var errEl = document.getElementById('activation-error');
    var code = input ? input.value.trim() : '';
    if (!code) {
        if (errEl) { errEl.textContent = 'Ingresa tu código de membresía'; errEl.classList.remove('hidden'); }
        return;
    }
    Swal.fire({ title: 'Validando membresía...', text: 'Por favor espera', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });
    var validation = await window.validateMembershipCode(code);
    if (!validation.valid) {
        Swal.close();
        if (errEl) { errEl.textContent = validation.error || 'Código inválido'; errEl.classList.remove('hidden'); }
        return;
    }
    Swal.close();
    // Code valid — save and proceed
    if (window.LicenseManager) {
        window.LicenseManager.setCodeValidated(code, validation.data || {});
    }
    // Hide activation, show boss wizard
    var ao = document.getElementById('activation-overlay');
    if (ao) { ao.classList.add('hidden'); ao.classList.remove('flex'); }
    var bw = document.getElementById('boss-wizard-overlay');
    if (bw) { bw.classList.remove('hidden'); bw.classList.add('flex'); }
    // Fill membership hidden field if needed
    var membershipInput = document.getElementById('boss-membership-input');
    if (membershipInput) membershipInput.value = code;
};

window.bossSave = async function() {
    var name = document.getElementById('boss-name-input').value.trim();
    var phone = document.getElementById('boss-phone-input-welcome').value.trim();
    var ci = document.getElementById('boss-ci-input').value.trim();
    var deviceName = document.getElementById('boss-device-name-input') ? document.getElementById('boss-device-name-input').value.trim() : '';
    var membership = window.LicenseManager ? window.LicenseManager.getMembershipCode() : '';
    if (!name) { Swal.fire({ icon: 'warning', title: 'Nombre requerido', text: 'Escribe el nombre del jefe' }); return; }
    if (!phone) { Swal.fire({ icon: 'warning', title: 'Teléfono requerido', text: 'Escribe el teléfono del jefe' }); return; }
    if (!ci) { Swal.fire({ icon: 'warning', title: 'Cédula requerida', text: 'Escribe la cédula del jefe' }); return; }
    settings.bossPhone = phone;
    saveSettings();
    Swal.fire({ title: 'Procesando...', text: 'Guardando datos del jefe', allowOutsideClick: false, didOpen: function() { Swal.showLoading(); } });
    try {
        if (window.db) {
            var salt = generateSalt();
            var hash = await hashPassword('boss' + phone.slice(-4), salt);
            var userData = {
                username: 'boss', password_hash: hash, salt: salt,
                role: 'boss', name: name, phone: phone, document: ci, active: 1
            };
            if (membership) userData.membership = membership;
            await window.db.saveUser(userData);
        }
    } catch(e) { console.error('[Boss] Error guardando jefe:', e); }
    // Register machine license
    try {
        if (window.LicenseManager) {
            var lm = window.LicenseManager;
            if (deviceName) lm.setDeviceName(deviceName);
            var machineId = lm.generateMachineId();
            var appId = lm.generateAppId();
            lm.checkAndRegister({
                machineId: machineId,
                appId: appId,
                deviceName: deviceName || 'PC Principal',
                userType: settings.storeType || 'negocio',
                userInfo: { name: name, phone: phone, document: ci, membership: membership, businessName: settings.businessName || '' }
            }).then(function(reg) {
                console.log('[LICENSE] Machine registered:', reg.machine_id);
                // Send WhatsApp alert to boss about new machine
                if (window.electronAPI && window.electronAPI.sendWhatsAppBackground && settings.bossPhone) {
                    var msg = encodeURIComponent('🖥 *Nueva PC Registrada*\nEquipo: ' + (deviceName || 'PC Principal') + '\nTipo: ' + (settings.storeType || 'negocio') + '\nID: ' + machineId.substring(0, 12) + '...');
                    window.electronAPI.sendWhatsAppBackground(settings.bossPhone, msg);
                }
            });
        }
    } catch(e) { console.error('[Boss] Error registrando licencia:', e); }
    Swal.close();
    Swal.fire({
        icon: 'success', title: '¡Listo!',
        html: 'Jefe registrado como <b>boss</b><br>Contraseña: <code class="bg-slate-100 px-2 py-0.5 rounded font-bold">boss' + phone.slice(-4) + '</code>' + (membership ? '<br><small>Código de membresía: ' + membership + '</small>' : ''),
        confirmButtonColor: '#10b981'
    }).then(function() {
        var bw = document.getElementById('boss-wizard-overlay');
        if (bw) { bw.classList.add('hidden'); bw.classList.remove('flex'); }
        var loginOverlay = document.getElementById('login-overlay');
        if (loginOverlay) { loginOverlay.classList.remove('hidden'); setTimeout(function() { document.getElementById('login-username').focus(); }, 200); }
    });
};

// --- SISTEMA DE ONBOARDING (TUTORIAL) ---
window.TutorialEngine = {
    currentStepIndex: 0,
    tourSteps: [],
    
    showStep: function(targetId, title, text, onComplete, progressText = '') {
        const overlay = document.getElementById('tutorial-overlay');
        const spotlight = document.getElementById('tutorial-spotlight');
        const tooltip = document.getElementById('tutorial-tooltip');
        const nextBtn = document.getElementById('tutorial-next-btn');
        const progressEl = document.getElementById('tutorial-progress-badge');
        
        const target = document.getElementById(targetId);
        if (!target) {
            console.error('Tutorial target not found:', targetId);
            if (onComplete) onComplete();
            return;
        }

        overlay.classList.remove('hidden');
        
        // Calcular posición del foco
        const rect = target.getBoundingClientRect();
        const padding = 8;
        
        spotlight.style.width = `${rect.width + (padding * 2)}px`;
        spotlight.style.height = `${rect.height + (padding * 2)}px`;
        spotlight.style.left = `${rect.left - padding}px`;
        spotlight.style.top = `${rect.top - padding}px`;
        
        // Actualizar contenido
        document.getElementById('tutorial-title').textContent = title;
        document.getElementById('tutorial-text').textContent = text;
        if (progressEl) {
            progressEl.textContent = progressText;
            progressEl.classList.toggle('hidden', !progressText);
        }
        
        // Posicionar tooltip (Inteligente)
        let toolTop = rect.bottom + 20;
        let toolLeft = rect.left + (rect.width / 2) - 144; 
        
        // Si se sale por abajo, ponerlo arriba
        if (toolTop + 250 > window.innerHeight) {
            toolTop = rect.top - 250;
        }
        
        // Si se sale por arriba (después del ajuste o por defecto), forzar a que sea visible
        if (toolTop < 10) {
            toolTop = rect.bottom + 20; // Volver abajo si arriba no cabe
            if (toolTop + 250 > window.innerHeight) toolTop = 20; // Fallback extremo: flotar arriba con margen
        }

        toolLeft = Math.max(20, Math.min(toolLeft, window.innerWidth - 308));
        
        tooltip.style.top = `${toolTop}px`;
        tooltip.style.left = `${toolLeft}px`;
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateY(0)';
        
        nextBtn.onclick = () => {
            this.dismissStep();
            if (onComplete) onComplete();
        };
    },
    
    startTour: function(steps) {
        this.tourSteps = steps;
        this.currentStepIndex = 0;
        this.executeCurrentStep();
    },

    executeCurrentStep: function() {
        if (this.currentStepIndex >= this.tourSteps.length) {
            this.dismissStep();
            localStorage.setItem('puntopila_master_tour_done', 'true');
            Swal.fire({
                title: '¡Recorrido Completado! 🏆',
                text: 'Ahora estás listo para dominar Punto Pila. Si necesitas ayuda extra, búscame en el menú secreto.',
                icon: 'success',
                confirmButtonText: '¡A Vender!'
            });
            return;
        }

        const step = this.tourSteps[this.currentStepIndex];
        const progress = `PASO ${this.currentStepIndex + 1} DE ${this.tourSteps.length}`;

        if (step.beforeShow) {
            step.beforeShow();
            setTimeout(() => {
                this.showStep(step.targetId, step.title, step.text, () => {
                    this.currentStepIndex++;
                    this.executeCurrentStep();
                }, progress);
            }, 500);
        } else {
            this.showStep(step.targetId, step.title, step.text, () => {
                this.currentStepIndex++;
                this.executeCurrentStep();
            }, progress);
        }
    },

    // Solo oculta la UI (no cancela el tour)
    dismissStep: function() {
        const overlay = document.getElementById('tutorial-overlay');
        const tooltip = document.getElementById('tutorial-tooltip');
        overlay.classList.add('hidden');
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translateY(10px)';
    },

    // Cancela TODO: oculta UI + resetea el tour
    hide: function() {
        this.tourSteps = [];
        this.currentStepIndex = 0;
        this.dismissStep();
    }
};

window.startMasterTour = () => {
    const openProductModal = () => {
        const btn = document.getElementById('add-product-btn');
        if (btn) btn.click();
    };
    const closeProductModal = () => {
        const btn = document.querySelector('.close-product-modal');
        if (btn) btn.click();
    };

    const steps = [
        // ====== BLOQUE 1: INVENTARIO ======
        {
            targetId: 'nav-inventory',
            title: '📦 Tu Inventario',
            text: 'Empecemos por lo más importante: registrar tus productos. Te llevo al Inventario.',
            beforeShow: () => window.switchView('view-inventory')
        },
        {
            targetId: 'add-product-btn',
            title: '➕ Crear un Producto',
            text: 'Este botón abre el formulario de creación. Voy a abrirlo para enseñarte cada campo paso a paso.',
        },
        // --- DENTRO DEL MODAL DE PRODUCTO ---
        {
            targetId: 'product-name',
            title: '✏️ Nombre del Producto',
            text: 'Escribe el nombre como quieres que aparezca en el catálogo. Ejemplo: "Coca-Cola 2L", "Polar Pilsen", "Agua 500ml".',
            beforeShow: () => { openProductModal(); }
        },
        {
            targetId: 'product-category',
            title: '🏷️ Categoría',
            text: 'Elige la categoría. Esto agrupa tus productos en el catálogo para que el cajero los encuentre más rápido.',
        },
        {
            targetId: 'product-stock',
            title: '📊 Stock Actual',
            text: 'Pon cuántas unidades tienes ahora mismo. Cada vez que vendas una, el sistema lo descuenta automáticamente.',
        },
        {
            targetId: 'product-cost-price',
            title: '💵 Costo de Compra (USD)',
            text: '¿Cuánto te costó comprarlo al proveedor? Esto es CLAVE para que el sistema calcule tu ganancia REAL por cada venta.',
        },
        {
            targetId: 'product-price-ves',
            title: '🇻🇪 Precio de Venta en Bolívares',
            text: 'El precio al que le vendes al cliente en Bolívares. Puedes presionar el ⚡ para calcularlo automáticamente desde el precio en dólares.',
        },
        {
            targetId: 'product-price-usd',
            title: '💲 Precio de Venta en Dólares',
            text: 'El precio en dólares. Si pones uno de los dos (Bs o USD), el otro se puede calcular con el ⚡ según la tasa del día.',
        },
        {
            targetId: 'product-form',
            title: '💾 ¡Guarda tu Producto!',
            text: 'Cuando llenes todos los campos, presiona "Guardar Producto" abajo. Aparecerá inmediatamente en tu inventario y en el catálogo del POS.',
            beforeShow: () => { closeProductModal(); }
        },

        // ====== BLOQUE 2: PUNTO DE VENTA ======
        {
            targetId: 'nav-pos',
            title: '🛒 El Punto de Venta',
            text: 'Ya sabes crear productos. Ahora aprende a VENDERLOS. Te llevo al catálogo.',
            beforeShow: () => window.switchView('view-pos')
        },
        {
            targetId: 'search-product',
            title: '🔎 Busca el Producto',
            text: 'Escribe las primeras letras del nombre. Las tarjetas se filtran al instante. Toca una para añadirla al carrito.',
        },
        {
            targetId: 'show-checkout-btn',
            title: '💰 Cobra al Cliente',
            text: 'Presiona "Pagar Ahora". Se abrirá la ventana de cobro donde eliges: Efectivo USD 💵, Bolívares 🇻🇪, Pago Móvil 📱 o Punto de Venta 💳. El ticket se imprime solo.',
        },

        // ====== BLOQUE 3: CLIENTES Y FIAOS ======
        {
            targetId: 'nav-clients',
            title: '👥 Tus Clientes',
            text: 'Guarda los datos de tus clientes frecuentes. Así sus ventas quedan registradas con nombre y cédula.',
            beforeShow: () => window.switchView('view-clients')
        },
        {
            targetId: 'nav-credits',
            title: '📋 Los Fiaos',
            text: 'Si alguien te dice "te pago después", registra la venta como Fiado. Aquí verás todas las deudas pendientes y puedes marcarlas como pagadas.',
            beforeShow: () => window.switchView('view-credits')
        },

        // ====== BLOQUE 4: GASTOS ======
        {
            targetId: 'nav-expenses',
            title: '💸 Tus Gastos',
            text: 'Registra alquiler, luz, hielo, empleados... Todo lo que gastas. Así los reportes te dicen cuánto GANASTE de verdad, no solo cuánto entró.',
            beforeShow: () => window.switchView('view-expenses')
        },

        // ====== BLOQUE 5: CIERRE DE CAJA ======
        {
            targetId: 'nav-reports',
            title: '📊 Reporte del Día',
            text: 'Aquí ves TODO lo que vendiste hoy desglosado por método de pago. Es tu caja en tiempo real.',
            beforeShow: () => window.switchView('view-reports')
        },
        {
            targetId: 'clear-reports-btn',
            title: '🧾 CERRAR LA CAJA',
            text: '¡LO MÁS IMPORTANTE! Al terminar el turno, presiona aquí. Se genera el Reporte Z, se envía por WhatsApp al jefe, y la caja queda limpia para mañana.',
        },

        // ====== BLOQUE 6: HERRAMIENTAS PRO ======
        {
            targetId: 'nav-purchases',
            title: '🤖 Escáner IA de Facturas',
            text: 'Toma una foto de la factura de tu proveedor. La IA lee los productos, precios de costo y actualiza todo tu inventario automáticamente. ¡Magia pura!',
            beforeShow: () => window.switchView('view-purchases')
        },
        {
            targetId: 'nav-analytics',
            title: '📈 Rendimiento del Negocio',
            text: 'Gráficos de ventas, ganancias y gastos por día. Sabrás exactamente cuánto dinero estás generando DE VERDAD.',
            beforeShow: () => window.switchView('view-analytics')
        },
        {
            targetId: 'nav-help',
            title: '📖 Guía de Ayuda',
            text: '¡Último paso! Si se te olvida algo, aquí tienes una guía completa con instrucciones para cada función. ¡Ya eres un experto en Caja Fresh! 🏆',
            beforeShow: () => window.switchView('view-help')
        }
    ];

    window.TutorialEngine.startTour(steps);
};

window.resetTutorial = () => {
    localStorage.removeItem('puntopila_master_tour_done');
    onboardingState = { welcome: false, sidebar: false, pos: false, scanner: false, analytics: false, server: false };
    saveOnboarding();
    window.startMasterTour();
};

window.skipTutorial = () => {
    if (window.TutorialEngine) {
        window.TutorialEngine.hide();
        localStorage.setItem('puntopila_master_tour_done', 'true');
    }
};

// NUEVO: Actualizar información de la licencia en la UI
window.updateTrialInfo = async () => {
    const infoBox = document.getElementById('trial-info-box');
    const daysCountEl = document.getElementById('trial-days-left-count');
    
    if (!infoBox || !daysCountEl) return;
    
    try {
        const result = await window.electronAPI.getLicenseStatus();
        if (result && result.valid) {
            const daysLeft = result.daysLeft !== null ? result.daysLeft : 0;
            const isTrial = result.isTrial;
            
            // 1. Mostrar días restantes (Grande)
            daysCountEl.textContent = daysLeft;
            
            // 2. Colores de advertencia si quedan pocos días
            if (daysLeft <= 7) {
                infoBox.classList.add('from-amber-50', 'to-orange-50', 'border-amber-200');
                daysCountEl.classList.add('text-orange-600');
            } else {
                infoBox.classList.remove('from-amber-50', 'to-orange-50', 'border-amber-200');
                daysCountEl.classList.remove('text-orange-600');
            }
            
            // 3. Lógica Diferenciada: Trial vs Activo
            const titleEl = infoBox.querySelector('h4');
            const statusLabel = infoBox.querySelector('p.text-brand-500');
            const subtitleEl = infoBox.querySelector('p.text-slate-500');
            const btnEl = infoBox.querySelector('button');

            if (isTrial) {
                let trialExpiryStr = '...';
                if (result.expiry) {
                    const date = new Date(result.expiry);
                    trialExpiryStr = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
                }

                if (statusLabel) statusLabel.textContent = 'Estado: Período de Prueba';
                if (titleEl) titleEl.innerHTML = `<span id="trial-days-left-count" class="text-brand-600 font-black">${daysLeft}</span> Días restantes`;
                if (subtitleEl) subtitleEl.innerHTML = `<span class="font-black text-slate-700">El período de prueba vence el:</span> ${trialExpiryStr}`;
                if (btnEl) btnEl.classList.remove('hidden');
            } else {
                // Formatear fecha de expiración/próximo pago
                let nextPaymentStr = 'Pendiente';
                if (result.expiry) {
                    const date = new Date(result.expiry);
                    nextPaymentStr = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
                } else {
                    const yearFromNow = new Date();
                    yearFromNow.setFullYear(yearFromNow.getFullYear() + 1);
                    nextPaymentStr = `${yearFromNow.getDate().toString().padStart(2, '0')}/${(yearFromNow.getMonth() + 1).toString().padStart(2, '0')}/${yearFromNow.getFullYear()}`;
                }

                if (statusLabel) statusLabel.textContent = 'Estado: Licencia Activa';
                if (titleEl) titleEl.innerHTML = `<i class="fas fa-check-circle text-emerald-500 mr-2"></i> Punto Pila POS Activado`;
                if (subtitleEl) subtitleEl.innerHTML = `<span class="font-black text-slate-700">Próximo pago:</span> ${nextPaymentStr} <span class="ml-2 text-[9px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full uppercase italic">Renovación Anual</span>`;
                if (btnEl) btnEl.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error('Error actualizando info de licencia:', e);
    }
};

/** Lógica de Tutorial por Vista — DESACTIVADA: Todo unificado en el Recorrido Maestro */
window.handleViewTutorial = function(viewId) {
    // Ya no se usan tutoriales individuales por sección.
    // Todo está unificado en window.startMasterTour()
};

window.logoutWhatsApp = async () => {
    const result = await Swal.fire({
        title: '¿Reiniciar conexión?',
        text: 'Esto cerrará la sesión actual de WhatsApp y generará un nuevo código QR para escanear. Úsalo si tienes problemas para conectar.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, generar QR nuevo',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        Swal.fire({
            title: 'Limpiando sesión...',
            text: 'Por favor espera unos segundos...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        await window.electronAPI.logoutWhatsApp();
        setTimeout(() => {
            Swal.fire('Sesión Limpia', 'El motor se está reiniciando. En unos segundos aparecerá el nuevo QR.', 'success');
        }, 2000);
    }
};

function saveAuditLogs() {
    // Mantener solo los últimos 500 registros para evitar pesadez en localStorage
    if (auditLogs.length > 500) auditLogs = auditLogs.slice(-500);
    tenantSet('freshpos_audit_logs', JSON.stringify(auditLogs));
}

function logAction(type, description, details = null) {
    const log = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        role: currentRole,
        type: type, // e.g., 'PRODUCT_DELETE', 'PRICE_CHANGE', 'SALE_VOID'
        description: description,
        details: details
    };
    auditLogs.push(log);
    saveAuditLogs();
    console.log(`[AUDIT] ${type}: ${description}`);
}

// Función Global de Emergencia para la Campana (Accesible siempre)
window.openMobileOrdersPanel = () => {
    console.log("Abriendo panel de pedidos móviles...");
    const panel = document.getElementById('incoming-orders-panel');
    const badge = document.getElementById('bell-badge');
    if (panel) {
        panel.classList.add('orders-panel-open');
        if (badge) {
            badge.classList.add('hidden');
            badge.textContent = '0';
        }
    } else {
        console.error("Error: No se encontró el panel 'incoming-orders-panel'");
    }
};

window.closeMobileOrdersPanel = () => {
    const panel = document.getElementById('incoming-orders-panel');
    if (panel) panel.classList.remove('orders-panel-open');
};

// --- Sistema de Verificación Manual de Licencia (Para pruebas de REVOKED) ---
window.syncLicenseStatus = async () => {
    console.log('[DEBUG] Iniciando sincronización de licencia...');
    const icon = document.getElementById('sync-lic-icon');
    if (icon) icon.classList.add('fa-spin');

    try {
        if (!window.electronAPI || !window.electronAPI.licenseForceCheck) {
            throw new Error('La API de Electron no está lista. Por favor, reinicia la app.');
        }

        const result = await window.electronAPI.licenseForceCheck();
        console.log('[DEBUG] Resultado sync:', result);
        
        if (result.valid) {
            Swal.fire({
                title: 'Licencia Sincronizada',
                text: `Todo en orden. Cliente: ${result.clientName}`,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            const motivos = {
                'REVOKED': 'Licencia Suspendida por el proveedor.',
                'EXPIRED': 'Tu licencia ha vencido.',
                'SIN_INTERNET': 'No se pudo contactar al servidor. Revisa tu internet.',
                'MACHINE_MISMATCH': 'Error de identidad de equipo.'
            };
            
            Swal.fire({
                title: 'Estado de Licencia',
                text: motivos[result.reason] || `Código: ${result.reason}`,
                icon: result.reason === 'SIN_INTERNET' ? 'warning' : 'error'
            });
        }
    } catch (err) {
        console.error('Error sincronizando licencia:', err);
        Swal.fire({
            title: 'Error de Conexión',
            text: 'No se pudo completar la sincronización. Asegúrate de haber REINICIADO la app desde cero.',
            icon: 'error'
        });
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
};

let mobileOrdersQueue = [];
let mobilePaymentsRegistry = [];
let settings = {
    exchangeRate: 480.00,
    euroRate: 510.00,
    appName: 'Caja Fresh',
    companyName: 'Caja Fresh POS',
    companyFooter: 'Caja Fresh 2026 | Gestión Inteligente',
    ticketFontSize: 10,
    autoPrint: false,
    mobileTitle: 'PUNTO PILA',
    mobileColor: '#2563eb',
    mobileBg: '',
    mobileBgOpacity: 100,
    mobileBgBlur: 0,
    ngrokAuthToken: '',
    ngrokDomain: '',
    launcherUrl: '',
    googleSheetId: '',   // ID del Google Sheet público para validar códigos de membresía
    storeId: '',        // ID único de sucursal — ej: "panaderia_delicias_catia"
    branchName: ''      // Nombre legible — ej: "Sede Principal"
};


// Migra automáticamente las llaves legacy al namespace del tenant actual
function migrateLegacyToTenant() {
    const sid = settings.storeId;
    if (!sid) return; // Sin storeId, no hay nada que migrar

    const keysToMigrate = [
        'freshpos_products', 'freshpos_sales', 'freshpos_clients',
        'freshpos_expenses', 'freshpos_payables', 'freshpos_suppliers',
        'freshpos_purchases_log', 'freshpos_history', 'freshpos_audit_logs',
        'freshpos_categories', 'freshpos_ticket'
    ];

    let migrated = 0;
    keysToMigrate.forEach(key => {
        const legacyVal = localStorage.getItem(key);
        const namespacedKey = `${key}_${sid}`;
        // Solo migrar si hay datos legacy Y no existe ya el namespace
        if (legacyVal !== null && localStorage.getItem(namespacedKey) === null) {
            localStorage.setItem(namespacedKey, legacyVal);
            migrated++;
        }
    });

    if (migrated > 0) {
        console.log(`[TENANT] ✅ Migrados ${migrated} almacenes de datos al namespace: ${sid}`);
    }
}

const TAX_RATE = 0; // IVA Eliminado globalmente en v16
let currentTicketNumber = parseInt(tenantGet('freshpos_ticket')) || 1;
let autoCloseTimer = null;
let currentRole = 'admin';
let searchTerm = '';
let inventorySearchTerm = '';
let currentCategory = 'Todos';

// Initial Seed Data (Precios internos en USD, UI muestra base VES)


const INITIAL_DATA_PRODUCTS = [
    { id: 'p_1', name: 'Coca-Cola Clásica Lata', category: 'Gaseosas', price: 1.50, costPrice: 0.80, stock: 45, img: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_2', name: 'Agua Mineral Evian', category: 'Aguas', price: 2.00, costPrice: 1.10, stock: 30, img: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4c?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_3', name: 'Jugo de Naranja Natural', category: 'Jugos', price: 2.50, costPrice: 1.50, stock: 15, img: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_4', name: 'Papas Fritas Lays 150g', category: 'Snacks', price: 1.80, costPrice: 0.90, stock: 50, img: 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_5', name: 'Galletas Oreo Original', category: 'Snacks', price: 1.20, costPrice: 0.60, stock: 80, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_6', name: 'Cerveza Corona Extra', category: 'Licores', price: 2.50, costPrice: 1.20, stock: 60, img: 'https://images.unsplash.com/photo-1614316049964-67258db54637?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_7', name: 'Café Expreso Doble', category: 'Cafetería', price: 2.00, costPrice: 0.50, stock: 99, img: 'https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_8', name: 'Croissant de Mantequilla', category: 'Panadería', price: 1.50, costPrice: 0.40, stock: 25, img: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_9', name: 'Helado de Vainilla y Fresa', category: 'Postres', price: 3.00, costPrice: 1.20, stock: 20, img: 'https://images.unsplash.com/photo-1570197571499-166b36435e9f?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_10', name: 'Sándwich de Jamón y Queso', category: 'Comida Rápida', price: 4.50, costPrice: 2.00, stock: 12, img: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&q=80&w=400' }
];
const INITIAL_DATA_CLIENTS = [
    { id: 'c_1', document: 'V-12345678', name: 'Cliente Frecuente', phone: '0414-1234567' }
];

// Formatting Utils
const formatUSD = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount);
const formatVES = (amount) => {
    return new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES', minimumFractionDigits: 2 }).format(amount).replace('Bs.S', 'Bs');
};
const formatEUR = (amount) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(amount);
const padTicketNumber = (num) => num.toString().padStart(4, '0');
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

/**
 * Normaliza un número de teléfono venezolano al formato internacional.
 * 04141006858 → 584141006858
 * 584141006858 → 584141006858 (ya está bien)
 * +584141006858 → 584141006858
 */
function normalizeVEPhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, ''); // Solo dígitos
    // Si empieza con 0 (formato local venezolano), reemplazar por 58
    if (cleaned.startsWith('0')) {
        cleaned = '58' + cleaned.substring(1);
    }
    // Si no empieza con 58, asumimos que falta el código de país
    if (!cleaned.startsWith('58') && cleaned.length === 10) {
        cleaned = '58' + cleaned;
    }
    return cleaned;
}

const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};


// NEW: Helper for dual price fields
// NEW: Helper for dual/triple price fields with real-time preview
window.updatePricePreviews = () => {
    const usdRate = settings.exchangeRate || 36.50;
    const eurRate = settings.euroRate || 40.00;
    
    const ves = parseFloat(document.getElementById('product-price-ves').value) || 0;
    const usd = parseFloat(document.getElementById('product-price-usd').value) || 0;
    const eur = parseFloat(document.getElementById('product-price-eur').value) || 0;

    const vesLabel = document.getElementById('preview-ves-conv');
    const usdLabel = document.getElementById('preview-usd-conv');
    const eurLabel = document.getElementById('preview-eur-conv');

    if (vesLabel) vesLabel.textContent = ves > 0 ? `${formatUSD(ves / usdRate)} | ${formatEUR(ves / eurRate)}` : '';
    if (usdLabel) usdLabel.textContent = usd > 0 ? `${formatVES(usd * usdRate)} | ${formatEUR((usd * usdRate) / eurRate)}` : '';
    if (eurLabel) eurLabel.textContent = eur > 0 ? `${formatVES(eur * eurRate)} | ${formatUSD((eur * eurRate) / usdRate)}` : '';
};

window.suggestPrice = (target) => {
    const usdRate = settings.exchangeRate || 36.50;
    const eurRate = settings.euroRate || 40.00;
    const vesInput = document.getElementById('product-price-ves');
    const usdInput = document.getElementById('product-price-usd');
    const eurInput = document.getElementById('product-price-eur');

    if (target === 'VES') {
        const usdVal = parseFloat(usdInput.value) || 0;
        const eurVal = parseFloat(eurInput.value) || 0;
        if (usdVal > 0) vesInput.value = (Math.round((usdVal * usdRate) / 10) * 10).toFixed(2);
        else if (eurVal > 0) vesInput.value = (Math.round((eurVal * eurRate) / 10) * 10).toFixed(2);
    } else if (target === 'USD') {
        const vesVal = parseFloat(vesInput.value) || 0;
        if (vesVal > 0) usdInput.value = (vesVal / usdRate).toFixed(2);
    } else if (target === 'EUR') {
        const vesVal = parseFloat(vesInput.value) || 0;
        if (vesVal > 0) eurInput.value = (vesVal / eurRate).toFixed(2);
    }
    window.updatePricePreviews();
};

let ocrDetectedItems = [];

// ==========================================
// SETUP WIZARD (Primera Configuración)
// ==========================================
let wizardCurrentStep = 1;
const WIZARD_TOTAL_STEPS = 5;

window.wizardNext = () => {
    if (wizardCurrentStep >= WIZARD_TOTAL_STEPS) return;
    wizardCurrentStep++;
    updateWizardUI();
};

window.wizardBack = () => {
    if (wizardCurrentStep <= 1) return;
    wizardCurrentStep--;
    updateWizardUI();
};

function updateWizardUI() {
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.add('hidden'));
    const active = document.querySelector(`.wizard-step[data-step="${wizardCurrentStep}"]`);
    if (active) active.classList.remove('hidden');
    const bar = document.getElementById('wizard-progress');
    if (bar) bar.style.width = `${(wizardCurrentStep / WIZARD_TOTAL_STEPS) * 100}%`;
    
    // Pre-fill summary on last step
    if (wizardCurrentStep === 5) {
        const name = document.getElementById('wizard-company')?.value || 'Mi Negocio';
        const summary = document.getElementById('wizard-summary');
        if (summary) summary.textContent = `"${name}" está configurado y listo para operar.`;
    }
}

window.wizardFinish = () => {
    // Save all wizard data
    const companyName = document.getElementById('wizard-company')?.value?.trim() || 'Mi Negocio';
    const bossPhone = document.getElementById('wizard-phone')?.value?.trim() || '';
    const rate = parseFloat(document.getElementById('wizard-rate')?.value) || 36.50;
    
    // Update settings
    settings.companyName = companyName;
    settings.appName = companyName;
    settings.companyFooter = `${companyName} | Gestión Inteligente POS`;
    settings.bossPhone = bossPhone;
    settings.exchangeRate = rate;
    saveSettings();
    
    // Update UI elements
    const h1 = document.getElementById('main-brand-logo');
    if (h1) h1.innerHTML = companyName.replace('POS', '<span class="text-brand-600">POS</span>');
    const rateInput = document.getElementById('exchange-rate-input');
    if (rateInput) rateInput.value = rate;
    
    // Save selected categories
    const checks = document.querySelectorAll('#wizard-categories input[type="checkbox"]:checked');
    if (checks.length > 0) {
        categories = Array.from(checks).map(c => c.value);
        saveCategories();
        if (typeof window.renderCategoryOptions === 'function') window.renderCategoryOptions();
    }
    
    // Mark wizard as done
    localStorage.setItem('freshpos_wizard_done', 'true');
    
    // Hide wizard
    document.getElementById('setup-wizard')?.classList.add('hidden');
    
    // Render everything with new data
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof renderInventory === 'function') renderInventory();
};

function showSetupWizard() {
    const wizard = document.getElementById('setup-wizard');
    if (wizard) {
        wizardCurrentStep = 1;
        updateWizardUI();
        wizard.classList.remove('hidden');
    }
}

// ==========================================
// DASHBOARD DATA SYNC (for remote dashboard)
// ==========================================
function syncDashboardData() {
    if (!window.electronAPI?.send) return;
    
    // Obtener fecha local YYYY-MM-DD
    const d = new Date();
    const todayStr = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    
    // Filtrar ventas de hoy con mayor tolerancia
    const todaySales = sales.filter(s => {
        if (!s.date) return false;
        return s.date.includes(todayStr);
    });

    let totalUSD = 0;
    let totalVES = 0;
    let totalCostUSD = 0;
    let itemsCount = 0;

    todaySales.forEach(s => {
        // Revenue: preferir totalUSD, luego total, luego sumar items
        let sUSD = Number(s.totalUSD) || Number(s.total) || 0;
        if (sUSD === 0 && s.items) {
            sUSD = s.items.reduce((sum, i) => sum + (Number(i.totalPriceUSD) || 0), 0);
        }
        totalUSD += sUSD;
        totalVES += Number(s.totalVES) || 0;

        // Cost: preferir totalCostUSD, luego calcular de items
        let sCost = Number(s.totalCostUSD) || 0;
        if (sCost === 0 && s.items) {
            sCost = s.items.reduce((sum, i) => {
                const cost = Number(i.costPrice) || Number(i.cost) || 0;
                return sum + (cost * (i.qty || 1));
            }, 0);
        }
        totalCostUSD += sCost;
        
        itemsCount += (Array.isArray(s.items) ? s.items.reduce((a, i) => a + (Number(i.qty) || 0), 0) : 0);
    });

    const lowStock = products.filter(p => p.stock <= (p.minStock || 5) && p.stock > 0);
    const outOfStock = products.filter(p => p.stock <= 0);
    
    const dashData = {
        companyName: settings.companyName || 'POS',
        mobileTitle: settings.mobileTitle || '',
        companyFooter: settings.companyFooter || '',
        exchangeRate: settings.exchangeRate,
        today: {
            totalVES, 
            totalUSD,
            tickets: todaySales.length,
            items: itemsCount,
            totalCostUSD: totalCostUSD
        },
        recentSales: todaySales.slice(-5).reverse().map(s => ({
            ticket: s.ticket,
            time: s.date ? s.date.split('T')[1].slice(0, 5) : '--:--',
            client: s.client?.name || 'Cliente',
            totalUSD: Number(s.totalUSD) || 0,
            items: (s.items || []).map(i => i.name).join(', ')
        })),
        alerts: {
            lowStock: lowStock.map(p => ({ name: p.name, stock: p.stock, min: p.minStock || 5 })),
            outOfStock: outOfStock.map(p => ({ name: p.name }))
        },
        inventory: {
            total: products.length,
            totalValue: products.reduce((acc, p) => acc + (p.stock * (p.priceUSD || 0)), 0)
        }
    };
    
    window.electronAPI.send('dashboard-data', dashData);
}

// Initialize System
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 Iniciando Sistema Caja Fresh POS...");
    
    const splash = document.getElementById('splash-screen');
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');

    // 1. SECUENCIA DE SALIDA (FALLBACK DE EMERGENCIA)
    // Forzar desaparición si algo falla catastróficamente
    const forceExitTimeout = setTimeout(() => {
        if (splash) {
            console.warn("⚠️ Aplicando salida de emergencia del Splash Screen...");
            splash.classList.add('splash-exit');
            if (aside) aside.classList.remove('initial-hidden');
            if (main) main.classList.remove('initial-hidden');
            setTimeout(() => { splash.style.display = 'none'; }, 1000);
        }
    }, 3000);

    // 2. FUNCIÓN DE REVELACIÓN (ÉXITO)
    const revealInterface = () => {
        console.log("✨ Revelando interfaz de usuario...");
        if (splash) splash.classList.add('splash-exit');
        
        // Entrada escalonada
        setTimeout(() => { if (aside) { aside.classList.remove('initial-hidden'); aside.classList.add('animate-entrance'); } }, 300);
        setTimeout(() => { if (main) { main.classList.remove('initial-hidden'); main.classList.add('animate-entrance'); } }, 500);
        setTimeout(() => {
            if (splash) splash.style.display = 'none';
            // License check silently in background, no blocking overlays
            if (window.LicenseManager) {
                (async function() {
                    try {
                        var lm = window.LicenseManager;
                        var machineId = lm.generateMachineId();
                        await lm.checkAndRegister({ machineId: machineId, appId: lm.generateAppId(), deviceName: lm.getDeviceName() || 'PC Principal', userType: settings.storeType || 'negocio' });
                        var status = await lm.checkLicense(machineId);
                        lm.updateSidebarIndicator(status.status);
                        setInterval(function() { lm.heartbeat(machineId); }, 30 * 60 * 1000);
                        lm.heartbeat(machineId);
                    } catch (e) { console.warn('[LICENSE] Error:', e.message); }
                })();
            }
        }, 1500);
    };

    // 3. CARGA DE MÓDULOS (AISLADA)
    try {
        // Bloque 1: Datos Base (Crítico)
        try {
            await loadData();
            initTheme();

            // Auto-create default admin user if none exist
            await ensureAdminUser();
            await ensureJoseUsers();

            // Auto-configure Cloud Sync if credentials exist
            const activeSid = _getStoreId();
            if (window.cloudSync && settings.supabaseUrl && settings.supabaseKey && activeSid) {
                console.log('[CloudSync] Auto-configurando con:', activeSid);
                window.cloudSync.configure({
                    supabaseUrl: settings.supabaseUrl,
                    supabaseKey: settings.supabaseKey,
                    storeId: activeSid,
                    storeName: settings.storeName || settings.branchName || 'Sucursal'
                });
            }
        } catch(e) { console.error("Fallo en Carga de Datos:", e); }

        // Bloque 2: Componentes Core (Aislados)
        const runInit = (name, fn) => {
            try { fn(); } catch(e) { console.error(`Fallo en ${name}:`, e); }
        };

        runInit("Navegación", initNavigation);
        runInit("POS", initPOS);
        runInit("Inventario", initInventory);
        runInit("Clientes", initClients);
        runInit("Checkout", initCheckout);
        runInit("Compras", initPurchases);

        // Bloque 3: Servicios y Sync
        try {
            initMobileServer();
            initSettingsAndAutoClose();
            updateCartUI();
            renderReports();
            initSettingsView();
            initClientSearch();
        } catch(e) { console.error("Fallo en Servicios:", e); }

        // Auto-updater
        try { if (window.UpdateManager && window.UpdateManager.init) window.UpdateManager.init(); }
        catch(e) { console.error("Fallo en auto-updater:", e); }

        // 4. EJECUTAR REVELACIÓN
        setTimeout(() => {
            clearTimeout(forceExitTimeout);
            revealInterface();
            
            // Sincronización secundaria
            if (window.isWhatsappAutomatedReady) syncProductsToMobile();
            
            // WIZARD: Mostrar si es la primera vez
            if (!localStorage.getItem('freshpos_wizard_done')) {
                setTimeout(() => showSetupWizard(), 1200);
            }

            // TRIAL INFO: Actualizar días restantes en configuración
            window.updateTrialInfo();
            
            // DASHBOARD SYNC: Enviar datos cada 60s
            syncDashboardData();
            setInterval(syncDashboardData, 60000);

            // Sincronización automática de tasa de cambio al inicio (3s después de cargar)
            setTimeout(() => {
                if (typeof fetchDailyRate === 'function') {
                    fetchDailyRate(true).catch(err => console.error("Error al sincronizar tasa en inicio:", err));
                }
            }, 3000);
        }, 800);

        // Persistir estado del cierre al cerrar/recargar
        window.addEventListener('beforeunload', () => {
            try {
                const pm = document.getElementById('cierre-count-pm')?.value;
                const card = document.getElementById('cierre-count-card')?.value;
                if (pm || card) {
                    localStorage.setItem('freshpos_last_cierre_state', JSON.stringify({
                        date: new Date().toISOString().split('T')[0],
                        'cierre-count-pm': pm || '0',
                        'cierre-count-card': card || '0'
                    }));
                }
            } catch(e) {}
        });

        // 5. ONBOARDING (Opcional — desactivado)
        onboardingState.welcome = true;
    } catch (criticalErr) {
        console.error("❌ ERROR CRÍTICO TOTAL:", criticalErr);
        clearTimeout(forceExitTimeout);
        revealInterface(); // Revelar incluso si falló para que el usuario vea el mensaje de error de window.onerror
    }
});

// Theme Logic
function initTheme() {
    const isDark = localStorage.getItem('freshpos_theme') === 'dark';
    if (isDark) document.documentElement.classList.add('dark');

    document.getElementById('theme-toggle-btn').addEventListener('click', () => {
        const root = document.documentElement;
        root.classList.toggle('dark');
        const nowDark = root.classList.contains('dark');
        localStorage.setItem('freshpos_theme', nowDark ? 'dark' : 'light');
        document.getElementById('theme-icon').className = nowDark ? 'fas fa-sun text-xl group-hover:scale-110 transition-transform' : 'fas fa-moon text-xl group-hover:scale-110 transition-transform';
    });

    // Set initial icon
    document.getElementById('theme-icon').className = isDark ? 'fas fa-sun text-xl group-hover:scale-110 transition-transform' : 'fas fa-moon text-xl group-hover:scale-110 transition-transform';

    // Color Theme Logic
    const colorPickerBtns = document.querySelectorAll('.color-picker-btn');
    const savedTheme = localStorage.getItem('freshpos-color-theme') || 'blue';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    function updateActiveThemeButton(theme) {
        colorPickerBtns.forEach(btn => {
            if (btn.getAttribute('data-theme') === theme) {
                btn.style.opacity = '1';
                btn.classList.add('ring-2', 'ring-brand-500', 'ring-offset-2', 'dark:ring-offset-slate-900');
                btn.classList.remove('opacity-50');
            } else {
                btn.style.opacity = '0.5';
                btn.classList.remove('ring-2', 'ring-brand-500', 'ring-offset-2', 'dark:ring-offset-slate-900');
                btn.classList.add('opacity-50');
            }
        });
    }
    
    updateActiveThemeButton(savedTheme);

    colorPickerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('freshpos-color-theme', theme);
            updateActiveThemeButton(theme);
        });
    });
}

async function loadData() {
    let loadTimedOut = false;
    const loadTimeout = setTimeout(() => {
        loadTimedOut = true;
        console.warn('[loadData] Timeout alcanzado, continuando con defaults locales');
    }, 4000);

    const guard = () => {
        if (loadTimedOut) {
            if (!loadTimeout._cleared) { clearTimeout(loadTimeout); loadTimeout._cleared = true; }
            return true;
        }
        return false;
    };

    // GUARD: Bloquear carga si no hay un tenant detectado en producción web
    const isWeb = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    const isElectron = typeof window.electronAPI !== 'undefined' || navigator.userAgent.toLowerCase().includes('electron');
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isWeb && !isElectron && !isLocalhost) {
        if (window.FRESH_TENANT && !window.FRESH_TENANT.isDetected) {
            console.error("🛑 ACCESO DENEGADO: No se detectó una sucursal válida en el dominio.");
            Swal.fire({
                icon: 'error',
                title: 'Sucursal No Encontrada',
                text: 'La URL ingresada no corresponde a una sucursal activa. Por favor contacta al administrador.',
                allowOutsideClick: false,
                showConfirmButton: false
            });
            return; // Detener carga
        }
    }

    // AUTO-SYNC CONFIG WITH ELECTRON BACKEND ON STARTUP
    if (window.cloudSync) {
        try {
            if (guard()) return;
            const status = await window.cloudSync.getStatus();
            if (status && status.enabled && status.storeId) {
                const localCfg = JSON.parse(localStorage.getItem('freshpos_settings') || '{}');
                if (localCfg.storeId !== status.storeId || localCfg.supabaseUrl !== status.url || localCfg.supabaseKey !== status.supabaseKey) {
                    console.log(`[CLOUD-SYNC] Sincronizando configuración local con backend. StoreId: ${status.storeId}`);
                    localCfg.storeId = status.storeId;
                    localCfg.supabaseUrl = status.url;
                    localCfg.supabaseKey = status.supabaseKey || localCfg.supabaseKey;
                    if (status.storeName) localCfg.storeName = status.storeName;
                    if (status.brandName) localCfg.brandName = status.brandName;
                    localStorage.setItem('freshpos_settings', JSON.stringify(localCfg));
                    
                    // Asegurar que la variable global de settings cargue estos datos nuevos
                    if (typeof settings !== 'undefined') {
                        settings = { ...settings, ...localCfg };
                    }
                }
            }
        } catch (e) {
            console.error('[CLOUD-SYNC] Error sincronizando storeId desde el backend:', e);
        }
    }

    const sid = _getStoreId();
    
    if (window.db) {
        if (!localStorage.getItem(`freshpos_db_migrated_${sid}`)) {
            console.log(`[TENANT] Migrando de localStorage a SQLite para: ${sid}...`);
            const legacyData = {
                products: JSON.parse(tenantGet('freshpos_products')) || [],
                clients: JSON.parse(tenantGet('freshpos_clients')) || []
            };
            if (guard()) return;
            await window.db.migrateData(legacyData);
            localStorage.setItem(`freshpos_db_migrated_${sid}`, 'true');
        }
        
        try {
            if (guard()) return;
            let dbProducts = await window.db.getProducts();
            if (dbProducts && dbProducts.length > 0) {
                products = dbProducts.map(p => {
                    if (typeof p.category === 'string' && (p.category.startsWith('{') || p.category.startsWith('['))) {
                        try { p.category = JSON.parse(p.category); } catch(e){}
                    }
                    if (typeof p.flavors === 'string') {
                        try { p.flavors = JSON.parse(p.flavors); } catch(e){ p.flavors = []; }
                    }
                    if (!p.priceUSD && p.price) p.priceUSD = p.price;
                    p.featured = !!p.featured;
                    return p;
                });
            } else {
                let seedDone = await window.db.getMeta('seed_products_done');
                if (!seedDone) seedDone = localStorage.getItem('seed_products_done');
                if (!seedDone) {
                    products = [...INITIAL_DATA_PRODUCTS];
                    for (const p of products) { if (guard()) return; await window.db.saveProduct(p); }
                    await window.db.setMeta('seed_products_done', 'true');
                } else {
                    products = [];
                }
            }
            
            if (guard()) return;
            let dbSales = await window.db.getSales(500) || [];
            sales = dbSales.map(s => {
                if (typeof s.items === 'string') {
                    try { s.items = JSON.parse(s.items); } catch(e) { s.items = []; }
                }
                if (typeof s.client === 'string') {
                    try { s.client = JSON.parse(s.client); } catch(e) { s.client = { name: 'Cliente', document: 'V-000000' }; }
                }
                if (s.total && !s.totalVES) s.totalVES = s.total;
                if (s.total && !s.totalUSD) s.totalUSD = s.total / (s.exchangeRate || settings.exchangeRate || 36.5);
                return s;
            });
            
            if (guard()) return;
            let dbClients = await window.db.getClients();
            clients = (dbClients && dbClients.length > 0) ? dbClients : [...INITIAL_DATA_CLIENTS];
            if (clients === INITIAL_DATA_CLIENTS) {
                for (const c of clients) { if (guard()) return; await window.db.saveClient(c); }
            }
        } catch (err) {
            console.error("Error cargando DB, fallback:", err);
            products = JSON.parse(tenantGet('freshpos_products')) || [...INITIAL_DATA_PRODUCTS];
            sales    = JSON.parse(tenantGet('freshpos_sales'))    || [];
            clients  = JSON.parse(tenantGet('freshpos_clients'))  || [...INITIAL_DATA_CLIENTS];
        }
    } else {
        products = JSON.parse(tenantGet('freshpos_products')) || [...INITIAL_DATA_PRODUCTS];
        sales = JSON.parse(tenantGet('freshpos_sales')) || [];
        clients = JSON.parse(tenantGet('freshpos_clients')) || [...INITIAL_DATA_CLIENTS];
    }
    const defaultSettings = {
        exchangeRate: 36.50,
        appName: 'Punto Pila',
        companyName: 'Punto Pila POS',
        companyFooter: 'Punto Pila 2024 | Gestión Inteligente',
        ticketFontSize: 10,
        autoPrint: false,
        bossPhone: '',
        callmebotKey: '',
        adminPin: '3244',
        mobileTitle: 'PUNTO PILA',
        mobileColor: '#2563eb',
        mobileBg: '',
        euroRate: 480.00, // Añadido para persistencia
        launcherUrl: '',
        googleSheetId: ''
    };
    settings = { ...defaultSettings, ...(JSON.parse(localStorage.getItem('freshpos_settings')) || {}) };

    // Si hay un storeId guardado, migrar datos legacy al namespace del tenant
    if (settings.storeId) {
        migrateLegacyToTenant();
        // Re-cargar con namespace correcto
        if (!window.db) {
            products = JSON.parse(tenantGet('freshpos_products')) || products;
            sales    = JSON.parse(tenantGet('freshpos_sales'))    || sales;
            clients  = JSON.parse(tenantGet('freshpos_clients'))  || clients;
        }
    }

    expenses   = JSON.parse(tenantGet('freshpos_expenses'))       || [];
    payables   = JSON.parse(tenantGet('freshpos_payables'))       || [];
    suppliers  = JSON.parse(tenantGet('freshpos_suppliers'))      || [];
    auditLogs  = JSON.parse(tenantGet('freshpos_audit_logs'))     || [];
    dailyHistory = JSON.parse(tenantGet('freshpos_history'))      || [];
    currentTicketNumber = parseInt(tenantGet('freshpos_ticket'))  || 1;


    // Migrate old product price structure to new dual price fields
    products = products.map(p => {
        if (p.price && !p.priceUSD && !p.priceVES) {
            p.priceUSD = p.price;
            p.priceVES = Math.round((p.price * settings.exchangeRate) / 10) * 10;
            delete p.price; // Remove old single price field
        }
        // Ensure priceUSD and priceVES are numbers, default to 0 if missing
        p.priceUSD = parseFloat(p.priceUSD) || 0;
        p.priceVES = parseFloat(p.priceVES) || 0;

        // NEW: Initialize minStock if missing
        if (p.minStock === undefined) p.minStock = 5;
        
        return p;
    });

    if (!tenantGet('freshpos_products')) saveProducts();
    if (!tenantGet('freshpos_clients')) saveClients();
    saveSettings();

    document.getElementById('exchange-rate-input').value = settings.exchangeRate;
    const eurRateInput = document.getElementById('euro-rate-input');
    if (eurRateInput) eurRateInput.value = settings.euroRate || 40.00;

    // Mostrar identidad de sucursal en la barra lateral
    renderStoreIdentityWidget();

    // Apply app name to header
    const h1 = document.getElementById('main-brand-logo');
    if (h1 && settings.appName) {
        h1.innerHTML = settings.appName.replace('POS', '<span class="text-brand-600">POS</span>');
    }

    // Update ticket template
    const ticketBrand = document.getElementById('branding-ticket-name');
    if (ticketBrand) ticketBrand.textContent = settings.companyName || 'Fresh POS';

    const ticketContainer = document.getElementById('print-ticket-container');
    if (ticketContainer) {
        const fs = (settings.ticketFontSize || 10) + 'px';
        document.documentElement.style.setProperty('--ticket-font-size', fs);
        ticketContainer.style.fontSize = fs;
        const footerEl = ticketContainer.querySelector('div.text-center:last-child');
        if (footerEl) {
            footerEl.innerHTML = `<span>${settings.companyFooter || ''}</span><br><span>¡Gracias por preferirnos!</span>`;
        }
    }

    // Ejecutar migración única del catálogo real del usuario basado en sus fotos
    (async () => {
        if (window.db && window.db.getMeta) {
            let done = await window.db.getMeta('migration_v38_2_done');
            if (!done) done = localStorage.getItem('migration_v38_2_done');
            if (!done) {
                migrateUserProducts();
                if (window.db.setMeta) await window.db.setMeta('migration_v38_2_done', 'true');
            }
            localStorage.removeItem('migration_v38_2_done');
        } else if (!localStorage.getItem('migration_v38_2_done')) {
            migrateUserProducts();
            localStorage.setItem('migration_v38_2_done', 'true');
        }
    })();
    if (window.electronAPI && window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(function(ver) {
            var el = document.getElementById('login-version');
            if (el) el.textContent = 'v' + ver;
        });
    }
    var overlay = document.getElementById('login-overlay');
    var savedUser = JSON.parse(localStorage.getItem('loggedUser') || 'null');
    
    if (savedUser) {
        (async () => {
            try {
                var userData = await window.db.getUser(savedUser.username);
                if (!userData && savedUser.id && savedUser.id.includes('master_test')) {
                    userData = savedUser;
                }
                if (userData && userData.active) {
                    currentUser = userData;
                    currentRole = userData.role;
                    if (overlay) overlay.classList.add('hidden');
                    var text = document.getElementById('role-text');
                    if (text) text.textContent = (userData.name || userData.username) + (userData.role === 'admin' ? ' (Admin)' : ' (Cajero)');
                    var badge = document.getElementById('role-status-badge');
                    if (badge) {
                        if (userData.role === 'admin') {
                            badge.className = 'absolute -bottom-1 -right-1 bg-brand-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center';
                            badge.innerHTML = '<i class="fas fa-crown text-[8px] text-white"></i>';
                        } else {
                            badge.className = 'absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center';
                            badge.innerHTML = '<i class="fas fa-check text-[8px] text-white"></i>';
                        }
                    }
                    if (userData.role === 'admin') {
                        var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
                        adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); });
                    }
                } else {
                    if (overlay) overlay.classList.remove('hidden');
                }
            } catch(e) { 
                console.error('[Auth] Error restoring session:', e); 
                if (overlay) overlay.classList.remove('hidden');
            }
        })();
    } else {
        // No hay sesión guardada (el usuario hizo logout previamente): Exigir Inicio de Sesión
        currentUser = null;
        currentRole = null;
        if (overlay) overlay.classList.remove('hidden');
        var text = document.getElementById('role-text');
        if (text) text.textContent = 'Sin Sesión';
        var badge = document.getElementById('role-status-badge');
        if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-slate-400 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-lock text-[8px] text-white"></i>'; }
        var adminNavs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
        adminNavs.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
        setTimeout(function() {
            var uInp = document.getElementById('login-username');
            if (uInp) uInp.focus();
        }, 300);
    }
    isInitialDataLoaded = true;
}

function migrateUserProducts() {
    const rawData = [
        { name: "7UP 1L", priceVES: 2100 },
        { name: "AGUA 1.5L", priceVES: 2890 },
        { name: "AGUA 500", priceVES: 2890 },
        { name: "AGUA 330", priceVES: 2790 },
        { name: "AGUA DE 5L", priceVES: 2180 },
        { name: "AGUA MINALBA GASIFICADA", priceVES: 7400 },
        { name: "AGUA NEV GAS", priceVES: 3490 },
        { name: "AGUA SABORISADA MI BRISA", priceVES: 3100 },
        { name: "BOTELLA 350", priceVES: 5700 },
        { name: "CHINOTO 1L", priceVES: 2190 },
        { name: "CHINOTO 2L", priceVES: 2490 },
        { name: "chinoto 400", priceVES: 5000 },
        { name: "COCA 2L", priceVES: 3890 },
        { name: "COCA 400", priceVES: 5190 },
        { name: "Coca cola 1L", priceVES: 2490 },
        { name: "coca cola lata", priceVES: 4990 },
        { name: "FANTA 1L", priceVES: 1990 },
        { name: "FANTA 2L", priceVES: 2490 },
        { name: "FRESCOLITA 1L", priceVES: 1990 },
        { name: "FRESCOLITA 2L", priceVES: 2490 },
        { name: "FRUTEA 600 ML", priceVES: 3190 },
        { name: "frutea mix 1.50", priceVES: 2790 },
        { name: "FRUTTSY", priceVES: 3600 },
        { name: "GATORADE", priceVES: 8190 },
        { name: "GLUP 1L", priceVES: 3690, flavors: ["FRESH", "MANZANA", "NEGRA", "UVA", "KOLITA"] },
        { name: "GLUP 2L", priceVES: 2890, flavors: ["FRESH", "KOLITA", "MANZANA", "NARANJA", "NEGRA", "UVA"] },
        { name: "GLUP 400", priceVES: 2590, flavors: ["MANZANA", "FRESH", "KOLITA", "NEGRA"] },
        { name: "GOLDE 2L", priceVES: 2890 },
        { name: "GOLDEN PIÑA 1L", priceVES: 1990 },
        { name: "JUGO PULPIN", priceVES: 1600 },
        { name: "JUGO VALLE 1.5L", priceVES: 2590 },
        { name: "JUSTY", priceVES: 5490, flavors: ["DURAZNO", "SANDIA", "MANDARINA", "NARANJA"] },
        { name: "PEPSI LATA", priceVES: 8990 },
        { name: "SPEED LATA", priceVES: 7590 },
        { name: "LECHE", priceVES: 14850 },
        { name: "LECHE SAN SIMON", priceVES: 13500 },
        { name: "LIPTON 500ML", priceVES: 10100 },
        { name: "MALTA LATA 18s", priceVES: 10290 },
        { name: "MALTA DESECHABLES 9S", priceVES: 4990 },
        { name: "MALTA GAVERA 15", priceVES: 8950 },
        { name: "MALTA LAT 250 PEQUEÑA", priceVES: 8190 },
        { name: "MALTÍN 1.5L", priceVES: 5290 },
        { name: "MANZANA GOLDEN 1L", priceVES: 1990 },
        { name: "NEVADA 1.50", priceVES: 2850 },
        { name: "pepsi 1L", priceVES: 2490 },
        { name: "PEPSI 1L MANGO", priceVES: 1970 },
        { name: "PEPSI 24", priceVES: 5700 },
        { name: "PEPSI 2L", priceVES: 3650 },
        { name: "POWER 1L", priceVES: 3990 },
        { name: "POWER 400ML", priceVES: 2800 },
        { name: "SILSA LECHE 1L", priceVES: 14850 },
        { name: "SODA", priceVES: 2590 },
        { name: "SOL AMADO 1.50", priceVES: 3650 },
        { name: "SOL AMADO 330", priceVES: 2850 },
        { name: "UFRESH 24", priceVES: 4890 },
        { name: "VACIOS MALTA COCA", priceVES: 2500 },
        { name: "VALENCIA 1L", priceVES: 5190 },
        { name: "VALLE 500 ML", priceVES: 3990 },
        { name: "YUKERI 250 ML", priceVES: 6190 },
        { name: "YUKERY 1.50", priceVES: 12490 },
        { name: "YUKYPARK 24 UN", priceVES: 10600 },
    ];

    const currentRate = settings.exchangeRate || 425.67;
    let addedCount = 0;
    let updatedCount = 0;

    // 1. Limpieza de variantes sueltas (Omitir sabores como productos individuales)
    const basesToConsolidate = ["GLUP 1L", "GLUP 2L", "GLUP 400", "JUSTY"];
    products = products.filter(p => {
        const pName = p.name.toUpperCase();
        // Si el nombre contiene una base de Sabores pero NO es exactamente la base, lo eliminamos
        const matchedBase = basesToConsolidate.find(base => pName.includes(base) && pName !== base);
        return !matchedBase;
    });

    rawData.forEach(item => {
        const targetPriceVES = item.priceVES;
        const targetPriceUSD = item.priceVES / currentRate;
        const targetCostUSD = targetPriceUSD * 0.75;

        let found = products.find(p => p.name.toLowerCase() === item.name.toLowerCase());

        if (!found) {
            found = products.find(p => p.name.toLowerCase().includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(p.name.toLowerCase()));
        }

        if (found) {
            found.priceVES = targetPriceVES;
            found.priceUSD = targetPriceUSD;
            if (!found.costPrice || found.costPrice === 0) found.costPrice = targetCostUSD;
            if (item.flavors) {
                found.flavors = item.flavors;
            }
            updatedCount++;
        } else {
            products.push({
                id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
                name: item.name.toUpperCase(),
                priceVES: targetPriceVES,
                priceUSD: targetPriceUSD,
                costPrice: targetCostUSD,
                stock: 0,
                category: 'Bebidas',
                subcategory: '',
                flavors: item.flavors || [],
                img: ''
            });
            addedCount++;
        }
    });

    // Limpiar productos de prueba iniciales
    const demoIds = ['p_1', 'p_2', 'p_3'];
    products = products.filter(p => !demoIds.includes(p.id));

    saveProducts();
    console.log(`Auto-Migración v38.2: ${updatedCount} actualizados, ${addedCount} nuevos.`);
}

function saveProducts() { 
    tenantSet('freshpos_products', JSON.stringify(products));
    if (window.db && window.db.saveProductsBulk) {
        window.db.saveProductsBulk(products).catch(e => console.error(e));
    }
    if (typeof syncProductsToMobile === 'function') syncProductsToMobile();
    if (window.cloudSync && typeof window.cloudSync.pushCatalog === 'function') {
        window.cloudSync.pushCatalog(products).catch(e => console.error('[CloudSync] Catalog push error:', e));
    }
}
function saveSales() { 
    tenantSet('freshpos_sales', JSON.stringify(sales)); 
    if (window.db && window.db.saveSale) {
        // En este sistema, las ventas suelen guardarse individualmente al finalizar el checkout,
        // pero esto asegura persistencia de la lista completa si se requiere.
    }
}
function saveClients() { 
    tenantSet('freshpos_clients', JSON.stringify(clients)); 
    if (window.db) {
        clients.forEach(c => window.db.saveClient(c).catch(e => {}));
    }
}
function saveExpenses() { tenantSet('freshpos_expenses', JSON.stringify(expenses)); }
function saveHistory()  { tenantSet('freshpos_history',  JSON.stringify(dailyHistory)); }
function saveSettings(forceTunnelRestart = false) {
    // Capturar tasas actualizadas antes de guardar
    const rateVal = parseFloat(document.getElementById('exchange-rate-input')?.value);
    const euroVal = parseFloat(document.getElementById('euro-rate-input')?.value);
    if (rateVal > 0) settings.exchangeRate = rateVal;
    if (euroVal > 0) settings.euroRate = euroVal;

    // Si el storeId es detectado por dominio, NO sobreescribir settings.storeId permanentemente 
    // a menos que sea un entorno local.
    const finalSettings = { ...settings };
    if (window.FRESH_TENANT && window.FRESH_TENANT.isDetected && window.location.hostname !== 'localhost') {
        // En producción por dominio, mantenemos el storeId detectado solo en memoria/estado actual
    }

    localStorage.setItem('freshpos_settings', JSON.stringify(finalSettings)); 
    if (window.electronAPI && window.electronAPI.saveData) {
        window.electronAPI.saveData({ filename: 'settings.json', data: settings });
    }
    
    // Reiniciar túneles SOLO si se solicita explícitamente (ej. cambio de Token de Ngrok)
    if (forceTunnelRestart && window.electronAPI && window.electronAPI.restartTunnels) {
        window.electronAPI.restartTunnels();
    }
    
    if (typeof syncProductsToMobile === 'function') syncProductsToMobile();
}
function incTicketNumber() { currentTicketNumber++; tenantSet('freshpos_ticket', currentTicketNumber); }

// El sistema utiliza ahora initMobileServer() definido en la sección de automatización (al final del archivo).


// Navigation Logic
function initNavigation() {
    const navItems = {
        'nav-pos': 'view-pos',
        'nav-inventory': 'view-inventory',
        'nav-clients': 'view-clients',
        'nav-reports': 'view-reports',
        'nav-analytics': 'view-analytics',
        'nav-purchases': 'view-purchases',
        'nav-payables': 'view-payables',
        'nav-proveedores': 'view-proveedores',
        'nav-credits': 'view-credits',
        'nav-expenses': 'view-expenses',
        'nav-provisionar': 'view-provisionar',
        'nav-server': 'view-server',
        'nav-settings': 'view-settings',
        'nav-mobile-payments': 'view-mobile-payments',
        'nav-mobile-deliveries': 'view-mobile-deliveries',
        'nav-movements': 'view-movements',
        'nav-audit': 'view-audit',
        'nav-help': 'view-help'
    };

    const isVisible = (id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    };

    window.switchView = (viewId) => {
        document.querySelectorAll('.view-section').forEach(view => {
            view.classList.add('hidden', 'opacity-0');
        });
        const activeView = document.getElementById(viewId);
        if (activeView) {
            activeView.classList.remove('hidden');
            setTimeout(() => activeView.classList.remove('opacity-0'), 20);
        }

        // Update Nav UI
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('bg-brand-50', 'text-brand-600', 'active');
            el.classList.add('text-slate-500');
        });
        
        // Match nav items
        for (let id in navItems) {
            if (navItems[id] === viewId) {
                const navEl = document.getElementById(id);
                if (navEl) {
                    navEl.classList.remove('text-slate-500');
                    navEl.classList.add('bg-brand-50', 'text-brand-600', 'active');
                }
            }
        }

        if (viewId === 'view-pos') renderProducts();
        if (viewId === 'view-inventory') renderInventory();
        if (viewId === 'view-clients') renderClients();
        if (viewId === 'view-reports') renderReports();
        if (viewId === 'view-analytics') renderAnalytics();
        if (viewId === 'view-purchases') initPurchases();
        if (viewId === 'view-payables') renderPayables();
        if (viewId === 'view-credits') renderCredits();
        if (viewId === 'view-expenses') renderExpenses();
        if (viewId === 'view-provisionar') {
            if (window.Provisionar && typeof window.Provisionar.init === 'function') {
                window.Provisionar.init();
            }
        }
        if (viewId === 'view-server') initMobileServer();
        if (viewId === 'view-mobile-payments') renderMobilePaymentsRegistry();
        if (viewId === 'view-mobile-deliveries') renderMobileDeliveries();
        if (viewId === 'view-movements') renderMovements();
        if (viewId === 'view-audit') renderAuditLogs();

        // --- DISPARADORES DE TUTORIAL ---
        window.handleViewTutorial(viewId);
    };

    for (let navId in navItems) {
        document.getElementById(navId).addEventListener('click', (e) => {
            e.preventDefault();
            
            document.querySelectorAll('.nav-item').forEach(el => {
                el.classList.remove('bg-emerald-50', 'bg-rose-50', 'bg-amber-50', 'text-emerald-600', 'text-rose-600', 'text-amber-600', 'text-brand-600', 'bg-brand-50');
                if (el && !el.id.includes('mobile-payments')) {
                    el.classList.add('text-slate-500');
                }
            });

            const targetNav = document.getElementById(navId);
            if (targetNav) {
                targetNav.classList.remove('text-slate-500');
                if (navId === 'nav-pos' || navId === 'nav-inventory' || navId === 'nav-clients') targetNav.classList.add('bg-emerald-50', 'text-emerald-600');
                else if (navId === 'nav-purchases') targetNav.classList.add('bg-emerald-50', 'text-emerald-600');
                else if (navId === 'nav-payables' || navId === 'nav-expenses') targetNav.classList.add('bg-rose-50', 'text-rose-600');
                else if (navId === 'nav-credits') targetNav.classList.add('bg-amber-50', 'text-amber-600');
                else if (navId === 'nav-proveedores') targetNav.classList.add('bg-brand-50', 'text-brand-600');
                else targetNav.classList.add('bg-emerald-50', 'text-emerald-600');
            }

            if (navId === 'nav-purchases' && typeof initMobileServer === 'function') initMobileServer();
            if (navId === 'nav-payables' && typeof renderPayables === 'function') renderPayables();
            if (navId === 'nav-proveedores' && typeof renderProveedores === 'function') renderProveedores();

            window.switchView(navItems[navId]);
        });
    }

    // Cashup opens modal directly
    const cashupNav = document.getElementById('nav-cashup');
    if (cashupNav) {
        cashupNav.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(el => {
                el.classList.remove('bg-emerald-50', 'bg-rose-50', 'bg-amber-50', 'text-emerald-600', 'text-rose-600', 'text-amber-600', 'text-brand-600', 'bg-brand-50');
                if (el && !el.id.includes('mobile-payments')) el.classList.add('text-slate-500');
            });
            cashupNav.classList.remove('text-slate-500');
            cashupNav.classList.add('bg-teal-50', 'text-teal-600');
            if (typeof window.openCierreModal === 'function') window.openCierreModal();
        });
    }
}

// --- UPDATE PRICES WITH NEW EXCHANGE RATE ---
function updatePricesWithNewRate(val, property) {
    if (property === 'exchangeRate' && val > 0) {
        products = products.map(p => {
            let usd = parseFloat(p.priceUSD || p.price || 0);
            if (usd === 0 && parseFloat(p.priceVES) > 0) {
                p.priceUSD = parseFloat(p.priceVES) / val;
                usd = parseFloat(p.priceUSD);
            }
            if (usd > 0) {
                p.priceVES = Math.round((usd * val) / 10) * 10;
                if (p.promoPrice) {
                    p.promoPriceVES = Math.round((parseFloat(p.promoPrice) * val) / 10) * 10;
                }
            }
            return p;
        });

        if (typeof cart !== 'undefined' && Array.isArray(cart)) {
            cart = cart.map(item => {
                let itemUSD = parseFloat(item.priceUSD || item.price || 0);
                if (itemUSD === 0 && parseFloat(item.priceVES) > 0) {
                    item.priceUSD = parseFloat(item.priceVES) / val;
                    itemUSD = parseFloat(item.priceUSD);
                }
                if (itemUSD > 0) {
                    item.priceVES = Math.round((itemUSD * val) / 10) * 10;
                    if (item.originalPriceUSD > 0) {
                        item.originalPriceVES = Math.round((parseFloat(item.originalPriceUSD) * val) / 10) * 10;
                    }
                }
                return item;
            });
        }

        if (typeof saveProducts === 'function') {
            saveProducts();
        }
    }
}

// --- AUTO FETCH DAILY RATE ---
async function fetchDailyRate(isSilent = false) {
    try {
        const btn = document.getElementById('sync-rate-btn');
        if(btn && !isSilent) {
            btn.classList.add('animate-spin');
            btn.style.pointerEvents = 'none';
        }
        
        const [dolarRes, euroRes] = await Promise.all([
            fetch('https://ve.dolarapi.com/v1/dolares'),
            fetch('https://ve.dolarapi.com/v1/euros').catch(() => ({ json: () => [] })) // Graceful fail for euros
        ]);
        
        const dolarData = await dolarRes.json();
        const euroData = await euroRes.json();
        
        // Find BCV rate
        const bcvDolar = Array.isArray(dolarData) ? dolarData.find(d => d.fuente === 'oficial') : null;
        const bcvEuro = Array.isArray(euroData) ? euroData.find(d => d.fuente === 'oficial') : null;
        
        let successCount = 0;
        let rateChanged = false;
        const oldRate = settings.exchangeRate;
        const oldEuroRate = settings.euroRate;

        if (bcvDolar && bcvDolar.promedio > 0) {
            const newRate = bcvDolar.promedio;
            if (Math.abs(newRate - oldRate) > 0.001) {
                rateChanged = true;
                settings.exchangeRate = newRate;
                
                const input = document.getElementById('exchange-rate-input');
                if (input) {
                    input.value = newRate.toFixed(2);
                }
                updatePricesWithNewRate(newRate, 'exchangeRate');
            }
            successCount++;
        }
        
        if (bcvEuro && bcvEuro.promedio > 0) {
            const newEuro = bcvEuro.promedio;
            if (Math.abs(newEuro - oldEuroRate) > 0.001) {
                rateChanged = true;
                settings.euroRate = newEuro;
                
                const euroInput = document.getElementById('euro-rate-input');
                if (euroInput) {
                    euroInput.value = newEuro.toFixed(2);
                }
            }
            successCount++;
        }

        if (rateChanged) {
            saveSettings();
            
            // Sync current rate displays
            const rateDisplays = document.querySelectorAll('.current-rate-display');
            rateDisplays.forEach(el => el.textContent = settings.exchangeRate.toFixed(2));

            if (window.updatePricePreviews) window.updatePricePreviews();

            requestAnimationFrame(() => {
                if (typeof renderProducts === 'function') renderProducts();
                const inventoryEl = document.getElementById('view-inventory');
                if (inventoryEl && !inventoryEl.classList.contains('hidden')) {
                    if (typeof renderInventory === 'function') renderInventory();
                }
                if (typeof updateCartUI === 'function') updateCartUI();
                if (typeof renderReports === 'function') renderReports();
            });

            if (typeof Swal !== 'undefined') {
                Swal.fire({ 
                    title: 'Tasas Sincronizadas', 
                    text: `Dólar: Bs ${settings.exchangeRate.toFixed(2)} | Euro: Bs ${settings.euroRate.toFixed(2)}`,
                    icon: 'success', 
                    toast: true, 
                    position: 'top-end', 
                    showConfirmButton: false, 
                    timer: 4000 
                });
            }
        } else {
            if (!isSilent && typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Tasas al Día',
                    text: 'Las tasas del BCV ya están actualizadas en el sistema.',
                    icon: 'info',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });
            }
        }

        if (successCount === 0 && !isSilent) {
            Swal.fire('Error', 'No se pudo obtener las tasas del BCV', 'error');
        }
    } catch (e) {
        console.error("Error fetching rate:", e);
        if (!isSilent && typeof Swal !== 'undefined') {
            Swal.fire('Error de Conexión', 'No se pudo conectar con el servidor de tasas.', 'error');
        }
    } finally {
        const btn = document.getElementById('sync-rate-btn');
        if(btn && !isSilent) {
            btn.classList.remove('animate-spin');
            btn.style.pointerEvents = 'auto';
        }
    }
}

// Settings & AutoClose Logic
function initSettingsAndAutoClose() {
    // Definir manejador común para cambios de tasa
    const handleRateInput = (id, property) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let rawValue = e.target.value.replace(',', '.');
            let val = parseFloat(rawValue);
            if (rateUpdateTimeout) clearTimeout(rateUpdateTimeout);
            
            rateUpdateTimeout = setTimeout(() => {
                if (val > 0) {
                    settings[property] = val;
                    saveSettings();
                    
                    if (property === 'exchangeRate') {
                        updatePricesWithNewRate(val, 'exchangeRate');
                    }

                    // Actualizar previsualizaciones si el modal de producto está abierto
                    if (window.updatePricePreviews) window.updatePricePreviews();

                    // Refrescar interfaces
                    requestAnimationFrame(() => {
                        renderProducts();
                        if (!document.getElementById('view-inventory').classList.contains('hidden')) renderInventory();
                        updateCartUI();
                        renderReports();
                    });

                    // Feedback visual
                    const parent = e.target.closest('.bg-slate-50, .bg-white');
                    if (parent) {
                        parent.classList.add('ring-2', 'ring-emerald-500');
                        setTimeout(() => parent.classList.remove('ring-2', 'ring-emerald-500'), 1000);
                    }
                }
            }, 400);
        });

        el.addEventListener('blur', () => {
            if (parseFloat(el.value) > 0) {
                saveSettings();
                Swal.fire({ title: 'Tasa Sincronizada', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            }
        });
    };

    handleRateInput('exchange-rate-input', 'exchangeRate');
    handleRateInput('euro-rate-input', 'euroRate');

    // Auto-Print Toggle Logic
    const apBtn = document.getElementById('autoprint-toggle-btn');
    const apIcon = document.getElementById('autoprint-icon');
    const apText = document.getElementById('autoprint-text');

    const updateAutoPrintUI = () => {
        if (settings.autoPrint) {
            apIcon.className = 'fas fa-print text-lg text-brand-500 font-black';
            apText.textContent = 'Auto-Impresión ON';
            apText.classList.add('text-brand-600', 'dark:text-brand-400');
        } else {
            apIcon.className = 'fas fa-print text-lg text-slate-400';
            apText.textContent = 'Auto-Impresión OFF';
            apText.classList.remove('text-brand-600', 'dark:text-brand-400');
        }
    };
    if (apBtn) {
        updateAutoPrintUI();
        apBtn.addEventListener('click', () => {
            settings.autoPrint = !settings.autoPrint;
            saveSettings();
            updateAutoPrintUI();
        });
    }

    // Auto close check every minute
    autoCloseTimer = setInterval(() => {
        const now = new Date();
        if (now.getHours() === 18 && now.getMinutes() === 15) {
            const lastCloseStr = localStorage.getItem('freshpos_last_close');
            const todayStr = now.toDateString();
            if (lastCloseStr !== todayStr && sales.length > 0) {
                localStorage.setItem('freshpos_last_close', todayStr);
                generateZReport(true);
            }
        }
    }, 60000);

    // Manual triggers
    document.getElementById('generate-pdf-btn')?.addEventListener('click', () => generateZReport(false));
    document.getElementById('force-close-btn')?.addEventListener('click', () => {
        Swal.fire({
            title: '¿Forzar Cierre de Caja?',
            text: "Se generará el PDF y se resetearán las ventas del día.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Sí, cerrar caja'
        }).then(res => {
            if (res.isConfirmed) generateZReport(true);
        });
    });
}

// ==========================================
// POS SYSTEM LOGIC
// ==========================================
function initPOS() {

    document.getElementById('order-number-display').textContent = `Ticket #${padTicketNumber(currentTicketNumber)}`;

    const posCatContainer = document.getElementById('pos-categories-container');
    if (posCatContainer) {
        posCatContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('category-btn')) {
                posCatContainer.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentCategory = e.target.dataset.category;
                renderProducts();
            }
        });
    }

    document.getElementById('search-product').addEventListener('input', debounce((e) => {
        searchTerm = e.target.value.toLowerCase();
        renderProducts();
    }, 300));


    document.getElementById('view-recent-sales-btn')?.addEventListener('click', () => {
        const today = new Date().toDateString();
        const dailySales = sales.filter(s => new Date(s.date).toDateString() === today);

        const dayTotalUSD = dailySales.reduce((acc, s) => acc + s.totalUSD, 0);
        const dayTotalVES = dailySales.reduce((acc, s) => acc + s.totalVES, 0);

        let salesListHtml = '';
        if (dailySales.length === 0) {
            salesListHtml = '<p class="text-center text-slate-400 py-6 italic font-medium">No hay ventas registradas hoy.</p>';
        } else {
            salesListHtml = [...dailySales].reverse().map(s => `
                <div class="flex items-center justify-between p-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100 hover:border-brand-200 transition-all group cursor-pointer" onclick="viewSaleDetail('${s.ticket}')">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-black bg-brand-100 text-brand-700 px-2 py-0.5 rounded-lg">#${s.ticket}</span>
                            <span class="text-[10px] text-slate-400 font-bold uppercase">${new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div class="text-sm font-bold text-slate-700 truncate w-40">${s.client?.name || 'Cliente Final'}</div>
                    </div>
                    <div class="text-right mr-3">
                        <div class="text-sm font-black text-slate-800">${formatVES(s.totalVES)}</div>
                        <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Ref: ${formatUSD(s.totalUSD)}</div>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="event.stopPropagation(); printTicketFromReport('${s.ticket}')" class="w-9 h-9 rounded-xl bg-white border border-slate-200 text-brand-600 hover:bg-brand-50 transition-all flex items-center justify-center shadow-sm">
                            <i class="fas fa-print"></i>
                        </button>
                        <button onclick="event.stopPropagation(); continueInvoice('${s.ticket}')" class="w-9 h-9 rounded-xl bg-white border border-slate-200 text-emerald-600 hover:bg-emerald-50 transition-all flex items-center justify-center shadow-sm" title="Cargar">
                            <i class="fas fa-redo-alt"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }

        Swal.fire({
            title: `<div class="text-lg font-black text-slate-800">Cierre Parcial: ${new Date().toLocaleDateString()}</div>`,
            html: `
                <div class="grid grid-cols-2 gap-3 mb-4">
                    <div class="bg-emerald-50 p-3 rounded-2xl border border-emerald-100 text-center shadow-sm">
                        <p class="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">Ventas VES</p>
                        <p class="text-base font-black text-emerald-700">${formatVES(dayTotalVES)}</p>
                    </div>
                    <div class="bg-blue-50 p-3 rounded-2xl border border-blue-100 text-center shadow-sm">
                        <p class="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-0.5">Ref USD</p>
                        <p class="text-base font-black text-blue-700">${formatUSD(dayTotalUSD)}</p>
                    </div>
                </div>
                <div class="max-h-72 overflow-y-auto px-1 pt-2 custom-scrollbar">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 text-left pl-2">Desglose de Hoy (${dailySales.length})</p>
                    ${salesListHtml}
                </div>
                <div class="mt-4 pt-4 border-t border-slate-100 italic text-[11px] text-slate-400">
                    <p class="mb-3">Este es un resumen informativo para el cajero.</p>
                    <button onclick="sendWhatsAppReport(true)" 
                        class="w-full py-3.5 bg-brand-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 not-italic uppercase text-xs tracking-wider">
                        <i class="fab fa-whatsapp text-lg"></i> Enviar Corte al Jefe
                    </button>
                </div>
            `,
            showConfirmButton: false,
            showCloseButton: true,
            width: '460px',
            customClass: { popup: 'rounded-3xl' }
        });
    });

    document.getElementById('clear-cart-btn').addEventListener('click', clearCartConfirm);
    renderProducts();
}

window.viewSaleDetail = (ticket) => {
    const sale = sales.find(s => s.ticket === ticket);
    if (!sale) return;

    let itemsHtml = '';
    if (sale.items && sale.items.length > 0) {
        sale.items.forEach(item => {
            itemsHtml += `
                <div class="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
                    <div class="flex-1">
                        <p class="text-sm font-bold text-slate-700">${item.name}</p>
                        <p class="text-[10px] text-slate-400 font-semibold">${item.category || ''}</p>
                    </div>
                    <div class="flex items-center gap-4 text-right">
                        <span class="text-xs font-bold text-slate-500 w-8">x${item.qty}</span>
                        <span class="text-xs font-bold text-slate-400 w-16">${formatVES(item.unitPriceVES)}</span>
                        <span class="text-sm font-black text-slate-800 w-20">${formatVES(item.totalPriceVES)}</span>
                    </div>
                </div>
            `;
        });
    } else {
        itemsHtml = '<p class="text-center text-slate-400 py-4 italic">Sin detalle de productos</p>';
    }

    const methodNames = {
        'cash-usd': 'Efectivo USD', 'cash-ves': 'Efectivo VES', 'cash-eur': 'Efectivo EUR',
        'card-ves': 'Punto', 'pago-movil': 'Pago Móvil', 'transfer': 'Transferencia'
    };

    Swal.fire({
        title: `<div class="text-lg font-black text-slate-800">Venta #${sale.ticket}</div>`,
        html: `
            <div class="text-left">
                <div class="grid grid-cols-2 gap-2 mb-4 text-xs">
                    <div class="bg-slate-50 rounded-xl p-2.5">
                        <span class="text-slate-400 font-bold block">Cliente</span>
                        <span class="font-bold text-slate-700">${sale.client?.name || 'Final'}</span>
                    </div>
                    <div class="bg-slate-50 rounded-xl p-2.5">
                        <span class="text-slate-400 font-bold block">Método</span>
                        <span class="font-bold text-slate-700">${methodNames[sale.method] || sale.method}</span>
                    </div>
                </div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Productos</p>
                <div class="bg-white border border-slate-100 rounded-2xl p-3 mb-4">
                    ${itemsHtml}
                </div>
                <div class="flex justify-between items-center px-1">
                    <span class="text-sm font-bold text-slate-500">Total</span>
                    <div class="text-right">
                        <span class="text-lg font-black text-slate-800">${formatVES(sale.totalVES)}</span>
                        <span class="text-xs text-slate-400 font-bold block">Ref: ${formatUSD(sale.totalUSD)}</span>
                    </div>
                </div>
            </div>
        `,
        showConfirmButton: false,
        showCloseButton: true,
        width: '480px',
        customClass: { popup: 'rounded-3xl' }
    });
};

function renderProducts() {
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    if (currentCategory === 'Todos' && !searchTerm.trim()) {
        const catCounts = {};
        products.forEach(p => {
            if (p.category) catCounts[p.category] = (catCounts[p.category] || 0) + 1;
        });
        const cats = [...new Set(categories.filter(c => catCounts[c] > 0))];
        if (cats.length === 0) {
            grid.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400">No hay categorías con productos.</div>`;
            return;
        }
        grid.innerHTML = cats.map(cat => {
                const img = products.find(p => p.category === cat && p.img)?.img || '';
                return `
                <div class="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group" onclick="selectCategory('${cat}')">
                    <div class="h-32 bg-gradient-to-br from-brand-50 to-brand-100 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center relative overflow-hidden">
                        ${img ? `<img src="${img}" class="w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity">` : ''}
                        <i class="fas fa-folder-open text-5xl text-brand-300 dark:text-slate-500 absolute opacity-40"></i>
                    </div>
                    <div class="p-4 text-center">
                        <h4 class="font-black text-slate-800 dark:text-slate-100 text-lg">${cat}</h4>
                        <p class="text-xs font-bold text-slate-400 mt-1">${catCounts[cat]} producto${catCounts[cat] !== 1 ? 's' : ''}</p>
                    </div>
                </div>`;
            }).join('');
        return;
    }

    const filtered = products.filter(p => {
        const matchesCat = currentCategory === 'Todos' || p.category === currentCategory;
        const s = searchTerm.toLowerCase();
        const matchesSearch = 
            p.name.toLowerCase().includes(s) || 
            (p.category && p.category.toLowerCase().includes(s)) ||
            (p.id && p.id.toLowerCase().includes(s)) ||
            (p.description && p.description.toLowerCase().includes(s)) ||
            (p.barcode && p.barcode.toLowerCase().includes(s));
        return matchesCat && matchesSearch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400">No hay productos.</div>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(product => {
        const isOutOfStock = product.stock <= 0;
        const card = document.createElement('div');
        card.className = `bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden group cursor-pointer transition-all duration-300 ${isOutOfStock ? 'opacity-50 pointer-events-none grayscale' : 'hover:shadow-xl hover:-translate-y-1'}`;
        card.onclick = () => addToCart(product);

        card.innerHTML = `
            <div class="h-40 bg-slate-100 dark:bg-slate-700 relative overflow-hidden">
                <img src="${product.img || 'https://via.placeholder.com/400?text=No+Image'}" alt="${product.name}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                ${isOutOfStock ? '<div class="absolute inset-0 bg-red-500/80 text-white font-black text-xl flex items-center justify-center backdrop-blur-sm z-10">AGOTADO</div>' : ''}
                ${product.promoPrice ? '<div class="absolute top-2 left-2 bg-rose-500 text-white font-black px-2 py-1 rounded-lg text-xs shadow-sm z-0 animate-pulse">PROMO</div>' : ''}
                <div class="absolute top-2 right-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur text-brand-600 dark:text-brand-400 font-black px-2 py-1 rounded-lg text-sm shadow-sm z-0">
                    ${product.stock} disp
                </div>
            </div>
            <div class="p-4 bg-white dark:bg-slate-800 relative">
                <p class="text-xs text-brand-500 dark:text-brand-400 font-bold uppercase tracking-wider mb-1">${product.category}</p>
                <h4 class="font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-tight mb-2">${product.name}</h4>
                <div class="text-xl font-black text-slate-800 dark:text-white">
                    ${product.promoPriceVES ? `
                        <span class="text-rose-600 dark:text-rose-400">${formatVES(product.promoPriceVES)}</span>
                        <span class="text-sm line-through text-slate-400 ml-1 font-semibold">${formatVES(product.priceVES)}</span>
                    ` : `
                        ${formatVES(product.priceVES)}
                    `}
                </div>
                <div class="text-xs font-bold text-slate-400 -mt-1">Ref: ${formatUSD(product.priceUSD || product.price)}</div>
            </div>
        `;
        fragment.appendChild(card);
    });

    grid.innerHTML = '';
    grid.appendChild(fragment);
}

window.selectCategory = (cat) => {
    currentCategory = cat;
    document.querySelectorAll('.category-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.category === cat);
        b.classList.toggle('bg-blue-600', b.dataset.category === cat);
        b.classList.toggle('text-white', b.dataset.category === cat);
        b.classList.toggle('bg-gray-100', b.dataset.category !== cat);
        b.classList.toggle('text-gray-500', b.dataset.category !== cat);
    });
    renderProducts();
};


async function loadProductsFromDB() {
    if (window.db) {
        let dbProducts = await window.db.getProducts();
        if (dbProducts && dbProducts.length > 0) {
            products = dbProducts.map(p => {
                if (typeof p.category === 'string' && (p.category.startsWith('{') || p.category.startsWith('['))) {
                    try { p.category = JSON.parse(p.category); } catch(e){}
                }
                if (typeof p.flavors === 'string') {
                    try { p.flavors = JSON.parse(p.flavors); } catch(e){ p.flavors = []; }
                }
                if (!p.priceUSD && p.price) p.priceUSD = p.price;
                p.featured = !!p.featured;
                return p;
            });
        }
    }
}

// ==========================================
// INVENTORY LOGIC
// ==========================================

window.toggleProductType = function(type) {
    const isComplex = type === 'complex';
    
    // Toggle buttons
    const btnSimple = document.getElementById('btn-prod-simple');
    const btnComplex = document.getElementById('btn-prod-complex');
    
    if (isComplex) {
        btnComplex.className = 'flex-1 py-2 text-sm font-bold rounded-lg bg-white shadow-sm text-brand-600 transition-all';
        btnSimple.className = 'flex-1 py-2 text-sm font-bold rounded-lg text-slate-500 hover:text-slate-700 transition-all';
    } else {
        btnSimple.className = 'flex-1 py-2 text-sm font-bold rounded-lg bg-white shadow-sm text-brand-600 transition-all';
        btnComplex.className = 'flex-1 py-2 text-sm font-bold rounded-lg text-slate-500 hover:text-slate-700 transition-all';
    }

    // Toggle fields
    const fields = document.querySelectorAll('.advanced-field');
    fields.forEach(f => {
        f.style.display = isComplex ? '' : 'none';
    });
};

function initInventory() {
    const modal = document.getElementById('product-modal');
    const content = document.getElementById('product-modal-content');

    document.getElementById('add-product-btn').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('product-featured').checked = false;
        document.getElementById('modal-product-title').textContent = 'Añadir Producto';
        
        window.toggleProductType('simple');
        
        const preview = document.getElementById('product-img-preview');
        if (preview) preview.classList.add('hidden');
        
        const flavCont = document.getElementById('product-flavors-container');
        if (flavCont) flavCont.innerHTML = ''; 
        
        const flavInput = document.getElementById('product-flavors');
        if (flavInput) flavInput.value = '';

        modal.classList.add('modal-open');
        setTimeout(() => { modal.classList.add('modal-fade-in'); content.classList.add('modal-scale-in'); }, 10);
    });

    document.querySelectorAll('.close-product-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); content.classList.remove('modal-scale-in');
        setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));

    // Add event listeners for price suggestion and real-time preview
    ['product-price-ves', 'product-price-usd', 'product-price-eur'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', window.updatePricePreviews);
    });

    document.getElementById('product-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (currentRole !== 'admin') {
            Swal.fire('Acceso Denegado', 'No tienes permiso para realizar esta acción.', 'error');
            return;
        }
        const id = document.getElementById('product-id').value;

        const name = document.getElementById('product-name').value;
        const category = document.getElementById('product-category').value;
        const priceVES = parseFloat(document.getElementById('product-price-ves').value) || 0;
        const priceUSD = parseFloat(document.getElementById('product-price-usd').value) || 0;
        const priceEUR = parseFloat(document.getElementById('product-price-eur').value) || 0;
        const costPrice = parseFloat(document.getElementById('product-cost-price').value) || 0;
        const stock = parseInt(document.getElementById('product-stock').value) || 0;
        const minStock = parseInt(document.getElementById('product-min-stock').value) || 5;
        const img = document.getElementById('product-img').value;
        const featured = document.getElementById('product-featured').checked;
        const flavors = document.getElementById('product-flavors').value.split(',').map(f => f.trim()).filter(f => f !== '');
        const expiryDate = document.getElementById('product-expiry').value;
        const description = document.getElementById('product-description').value;
        const barcode = document.getElementById('product-barcode').value;

        if (!name || !category || (priceVES <= 0 && priceUSD <= 0)) {
            Swal.fire('Error', 'Nombre, categoría y al menos un precio son obligatorios.', 'error');
            return;
        }

        // Duplicate prevention: check name and barcode
        if (id) {
            const dupName = products.find(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase());
            if (dupName) { Swal.fire('Error', `Ya existe un producto con el nombre "${name}". Creado por: ${dupName.name}`, 'error'); return; }
            if (barcode) {
                const dupBarcode = products.find(p => p.id !== id && p.barcode && p.barcode === barcode);
                if (dupBarcode) { Swal.fire('Error', `Ya existe un producto con el código de barras "${barcode}". Producto: ${dupBarcode.name}`, 'error'); return; }
            }
            const index = products.findIndex(p => p.id === id);
            if (index > -1) {
                const oldProduct = { ...products[index] };
                products[index] = { ...products[index], name, category, priceVES, priceUSD, priceEUR, costPrice, stock, minStock, img, featured, flavors, expiryDate, description, barcode };
                
                // AUDIT: Solo loggear si hubo cambios significativos
                if (oldProduct.priceVES !== priceVES || oldProduct.priceUSD !== priceUSD || oldProduct.stock !== stock) {
                    logAction('PRODUCT_UPDATE', `Editado producto: ${name} (Stock: ${stock}, Min: ${minStock})`, { old: oldProduct, new: products[index] });
                }
            }
        } else {
            const dupName = products.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (dupName) { Swal.fire('Error', `Ya existe un producto con el nombre "${name}". Producto existente: ${dupName.name}`, 'error'); return; }
            if (barcode) {
                const dupBarcode = products.find(p => p.barcode && p.barcode === barcode);
                if (dupBarcode) { Swal.fire('Error', `Ya existe un producto con el código de barras "${barcode}". Producto: ${dupBarcode.name}`, 'error'); return; }
            }
            const newProd = { id: generateId(), name, category, priceVES, priceUSD, priceEUR, costPrice, stock, minStock, img, featured, flavors, expiryDate, description, barcode };
            products.push(newProd);
            logAction('PRODUCT_CREATE', `Creado producto: ${name}`, newProd);
        }

        saveProducts();
        renderInventory();
        renderProducts(); // Update POS view
        document.querySelector('.close-product-modal').click();
        
        // Si venimos del OCR, vincular el nuevo producto
        if (id === '' && window.pendingOCRIndex !== undefined && window.pendingOCRIndex !== null) {
            const savedId = products[products.length - 1].id;
            ocrDetectedItems[window.pendingOCRIndex].productId = savedId;
            window.pendingOCRIndex = null;
            setTimeout(renderOCRResults, 350);
        }

        Swal.fire({ title: 'Guardado', icon: 'success', timer: 1500, showConfirmButton: false });
    });

    document.getElementById('product-img').addEventListener('input', (e) => {
        const preview = document.getElementById('product-img-preview');
        if (!preview) return;
        if (e.target.value) {
            preview.src = e.target.value;
            preview.classList.remove('hidden');
        } else {
            preview.src = 'https://via.placeholder.com/150?text=No+Image';
        }
    });

    const productFlavorsEl = document.getElementById('product-flavors');
    if (productFlavorsEl) productFlavorsEl.addEventListener('input', (e) => {
        const flavorsContainer = document.getElementById('product-flavors-container');
        if (!flavorsContainer) return;
        flavorsContainer.innerHTML = '';
        e.target.value.split(',').map(f => f.trim()).filter(f => f !== '').forEach(flavor => {
            const span = document.createElement('span');
            span.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2 mb-2';
            span.textContent = flavor;
            flavorsContainer.appendChild(span);
        });
    });

    const inventorySearchInput = document.getElementById('search-inventory');
    if (inventorySearchInput) {
        inventorySearchInput.addEventListener('input', debounce((e) => {
            inventorySearchTerm = e.target.value.toLowerCase();
            renderInventory();
        }, 300));
    }


    renderInventory();
    window.renderCategoryOptions();
}

window.showLowStockReport = () => {
    const lowItems = products.filter(p => p.stock <= (p.minStock || 5));
    if (lowItems.length === 0) {
        Swal.fire({ icon: 'success', title: 'Stock Saludable', text: 'Todos los productos tienen inventario suficiente.', confirmButtonText: 'OK', customClass: { popup: 'rounded-3xl' } });
        return;
    }
    let rows = lowItems.map(p => `
        <tr class="border-b border-slate-100">
            <td class="py-2.5 px-3 text-sm font-bold text-slate-700">${p.name}</td>
            <td class="py-2.5 px-3 text-xs text-slate-500">${p.category || '-'}</td>
            <td class="py-2.5 px-3 text-sm font-black text-rose-600">${p.stock}</td>
            <td class="py-2.5 px-3 text-sm font-bold text-slate-500">${p.minStock || 5}</td>
            <td class="py-2.5 px-3 text-right">
                <button onclick="quickAddStock('${p.id}')" class="text-xs font-bold bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-all"><i class="fas fa-plus mr-1"></i>Stock</button>
            </td>
        </tr>
    `).join('');
    Swal.fire({
        title: `<div class="text-lg font-black text-slate-800"><i class="fas fa-exclamation-triangle text-amber-500 mr-2"></i>${lowItems.length} Producto${lowItems.length !== 1 ? 's' : ''} por Comprar</div>`,
        html: `
            <div class="max-h-96 overflow-y-auto custom-scrollbar">
                <table class="w-full text-left">
                    <thead><tr class="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        <th class="py-2 px-3">Producto</th><th class="py-2 px-3">Cat</th><th class="py-2 px-3">Stock</th><th class="py-2 px-3">Mín</th><th class="py-2 px-3"></th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="mt-4 pt-4 border-t border-slate-100">
                <button onclick="printLowStockReport()" class="w-full py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-all"><i class="fas fa-print mr-2"></i>Imprimir Lista</button>
            </div>
        `,
        showConfirmButton: false, showCloseButton: true, width: '520px', customClass: { popup: 'rounded-3xl' }
    });
};

window.quickAddStock = (id) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    const qty = prompt(`Stock actual de "${p.name}": ${p.stock}\n¿Cuánto deseas agregar?`, '10');
    if (qty && !isNaN(qty) && parseInt(qty) > 0) {
        p.stock = (parseInt(p.stock) || 0) + parseInt(qty);
        saveProducts();
        renderInventory();
        Swal.fire({ icon: 'success', title: 'Stock Actualizado', text: `${p.name}: ${p.stock} unidades`, timer: 1500, showConfirmButton: false, customClass: { popup: 'rounded-3xl' } });
    }
};

window.printLowStockReport = () => {
    const lowItems = products.filter(p => p.stock <= (p.minStock || 5));
    const lines = [
        '╔══════════════════════════════╗',
        '║   LISTA DE COMPRAS           ║',
        `║  ${new Date().toLocaleDateString().padEnd(27)}║`,
        '╠══════════════════════════════╣',
        ...lowItems.map(p => {
            const name = p.name.padEnd(24).slice(0,24);
            const stock = String(p.stock).padStart(4);
            return `║ ${name} ${stock} uds ║`;
        }),
        '╚══════════════════════════════╝'
    ].join('\n');
    const printWin = window.open('', '_blank');
    printWin.document.write(`<pre style="font-family:monospace;font-size:14px">${lines}</pre>`);
    printWin.document.close();
    printWin.print();
};

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    
    const filtered = products.filter(p => {
        const s = inventorySearchTerm.toLowerCase();
        return p.name.toLowerCase().includes(s) || 
               (p.category && p.category.toLowerCase().includes(s)) ||
               (p.id && p.id.toLowerCase().includes(s)) ||
               (p.description && p.description.toLowerCase().includes(s)) ||
               (p.barcode && p.barcode.toLowerCase().includes(s));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-slate-400">No hay productos que coincidan con la búsqueda.</td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    const today = new Date().toISOString().split('T')[0];
    
    filtered.forEach(p => {
        const isExpired = p.expiryDate && p.expiryDate < today;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group border-b border-slate-100";
        tr.innerHTML = `
            <td class="py-3 px-4">
                <img src="${p.img || 'https://via.placeholder.com/50?text=No+Image'}" alt="${p.name}" class="w-10 h-10 object-cover rounded-md">
            </td>
            <td class="py-3 px-4">
                <div class="font-bold text-slate-800">${p.name}</div>
                ${p.barcode ? `<p class="text-[10px] text-slate-400 font-mono tracking-wider">${p.barcode}</p>` : ''}
                ${p.description ? `<p class="text-[10px] text-slate-400 italic line-clamp-1">${p.description}</p>` : ''}
            </td>
            <td class="py-3 px-4 text-slate-600">${p.category}</td>
            <td class="py-3 px-4 text-slate-600 text-right font-mono">${formatUSD(p.priceUSD || p.price)}</td>
            <td class="py-3 px-4 text-center">
                <span class="text-[11px] font-bold ${isExpired ? 'text-rose-500' : 'text-slate-500'}">
                    ${p.expiryDate ? p.expiryDate : '---'}
                </span>
            </td>
            <td class="py-3 px-4 text-center">
                <span class="px-3 py-1 rounded-full text-xs font-semibold ${p.stock > 10 ? 'bg-emerald-100 text-emerald-800' : p.stock > 0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">
                    ${p.stock}
                </span>
            </td>
            <td class="py-3 px-4 text-center">
                ${currentRole === 'admin' ? `
                <div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button onclick="editProduct('${p.id}')" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteProduct('${p.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><i class="fas fa-trash-alt"></i></button>
                </div>
                ` : '<span class="text-[10px] text-slate-300 font-bold uppercase tracking-tighter">SÓLO ADMIN</span>'}
            </td>
        `;

        fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

window.editProduct = (id) => {

    const p = products.find(i => i.id === id);
    if (!p) return;
    document.getElementById('product-id').value = p.id;
    document.getElementById('product-name').value = p.name;
    document.getElementById('product-category').value = p.category;
    document.getElementById('product-price-ves').value = p.priceVES;
    document.getElementById('product-price-usd').value = p.priceUSD || p.price;
    document.getElementById('product-price-eur').value = p.priceEUR || 0;
    window.updatePricePreviews();
    document.getElementById('product-cost-price').value = p.costPrice;
    document.getElementById('product-stock').value = p.stock;
    document.getElementById('product-min-stock').value = p.minStock;
    document.getElementById('product-img').value = p.img || '';
    document.getElementById('product-featured').checked = p.featured || false;
    document.getElementById('product-expiry').value = p.expiryDate || '';
    document.getElementById('product-description').value = p.description || '';
    document.getElementById('product-barcode').value = p.barcode || '';
    
    document.getElementById('modal-product-title').textContent = 'Editar Producto';
    window.toggleProductType('complex'); 
    
    // Preview image with safeguard
    const preview = document.getElementById('product-img-preview');
    if (preview) {
        preview.src = p.img || 'https://via.placeholder.com/150?text=No+Image';
        preview.classList.remove('hidden');
    }
    
    // Handle flavors with correct ID and existence check
    const flavorsInput = document.getElementById('product-flavors');
    if (flavorsInput) flavorsInput.value = (p.flavors || []).join(', ');
    
    const flavorsContainer = document.getElementById('product-flavors-container');
    if (flavorsContainer) {
        flavorsContainer.innerHTML = '';
        if (p.flavors) {
            p.flavors.forEach(flavor => {
                const span = document.createElement('span');
                span.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2 mb-2';
                span.textContent = flavor;
                flavorsContainer.appendChild(span);
            });
        }
    }

    const modal = document.getElementById('product-modal');
    modal.classList.add('modal-open');
    setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('product-modal-content').classList.add('modal-scale-in'); }, 10);

    if (window.db && window.db.getProductChanges) {
        window.db.getProductChanges(_getStoreId(), id, 10).then(changes => {
            renderProductChanges(id, changes);
        }).catch(() => {});
    }
};

function renderProductChanges(productId, changes) {
    const section = document.getElementById('product-changes-section');
    const list = document.getElementById('product-changes-list');
    if (!section || !list) return;

    if (!changes || changes.length === 0) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');

    list.innerHTML = changes.map(c => {
        const date = new Date(c.created_at).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const cashierName = c.cashier || '';
        let detail = '';
        if (c.change_type === 'deleted') {
            detail = '<span class="text-rose-600 font-semibold">Eliminado</span>';
        } else if (c.change_type === 'restored') {
            detail = '<span class="text-emerald-600 font-semibold">Restaurado</span>';
        } else if (c.change_type === 'created') {
            detail = '<span class="text-blue-600 font-semibold">Creado</span>';
        } else if (c.changes) {
            try {
                const parsed = typeof c.changes === 'string' ? JSON.parse(c.changes) : c.changes;
                detail = Object.entries(parsed).map(([field, vals]) => {
                    return `<span class="text-xs"><span class="font-medium text-slate-600">${field}</span>: <span class="text-rose-500 line-through">${vals.old ?? ''}</span> → <span class="text-emerald-600">${vals.new ?? ''}</span></span>`;
                }).join(' &nbsp;|&nbsp; ');
            } catch(e) { detail = c.changes; }
        } else {
            detail = c.changes || '';
        }
        return `<div class="flex items-start gap-2 py-1.5 px-2 rounded-lg bg-slate-50 text-xs leading-relaxed">
            <span class="text-slate-400 whitespace-nowrap shrink-0">${date}</span>
            <div class="flex-1 min-w-0">${detail}</div>
            ${cashierName ? `<span class="text-slate-400 shrink-0">${cashierName}</span>` : ''}
        </div>`;
    }).join('');
}

window.showFullProductHistory = async function() {
    const pid = document.getElementById('product-id').value;
    if (!pid) return;
    const modal = document.getElementById('product-history-modal');
    const list = document.getElementById('product-history-full-list');
    const title = document.getElementById('product-history-modal-title');
    const p = products.find(i => i.id === pid);
    if (p) title.textContent = `Historial: ${p.name}`;
    list.innerHTML = '<div class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin text-2xl"></i><p class="mt-2">Cargando...</p></div>';
    modal.classList.add('modal-open');
    setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('product-history-modal').querySelector('.pointer-events-auto')?.classList.add('modal-scale-in'); }, 10);

    try {
        const changes = await window.db.getProductChanges(_getStoreId(), pid, 500);
        if (!changes || changes.length === 0) {
            list.innerHTML = '<div class="text-center text-slate-400 py-8"><i class="fas fa-inbox text-3xl mb-2"></i><p>Sin cambios registrados</p></div>';
            return;
        }
        list.innerHTML = changes.map(c => {
            const date = new Date(c.created_at).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const cashierName = c.cashier || '';
            let detail = '';
            if (c.change_type === 'deleted') {
                detail = '<div class="text-rose-600 font-semibold">Producto eliminado</div>';
            } else if (c.change_type === 'restored') {
                detail = '<div class="text-emerald-600 font-semibold">Producto restaurado</div>';
            } else if (c.change_type === 'created') {
                detail = '<div class="text-blue-600 font-semibold">Producto creado</div>';
            } else if (c.changes) {
                try {
                    const parsed = typeof c.changes === 'string' ? JSON.parse(c.changes) : c.changes;
                    detail = Object.entries(parsed).map(([field, vals]) => {
                        return `<div class="flex items-center gap-2 py-0.5"><span class="font-medium text-slate-600 w-20 shrink-0">${field}:</span><span class="text-rose-500 line-through">${vals.old ?? ''}</span><span class="text-slate-300">→</span><span class="text-emerald-600 font-medium">${vals.new ?? ''}</span></div>`;
                    }).join('');
                } catch(e) { detail = c.changes; }
            }
            return `<div class="py-2 px-3 rounded-lg ${c.change_type === 'deleted' ? 'bg-rose-50' : c.change_type === 'restored' ? 'bg-emerald-50' : 'bg-slate-50'} text-sm">
                <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>${date}</span>
                    ${cashierName ? `<span>${cashierName}</span>` : ''}
                </div>
                ${detail}
            </div>`;
        }).join('');
    } catch(e) {
        list.innerHTML = '<div class="text-center text-rose-500 py-8"><i class="fas fa-exclamation-triangle text-2xl mb-2"></i><p>Error al cargar historial</p></div>';
    }
};

// Close full history modal
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.close-product-history-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = document.getElementById('product-history-modal');
            modal.classList.remove('modal-fade-in');
            setTimeout(() => modal.classList.remove('modal-open'), 300);
        });
    });
});


window.deleteProduct = (id) => {
    if (currentRole !== 'admin') {
        Swal.fire('Acceso Denegado', 'No tienes permiso para realizar esta acción.', 'error');
        return;
    }
    Swal.fire({ title: '¿Eliminar?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' }).then((res) => {

        if (res.isConfirmed) {
            if (window.db && window.db.deleteProduct) {
                window.db.deleteProduct(id).catch(e => console.error('[DB] Error soft-delete:', e));
            }
            products = products.filter(p => p.id !== id);
            saveProducts(); renderInventory(); renderProducts();
        }
    });
};

window.printInventoryReport = async function() {
    try {
        // Obtenemos TODOS los productos reales guardados en la base de datos local SQLite del sistema
        let allDbProducts = [];
        if (window.db && window.db.getProducts) {
            allDbProducts = await window.db.getProducts('');
        }
        if (!allDbProducts || allDbProducts.length === 0) {
            allDbProducts = products || [];
        }

        if (!allDbProducts || allDbProducts.length === 0) {
            Swal.fire('Inventario Vacío', 'No hay productos registrados en el sistema para imprimir.', 'info');
            return;
        }

        const er = settings.exchangeRate || 1;
        const dateStr = new Date().toLocaleString();
        const bName = settings.businessName || 'Caja Fresh POS';

        let totalItems = 0;
        let totalValueUSD = 0;
        allDbProducts.forEach(p => {
            const stk = parseInt(p.stock) || 0;
            const pr = parseFloat(p.priceUSD || p.price_usd || p.price) || 0;
            totalItems += stk;
            totalValueUSD += (stk * pr);
        });
        const totalValueVES = totalValueUSD * er;

        const printWin = window.open('', '_blank', 'width=950,height=800');
        if (!printWin) {
            Swal.fire('Error', 'Por favor permite las ventanas emergentes (popups) en tu navegador para ver la hoja de inventario.', 'error');
            return;
        }

        const rowsHtml = allDbProducts.map((p, idx) => {
            const stk = parseInt(p.stock) || 0;
            const minStk = parseInt(p.minStock || p.min_stock) || 5;
            const prUSD = parseFloat(p.priceUSD || p.price_usd || p.price) || 0;
            const prVES = prUSD * er;
            const valUSD = stk * prUSD;
            const isLow = stk <= minStk;
            const stkStyle = isLow ? 'color: #dc2626; font-weight: bold; background: #fee2e2;' : '';
            return `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 10px 8px; text-align: center; color: #64748b;">${idx + 1}</td>
                    <td style="padding: 10px 8px; font-weight: 600;">${p.name || 'Sin Nombre'}</td>
                    <td style="padding: 10px 8px; text-align: center; color: #475569;">${p.category || 'General'}</td>
                    <td style="padding: 10px 8px; text-align: center; ${stkStyle}">${stk} ${isLow ? '⚠️' : ''}</td>
                    <td style="padding: 10px 8px; text-align: right;">$${prUSD.toFixed(2)}</td>
                    <td style="padding: 10px 8px; text-align: right; color: #475569;">Bs ${prVES.toFixed(2)}</td>
                    <td style="padding: 10px 8px; text-align: right; font-weight: 600;">$${valUSD.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        const html = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Inventario_Completo_${bName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}</title>
                <style>
                    @page { size: A4 portrait; margin: 15mm; }
                    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; color: #0f172a; background: #ffffff; }
                    .header-box { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0284c7; padding-bottom: 16px; margin-bottom: 20px; }
                    .header-title h1 { margin: 0; font-size: 26px; color: #0f172a; font-weight: 800; }
                    .header-title p { margin: 4px 0 0; color: #64748b; font-size: 13px; font-weight: 500; }
                    .header-meta { text-align: right; font-size: 12px; color: #475569; line-height: 1.6; }
                    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f8fafc; padding: 14px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e2e8f0; }
                    .summary-card { text-align: center; }
                    .summary-card .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
                    .summary-card .val { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px; }
                    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
                    th { background: #0f172a; color: #ffffff; padding: 10px 8px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
                    th.text-center { text-align: center; }
                    th.text-right { text-align: right; }
                    tr:nth-child(even) { background-color: #f8fafc; }
                    .action-bar { background: #0f172a; padding: 12px 20px; margin-bottom: 20px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; color: white; }
                    .action-btn { background: #0284c7; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: background 0.2s; }
                    .action-btn:hover { background: #0369a1; }
                    @media print {
                        .action-bar { display: none !important; }
                        body { padding: 0; }
                    }
                </style>
            </head>
            <body>
                <div class="action-bar">
                    <span style="font-weight: 600;">📋 Vista Previa de Hoja de Inventario (${allDbProducts.length} productos del sistema)</span>
                    <div style="display: flex; gap: 10px;">
                        <button class="action-btn" onclick="window.print()">🖨️ Imprimir Hoja / Descargar PDF</button>
                    </div>
                </div>
                <div class="header-box">
                    <div class="header-title">
                        <h1>${bName}</h1>
                        <p>INVENTARIO GENERAL DE PRODUCTOS REGISTRADOS EN EL SISTEMA</p>
                    </div>
                    <div class="header-meta">
                        <div><b>Fecha de Emisión:</b> ${dateStr}</div>
                        <div><b>Tasa BCV/Oficial:</b> Bs ${er.toFixed(2)} / $</div>
                        <div><b>Fuente de Datos:</b> Base de Datos SQLite del Sistema</div>
                    </div>
                </div>
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="label">Total Productos</div>
                        <div class="val">${allDbProducts.length}</div>
                    </div>
                    <div class="summary-card">
                        <div class="label">Unidades en Stock</div>
                        <div class="val">${totalItems}</div>
                    </div>
                    <div class="summary-card">
                        <div class="label">Valor Total ($)</div>
                        <div class="val" style="color: #0284c7;">$${totalValueUSD.toFixed(2)}</div>
                    </div>
                    <div class="summary-card">
                        <div class="label">Valor Total (Bs)</div>
                        <div class="val" style="color: #16a34a;">Bs ${totalValueVES.toFixed(2)}</div>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th class="text-center" style="width: 35px;">#</th>
                            <th>Descripción del Producto</th>
                            <th class="text-center">Categoría</th>
                            <th class="text-center">Stock Cant.</th>
                            <th class="text-right">Precio ($)</th>
                            <th class="text-right">Precio (Bs)</th>
                            <th class="text-right">Valor Total ($)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
                <script>
                    window.onload = function() {
                        setTimeout(function() { window.print(); }, 400);
                    };
                </script>
            </body>
            </html>
        `;
        printWin.document.write(html);
        printWin.document.close();
    } catch(e) {
        console.error('Error imprimiendo inventario:', e);
        Swal.fire('Error', 'No se pudo generar la hoja de inventario: ' + e.message, 'error');
    }
};

window.clearAllProducts = () => {
    if (currentRole !== 'admin') {
        Swal.fire('Acceso Denegado', 'No tienes permiso para realizar esta acción.', 'error');
        return;
    }
    Swal.fire({ 
        title: '¿Vaciar Inventario?', 
        text: 'Esta acción borrará TODOS los productos y no se puede deshacer.',
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#ef4444', 
        confirmButtonText: 'Sí, borrar todo' 
    }).then((res) => {
        if (res.isConfirmed) {
            products = [];
            saveProducts(); renderInventory(); renderProducts();
            Swal.fire('Inventario Vaciado', 'Se han eliminado todos los productos.', 'success');
        }
    });
};
window.clearLocalProducts = window.clearAllProducts;

// ==========================================
// CLIENTS LOGIC
// ==========================================
let currentClientFilter = 'todos'; // 'todos' | 'cliente' | 'proveedor'

function initClients() {
    const modal = document.getElementById('client-modal');
    const content = document.getElementById('client-modal-content');

    document.getElementById('add-client-btn').addEventListener('click', () => {
        document.getElementById('client-form').reset();
        document.getElementById('client-id').value = '';
        document.getElementById('client-type').value = 'cliente';
        document.getElementById('modal-client-title').textContent = 'Nuevo Contacto';

        modal.classList.add('modal-open');
        setTimeout(() => { modal.classList.add('modal-fade-in'); content.classList.add('modal-scale-in'); }, 10);
    });

    document.querySelectorAll('.close-client-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); content.classList.remove('modal-scale-in');
        setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));

    // Botones de filtro de tipo
    document.querySelectorAll('.client-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentClientFilter = btn.dataset.clientFilter;
            // Estilos activos
            document.querySelectorAll('.client-filter-btn').forEach(b => {
                b.classList.remove('border-brand-500', 'bg-brand-500', 'text-white',
                    'border-emerald-400', 'bg-emerald-50', 'text-emerald-700',
                    'border-purple-400', 'bg-purple-50', 'text-purple-700');
                b.classList.add('border-slate-200', 'bg-white', 'text-slate-500');
            });
            if (currentClientFilter === 'todos') {
                btn.classList.add('border-brand-500', 'bg-brand-500', 'text-white');
            } else if (currentClientFilter === 'cliente') {
                btn.classList.add('border-emerald-400', 'bg-emerald-50', 'text-emerald-700');
            } else {
                btn.classList.add('border-purple-400', 'bg-purple-50', 'text-purple-700');
            }
            btn.classList.remove('border-slate-200', 'bg-white', 'text-slate-500');
            renderClients();
        });
    });

    document.getElementById('client-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('client-id').value;
        const doc = document.getElementById('client-document').value;
        const name = document.getElementById('client-name').value;
        const phone = document.getElementById('client-phone').value;
        const type = document.getElementById('client-type').value || 'cliente';

        if (id) {
            const index = clients.findIndex(c => c.id === id);
            if (index > -1) clients[index] = { id, document: doc, name, phone, type };
        } else {
            clients.push({ id: generateId(), document: doc, name, phone, type });
        }

        // Sincronizar proveedores: si es proveedor, agregar/actualizar en lista global suppliers
        const savedClient = clients.find(c => c.document === doc && c.name === name);
        if (savedClient && savedClient.type === 'proveedor') {
            if (typeof suppliers !== 'undefined') {
                const existingSupIdx = suppliers.findIndex(s => s.id === savedClient.id || s.name === name);
                if (existingSupIdx > -1) {
                    suppliers[existingSupIdx] = { ...suppliers[existingSupIdx], id: savedClient.id, name, phone };
                } else {
                    suppliers.push({ id: savedClient.id, name, phone, rif: doc });
                }
                if (typeof saveSuppliers === 'function') saveSuppliers();
            }
        }

        saveClients();
        renderClients();
        document.querySelector('.close-client-modal').click();
        Swal.fire({ title: 'Guardado', icon: 'success', timer: 1500, showConfirmButton: false });
    });
}

function renderClients() {
    const tbody = document.getElementById('clients-table-body');
    const searchInput = document.getElementById('client-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    tbody.innerHTML = '';

    const filtered = clients.filter(c => {
        const matchesType = currentClientFilter === 'todos' || (c.type || 'cliente') === currentClientFilter;
        if (!matchesType) return false;
        if (!searchTerm) return true;
        return (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.document || '').toLowerCase().includes(searchTerm) ||
            (c.phone || '').toLowerCase().includes(searchTerm);
    });

    if (filtered.length === 0) {
        const msg = searchTerm
            ? `No se encontraron contactos con "${searchTerm}"`
            : 'No hay contactos en esta categoría.';
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-sm">${msg}</td></tr>`;
        return;
    }

    filtered.forEach(c => {
        const type = c.type || 'cliente';
        const isProveedor = type === 'proveedor';
        const badge = isProveedor
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200"><i class="fas fa-truck-fast text-[10px]"></i> Proveedor</span>`
            : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"><i class="fas fa-user text-[10px]"></i> Cliente</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group";
        tr.innerHTML = `
            <td class="py-3 px-6 font-bold text-slate-800">${c.document}</td>
            <td class="py-3 px-6 text-slate-600">${c.name}</td>
            <td class="py-3 px-6 text-slate-600">${c.phone || '-'}</td>
            <td class="py-3 px-6 text-center">${badge}</td>
            <td class="py-3 px-6 text-center">
                <div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button onclick="editClient('${c.id}')" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteClient('${c.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Buscador de clientes en tiempo real
document.getElementById('client-search-input')?.addEventListener('input', () => renderClients());


function populateClientSearch() {
    // This is now handled by the real-time search, no need to populate a static select.
}

window.editClient = (id) => {
    const c = clients.find(i => i.id === id);
    if (!c) return;
    document.getElementById('client-id').value = c.id;
    document.getElementById('client-document').value = c.document;
    document.getElementById('client-name').value = c.name;
    document.getElementById('client-phone').value = c.phone || '';
    document.getElementById('client-type').value = c.type || 'cliente';
    document.getElementById('modal-client-title').textContent = 'Editar Contacto';

    const modal = document.getElementById('client-modal');
    modal.classList.add('modal-open');
    setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('client-modal-content').classList.add('modal-scale-in'); }, 10);
};

window.deleteClient = (id) => {
    if (currentRole !== 'admin') {
        Swal.fire('Acceso Denegado', 'No tienes permiso para realizar esta acción.', 'error');
        return;
    }
    Swal.fire({ title: '¿Eliminar?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' }).then((res) => {
        if (res.isConfirmed) {
            clients = clients.filter(c => c.id !== id);
            saveClients(); renderClients();
        }
    });
};


// ==========================================
// CART & CHECKOUT LOGIC
// ==========================================
function addToCart(product) {
    if (product.stock <= 0) return;

    // Si el producto tiene sabores definidos, mostrar selector primero
    if (product.flavors && product.flavors.length > 0) {
        const inputOptions = {};
        product.flavors.forEach(f => { inputOptions[f] = `🍹 ${f}`; });

        Swal.fire({
            title: product.name,
            text: '¿De qué sabor?',
            input: 'select',
            inputOptions,
            inputPlaceholder: 'Elige un sabor...',
            showCancelButton: true,
            cancelButtonText: 'Cancelar',
            confirmButtonText: 'Añadir al Carrito',
            confirmButtonColor: '#6366f1',
            inputValidator: (value) => { if (!value) return '¡Elige un sabor para continuar!'; }
        }).then(result => {
            if (result.isConfirmed && result.value) {
                const flavor = result.value;
                const cartId = `${product.id}-${flavor}`;
                const existingIndex = cart.findIndex(item => item.id === cartId);

                // Contar unidades ya en carrito del mismo producto padre
                const parentQtyInCart = cart.filter(i => i.parentId === product.id).reduce((sum, i) => sum + i.qty, 0);

                if (parentQtyInCart >= product.stock) {
                    Swal.fire({ title: 'Stock Insuficiente', text: `Solo hay ${product.stock} unidades de ${product.name} en total.`, icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
                    return;
                }

                if (existingIndex > -1) {
                    cart[existingIndex].qty += 1;
                } else {
                    const priceVES = product.priceVES || (product.price * settings.exchangeRate) || 0;
                    const priceUSD = product.priceUSD || product.price || 0;
                    const cartItem = { ...product, id: cartId, parentId: product.id, name: `${product.name} - ${flavor}`, qty: 1, priceVES, priceUSD };
                    
                    if (cartItem.promoPriceVES && cartItem.promoPriceVES > 0) {
                        cartItem.originalPriceVES = priceVES;
                        cartItem.originalPriceUSD = priceUSD;
                        cartItem.priceVES = cartItem.promoPriceVES;
                        cartItem.priceUSD = cartItem.promoPrice || priceUSD;
                    }
                    cart.push(cartItem);
                }
                updateCartUI();
            }
        });
        return;
    }

    // Sin sabores: flujo normal
    const existingIndex = cart.findIndex(item => item.id === product.id);
    if (existingIndex > -1) {
        if (cart[existingIndex].qty >= product.stock) {
            Swal.fire({ title: 'Stock Insuficiente', icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
            return;
        }
        cart[existingIndex].qty += 1;
    } else {
        const priceVES = product.priceVES || (product.price * settings.exchangeRate) || 0;
        const priceUSD = product.priceUSD || product.price || 0;
        const cartItem = { ...product, qty: 1, priceVES, priceUSD };
        
        if (cartItem.promoPriceVES && cartItem.promoPriceVES > 0) {
            cartItem.originalPriceVES = priceVES;
            cartItem.originalPriceUSD = priceUSD;
            cartItem.priceVES = cartItem.promoPriceVES;
            cartItem.priceUSD = cartItem.promoPrice || priceUSD;
        }
        cart.push(cartItem);
    }
    updateCartUI();
}

function updateCartQty(id, delta) {
    const index = cart.findIndex(i => i.id === id);
    if (index === -1) return;

    const cartItem = cart[index];
    // Si es una variante con sabor, buscar el producto padre para verificar el stock total
    const parentId = cartItem.parentId || id;
    const prodRef = products.find(p => p.id === parentId);
    if (!prodRef) return;

    const newQty = cartItem.qty + delta;

    if (newQty <= 0) {
        cart.splice(index, 1);
    } else {
        // Calcular cuántas unidades del producto padre ya están en carrito (todas las variantes)
        const otherFlavorsQty = cart
            .filter(i => (i.parentId || i.id) === parentId && i.id !== id)
            .reduce((sum, i) => sum + i.qty, 0);

        if (newQty + otherFlavorsQty > prodRef.stock) {
            Swal.fire({ title: 'Stock Insuficiente', text: `Solo hay ${prodRef.stock} unidades disponibles en total.`, icon: 'warning', toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
            return;
        }
        cart[index].qty = newQty;
    }
    updateCartUI();
}

function clearCartConfirm() {
    if (cart.length === 0) return;
    cart = []; updateCartUI();
}

function updateCartUI() {
    const list = document.getElementById('cart-items');
    const totUSD = document.getElementById('cart-total');
    const totVES = document.getElementById('cart-total-ves');
    const checkoutBtn = document.getElementById('show-checkout-btn');

    if (cart.length === 0) {
        list.innerHTML = `<div class="py-10 text-center text-slate-400">Carrito vacío</div>`;
        totUSD.textContent = '$0.00';
        totVES.textContent = 'Bs 0.00';
        const totEUR = document.getElementById('cart-total-eur');
        if (totEUR) totEUR.textContent = '€ 0.00';
        
        checkoutBtn.disabled = true;
        checkoutBtn.dataset.totalUsd = "0.00";
        checkoutBtn.dataset.totalVes = "0.00";
        checkoutBtn.dataset.totalEur = "0.00";
        return;
    }

    list.innerHTML = '';
    let subtotalUSD = 0;
    let subtotalVES = 0;

    cart.forEach(item => {
        // Robuustez en precios: usar 0 si falta cualquier dato
        const itemPriceVES = item.priceVES || 0;
        const itemPriceUSD = item.priceUSD || 0;

        subtotalUSD += (itemPriceUSD * item.qty);
        subtotalVES += (itemPriceVES * item.qty);

        const li = document.createElement('div');
        li.className = 'bg-white dark:bg-slate-800 rounded-xl shadow-sm p-3 mb-3 border border-slate-100 dark:border-slate-700 flex items-center cart-item-enter';
        li.innerHTML = `
            <div class="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 overflow-hidden flex-shrink-0"><img src="${item.img}" class="w-full h-full object-cover"></div>
            <div class="ml-3 flex-1">
                <h5 class="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-1">${item.name}</h5>
                <div class="text-brand-600 dark:text-brand-400 font-black text-sm">
                    ${formatVES(itemPriceVES)} 
                    <span class="text-[10px] text-slate-400 ml-1">Ref: ${formatUSD(itemPriceUSD)}</span>
                </div>
            </div>
            <div class="flex items-center ml-2 bg-slate-50 dark:bg-slate-900 rounded-lg p-1 border border-slate-100 dark:border-slate-700">
                <button onclick="updateCartQty('${item.id}', -1)" class="w-7 h-7 text-slate-500 hover:bg-white dark:hover:bg-slate-700 rounded"><i class="fas ${item.qty === 1 ? 'fa-trash-alt text-red-400' : 'fa-minus'} text-xs"></i></button>
                <span class="w-6 text-center text-sm font-bold text-slate-800 dark:text-slate-100">${item.qty}</span>
                <button onclick="updateCartQty('${item.id}', 1)" class="w-7 h-7 text-slate-500 hover:bg-white dark:hover:bg-slate-700 rounded"><i class="fas fa-plus text-xs"></i></button>
            </div>
        `;
        list.appendChild(li);
    });

    const totalUSD = subtotalUSD || 0;
    const totalBs = subtotalVES || 0;
    
    // CÁLCULO DE EUR POR PROPORCIÓN DIRECTA CON USD
    // Esto evita que tasas de Bolívares mal configuradas arruinen el monto de Euros.
    // Si la tasa de Euro es 510 y la de Dólar 480, el Euro es USD * 0.94
    const conversionFactor = (settings.euroRate && settings.exchangeRate) ? (settings.exchangeRate / settings.euroRate) : 0.94;
    const totalEur = totalUSD * conversionFactor;

    totUSD.textContent = formatUSD(totalUSD);
    totVES.textContent = formatVES(totalBs);
    
    const totEUR = document.getElementById('cart-total-eur');
    if (totEUR) totEUR.textContent = formatEUR(totalEur);

    checkoutBtn.disabled = false;
    checkoutBtn.dataset.totalUsd = (totalUSD || 0).toFixed(2);
    checkoutBtn.dataset.totalVes = (totalBs || 0).toFixed(2);
    checkoutBtn.dataset.totalEur = (totalEur || 0).toFixed(2);

    // Broadcast live state to cloud
    if (typeof cloudSyncPushLiveState === 'function') cloudSyncPushLiveState();
}

// Checkout Form
let checkoutMethod = 'cash-usd';
let currentTotalUSD = 0;
let currentTotalVES = 0;

function initCheckout() {
    const modal = document.getElementById('checkout-modal');

    document.getElementById('show-checkout-btn').addEventListener('click', () => {
        if (cart.length === 0) return;
        currentTotalUSD = parseFloat(document.getElementById('show-checkout-btn').dataset.totalUsd);
        currentTotalVES = parseFloat(document.getElementById('show-checkout-btn').dataset.totalVes);
        const totalEur = parseFloat(document.getElementById('show-checkout-btn').dataset.totalEur);

        document.getElementById('checkout-total-display').textContent = formatUSD(currentTotalUSD);
        document.getElementById('checkout-total-ves-display').textContent = formatVES(currentTotalVES);
        const eurDisplay = document.getElementById('checkout-total-eur-display');
        if (eurDisplay) eurDisplay.textContent = formatEUR(totalEur);

        document.getElementById('checkout-observations').value = '';

        // Reset to default method with safeguard
        const defaultMethodBtn = document.querySelector('[data-method="cash-usd"]');
        if (defaultMethodBtn) defaultMethodBtn.click();

        const modalContent = document.getElementById('checkout-modal-content');
        modal.classList.add('modal-open');
        setTimeout(() => { 
            modal.classList.add('modal-fade-in'); 
            if (modalContent) modalContent.classList.add('modal-scale-in'); 
        }, 10);
    });

    // Payment Tabs
    document.querySelectorAll('.payment-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            checkoutMethod = btn.dataset.method;

            // Update tab UI
            document.querySelectorAll('.payment-tab').forEach(t => {
                t.classList.remove('active', 'border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/20', 'text-brand-600', 'dark:text-brand-400', 'shadow-lg', 'shadow-brand-500/20', 'shadow-inner');
                t.classList.add('border-slate-100', 'dark:border-slate-700', 'bg-white', 'dark:bg-slate-800', 'text-slate-400');
            });
            
            btn.classList.add('active', 'border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/20', 'text-brand-600', 'dark:text-brand-400', 'shadow-lg', 'shadow-brand-500/20', 'shadow-inner');
            btn.classList.remove('border-slate-100', 'dark:border-slate-700', 'bg-white', 'dark:bg-slate-800', 'text-slate-400');

            // Reveal and Animate Container
            const detailsContainer = document.getElementById('payment-details-container');
            if (detailsContainer) {
                detailsContainer.classList.remove('hidden');
                setTimeout(() => detailsContainer.classList.add('reveal-active'), 10);
            }

            const cashSec = document.getElementById('cash-section');
            const cardSec = document.getElementById('card-section');
            const pmSec = document.getElementById('pm-extra-fields');
            const input = document.getElementById('amount-received');

            if (checkoutMethod === 'card-ves') {
                if (cashSec) cashSec.classList.add('hidden'); 
                if (cardSec) cardSec.classList.remove('hidden');
                if (pmSec) pmSec.classList.add('hidden');
                document.getElementById('tpv-amount-bs').textContent = formatVES(currentTotalVES);
            } else {
                if (cardSec) cardSec.classList.add('hidden'); 
                if (cashSec) cashSec.classList.remove('hidden');
                
                input.value = '';
                let symbol = 'Bs';
                let label = 'Monto Recibido (VES)';
                
                if (checkoutMethod === 'cash-usd') { 
                    symbol = '$'; 
                    label = 'Monto Recibido (USD)'; 
                    if (pmSec) pmSec.classList.add('hidden');
                }
                else if (checkoutMethod === 'cash-eur') { 
                    symbol = '€'; 
                    label = 'Monto Recibido (EUR)'; 
                    if (pmSec) pmSec.classList.add('hidden');
                }
                else if (checkoutMethod === 'pago-movil') {
                    symbol = 'Bs';
                    label = 'Pago Móvil Recibido (VES)';
                    if (pmSec) pmSec.classList.remove('hidden');
                } else {
                    if (pmSec) pmSec.classList.add('hidden');
                }
                
                document.getElementById('currency-input-symbol').textContent = symbol;
                document.getElementById('label-amount-received').textContent = label;
                setTimeout(() => input.focus(), 150);
            }
            validatePayment();
        });
    });

    document.getElementById('amount-received').addEventListener('input', validatePayment);
    document.getElementById('confirm-payment-btn').addEventListener('click', processPayment);

    const sendToMgmtBtn = document.getElementById('send-to-management-btn');
    if (sendToMgmtBtn) {
        sendToMgmtBtn.addEventListener('click', sendToAppManagement);
    }

    document.querySelectorAll('.close-checkout-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); document.getElementById('checkout-modal-content').classList.remove('modal-scale-in');
        setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));

    // Listeners para validación en tiempo real de campos Pago Móvil
    ['pm-id', 'pm-phone', 'pm-ref'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', validatePayment);
    });
}

function validatePayment() {
    const confirmBtn = document.getElementById('confirm-payment-btn');
    const changeEl = document.getElementById('checkout-change');
    const changeSecEl = document.getElementById('checkout-change-secundary');
    const container = document.getElementById('change-container');

    if (checkoutMethod === 'card-ves') {
        confirmBtn.disabled = false;
        return;
    }

    const received = parseFloat(document.getElementById('amount-received').value) || 0;
    let change = 0;
    let changeSec = 0;
    let isValid = false;

    if (checkoutMethod === 'cash-usd') {
        change = received - currentTotalUSD;
        changeSec = change * settings.exchangeRate;
        isValid = received >= currentTotalUSD && received > 0;
        changeEl.textContent = formatUSD(Math.max(0, change));
        changeSecEl.textContent = isValid ? `Eq: ${formatVES(changeSec)}` : '';
    } else if (checkoutMethod === 'cash-ves' || checkoutMethod === 'pago-movil') {
        change = received - currentTotalVES;
        changeSec = change / settings.exchangeRate;
        isValid = received >= currentTotalVES && received > 0;
        changeEl.textContent = formatVES(Math.max(0, change));
        changeSecEl.textContent = isValid ? `Eq: ${formatUSD(changeSec)}` : '';
    } else if (checkoutMethod === 'cash-eur') {
        const totalEUR = currentTotalVES / (settings.euroRate || 40);
        change = received - totalEUR;
        changeSec = change * (settings.euroRate || 40);
        isValid = received >= totalEUR && received > 0;
        changeEl.textContent = formatEUR(Math.max(0, change));
        changeSecEl.textContent = isValid ? `Eq: ${formatVES(changeSec)}` : '';
    }

    // Validación extra para Pago Móvil (Referencia obligatoria)
    let pmRefMsg = '';
    if (checkoutMethod === 'pago-movil') {
        const ref = document.getElementById('pm-ref')?.value.trim() || '';
        const phone = document.getElementById('pm-phone')?.value.trim() || '';
        const ci = document.getElementById('pm-id')?.value.trim() || '';
        if (ref.length < 4) { isValid = false; pmRefMsg = 'Falta referencia (4 dígitos)'; }
        if (!phone) { isValid = false; pmRefMsg = 'Falta teléfono de origen'; }
        if (!ci) { isValid = false; pmRefMsg = 'Falta cédula de origen'; }
    }
    const pmHint = document.getElementById('pm-validation-hint');
    if (pmHint) {
        pmHint.textContent = pmRefMsg;
        pmHint.classList.toggle('hidden', !pmRefMsg);
    }

    if (isValid) {
        container.classList.remove('bg-red-50', 'border-red-200');
        container.classList.add('bg-emerald-50', 'border-emerald-100');
        confirmBtn.disabled = false;
    } else {
        container.classList.add('bg-red-50', 'border-red-200');
        container.classList.remove('bg-emerald-50', 'border-emerald-100');
        confirmBtn.disabled = true;
    }
}

function processPayment() {
    console.log('🚀 Iniciando proceso de cobro...');
    try {
        const clientId = document.getElementById('pos-client-id').value;
        const searchVal = document.getElementById('pos-client-search').value.trim();
        const clientDocInput = document.getElementById('pos-client-document')?.value.trim();
        const clientNameInput = document.getElementById('pos-client-name')?.value.trim();
        const clientPhoneInput = document.getElementById('pos-client-phone')?.value.trim();

        let client = clients.find(c => c.id === clientId);

        // Auto-Registro: Si no hay ID pero hay Nombre/Documento, buscar o crear
        if (!client && (clientNameInput || searchVal || clientDocInput)) {
            const nameToFind = clientNameInput || searchVal;
            const docToFind = clientDocInput;
            
            if (docToFind && docToFind !== 'V-00000000') {
                client = clients.find(c => c.document === docToFind);
            }
            
            if (!client && nameToFind) {
                client = clients.find(c => c.name.toLowerCase() === nameToFind.toLowerCase());
            }
            
            if (!client) {
                client = { 
                    id: generateId(), 
                    document: clientDocInput || 'V-NUEVO', 
                    name: clientNameInput || searchVal || 'Cliente Nuevo', 
                    phone: clientPhoneInput || '' 
                };
                clients.push(client);
                saveClients();
                if (typeof renderClients === 'function') renderClients();
            }
        }

        if (!client) client = { name: 'Cliente Genérico', document: 'V-000000' };

        // Reduce Stock
        cart.forEach(item => {
            const pIndex = products.findIndex(p => p.id === item.id || p.id === item.parentId);
            if (pIndex > -1) products[pIndex].stock -= item.qty;
        });
        saveProducts();

        const saleRecord = {
            ticket: padTicketNumber(currentTicketNumber),
            date: new Date().toISOString(),
            client: client,
            items: cart.map(item => {
                const unitPriceVES = item.promoPriceVES || item.priceVES || Math.round((item.price * settings.exchangeRate) / 10) * 10;
                const unitPriceUSD = item.priceUSD || item.price;
                return {
                    ...item,
                    unitPriceVES: unitPriceVES,
                    unitPriceUSD: unitPriceUSD,
                    totalPriceVES: unitPriceVES * item.qty,
                    totalPriceUSD: unitPriceUSD * item.qty,
                    costPrice: products.find(p => p.id === item.id || p.id === item.parentId)?.costPrice || 0
                };
            }),
            method: (window.pendingStatus === 'pending') ? 'Crédito' : checkoutMethod,
            pmDetails: checkoutMethod === 'pago-movil' ? {
                id: document.getElementById('pm-id')?.value.trim(),
                phone: document.getElementById('pm-phone')?.value.trim(),
                ref: document.getElementById('pm-ref')?.value.trim()
            } : null,
            observations: document.getElementById('checkout-observations').value.trim(),
            totalUSD: currentTotalUSD,
            totalVES: currentTotalVES,
            totalEUR: currentTotalUSD * ((settings.euroRate && settings.exchangeRate) ? (settings.exchangeRate / settings.euroRate) : 0.94),
            exchangeRate: settings.exchangeRate,
            totalCostUSD: cart.reduce((acc, item) => {
                const prod = products.find(p => p.id === item.id || p.id === item.parentId);
                return acc + ((prod?.costPrice || 0) * item.qty);
            }, 0),
            timestamp: Date.now(),
            status: window.pendingStatus || 'paid',
            id: padTicketNumber(currentTicketNumber),
            clientId: client?.id || null
        };

        sales.push(saleRecord);
        if (window.db) window.db.saveSale(saleRecord).catch(e => console.error('Error DB:', e));
        window.pendingStatus = 'paid';

        saveProducts(); saveSales(); incTicketNumber();

        logAction('SALE_COMPLETE', `Venta #${saleRecord.ticket}`, { totalUSD: currentTotalUSD, method: checkoutMethod });

        if (typeof checkLowStockAlerts === 'function') checkLowStockAlerts();

        // Multi-Branch Cloud Sync
        if (typeof cloudSyncPushSale === 'function') cloudSyncPushSale(saleRecord);
        if (typeof cloudSyncPushAlerts === 'function') cloudSyncPushAlerts();

        // 📲 Alerta automática de venta al Jefe por WhatsApp
        if (window.electronAPI && window.electronAPI.sendWASaleAlert && settings.bossPhone) {
            const todayStr = new Date().toDateString();
            const dailyTotalUSD = sales
                .filter(s => new Date(s.date).toDateString() === todayStr && s.status !== 'pending')
                .reduce((acc, s) => acc + (parseFloat(s.totalUSD) || 0), 0);
            window.electronAPI.sendWASaleAlert(settings.bossPhone, saleRecord, dailyTotalUSD)
                .catch(e => console.warn('WA sale alert failed:', e));
        }

        // Limpiar UI
        cart = []; updateCartUI(); renderProducts();
        if (!document.getElementById('view-inventory').classList.contains('hidden')) renderInventory();

        // Cerrar Modal
        const closeBtn = document.querySelector('.close-checkout-modal');
        if (closeBtn) closeBtn.click();

        // Alerta Final
        if (settings.autoPrint) {
            printTicket(saleRecord);
            Swal.fire({ title: '¡Pago Exitoso!', text: `Ticket #${saleRecord.ticket} procesado e imprimiendo...`, icon: 'success', timer: 2000, showConfirmButton: false });
        } else {
            Swal.fire({
                icon: 'success', title: '¡Pago Exitoso!',
                text: `Ticket #${saleRecord.ticket} procesado.`,
                showCancelButton: true,
                confirmButtonText: '<i class="fas fa-print"></i> Imprimir',
                cancelButtonText: 'Nueva Venta',
                reverseButtons: true
            }).then((res) => { if (res.isConfirmed) printTicket(saleRecord); });
        }
        
        // Actualizar número de orden en pantalla principal si existe
        const orderDisp = document.getElementById('order-number-display');
        if (orderDisp) orderDisp.textContent = `Ticket #${padTicketNumber(currentTicketNumber)}`;

    } catch (err) {
        console.error('❌ Error crítico en processPayment:', err);
        Swal.fire('Error de Sistema', 'No se pudo completar el cobro: ' + err.message, 'error');
    }
}

// ==========================================
// REPORTS & CHARTS
// ==========================================
// ==========================================
// REPORTS & CHARTS
// ==========================================
let chartCategory = null;
let chartPayment = null;
let anaTrendChart = null;
let anaEfficiencyChart = null;

function renderReports() {
    const totalUSD = sales.reduce((acc, sale) => acc + (Number(sale.totalUSD) || 0), 0);
    const totalVES = sales.reduce((acc, sale) => acc + (Number(sale.totalVES) || (Number(sale.totalUSD) || 0) * settings.exchangeRate), 0);
    const totalCostUSD = sales.reduce((acc, sale) => acc + (Number(sale.totalCostUSD) || 0), 0);
    
    const paidSalesUSD = sales.filter(s => s.status !== 'pending').reduce((acc, s) => acc + (parseFloat(s.totalUSD) || 0), 0);
    const rawCostUSD = sales.reduce((acc, s) => acc + (parseFloat(s.totalCostUSD) || 0), 0);
    const totalExpensesUSD = typeof expenses !== 'undefined' && Array.isArray(expenses) ? expenses.reduce((acc, e) => acc + (parseFloat(e.amountUSD) || 0), 0) : 0;
    
    // Validación para Gastos (Expenses): Si el usuario digitó bolívares en vez de dólares por error, el gasto será absurdo.
    let safeTotalExpensesUSD = totalExpensesUSD;
    if (safeTotalExpensesUSD > (paidSalesUSD * 10 || 1000)) {
        safeTotalExpensesUSD = safeTotalExpensesUSD / settings.exchangeRate;
    }
    
    // Cálculo de 'Ganancia Real' (MARGEN BRUTO COMERCIAL)
    let netProfitUSD = 0;
    if (rawCostUSD > paidSalesUSD * 0.95 && paidSalesUSD > 0) {
        // Ignorar costos históricos corruptos, asumir 30% de margen estándar
        netProfitUSD = paidSalesUSD * 0.30;
    } else {
        netProfitUSD = paidSalesUSD - rawCostUSD;
    }
    
    // Clampeo Visual Definitivo: La ganancia por ventas de mercancía no puede ser negativa en condiciones lógicas
    if (isNaN(netProfitUSD) || netProfitUSD < 0) {
        netProfitUSD = 0;
    }

    document.getElementById('report-total-sales').textContent = formatVES(totalVES);
    document.getElementById('report-net-profit').textContent = formatVES(netProfitUSD * settings.exchangeRate);
    document.getElementById('report-total-tickets').textContent = sales.length;
    document.getElementById('report-total-items').textContent = sales.reduce((acc, s) => {
        return acc + (Array.isArray(s.items) ? s.items.reduce((a, i) => a + (Number(i.qty) || 0), 0) : 0);
    }, 0);

    const tbody = document.getElementById('reports-table-body');
    if(tbody) tbody.innerHTML = '';
    const sorted = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Map methods to friendly names
    const methodNames = {
        'cash-usd': '<span class="text-green-600 bg-green-50 px-2 rounded font-bold"><i class="fas fa-dollar-sign"></i> Efec $</span>',
        'cash-ves': '<span class="text-blue-600 bg-blue-50 px-2 rounded font-bold"><i class="fas fa-money-bill"></i> Efec BS</span>',
        'card-ves': '<span class="text-brand-600 bg-brand-50 px-2 rounded font-bold"><i class="fas fa-credit-card"></i> Punto BS</span>',
        'pago-movil': '<span class="text-purple-600 bg-purple-50 px-2 rounded font-bold"><i class="fas fa-mobile-alt"></i> Pago Móvil</span>',
        'cash-eur': '<span class="text-blue-700 bg-blue-100 px-2 rounded font-bold"><i class="fas fa-euro-sign"></i> Euros</span>'
    };

    // Aggregate Data for Charts
    let catTotals = {};
    let methodTotals = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0 };

    sorted.forEach(sale => {
        const saleTotalVES = Number(sale.totalVES) || (Number(sale.totalUSD) || 0) * settings.exchangeRate;
        const saleMethod = sale.method || 'cash-usd';
        
        methodTotals[saleMethod] = (methodTotals[saleMethod] || 0) + saleTotalVES;
        
        if (Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                const itemCat = item.category || 'Sin Categoría';
                const itemVES = Number(item.unitPriceVES) || (Number(item.price) * settings.exchangeRate) || 0;
                catTotals[itemCat] = (catTotals[itemCat] || 0) + (itemVES * (Number(item.qty) || 1));
            });
        }

        const timeStr = sale.date ? new Date(sale.date).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const displayTicket = sale.ticket || sale.id || '0000';
        
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 border-b border-slate-100";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-slate-800 dark:text-slate-100">#${displayTicket}</td>
            <td class="py-4 px-6 text-slate-500 dark:text-slate-400">${timeStr}</td>
            <td class="py-4 px-6 font-semibold dark:text-slate-200">${sale.client?.name || 'Cliente Final'}</td>
            <td class="py-4 px-6 text-xs">
                ${methodNames[saleMethod] || saleMethod}
                ${saleMethod === 'pago-movil' && sale.pmDetails ? `
                    <div class="mt-1 text-[9px] text-slate-400 font-medium">
                        Ref: <span class="font-bold text-purple-600">*${sale.pmDetails.ref || '----'}</span><br>
                        ${sale.pmDetails.id ? `CI: ${sale.pmDetails.id}` : ''}
                    </div>
                ` : ''}
            </td>
            <td class="py-4 px-6 text-right font-black text-slate-800 dark:text-slate-100">
                ${formatVES(saleTotalVES)}<br>
                <span class="text-[10px] text-slate-400 font-normal">Ref: ${formatUSD(Number(sale.totalUSD) || 0)}</span>
            </td>
            <td class="py-4 px-6 text-center whitespace-nowrap">
                <button onclick="continueInvoice('${displayTicket}')" class="text-emerald-600 hover:bg-emerald-50 p-2 rounded-lg transition-colors mr-1" title="Continuar Factura">
                    <i class="fas fa-redo-alt"></i>
                </button>
                <button onclick="printTicketFromReport('${displayTicket}')" class="text-brand-600 hover:bg-brand-50 p-2 rounded-lg transition-colors" title="Imprimir Ticket">
                    <i class="fas fa-print"></i>
                </button>
            </td>
        `;
        if(tbody) tbody.appendChild(tr);
    });

    // Charts are now in Rendimientos - aggregate data for later use
    // Render Charts in renderAnalytics() instead
    window._lastCatTotals = catTotals;
    window._lastMethodTotals = methodTotals;
    
    // If analytics view is visible, update charts immediately
    if (!document.getElementById('view-analytics').classList.contains('hidden')) {
        renderInternalCharts(catTotals, methodTotals);
    }

    // Clear btn
    const clearBtn = document.getElementById('clear-reports-btn');
    if (clearBtn) clearBtn.onclick = () => {
        if (sales.length === 0) return;
        Swal.fire({
            title: '¿Cerrar Caja y Borrar Datos?',
            text: "Se borrará definitivamente el historial del día.",
            icon: 'warning',
            showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Borrar Datos'
        }).then((res) => {
            if (res.isConfirmed) { sales = []; saveSales(); renderReports(); }
        });
    };
}

// ==========================================
// RENDIMIENTOS — Filtro de Período Activo
// ==========================================
window._analyticsPeriod = window._analyticsPeriod || 'day';
window._analyticsCustomDate = window._analyticsCustomDate || null;

function setAnalyticsPeriod(period, customDate) {
    window._analyticsPeriod = period;
    window._analyticsCustomDate = customDate || null;
    renderAnalytics();
}

function getSalesForPeriod(period, customDate) {
    const now = new Date();
    const todayStr = now.toDateString();

    // Cargar historial desde DB si está disponible, o usar dailyHistory + sales actuales
    let allSales = [...sales]; // ventas de hoy en memoria

    // Agregar ventas históricas desde dailyHistory (tienen items si se guardaron bien)
    // Si dailyHistory tiene items detallados, los usamos; si no, usamos solo totales
    const historicSales = [];
    if (Array.isArray(dailyHistory)) {
        dailyHistory.forEach(d => {
            if (Array.isArray(d.sales)) {
                d.sales.forEach(s => historicSales.push(s));
            }
        });
    }
    allSales = [...historicSales, ...allSales];

    // Filtrar según período
    return allSales.filter(s => {
        if (!s || !s.date) return false;
        const sDate = new Date(s.date);
        if (isNaN(sDate.getTime())) return false;
        if (s.status === 'pending') return false;

        if (period === 'day') {
            if (customDate) {
                return sDate.toDateString() === new Date(customDate + 'T12:00:00').toDateString();
            }
            return sDate.toDateString() === todayStr;
        }
        if (period === 'week') {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);
            return sDate >= startOfWeek;
        }
        if (period === 'month') {
            return sDate.getMonth() === now.getMonth() && sDate.getFullYear() === now.getFullYear();
        }
        if (period === 'year') {
            return sDate.getFullYear() === now.getFullYear();
        }
        return true;
    });
}

function renderAnalytics() {
    const period = window._analyticsPeriod || 'day';
    const customDate = window._analyticsCustomDate;

    // Renderizar controles de filtro si no existen
    renderAnalyticsPeriodControls();

    // Obtener ventas del período seleccionado
    const periodSales = getSalesForPeriod(period, customDate);

    // ── 1. Inversión en Stock ──────────────────────────────────────────
    const inventoryValue = products.reduce((acc, p) => acc + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0)), 0);
    const valEl = document.getElementById('ana-inventory-value');
    if (valEl) valEl.textContent = formatUSD(inventoryValue);

    // ── 2. Ventas y Utilidad del Período ──────────────────────────────
    let periodSalesUSD = 0;
    let periodCostUSD = 0;

    periodSales.forEach(s => {
        const saleUSD = Number(s.totalUSD) || 0;
        periodSalesUSD += saleUSD;

        // Calcular costo: usar totalCostUSD si existe y es razonable,
        // si no, retro-calcular desde inventario actual
        let saleCost = Number(s.totalCostUSD) || 0;
        if (saleCost <= 0 || saleCost > saleUSD * 2) {
            // Costo corrupto o ausente → retro-calcular
            if (Array.isArray(s.items)) {
                saleCost = s.items.reduce((acc, item) => {
                    const prod = products.find(p => p.id === item.id || p.id === item.parentId);
                    const cost = Number(prod?.costPrice) || 0;
                    return acc + (cost * (Number(item.qty) || 0));
                }, 0);
            }
            // Si sigue siendo 0 o negativo, asumir margen del 30%
            if (saleCost <= 0) saleCost = saleUSD * 0.70;
        }
        periodCostUSD += saleCost;
    });

    // Proteger contra costos que superen ventas (datos corruptos)
    if (periodCostUSD > periodSalesUSD && periodSalesUSD > 0) {
        periodCostUSD = periodSalesUSD * 0.70; // Asumir margen 30%
    }

    const periodProfitUSD = Math.max(0, periodSalesUSD - periodCostUSD);
    const avgMargin = periodSalesUSD > 0 ? (periodProfitUSD / periodSalesUSD) * 100 : 0;

    // Mostrar Utilidad
    const profEl = document.getElementById('ana-total-profit');
    if (profEl) profEl.textContent = formatUSD(periodProfitUSD);

    // Mostrar Margen
    const margEl = document.getElementById('ana-average-margin');
    if (margEl) {
        margEl.textContent = avgMargin.toFixed(1) + '%';
        margEl.closest?.('.bg-brand-600, [class*="bg-brand"]')?.classList?.toggle('bg-rose-600', avgMargin < 0);
    }

    // ── 3. Proyección del Mes ─────────────────────────────────────────
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const today = new Date();
    const dayOfMonth = today.getDate(); // Día actual del mes (1-31)

    let recentAvgSales = 0;
    const daySalesHistory = (Array.isArray(dailyHistory) ? dailyHistory.slice(-7) : []);

    if (daySalesHistory.length > 0) {
        // Tenemos historial de cierres → usarlo
        recentAvgSales = daySalesHistory.reduce((acc, d) => acc + (Number(d.salesUSD) || 0), 0) / daySalesHistory.length;
    } else if (Array.isArray(sales) && sales.length > 0) {
        // Sin historial de cierres → calcular promedio diario desde las ventas reales
        const salesByDay = {};
        sales.forEach(s => {
            const dayKey = new Date(s.date || s.timestamp).toDateString();
            salesByDay[dayKey] = (salesByDay[dayKey] || 0) + (Number(s.totalUSD) || 0);
        });
        const uniqueDays = Object.keys(salesByDay).length;
        const totalFromSales = Object.values(salesByDay).reduce((a, b) => a + b, 0);
        recentAvgSales = uniqueDays > 0 ? totalFromSales / uniqueDays : 0;
    }

    // Si el promedio es $0 pero hay ventas este período, usar ventas del período / días transcurridos
    if (recentAvgSales === 0 && periodSalesUSD > 0 && dayOfMonth > 0) {
        recentAvgSales = periodSalesUSD / dayOfMonth;
    }

    const projectedSales = recentAvgSales * daysInMonth;
    const projEl = document.getElementById('ana-projection-value');
    if (projEl) projEl.textContent = formatUSD(projectedSales);


    // ── 4. Ranking de Productos más Rentables ─────────────────────────
    const prodStats = {};
    periodSales.forEach(s => {
        if (!Array.isArray(s.items)) return;
        s.items.forEach(i => {
            if (!prodStats[i.id]) prodStats[i.id] = { name: i.name, qty: 0, profit: 0, cost: 0 };
            const prod = products.find(p => p.id === i.id || p.id === i?.parentId);
            const cost = Number(prod?.costPrice) || 0;
            const itemPrice = Number(i.unitPriceUSD || i.price) || 0;
            const itemQty = Number(i.qty) || 0;
            prodStats[i.id].qty += itemQty;
            prodStats[i.id].profit += (itemPrice - cost) * itemQty;
            prodStats[i.id].cost = cost;
        });
    });

    const ranking = Object.values(prodStats).sort((a, b) => b.profit - a.profit).slice(0, 5);
    const rankingBody = document.getElementById('ana-top-products-body');
    if (rankingBody) {
        rankingBody.innerHTML = ranking.length ? ranking.map(p => {
            const unitProfit = p.qty > 0 ? p.profit / p.qty : 0;
            const margin = (unitProfit + p.cost) > 0 ? (unitProfit / (unitProfit + p.cost)) * 100 : 0;
            return `
                <tr>
                    <td class="py-4 px-8 font-bold text-slate-700">${p.name}</td>
                    <td class="py-4 px-8 text-center font-medium text-slate-500">${p.qty}</td>
                    <td class="py-4 px-8 text-center"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-bold">${isNaN(margin) ? 0 : margin.toFixed(0)}%</span></td>
                    <td class="py-4 px-8 text-right font-black text-slate-800">${formatUSD(p.profit || 0)}</td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="4" class="py-10 text-center text-slate-400 italic">No hay ventas en este período</td></tr>';
    }

    // ── 5. Gráficos ───────────────────────────────────────────────────
    renderAnalyticsCharts(periodProfitUSD, periodSales);

    if (window._lastCatTotals && window._lastMethodTotals) {
        renderInternalCharts(window._lastCatTotals, window._lastMethodTotals);
    } else {
        let catTotals = {};
        let methodTotals = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0 };
        periodSales.forEach(sale => {
            methodTotals[sale.method] = (methodTotals[sale.method] || 0) + (Number(sale.totalVES) || 0);
            if (!Array.isArray(sale.items)) return;
            sale.items.forEach(item => {
                catTotals[item.category] = (catTotals[item.category] || 0) + ((Number(item.unitPriceVES) || 0) * (Number(item.qty) || 0));
            });
        });
        renderInternalCharts(catTotals, methodTotals);
    }

    // ── 6. Punto de Equilibrio ────────────────────────────────────────
    const expensesList = typeof expenses !== 'undefined' && Array.isArray(expenses) ? expenses : [];
    const totalExpensesUSD = expensesList.reduce((acc, e) => acc + (Number(e.amountUSD) || 0), 0);
    const safeTotalExpensesUSD = totalExpensesUSD > periodSalesUSD * 10 ? totalExpensesUSD / (settings.exchangeRate || 36) : totalExpensesUSD;
    const avgMarginRate = avgMargin > 0 ? avgMargin / 100 : 0.30;
    const breakEvenSales = safeTotalExpensesUSD / avgMarginRate;
    const bePercent = breakEvenSales > 0 ? Math.min(100, (periodSalesUSD / breakEvenSales) * 100) : 100;

    const beStatusEl = document.getElementById('ana-be-status');
    const bePercentEl = document.getElementById('ana-be-percent');
    const beBarEl = document.getElementById('ana-be-bar');
    if (beStatusEl) {
        if (safeTotalExpensesUSD === 0) {
            beStatusEl.textContent = 'Registra gastos para calcular el punto de equilibrio';
        } else if (periodSalesUSD >= breakEvenSales) {
            beStatusEl.textContent = '¡Meta Alcanzada! (Ganancia neta)';
            beStatusEl.classList.add('text-emerald-600');
        } else {
            beStatusEl.textContent = `Faltan ${formatUSD(breakEvenSales - periodSalesUSD)} para ser rentable`;
            beStatusEl.classList.remove('text-emerald-600');
        }
    }
    if (bePercentEl) bePercentEl.textContent = (isNaN(bePercent) ? 0 : bePercent).toFixed(0) + '%';
    if (beBarEl) beBarEl.style.width = (isNaN(bePercent) ? 0 : bePercent) + '%';

    // ── 7. Insights ───────────────────────────────────────────────────
    const insightsContainer = document.getElementById('ana-insights-container');
    if (insightsContainer) {
        let insightsHTML = '';
        const slowMovers = products.filter(p => p.stock > 0 && !prodStats[p.id]).sort((a, b) => (b.stock * b.costPrice) - (a.stock * a.costPrice)).slice(0, 2);
        const totalDeadValue = slowMovers.reduce((acc, p) => acc + (p.stock * p.costPrice), 0);
        if (slowMovers.length > 0 && totalDeadValue > 0) {
            insightsHTML += `<div class="flex gap-4 animate-fadeIn"><div class="w-10 h-10 shrink-0 bg-rose-500/20 rounded-xl flex items-center justify-center text-rose-400"><i class="fas fa-exclamation-triangle"></i></div><div><p class="text-xs font-bold text-rose-300 mb-1">Capital Muerto Detectado</p><p class="text-[10px] text-slate-400 leading-relaxed">Tienes <b>${formatUSD(totalDeadValue)}</b> en stock que no se mueve. ${slowMovers.map(p => `<b>${p.name}</b> (x${p.stock})`).join(' y ')}.</p></div></div>`;
        }
        if (periodSalesUSD > recentAvgSales * 1.05) {
            insightsHTML += `<div class="flex gap-4 animate-fadeIn"><div class="w-10 h-10 shrink-0 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400"><i class="fas fa-rocket"></i></div><div><p class="text-xs font-bold text-emerald-300 mb-1">Crecimiento Detectado</p><p class="text-[10px] text-slate-400 leading-relaxed">Estás vendiendo <b>${formatUSD(periodSalesUSD - recentAvgSales)}</b> más que tu promedio habitual.</p></div></div>`;
        }
        insightsContainer.innerHTML = insightsHTML || '<p class="text-xs text-slate-500 italic text-center">No hay alertas críticas en este período.</p>';
    }

    // ── 8. Capacidad de Reposición ─────────────────────────────────────
    const replenishEl = document.getElementById('ana-replenish-advice');
    if (replenishEl) replenishEl.textContent = `Puedes reinvertir hasta ${formatUSD(periodProfitUSD * 0.7)} en mercancía manteniendo el flujo de caja estable.`;

    // ── 9. Runway de Inventario ────────────────────────────────────────
    const avgDailyItemsCost = periodSalesUSD * 0.7 || 1;
    const runwayDays = inventoryValue / avgDailyItemsCost;
    const runwayEl = document.getElementById('ana-inventory-runway');
    if (runwayEl) {
        runwayEl.textContent = `${Math.round(runwayDays)} días de stock`;
        runwayEl.className = runwayDays < 5
            ? 'px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-black rounded-lg border border-rose-100 animate-pulse'
            : 'px-2 py-0.5 bg-brand-50 text-brand-700 text-[10px] font-black rounded-lg border border-brand-100';
    }

    // ── 10. Deuda Pendiente de Proveedores (Cuentas por Pagar) ──────────
    const payablesList = typeof payables !== 'undefined' && Array.isArray(payables) ? payables : [];
    const pendingPayables = payablesList.filter(p => p.status === 'pending');
    const totalPendingDebt = pendingPayables.reduce((acc, p) => acc + (Number(p.amountUSD) || 0), 0);
    
    const pendingDebtEl = document.getElementById('ana-payables-pending');
    const pendingCountEl = document.getElementById('ana-payables-count');
    
    if (pendingDebtEl) {
        pendingDebtEl.textContent = formatUSD(totalPendingDebt);
        if (totalPendingDebt > 0) {
            pendingDebtEl.closest?.('div[class*="bg-rose"]')?.classList?.add('animate-pulse');
            setTimeout(() => pendingDebtEl.closest?.('div[class*="bg-rose"]')?.classList?.remove('animate-pulse'), 2000);
        }
    }
    if (pendingCountEl) {
        const overdueCount = pendingPayables.filter(p => new Date(p.dueDate) < new Date()).length;
        if (overdueCount > 0) {
            pendingCountEl.textContent = `${pendingPayables.length} facturas (${overdueCount} vencida${overdueCount > 1 ? 's' : ''})`;
            pendingCountEl.classList.add('bg-rose-700', 'border-rose-300');
        } else {
            pendingCountEl.textContent = `${pendingPayables.length} factura${pendingPayables.length !== 1 ? 's' : ''} pendiente${pendingPayables.length !== 1 ? 's' : ''}`;
        }
    }

    // ── 11. Ticket Promedio y Hora Pico ─────────────────────────────
    const txCount = periodSales.length;
    const avgTicketUSD = txCount > 0 ? periodSalesUSD / txCount : 0;
    const er = settings.exchangeRate || 1;
    const avgTicketVES = avgTicketUSD * er;

    const avgTicketEl = document.getElementById('ana-avg-ticket');
    if (avgTicketEl) avgTicketEl.textContent = formatUSD(avgTicketUSD);

    const avgTicketVesEl = document.getElementById('ana-avg-ticket-ves');
    if (avgTicketVesEl) avgTicketVesEl.textContent = `Equivalente a Bs ${avgTicketVES.toFixed(2)} (${txCount} ventas)`;

    // Hora pico
    const hourCounts = {};
    periodSales.forEach(s => {
        const h = new Date(s.timestamp || s.date).getHours();
        hourCounts[h] = (hourCounts[h] || 0) + 1;
    });
    let peakHour = '--:--';
    let maxTx = 0;
    Object.keys(hourCounts).forEach(h => {
        if (hourCounts[h] > maxTx) {
            maxTx = hourCounts[h];
            const hNum = parseInt(h);
            const ampm = hNum >= 12 ? 'PM' : 'AM';
            const displayH = hNum % 12 || 12;
            peakHour = `${displayH}:00 ${ampm} (${maxTx} ventas)`;
        }
    });

    const peakHourEl = document.getElementById('ana-peak-hour');
    if (peakHourEl) peakHourEl.textContent = peakHour;

    // Guardar resumen global para exportación y IA
    window._lastAnalyticsSummary = {
        periodSalesUSD,
        periodProfitUSD,
        avgMargin,
        inventoryValue,
        projectedSales,
        txCount,
        avgTicketUSD,
        avgTicketVES,
        peakHour,
        totalPendingDebt
    };
}

// 🤖 DIAGNÓSTICO DE NEGOCIO CON INTELIGENCIA ARTIFICIAL
window.runAIDiagnostic = function() {
    const summary = window._lastAnalyticsSummary || {};
    const bName = settings.businessName || 'Caja Fresh POS';
    const er = settings.exchangeRate || 1;

    const marginScore = Math.min(100, Math.max(0, summary.avgMargin || 0));
    const profitRatio = summary.periodSalesUSD > 0 ? (summary.periodProfitUSD / summary.periodSalesUSD) : 0;
    let healthStatus = 'Excelente 🟢';
    let healthColor = 'text-emerald-500';
    
    if (profitRatio < 0.15) {
        healthStatus = 'Atención Requerida ⚠️';
        healthColor = 'text-amber-500';
    } else if (profitRatio < 0.05) {
        healthStatus = 'Crítico 🔴';
        healthColor = 'text-rose-500';
    }

    const tips = [];
    if (summary.avgMargin < 25) {
        tips.push('💡 <b>Aumentar Margen:</b> Tu margen promedio está por debajo del 25%. Considera revisar precios de costo con tus proveedores.');
    } else {
        tips.push('✨ <b>Excelente Salud de Margen:</b> Mantienes un margen promedio del ' + (summary.avgMargin || 0).toFixed(1) + '%.');
    }

    if (summary.avgTicketUSD < 5) {
        tips.push('🛍️ <b>Elevar Ticket Promedio:</b> El gasto promedio por cliente es $' + (summary.avgTicketUSD || 0).toFixed(2) + '. Crea combos o promociones para incentivar ventas cruzadas.');
    } else {
        tips.push('🛍️ <b>Buen Ticket Promedio:</b> El promedio por cliente es $' + (summary.avgTicketUSD || 0).toFixed(2) + '.');
    }

    if (summary.peakHour && summary.peakHour !== '--:--') {
        tips.push('⏰ <b>Horario Estratégico:</b> Tu hora pico es <b>' + summary.peakHour + '</b>. Asegúrate de tener suficiente personal y productos listos a esa hora.');
    }

    if (summary.totalPendingDebt > 0) {
        tips.push('⚠️ <b>Control de Deudas:</b> Tienes $' + summary.totalPendingDebt.toFixed(2) + ' pendientes con proveedores. Prioriza la liquidez para saldar facturas.');
    }

    const html = `
        <div class="text-left font-sans space-y-4">
            <div class="bg-slate-900 text-white p-5 rounded-2xl border border-indigo-500/30">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs uppercase tracking-widest font-black text-indigo-400">Salud Financiera del Negocio</span>
                    <span class="text-xs font-bold px-3 py-1 bg-indigo-950 text-indigo-300 rounded-full border border-indigo-700/50">${bName}</span>
                </div>
                <div class="text-2xl font-black ${healthColor} mb-1">${healthStatus}</div>
                <p class="text-xs text-slate-400">Evaluación automática generada por la IA de Rendimiento Caja Fresh.</p>
            </div>

            <div class="grid grid-cols-2 gap-3 text-xs">
                <div class="bg-slate-100 p-3 rounded-xl">
                    <div class="text-slate-500 font-bold uppercase text-[10px]">Ventas del Período</div>
                    <div class="text-base font-black text-slate-800 mt-1">$${(summary.periodSalesUSD || 0).toFixed(2)}</div>
                    <div class="text-[10px] text-slate-400">Bs ${((summary.periodSalesUSD || 0) * er).toFixed(2)}</div>
                </div>
                <div class="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                    <div class="text-emerald-700 font-bold uppercase text-[10px]">Utilidad Ganada</div>
                    <div class="text-base font-black text-emerald-700 mt-1">$${(summary.periodProfitUSD || 0).toFixed(2)}</div>
                    <div class="text-[10px] text-emerald-600">Margen: ${(summary.avgMargin || 0).toFixed(1)}%</div>
                </div>
            </div>

            <div class="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-2 text-xs text-slate-700">
                <div class="font-bold text-indigo-900 uppercase text-[11px] mb-2 flex items-center gap-1.5">
                    <i class="fas fa-lightbulb text-amber-500"></i> Recomendaciones de la IA:
                </div>
                ${tips.map(t => `<div class="leading-relaxed bg-white p-2.5 rounded-lg border border-indigo-50 shadow-sm">${t}</div>`).join('')}
            </div>
        </div>
    `;

    Swal.fire({
        title: '🤖 Diagnóstico Inteligente de Negocio',
        html: html,
        width: '550px',
        confirmButtonText: '✨ Entendido',
        confirmButtonColor: '#4f46e5'
    });
};

// 📲 COMPARTIR RENDIMIENTO POR WHATSAPP AL JEFE
window.sendAnalyticsToWhatsApp = function() {
    const summary = window._lastAnalyticsSummary || {};
    const bName = settings.businessName || 'Caja Fresh POS';
    const bossPhone = settings.bossPhone || settings.businessPhoneFooter || '';
    const dateStr = new Date().toLocaleDateString();
    const er = settings.exchangeRate || 1;

    let msg = `📊 *REPORTE DE RENDIMIENTO — ${bName.toUpperCase()}*\n`;
    msg += `📅 Fecha: ${dateStr}\n`;
    msg += `💵 Tasa Oficial: Bs ${er.toFixed(2)}/$\n`;
    msg += `-----------------------------------\n`;
    msg += `💰 *Ventas Totales:* $${(summary.periodSalesUSD || 0).toFixed(2)} (Bs ${((summary.periodSalesUSD || 0) * er).toFixed(2)})\n`;
    msg += `📈 *Utilidad Neta:* $${(summary.periodProfitUSD || 0).toFixed(2)}\n`;
    msg += `📊 *Margen Promedio:* ${(summary.avgMargin || 0).toFixed(1)}%\n`;
    msg += `🛒 *Total Ventas:* ${summary.txCount || 0} transacciones\n`;
    msg += `🧾 *Ticket Promedio:* $${(summary.avgTicketUSD || 0).toFixed(2)}\n`;
    msg += `⏰ *Hora Pico:* ${summary.peakHour || 'N/A'}\n`;
    msg += `📦 *Valor Inventario:* $${(summary.inventoryValue || 0).toFixed(2)}\n`;
    msg += `🔮 *Cierre Proyectado:* $${(summary.projectedSales || 0).toFixed(2)}\n`;
    msg += `-----------------------------------\n`;
    msg += `✨ _Generado automáticamente por Caja Fresh POS_`;

    const encoded = encodeURIComponent(msg);
    const targetPhone = bossPhone.replace(/\D/g, '');
    const url = targetPhone ? `https://wa.me/${targetPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
};

// 📄 EXPORTAR EXPEDIENTE FINANCIERO A PDF / IMPRIMIR
window.downloadAnalyticsPDF = function() {
    const summary = window._lastAnalyticsSummary || {};
    const bName = settings.businessName || 'Caja Fresh POS';
    const dateStr = new Date().toLocaleString();
    const er = settings.exchangeRate || 1;

    const printWin = window.open('', '_blank', 'width=950,height=800');
    if (!printWin) {
        Swal.fire('Error', 'Por favor habilita las ventanas emergentes (popups) en tu navegador para ver el PDF.', 'error');
        return;
    }

    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Expediente_Financiero_${bName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}</title>
            <style>
                @page { size: A4 portrait; margin: 15mm; }
                body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; color: #0f172a; background: #ffffff; }
                .header-box { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #4f46e5; padding-bottom: 16px; margin-bottom: 20px; }
                .header-title h1 { margin: 0; font-size: 24px; color: #0f172a; font-weight: 800; }
                .header-title p { margin: 4px 0 0; color: #64748b; font-size: 13px; font-weight: 500; }
                .header-meta { text-align: right; font-size: 12px; color: #475569; line-height: 1.6; }
                .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
                .summary-card { background: #f8fafc; padding: 14px; border-radius: 10px; border: 1px solid #e2e8f0; text-align: center; }
                .summary-card .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
                .summary-card .val { font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px; }
                table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
                th { background: #0f172a; color: #ffffff; padding: 12px 10px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 11px; }
                td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; }
                .action-bar { background: #0f172a; padding: 12px 20px; margin-bottom: 20px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; color: white; }
                .action-btn { background: #4f46e5; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
                @media print {
                    .action-bar { display: none !important; }
                    body { padding: 0; }
                }
            </style>
        </head>
        <body>
            <div class="action-bar">
                <span style="font-weight: 600;">📄 Expediente Financiero de Rendimiento</span>
                <button class="action-btn" onclick="window.print()">🖨️ Imprimir / Guardar en PDF</button>
            </div>
            <div class="header-box">
                <div class="header-title">
                    <h1>${bName}</h1>
                    <p>EXPEDIENTE FINANCIERO DE RENDIMIENTO Y BALANCE DE CAJA</p>
                </div>
                <div class="header-meta">
                    <div><b>Fecha de Emisión:</b> ${dateStr}</div>
                    <div><b>Tasa BCV/Oficial:</b> Bs ${er.toFixed(2)} / $</div>
                </div>
            </div>

            <div class="summary-grid">
                <div class="summary-card">
                    <div class="label">Ventas Totales ($)</div>
                    <div class="val" style="color: #2563eb;">$${(summary.periodSalesUSD || 0).toFixed(2)}</div>
                </div>
                <div class="summary-card">
                    <div class="label">Utilidad Neta ($)</div>
                    <div class="val" style="color: #16a34a;">$${(summary.periodProfitUSD || 0).toFixed(2)}</div>
                </div>
                <div class="summary-card">
                    <div class="label">Margen Real</div>
                    <div class="val" style="color: #4f46e5;">${(summary.avgMargin || 0).toFixed(1)}%</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Métrica Financiera</th>
                        <th style="text-align: right;">Valor ($ USD)</th>
                        <th style="text-align: right;">Valor (Bs VES)</th>
                        <th>Observaciones / Estado</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><b>Ventas Totales</b></td>
                        <td style="text-align: right; font-weight: bold;">$${(summary.periodSalesUSD || 0).toFixed(2)}</td>
                        <td style="text-align: right;">Bs ${((summary.periodSalesUSD || 0) * er).toFixed(2)}</td>
                        <td>Ingreso bruto del período</td>
                    </tr>
                    <tr>
                        <td><b>Utilidad Neta Acumulada</b></td>
                        <td style="text-align: right; font-weight: bold; color: #16a34a;">$${(summary.periodProfitUSD || 0).toFixed(2)}</td>
                        <td style="text-align: right;">Bs ${((summary.periodProfitUSD || 0) * er).toFixed(2)}</td>
                        <td>Ganancia después de costos de productos</td>
                    </tr>
                    <tr>
                        <td><b>Inversión en Stock</b></td>
                        <td style="text-align: right; font-weight: bold;">$${(summary.inventoryValue || 0).toFixed(2)}</td>
                        <td style="text-align: right;">Bs ${((summary.inventoryValue || 0) * er).toFixed(2)}</td>
                        <td>Capital total invertido en inventario</td>
                    </tr>
                    <tr>
                        <td><b>Ticket Promedio por Cliente</b></td>
                        <td style="text-align: right; font-weight: bold;">$${(summary.avgTicketUSD || 0).toFixed(2)}</td>
                        <td style="text-align: right;">Bs ${(summary.avgTicketVES || 0).toFixed(2)}</td>
                        <td>Basado en ${summary.txCount || 0} transacciones</td>
                    </tr>
                    <tr>
                        <td><b>Cierre Proyectado del Mes</b></td>
                        <td style="text-align: right; font-weight: bold;">$${(summary.projectedSales || 0).toFixed(2)}</td>
                        <td style="text-align: right;">Bs ${((summary.projectedSales || 0) * er).toFixed(2)}</td>
                        <td>Basado en ritmo promedio de ventas</td>
                    </tr>
                    <tr>
                        <td><b>Hora Pico de Ventas</b></td>
                        <td style="text-align: right; font-weight: bold;" colspan="2">${summary.peakHour || 'N/A'}</td>
                        <td>Período de mayor volumen de clientes</td>
                    </tr>
                    <tr>
                        <td><b>Deuda Pendiente a Proveedores</b></td>
                        <td style="text-align: right; font-weight: bold; color: #dc2626;">$${(summary.totalPendingDebt || 0).toFixed(2)}</td>
                        <td style="text-align: right; color: #dc2626;">Bs ${((summary.totalPendingDebt || 0) * er).toFixed(2)}</td>
                        <td>Cuentas por pagar pendientes</td>
                    </tr>
                </tbody>
            </table>
            <script>
                window.onload = function() { setTimeout(function() { window.print(); }, 400); };
            </script>
        </body>
        </html>
    `;
    printWin.document.write(html);
    printWin.document.close();
};


function renderAnalyticsPeriodControls() {
    const container = document.getElementById('analytics-period-controls');
    if (!container) return;

    const period = window._analyticsPeriod || 'day';
    const customDate = window._analyticsCustomDate || '';

    // If already rendered, just update classes and values
    const datePicker = document.getElementById('analytics-date-picker');
    if (datePicker && container.dataset.rendered === '1') {
        ['day', 'week', 'month', 'year'].forEach(p => {
            const btn = document.getElementById(`apbtn-${p}`);
            if (btn) {
                if (period === p) {
                    btn.className = `px-3 py-1.5 text-xs font-bold rounded-lg border transition-all bg-brand-600 text-white border-brand-600`;
                } else {
                    btn.className = `px-3 py-1.5 text-xs font-bold rounded-lg border transition-all bg-white text-slate-600 border-slate-200 hover:border-brand-400`;
                }
            }
        });
        
        const labelEl = document.getElementById('analytics-period-label');
        if (labelEl) labelEl.textContent = getAnalyticsPeriodLabel(period, customDate);
        
        if (document.activeElement !== datePicker) {
            datePicker.value = customDate;
        }
        return;
    }

    container.dataset.rendered = '1';
    container.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wide mr-1">Ver por:</span>
            <button id="apbtn-day" onclick="setAnalyticsPeriod('day')" class="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${period==='day' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'}">Hoy</button>
            <button id="apbtn-week" onclick="setAnalyticsPeriod('week')" class="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${period==='week' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'}">Esta Semana</button>
            <button id="apbtn-month" onclick="setAnalyticsPeriod('month')" class="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${period==='month' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'}">Este Mes</button>
            <button id="apbtn-year" onclick="setAnalyticsPeriod('year')" class="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${period==='year' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'}">Este Año</button>
            <div class="flex items-center gap-1 ml-2">
                <span class="text-xs text-slate-400">📅</span>
                <input type="date" id="analytics-date-picker"
                    class="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-400"
                    value="${customDate}"
                    onchange="setAnalyticsPeriod('day', this.value)">
            </div>
            <span id="analytics-period-label" class="ml-auto text-xs text-slate-400 italic">${getAnalyticsPeriodLabel(period, customDate)}</span>
        </div>
    `;
}

function getAnalyticsPeriodLabel(period, customDate) {
    if (period === 'day' && customDate) return `Fecha: ${new Date(customDate + 'T12:00:00').toLocaleDateString('es-VE', {day:'numeric', month:'long', year:'numeric'})}`;
    if (period === 'day') return `Hoy: ${new Date().toLocaleDateString('es-VE', {weekday:'long', day:'numeric', month:'long'})}`;
    if (period === 'week') return 'Esta semana (Dom - Hoy)';
    if (period === 'month') return new Date().toLocaleDateString('es-VE', {month:'long', year:'numeric'});
    if (period === 'year') return `Año ${new Date().getFullYear()}`;
    return '';
}



// Función Helper para Alertas de Negocio via WhatsApp
function sendBusinessAlert(message) {
    const rawPhone = localStorage.getItem('boss_phone') || settings.bossPhone || '';
    const phone = normalizeVEPhone(rawPhone);
    if (!phone) return;

    if (window.electronAPI && window.electronAPI.sendWhatsAppBackground) {
        window.electronAPI.sendWhatsAppBackground(phone, message)
            .then(res => console.log('[BI-ALERT] Notificación enviada'))
            .catch(err => console.error('[BI-ALERT] Error enviando notification', err));
    }
}

function renderAnalyticsCharts(dayProfitToday) {
    const canvasTrend = document.getElementById('ana-chart-trend');
    const canvasEff = document.getElementById('ana-chart-efficiency');
    if (!canvasTrend || !canvasEff) return;

    const ctxTrend = canvasTrend.getContext('2d');
    const ctxEff = canvasEff.getContext('2d');

    if (anaTrendChart) anaTrendChart.destroy();
    if (anaEfficiencyChart) anaEfficiencyChart.destroy();

    // Data para tendencia (últimos 6 registros de historia + hoy)
    const historyLast = dailyHistory.slice(-6);
    const labels = historyLast.map(d => new Date(d.date).toLocaleDateString('es-VE', {day:'2-digit', month:'short'}));
    labels.push('Hoy');

    const salesData = historyLast.map(d => d.salesUSD);
    salesData.push(sales.reduce((acc, s) => acc + s.totalUSD, 0));

    const profitData = historyLast.map(d => d.profitUSD);
    profitData.push(dayProfitToday);

    anaTrendChart = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Ventas USD', data: salesData, borderColor: '#6366f1', backgroundColor: '#6366f120', fill: true, tension: 0.4 },
                { label: 'Utilidad USD', data: profitData, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 }
            ]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { position: 'top', labels: { font: { weight: 'bold' } } } },
            scales: { y: { beginAtZero: true }, x: { grid: { display: false } } }
        }
    });

    // Eficiencia (Ganancia vs Gastos)
    const totalExpensesUSD = expenses.reduce((acc, e) => acc + (e.amountUSD || 0), 0);
    const netProfit = Math.max(0, dayProfitToday - totalExpensesUSD);
    
    // UI Update (Absolutes)
    const elProfit = document.getElementById('ana-eff-profit-val');
    const elExpense = document.getElementById('ana-eff-expense-val');
    if(elProfit) elProfit.textContent = `$${netProfit.toFixed(2)}`;
    if(elExpense) elExpense.textContent = `$${totalExpensesUSD.toFixed(2)}`;

    anaEfficiencyChart = new Chart(ctxEff, {
        type: 'doughnut',
        data: {
            labels: ['Ganancia Neta', 'Gastos'],
            datasets: [{
                data: [netProfit, totalExpensesUSD],
                backgroundColor: ['#10b981', '#f43f5e'],
                borderWidth: 0
            }]
        },
        options: { cutout: '70%', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
    });
}

function renderInternalCharts(catTotals, methodTotals) {
    const ctxCat = document.getElementById('view-chart-category').getContext('2d');
    const ctxPay = document.getElementById('view-chart-payment').getContext('2d');

    if (chartCategory) chartCategory.destroy();
    if (chartPayment) chartPayment.destroy();

    const categories = Object.keys(catTotals);
    if (categories.length === 0) return;

    chartCategory = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: Object.values(catTotals),
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'],
                borderWidth: 0
            }]
        },
        options: {
            cutout: '65%',
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { weight: 'bold' } } } }
        }
    });

    chartPayment = new Chart(ctxPay, {
        type: 'bar',
        data: {
            labels: ['Efec $', 'Efec BS', 'Punto BS'],
            datasets: [{
                label: 'Ventas (VES)',
                data: [methodTotals['cash-usd'], methodTotals['cash-ves'], methodTotals['card-ves']],
                backgroundColor: ['#10b981', '#2563eb', '#6366f1'],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { display: false } },
                x: { grid: { display: false } }
            }
        }
    });
}



// ==========================================
// TICKET PRINTING (80mm)
// ==========================================
window.printTicketFromReport = (ticketNum) => {
    const sale = sales.find(s => s.ticket === ticketNum);
    if (sale) printTicket(sale);
}

function printTicket(sale) {
    // Populate Header & Client
    document.getElementById('print-ticket-num-header').textContent = `TICKET: #${sale.ticket}`;
    document.getElementById('print-ticket-date').textContent = new Date(sale.date).toLocaleString();
    document.getElementById('print-ticket-client-name').textContent = sale.client ? sale.client.name : 'CLIENTE GENÉRICO';
    document.getElementById('print-ticket-client-doc').textContent = sale.client ? sale.client.document : 'V-00000000';

    // Dinamic Branding Injection
    const brandingName = document.getElementById('branding-ticket-name');
    if (brandingName) brandingName.textContent = settings.companyName || 'NEGOCIO';
    
    const brandingFooter = document.getElementById('branding-ticket-footer');
    if (brandingFooter) brandingFooter.textContent = settings.companyFooter || '¡Gracias por su compra!';

    const tbody = document.getElementById('print-ticket-items');
    tbody.innerHTML = '';

    // Rows: Producto | Cant | Precio | Importe
    sale.items.forEach(item => {
        // Usar precio redondeado guardado o recalcular con redondeo a decena si no existe
        const priceVESRounded = item.unitPriceVES || Math.round(((item.promoPrice || item.price) * (sale.exchangeRate || settings.exchangeRate)) / 10) * 10;
        const totalVESRounded = item.totalPriceVES || (priceVESRounded * item.qty);

        // Truncar nombre para que no rompa la tabla (max 18 chars)
        const displayName = item.name.length > 18 ? item.name.substring(0, 15) + '...' : item.name;

        tbody.innerHTML += `
            <tr style="font-weight:900;">
                <td style="width:45%;text-align:left;padding:0;">${displayName.toUpperCase()}</td>
                <td style="width:15%;text-align:center;padding:0;">${item.qty}</td>
                <td style="width:20%;text-align:right;padding:0;">${priceVESRounded}</td>
                <td style="width:20%;text-align:right;padding:0;">${totalVESRounded}</td>
            </tr>
        `;
    });

    const formatTotalVES = (n) => {
        const rounded = Math.round(n / 10) * 10;
        return rounded.toLocaleString('es-VE');
    };

    document.getElementById('print-ticket-total-ves').textContent = formatTotalVES(sale.totalVES);
    document.getElementById('print-ticket-total-usd').textContent = sale.totalUSD.toFixed(2);

    // Observations
    const obsContainer = document.getElementById('print-ticket-observations-container');
    const obsText = document.getElementById('print-ticket-observations');
    if (sale.observations) {
        obsText.textContent = sale.observations;
        obsContainer.classList.remove('hidden');
    } else {
        obsContainer.classList.add('hidden');
    }

    // QR Code removed in v12

    // Trigger print after delay
    setTimeout(() => {
        try {
            if (window.electronAPI && window.electronAPI.printTicket) {
                window.electronAPI.printTicket().catch(err => Swal.fire('Error', 'No se pudo imprimir: ' + err, 'error'));
            } else {
                window.print();
            }
        } catch (e) {
            console.error("Print Error:", e);
        }
    }, 1200);
}



// ==========================================
// MÓDULO MANUAL DE COMPRAS (CARGA SURTIDOR)
// ==========================================
let manualSelectedProduct = null;

function toggleCargaMode(mode) {
    const aiSection = document.getElementById('carga-ai-section');
    const manualSection = document.getElementById('carga-manual-section');
    const tabAi = document.getElementById('tab-mode-ai');
    const tabManual = document.getElementById('tab-mode-manual');
    
    const activeClassNames = 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm';
    const inactiveClassNames = 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200';

    if (mode === 'ai') {
        aiSection.classList.remove('hidden');
        manualSection.classList.add('hidden');
        tabAi.className = `px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeClassNames}`;
        tabManual.className = `px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${inactiveClassNames}`;
    } else {
        aiSection.classList.add('hidden');
        manualSection.classList.remove('hidden');
        tabManual.className = `px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeClassNames}`;
        tabAi.className = `px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${inactiveClassNames}`;
        
        // Focus search input
        setTimeout(() => document.getElementById('manual-carga-search')?.focus(), 100);
    }
}

function initManualCargaSearch() {
    const input = document.getElementById('manual-carga-search');
    const dropdown = document.getElementById('manual-carga-dropdown');
    
    if (!input || !dropdown) return;
    
    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        dropdown.innerHTML = '';
        
        if (query.length < 2) {
            dropdown.classList.add('hidden');
            manualSelectedProduct = null;
            return;
        }
        
        const matches = products.filter(p => 
            p.name.toLowerCase().includes(query) || 
            (p.barcode && p.barcode.toLowerCase().includes(query))
        ).slice(0, 8); // Top 8 results
        
        if (matches.length > 0) {
            matches.forEach(p => {
                const div = document.createElement('div');
                div.className = 'px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-700 last:border-0 flex justify-between items-center';
                div.innerHTML = `
                    <div>
                        <div class="font-bold text-slate-800 dark:text-white">${p.name}</div>
                        <div class="text-[10px] text-slate-400">ID: ${p.id} | Disp: ${p.stock || 0} u</div>
                    </div>
                    <div class="font-bold text-slate-500 text-xs">$${p.costPrice || 0}</div>
                `;
                div.onclick = () => {
                    manualSelectedProduct = p;
                    input.value = p.name;
                    dropdown.classList.add('hidden');
                    document.getElementById('manual-carga-qty').focus();
                };
                dropdown.appendChild(div);
            });
        }
        
        // Add "Create new" option at the bottom
        const createDiv = document.createElement('div');
        createDiv.className = 'px-4 py-3 bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 cursor-pointer border-t border-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs transition-colors';
        createDiv.innerHTML = `<i class="fas fa-plus-circle mr-2"></i> Crear "${query}" como nuevo`;
        createDiv.onclick = () => {
            manualSelectedProduct = { id: 'new_' + Date.now(), name: query, isNew: true };
            input.value = query;
            dropdown.classList.add('hidden');
            document.getElementById('manual-carga-qty').focus();
        };
        dropdown.appendChild(createDiv);

        dropdown.classList.remove('hidden');
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

function addManualCargaItem() {
    const inputName = document.getElementById('manual-carga-search').value.trim();
    if (!inputName) {
        alert("Introduce el nombre del producto.");
        return;
    }

    // Si escribió algo pero no lo seleccionó del dropdown, asumimos que quiere crearlo nuevo
    if (!manualSelectedProduct || manualSelectedProduct.name.toLowerCase() !== inputName.toLowerCase()) {
        manualSelectedProduct = { id: 'new_' + Date.now(), name: inputName, isNew: true };
    }

    const qtyInput = document.getElementById('manual-carga-qty');
    const priceInput = document.getElementById('manual-carga-price');
    const currencyInput = document.getElementById('manual-carga-currency');

    const qty = parseFloat(qtyInput.value);
    const price = parseFloat(priceInput.value);
    const currency = currencyInput.value;

    if (isNaN(qty) || qty <= 0) {
        alert("Introduce una cantidad válida y mayor a 0.");
        return;
    }
    if (isNaN(price) || price < 0) {
        alert("Introduce un precio/costo válido.");
        return;
    }

    // Inicializar arreglo global si no existe (por si se usa Manual antes de IA)
    if (!window.ocrDetectedItems) {
        window.ocrDetectedItems = [];
    }

    // Calcular montos y crear objeto
    const rate = settings.exchangeRate || 1;
    const priceInUSD = (currency === 'VES' || currency === 'BS') ? (price / rate) : price;
    
    const newItem = {
        id: Date.now() + Math.random(),
        rawText: manualSelectedProduct.isNew ? "[NUEVO] " + manualSelectedProduct.name : "[INGRESO MANUAL] " + manualSelectedProduct.name,
        cleanName: manualSelectedProduct.name,
        productId: manualSelectedProduct.id,
        isNew: manualSelectedProduct.isNew || false,
        qtyBoxes: qty,
        unitsPerBox: 1, 
        boxPriceGross: priceInUSD,
        discountPerc: 0, 
        globalDiscount: 0,
        ivaPerc: 0,
        margin: 25,
        newPriceVES: 0
    };

    ocrDetectedItems.unshift(newItem); // Añadir al inicio
    
    // Mostrar la tabla de resultados
    const resultsDiv = document.getElementById('ocr-results');
    if (resultsDiv) resultsDiv.classList.remove('hidden');

    renderOCRResults();

    // Resetear formulario manual
    manualSelectedProduct = null;
    document.getElementById('manual-carga-search').value = '';
    qtyInput.value = '';
    priceInput.value = '';
    document.getElementById('manual-carga-search').focus();
}

// ==========================================
// PURCHASES (OCR & MARGINS)
// ==========================================
function initPurchases() {
    const dropzone = document.getElementById('ocr-dropzone');
    const input = document.getElementById('ocr-file-input');
    const status = document.getElementById('ai-mode-status');

    if (!dropzone || !input) return;

    dropzone.onclick = () => input.click();
    
    // Inicializar lógica del buscador manual
    initManualCargaSearch();

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const apiKey = localStorage.getItem('gemini_api_key');
        if (apiKey) {
            processWithGemini(file);
        } else {
            // Fallback a Tesseract (Modo Local)
            status.textContent = "Procesando (Local)...";
            status.className = "text-sm font-black text-amber-600 animate-pulse";

            try {
                const result = await Tesseract.recognize(file, 'spa', {
                    logger: m => console.log(m)
                });
                processOCRText(result.data);
            } catch (err) {
                console.error(err);
                Swal.fire('Error', 'No se pudo leer la imagen localmente.', 'error');
                status.textContent = "Error";
                status.className = "text-sm font-black text-red-600";
            }
        }
    };

    document.getElementById('cancel-ocr-btn').onclick = () => {
        document.getElementById('ocr-results').classList.add('hidden');
        document.getElementById('ocr-dropzone').classList.remove('hidden');
        const dzContainer = document.getElementById('ocr-dropzone').closest('.bg-white');
        if (dzContainer) dzContainer.classList.remove('hidden'); 
        
        if (status) {
            status.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Modo Local: Activo`;
            status.className = "bg-emerald-50 text-emerald-600 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-emerald-100";
        }
        
        ocrDetectedItems = [];
        processableItems = [];
        ignoredItems = [];
    };

    // confirm-ocr-btn.onclick is defined in initPurchases() (renderOCRResults section) to handle
    // the full invoice logic including Cuentas por Pagar and cost variation alerts.

}

const PRODUCT_MAPPING = {
    '7UP': { id: 'p_7up', unitsPerBox: 6 },
    'GOLD': { id: 'p_gold', unitsPerBox: 6 },
    'YUK': { id: 'p_yuk', unitsPerBox: 6 },
    'LIPTON': { id: 'p_lipton', unitsPerBox: 12 },
    'GLUP': { id: 'p_glup', unitsPerBox: 6 },
    'JUSTY': { id: 'p_justy', unitsPerBox: 12 }
};

// ---------------------------------------------------------
// V35 INTEGRACIÓN GEMINI AI VISION
// ---------------------------------------------------------

window.openGeminiSettings = openGeminiSettings;
window.processWithGemini = processWithGemini;
window.checkAvailableModels = checkAvailableModels;

// --- NUEVO: Algoritmo de Coincidencia Difusa (Fuzzy Match) ---
function fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return 0;
    str1 = str1.toLowerCase().trim();
    str2 = str2.toLowerCase().trim();
    if (str1 === str2) return 1;
    if (str1.includes(str2) || str2.includes(str1)) return 0.8;
    
    // Simple Bigram overlapping
    const getBigrams = (s) => {
        const bigrams = new Set();
        for (let i = 0; i < s.length - 1; i++) bigrams.add(s.substring(i, i + 2));
        return bigrams;
    };
    const b1 = getBigrams(str1);
    const b2 = getBigrams(str2);
    let intersection = 0;
    for (const b of b1) if (b2.has(b)) intersection++;
    return (2 * intersection) / (b1.size + b2.size);
}

async function processWithGemini(file) {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        openGeminiSettings();
        return;
    }

    const statusEl = document.getElementById('ai-mode-status');
    statusEl.innerHTML = `<div class="w-3 h-3 rounded-full bg-indigo-500 animate-ping"></div> Analizando con IA Inteligente...`;
    statusEl.className = "bg-indigo-50 text-indigo-700 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-indigo-100 shadow-sm";

    // INYECCIÓN DE CONTEXTO: Tu catálogo actual para que la IA asocie automáticamente
    const catalogContext = products.map(p => `ID:${p.id} Name:${p.name}`).join(' | ');

    // MASTER PROMPT UNIVERSAL V40 (Razonamiento en Cadena)
    const masterPrompt = `Analizador Universal de Facturas y Compras (Venezuela).
    Eres un motor de inteligencia contable de alta precisión. Tu misión es extraer CADA PRODUCTO de la imagen y mapearlo a mi inventario actual si existe.

    CATÁLOGO DE INVENTARIO ACTUAL (Usa esto para mapear el 'productId'):
    [${catalogContext}]

    INSTRUCCIONES ANALÍTICAS:
    1. TAXONOMÍA: Si el nombre en la factura es una variante (ej: "Glup Piña 2L") y en mi catálogo está como "GLUP 2L", mapea ese ID pero mantén "Glup Piña 2L" como 'cleanName'.
    2. MATEMÁTICAS: 
       - 'qty': Cantidad de bultos/cajas.
       - 'price': Precio POR BULTO/CAJA que aparece en la factura.
       - 'currency': Si ves Bs/Bolívares -> 'VES'. Si ves $/USD -> 'USD'.
       - 'unitsPerBox': Infiere por el nombre (X6=6, X12=12, X24=24, etc).
       - 'iva': Porcentaje de IVA por línea (Casi siempre 16).
       - 'dcto': Descuento comercial por línea en porcentaje (si existe).
       - 'globalDiscount': Descuento aplicado al Subtotal de la factura (si existe, ej: 7%).
    3. TASA DE CAMBIO (bcvRate): Busca la tasa oficial BCV si aparece. Si no, pon 0.
    4. PRECIO POR BULTO: Si el precio es unitario (por botella), multiplícalo por 'unitsPerBox' para obtener el precio del bulto.

    FORMATO DE RESPUESTA (Solo JSON):
    {
      "bcvRate": 42.50,
      "items": [
        {
          "desc": "Nombre crudo en factura",
          "cleanName": "Nombre legible",
          "productId": "ID_DEL_CATALOGO_SI_COINCIDE_SINO_VACIO",
          "qty": 10,
          "price": 12.50,
          "currency": "USD",
          "unitsPerBox": 12,
          "iva": 16,
          "dcto": 5.0,
          "globalDiscount": 0
        }
      ]
    }`;

    const modelConfigs = [
        { name: 'gemini-1.5-flash', version: 'v1' },
        { name: 'gemini-1.5-pro', version: 'v1' },
        { name: 'gemini-2.0-flash-exp', version: 'v1beta' },
        { name: 'gemini-flash-latest', version: 'v1beta' }
    ];

    let lastError = null;
    let isBlocked = false;

    for (const cfg of modelConfigs) {
        try {
            const base64Image = await fileToBase64(file);
            const base64Data = base64Image.split(',')[1];

            const response = await fetch(`https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.name}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: masterPrompt },
                            { inline_data: { mime_type: file.type || 'image/jpeg', data: base64Data } }
                        ]
                    }],
                    generationConfig: { 
                        response_mime_type: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                bcvRate: { type: "NUMBER" },
                                items: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            desc: { type: "STRING" },
                                            cleanName: { type: "STRING" },
                                            productId: { type: "STRING" },
                                            qty: { type: "NUMBER" },
                                            price: { type: "NUMBER" },
                                            currency: { type: "STRING" },
                                            unitsPerBox: { type: "NUMBER" },
                                            iva: { type: "NUMBER" },
                                            dcto: { type: "NUMBER" },
                                            globalDiscount: { type: "NUMBER" }
                                        },
                                        required: ["desc", "cleanName", "qty", "price", "currency", "unitsPerBox"]
                                    }
                                }
                            },
                            required: ["bcvRate", "items"]
                        }
                    }
                })
            });

            if (!response.ok) {
                if (response.status === 403) isBlocked = true;
                const errorData = await response.json();
                throw new Error(errorData.error?.message || `Fallo en ${cfg.name}`);
            }

            const data = await response.json();
            const textResponse = data.candidates[0].content.parts[0].text;
            
            // Clean markdown if accidentally returned
            let cleanJson = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const response_json = JSON.parse(cleanJson);
            const items = response_json.items || response_json;

            // Procesamiento de Tasa BCV
            const detectedBcv = parseFloat(response_json.bcvRate);
            if (detectedBcv > 0 && Math.abs(detectedBcv - settings.exchangeRate) > 2) {
                // Notificación silenciosa o ajuste opcional
                console.log(`Tasa detectada: ${detectedBcv}`);
            }

            const processedItems = items.map(item => {
                let pid = item.productId || '';
                
                // Si la IA no mapeó el producto, intentamos Fuzzy Match local
                if (!pid) {
                    let bestScore = 0;
                    products.forEach(p => {
                        const score = fuzzyMatch(item.cleanName || item.desc, p.name);
                        if (score > bestScore && score > 0.6) {
                            bestScore = score;
                            pid = p.id;
                        }
                    });
                }

                // Normalización de precios y matemática contable
                const currency = (item.currency || 'USD').toUpperCase();
                const rate = detectedBcv || settings.exchangeRate || 1;
                let priceInUSD = (currency === 'VES' || currency === 'BS') ? (item.price / rate) : item.price;
                
                // Descuentos multiplicativos (Línea * Global)
                const d1 = 1 - ((parseFloat(item.dcto) || 0) / 100);
                const d2 = 1 - ((parseFloat(item.globalDiscount) || 0) / 100);
                const boxPriceGross = priceInUSD * d1 * d2;

                return {
                    id: Date.now() + Math.random(),
                    rawText: item.desc || 'Item factura',
                    cleanName: item.cleanName || item.desc || 'Producto Nuevo',
                    productId: pid,
                    qtyBoxes: parseFloat(item.qty) || 0,
                    unitsPerBox: parseInt(item.unitsPerBox) || 12,
                    boxPriceGross: boxPriceGross,
                    discountPerc: parseFloat(item.dcto) || 0,
                    globalDiscount: parseFloat(item.globalDiscount) || 0,
                    ivaPerc: parseFloat(item.iva) || 16,
                    margin: 25,
                    newPriceVES: 0
                };
            });

            ocrDetectedItems = processedItems;
            renderOCRResults();
            statusEl.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-500"></div> IA Universal: Procesada con éxito`;
            statusEl.className = "bg-emerald-50 text-emerald-700 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-emerald-100 shadow-sm";
            return;

        } catch (err) {
            lastError = err;
            console.error(`Error con ${cfg.name}:`, err.message);
        }
    }

    // Fallback error UI
    statusEl.innerHTML = `<div class="w-2 h-2 rounded-full bg-red-500"></div> Error de Conexión AI`;
    statusEl.className = "bg-red-50 text-red-700 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-red-100 shadow-sm";
    
    Swal.fire({
        title: 'Fallo en Análisis IA',
        text: isBlocked ? 'Google bloqueó la conexión. ¿Tienes activado tu VPN?' : lastError.message,
        icon: 'error',
        confirmButtonText: 'Entendido'
    });
}

async function checkAvailableModels() {
    const apiKey = localStorage.getItem('gemini_api_key');
    Swal.fire({ title: 'Diagnosticando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            const list = data.models.map(m => m.name.replace('models/', '')).join('<br>');
            Swal.fire('Modelos Disponibles', `Tu cuenta tiene acceso a:<br><br><div class="text-xs font-mono bg-slate-100 p-2 rounded">${list}</div>`, 'success');
        } else {
            Swal.fire('Error de Región', 'Google no devolvió ningún modelo. Esto confirma un bloqueo regional (Venezuela/Otros). Prueba usando un VPN en tu equipo.', 'error');
        }
    } catch (e) {
        Swal.fire('Error de Conexión', 'No se pudo contactar con Google. Verifica tu internet.', 'error');
    }
}

function openGeminiSettings() {
    const currentKey = localStorage.getItem('gemini_api_key') || '';
    Swal.fire({
        title: 'Configuración AI Gemini',
        html: `
            <div class="text-left space-y-4">
                <p class="text-xs text-slate-500 font-medium">Para una precisión del 100%, usa inteligencia artificial. <br><b class="text-red-500">Nota:</b> Si estás en Venezuela podrías necesitar un VPN.</p>
                <div>
                    <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Tu API KEY de Gemini</label>
                    <input type="password" id="gemini-key-input" value="${currentKey}" class="w-full border-2 border-slate-100 rounded-xl py-3 px-4 font-mono text-sm focus:border-brand-500 transition-all outline-none" placeholder="Ingresa tu clave aquí...">
                </div>
                <button onclick="checkAvailableModels()" class="w-full py-2 text-[10px] font-black uppercase text-brand-600 bg-brand-50 rounded-xl hover:bg-brand-100 transition-all border border-brand-100">
                    <i class="fas fa-vial mr-2"></i> Probar Conexión y Modelos
                </button>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Guardar Configuración',
        confirmButtonColor: '#10b981',
        preConfirm: () => {
            const key = document.getElementById('gemini-key-input').value.trim();
            if (key) {
                localStorage.setItem('gemini_api_key', key);
                return key;
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('¡Listo!', 'Configuración guardada.', 'success');
        }
    });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function renderOCRResults() {
    const tbody = document.getElementById('ocr-table-body');
    tbody.innerHTML = '';

    // Encabezado dinámico para la tabla (Asegurarse de que index.html tenga las columnas correctas o inyectarlas)
    ocrDetectedItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors";

        let productOptions = `<option value="">-- Buscar Manual --</option>
<option value="NEW_PRODUCT" class="font-bold text-brand-600 bg-brand-50">-- 🆕 CREAR NUEVO PRODUCTO --</option>
<option value="IGNORE_VARIANT" class="font-bold text-slate-500 bg-slate-100">-- ⏭️ OMITIR (ES VARIANTE DE SABOR) --</option>`;
        products.sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
            productOptions += `<option value="${p.id}" ${p.id === item.productId ? 'selected' : ''}>${p.name}</option>`;
        });

        tr.innerHTML = `
            <td class="py-4 px-6 opacity-40 italic">
                <div class="text-[9px] font-mono truncate max-w-[120px]" title="${item.rawText}">${item.rawText}</div>
            </td>
            <td class="py-4 px-6">
                ${(!item.productId || item.productId === 'NEW_PRODUCT') ? `
                    <div class="space-y-2">
                        <div class="relative">
                            <input type="text" value="${item.cleanName || ''}" 
                                onchange="updateOCRItem(${index}, 'cleanName', this.value)"
                                placeholder="Nombre del nuevo producto..."
                                class="w-64 bg-amber-50 border-2 border-amber-200 rounded-xl py-2 px-3 text-sm font-black text-amber-900 outline-none focus:border-amber-500 transition-all shadow-inner">
                            <span class="absolute -top-2 -right-2 bg-amber-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full shadow-sm">NUEVO</span>
                        </div>
                        <button onclick="toggleOCRRowMode(${index}, 'link')" class="text-[9px] font-bold text-brand-600 hover:underline flex items-center gap-1">
                            <i class="fas fa-link"></i> Vincular a producto existente
                        </button>
                    </div>
                ` : `
                    <div class="space-y-2">
                        <select onchange="updateOCRItem(${index}, 'productId', this.value)" class="w-64 bg-slate-50 border-2 border-slate-200 rounded-xl py-2 px-3 text-sm font-black text-slate-700 outline-none focus:border-brand-500 transition-all">
                            ${productOptions}
                        </select>
                        <button onclick="toggleOCRRowMode(${index}, 'new')" class="text-[9px] font-bold text-amber-600 hover:underline flex items-center gap-1">
                            <i class="fas fa-plus-circle"></i> Crear como producto nuevo
                        </button>
                    </div>
                `}
            </td>
            <td class="py-4 px-6 text-center">
                <input type="number" value="${item.qtyBoxes}" onchange="updateOCRItem(${index}, 'qtyBoxes', this.value)" class="w-16 border-2 border-slate-100 rounded-lg py-1 px-2 text-center font-bold">
            </td>
            <td class="py-4 px-6 text-center">
                <div class="relative inline-block mb-1">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">$</span>
                    <input type="number" step="0.01" id="ocr-gross-input-${index}" value="${item.boxPriceGross}" onchange="updateOCRItem(${index}, 'boxPriceGross', this.value)" class="w-20 pl-4 border-2 border-slate-100 rounded-lg py-1 px-2 text-center font-bold text-slate-500">
                </div>
                <div id="ocr-gross-ves-${index}" class="text-[9px] font-bold text-slate-400 mt-1">Bs 0.00</div>
            </td>
            <td class="py-4 px-6 text-center">
                <input type="number" step="0.01" value="${item.discountPerc}" onchange="updateOCRItem(${index}, 'discountPerc', this.value)" class="w-14 border-2 border-rose-100 rounded-lg py-1 px-2 text-center font-bold text-rose-500">%
            </td>
            <td class="py-4 px-6 text-center">
                <input type="number" step="0.01" value="${item.ivaPerc}" onchange="updateOCRItem(${index}, 'ivaPerc', this.value)" class="w-14 border-2 border-slate-100 rounded-lg py-1 px-2 text-center font-bold text-slate-400">%
            </td>
            <td class="py-4 px-6 text-center">
                <div id="ocr-net-cost-${index}" class="font-black text-emerald-600 text-sm">$0.00</div>
                <div id="ocr-net-cost-bs-${index}" class="font-bold text-slate-500 text-[10px] mb-1">Bs 0.00</div>
                <div class="text-[8px] text-slate-400 uppercase font-black">Neto + IVA</div>
            </td>
            <td class="py-4 px-6 text-center">
                <div class="flex items-center justify-center gap-1">
                    <input type="number" id="ocr-margin-input-${index}" value="${item.margin}" onchange="updateOCRItem(${index}, 'margin', this.value)" class="w-14 border-2 border-brand-100 rounded-lg py-1 px-2 text-center font-black text-brand-600">%
                </div>
            </td>
            <td class="py-4 px-6 text-center">
                <div class="relative w-24 mx-auto mb-1">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-brand-400">Bs</span>
                    <input type="number" id="ocr-new-price-input-${index}" step="1" value="${item.newPriceVES}" onchange="updateOCRItem(${index}, 'newPriceVES', this.value)" class="w-full pl-6 border-2 border-brand-200 rounded-lg py-1 px-1 text-center font-black text-brand-700 bg-brand-50 shadow-inner" title="PVP Sugerido en Bs">
                </div>
                <div id="ocr-unit-cost-${index}" class="text-[10px] text-slate-400 font-bold tracking-tighter">Ref: $0.00/u</div>
            </td>
            <td class="py-4 px-6 text-center">
                <div class="bg-slate-100 px-3 py-1 rounded-lg inline-block">
                    <span id="ocr-total-units-${index}" class="text-xs font-black text-slate-600">0</span>
                    <span class="text-[8px] text-slate-400 block uppercase">unds</span>
                </div>
            </td>
            <td class="py-4 px-6 text-center">
                <button onclick="deleteOCRRow(${index})" class="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 text-rose-400 hover:bg-rose-500 hover:text-white transition-all">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
        updateOCRItem(index, null, null);
    });

    document.getElementById('ocr-results').classList.remove('hidden');
    document.getElementById('ocr-dropzone').classList.add('hidden');
    const dateInput = document.getElementById('carga-date');
    if (dateInput && !dateInput.value) {
        dateInput.valueAsDate = new Date();
    }
    const statusEl = document.getElementById('ai-mode-status');
    if (statusEl) {
        statusEl.innerHTML = `<div class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div> Análisis Universal v4.0 Finalizado`;
    }
    // Mostrar tasa BCV configurada
    const bcvDisp = document.getElementById('ocr-bcv-rate-display');
    if (bcvDisp) bcvDisp.textContent = settings.exchangeRate.toFixed(2);
    // Si no hay tasa mercado puesta, inicializarla igual a BCV como fallback
    const mktInput = document.getElementById('ocr-market-rate');
    if (mktInput && !mktInput.value) mktInput.placeholder = `ej. ${(settings.exchangeRate * 4).toFixed(0)}`;
    calculateOCRFacturaTotals();
    if (typeof renderSuppliersDropdown === 'function') renderSuppliersDropdown();
}

window.deleteOCRRow = (index) => {
    ocrDetectedItems.splice(index, 1);
    renderOCRResults();
}

window.toggleOCRRowMode = (index, mode) => {
    const item = ocrDetectedItems[index];
    if (mode === 'new') {
        item.productId = ''; // Cambia a modo input
    } else {
        item.productId = products.length > 0 ? products[0].id : ''; // Cambia a modo select
    }
    renderOCRResults();
}

window.updateOCRItem = (index, field, value) => {
    const item = ocrDetectedItems[index];
    if (!item) return;

    // Actualizar el campo si se proporciona
    if (field === 'productId') {
        item.productId = value;
        if (value && value !== 'NEW_PRODUCT' && value !== 'IGNORE_VARIANT') {
            const p = products.find(p => p.id === value);
            if (p) {
                // Lógica de bultos por categoría/nombre
                item.unitsPerBox = p.name.toLowerCase().includes('1.5') || p.name.toLowerCase().includes('2') || p.name.toLowerCase().includes('1l') ? 6 : 12;
            }
        }
    } else if (field === 'cleanName') {
        item.cleanName = value;
    } else if (field === null && item.productId) {
        // Inicialización o refresco sin campo específico
        const p = products.find(p => p.id === item.productId);
        if (p) {
            item.unitsPerBox = item.unitsPerBox || (p.name.toLowerCase().includes('1.5') || p.name.toLowerCase().includes('2') || p.name.toLowerCase().includes('1l') ? 6 : 12);
        }
    } else if (field && field !== 'productId') {
        // Campos numéricos genéricos
        item[field] = parseFloat(value) || 0;
    }

    // Tasa de mercado centralizada
    const mktInput = document.getElementById('ocr-market-rate');
    const mktRate = (mktInput && mktInput.value) ? (parseFloat(mktInput.value) || settings.exchangeRate) : settings.exchangeRate;

    // Normalización de valores base (defensivo contra undefined/NaN)
    const boxPriceGross = parseFloat(item.boxPriceGross) || 0;
    const qtyBoxes = parseFloat(item.qtyBoxes) || 0;
    const unitsPerBox = parseInt(item.unitsPerBox) || 1;
    const discLine = (parseFloat(item.discountPerc) || 0) / 100;
    const discGlobal = (parseFloat(item.globalDiscount) || 0) / 100;
    const ivaPerc = parseFloat(item.ivaPerc) || 0;
    const currentMargin = parseFloat(item.margin) || 0;

    // Cálculo de Costo Neto en USD (Costo por caja = PrecioBase × (1 - DctoLinea%) × (1 - DctoGlobal%))
    const baseNetUSD = boxPriceGross * (1 - discLine) * (1 - discGlobal);
    const netBoxCostWithIVA = baseNetUSD * (1 + (ivaPerc / 100));
    const unitCostUSD = netBoxCostWithIVA / unitsPerBox;

    // Lógica de Precios Sugeridos
    if (field === 'newPriceVES') {
        // Usuario digitó PVP en Bs del BULTO -> calculamos el margen resultante
        const targetBundleUSD = item.newPriceVES / mktRate;
        if (targetBundleUSD > 0 && targetBundleUSD > netBoxCostWithIVA) {
            item.margin = parseFloat(((1 - (netBoxCostWithIVA / targetBundleUSD)) * 100).toFixed(2));
        } else {
            item.margin = 0;
        }
    } else {
        // Se cambió el margen o el costo -> calculamos el PVP sugerido del BULTO en Bs
        const marginDec = Math.min(currentMargin / 100, 0.999); // Evitar división por cero
        const targetBundleUSD = netBoxCostWithIVA / (1 - marginDec);
        item.newPriceVES = Math.ceil(targetBundleUSD * mktRate);
    }

    // ACTUALIZACIONES DE UI POR COLUMNA
    const grossVesEl = document.getElementById(`ocr-gross-ves-${index}`);
    const netCostUSD = document.getElementById(`ocr-net-cost-${index}`);
    const netCostVES = document.getElementById(`ocr-net-cost-bs-${index}`);
    const priceInput = document.getElementById(`ocr-new-price-input-${index}`);
    const marginInput = document.getElementById(`ocr-margin-input-${index}`);
    const refEl = document.getElementById(`ocr-unit-cost-${index}`);
    const totalUnitsEl = document.getElementById(`ocr-total-units-${index}`);

    if (grossVesEl) grossVesEl.textContent = `Bs ${(boxPriceGross * settings.exchangeRate).toFixed(2)}`;
    if (netCostUSD) netCostUSD.textContent = `$ ${netBoxCostWithIVA.toFixed(2)}`;
    if (netCostVES) netCostVES.textContent = `Bs ${(netBoxCostWithIVA * settings.exchangeRate).toFixed(2)}`;
    
    // Solo actualizamos los inputs si el usuario NO es quien está escribiendo en ellos en este momento
    if (priceInput && field !== 'newPriceVES') priceInput.value = item.newPriceVES;
    if (marginInput && field === 'newPriceVES') marginInput.value = item.margin;
    
    if (refEl) {
        const bundleUSD = item.newPriceVES / mktRate;
        refEl.textContent = `Ref: $${unitCostUSD.toFixed(2)}/u ($${bundleUSD.toFixed(2)}/b)`;
    }
    
    if (totalUnitsEl) totalUnitsEl.textContent = Math.round(qtyBoxes * unitsPerBox);

    calculateOCRFacturaTotals();
}

// Recalcula todos los PVP al cambiar la tasa de mercado
window.recalcAllOCRPrices = () => {
    ocrDetectedItems.forEach((_, i) => updateOCRItem(i, null, null));
};

function calculateOCRFacturaTotals() {
    let totBultos = 0;
    let totInvestmentUSD = 0;
    let totRevenueUSD = 0;

    ocrDetectedItems.forEach(item => {
        const qty = parseFloat(item.qtyBoxes) || 0;
        const price = parseFloat(item.boxPriceGross) || 0;
        const d1 = (parseFloat(item.discountPerc) || 0) / 100;
        const d2 = (parseFloat(item.globalDiscount) || 0) / 100;
        const iva = (parseFloat(item.ivaPerc) || 0) / 100;

        // Costo Neto de la línea
        const lineNetBase = price * (1 - d1) * (1 - d2) * qty;
        const lineNetWithIVA = lineNetBase * (1 + iva);
        
        // Ingreso proyectado (PVP)
        const pvpUSD = (parseFloat(item.newPriceVES) || 0) / settings.exchangeRate;
        const lineRevenue = pvpUSD * qty;

        totBultos += qty;
        totInvestmentUSD += lineNetWithIVA;
        totRevenueUSD += lineRevenue;
    });

    const totalProfitUSD = Math.max(0, totRevenueUSD - totInvestmentUSD);
    const profitMargin = totInvestmentUSD > 0 ? (totalProfitUSD / totInvestmentUSD) * 100 : 0;
    
    const investmentVES = totInvestmentUSD * settings.exchangeRate;
    const profitVES = totalProfitUSD * settings.exchangeRate;

    const bultosEl = document.getElementById('ocr-total-bultos');
    const usdEl = document.getElementById('ocr-total-usd');

    if (bultosEl) bultosEl.textContent = totBultos.toFixed(1);
    
    if (usdEl) {
        usdEl.innerHTML = `
            <div class="flex items-center justify-end gap-10 pr-6 py-2">
                <!-- INVERSIÓN -->
                <div class="text-right">
                    <div class="text-[10px] text-slate-400 uppercase font-black mb-1">Inversión Total (Costo):</div>
                    <div class="text-slate-300 font-bold text-lg">$${totInvestmentUSD.toFixed(2)}</div>
                    <div class="text-[10px] text-slate-500 font-bold">Bs ${investmentVES.toLocaleString('es-VE', {minimumFractionDigits:2})}</div>
                </div>

                <!-- GANANCIA -->
                <div class="text-right border-l border-slate-700 pl-10">
                    <div class="text-[10px] text-emerald-400 uppercase font-black mb-1">Ganancia Proyectada:</div>
                    <div class="text-emerald-400 font-black text-2xl">+$${totalProfitUSD.toFixed(2)}</div>
                    <div class="text-[11px] text-emerald-500/80 font-bold">Bs ${profitVES.toLocaleString('es-VE', {minimumFractionDigits:2})}</div>
                </div>

                <!-- MARGEN -->
                <div class="text-right border-l border-slate-700 pl-10">
                    <div class="text-[10px] text-brand-400 uppercase font-black mb-1">Margen Estimado:</div>
                    <div class="flex items-center justify-end gap-2">
                        <span class="text-brand-500 font-black text-2xl">${profitMargin.toFixed(1)}%</span>
                        <div class="w-8 h-8 rounded-lg bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs">
                            <i class="fas fa-chart-line"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

document.getElementById('confirm-ocr-btn').onclick = () => {
    let processableItems = ocrDetectedItems.filter(i => i.productId && i.productId !== 'IGNORE_VARIANT');
    let ignoredItems = ocrDetectedItems.filter(i => i.productId === 'IGNORE_VARIANT');

    if (processableItems.length === 0 && ignoredItems.length === 0) {
        Swal.fire('Atención', 'Selecciona una acción (Producto, Nuevo u Omitir) para cada fila antes de confirmar.', 'warning');
        return;
    }

    let unassigned = ocrDetectedItems.filter(i => !i.productId);
    if (unassigned.length > 0) {
        Swal.fire('Atención', `Faltan ${unassigned.length} productos por asignar. O seleccionalos o dales a 'Omitir'.`, 'warning');
        return;
    }

    let createdCount = 0;
    let updatedCount = 0;
    let totalInvoiceUSD = 0;
    let costVariations = [];

    processableItems.forEach(item => {
        // Costo neto real pagado por bulto (incluyendo IVA y Descuento)
        const netBoxBase = item.boxPriceGross * (1 - (item.discountPerc / 100)) * (1 - (item.globalDiscount / 100 || 0));
        const netBoxWithIVA = netBoxBase * (1 + (item.ivaPerc / 100));
        const costPrice = netBoxWithIVA / item.unitsPerBox;
        const newPriceUSD = item.newPriceVES / settings.exchangeRate; // En v37.4 newPriceVES es por BULTO

        totalInvoiceUSD += (netBoxWithIVA * item.qtyBoxes);

        if (item.productId === 'NEW_PRODUCT') {
            const productName = item.cleanName || item.rawText;
            // Duplicate check by name
            const existing = products.find(function(p) { return p.name.toLowerCase() === productName.toLowerCase(); });
            if (existing) {
                // If exists, just update stock and price instead of creating duplicate
                existing.stock = (existing.stock || 0) + Math.round(item.qtyBoxes * item.unitsPerBox);
                existing.costPrice = costPrice;
                existing.price = newPriceUSD;
                console.log('[OCR] Producto existente actualizado:', existing.name);
                updatedCount++;
                return;
            }
            const newProduct = {
                id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
                name: productName,
                costPrice: costPrice,
                price: newPriceUSD,
                stock: Math.round(item.qtyBoxes * item.unitsPerBox),
                category: 'Bebidas',
                subcategory: '',
                flavors: [],
                image: ''
            };
            newProduct.price = newPriceUSD;

            products.push(newProduct);
            createdCount++;
        } else {
            // Actualizar producto existente
            const p = products.find(p => p.id === item.productId);
            if (p) {
                const oldCost = p.costPrice || 0;
                if (oldCost > 0 && costPrice > oldCost * 1.05) {
                    const percentIncrease = ((costPrice - oldCost) / oldCost) * 100;
                    costVariations.push(`<b>${p.name}</b> subió un <span class="text-rose-500 font-black">+${percentIncrease.toFixed(1)}%</span>`);
                }

                p.stock += Math.round(item.qtyBoxes * item.unitsPerBox);
                p.costPrice = costPrice;
                p.price = newPriceUSD;
                updatedCount++;
            }
        }
    });

    const providerInput = document.getElementById('carga-provider');
    const dateInput = document.getElementById('carga-date');
    const invoiceNumInput = document.getElementById('carga-invoice-num');
    const paymentStatusEl = document.getElementById('carga-payment-status');
    const creditDaysEl = document.getElementById('carga-credit-days');
    const payMethodEl = document.getElementById('carga-payment-method');
    const payCurrencyEl = document.getElementById('carga-payment-currency');
    const payRefEl = document.getElementById('carga-payment-ref');

    const providerName = providerInput ? (providerInput.value.trim() || 'Distribuidor General') : 'Distribuidor General';
    const invoiceDate = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().split('T')[0];
    const invoiceNum = invoiceNumInput ? (invoiceNumInput.value.trim() || 'S/N') : 'S/N';
    const paymentStatus = paymentStatusEl ? paymentStatusEl.value : 'contado';
    const creditDays = (creditDaysEl && creditDaysEl.value) ? parseInt(creditDaysEl.value) : 0;
    const basePayMethod = payMethodEl ? payMethodEl.value : 'Efectivo (Caja)';
    const payCurrency = payCurrencyEl ? payCurrencyEl.value : 'USD';
    const payRef = payRefEl ? payRefEl.value.trim() : '';
    let contadoPayMethod = payRef ? `${basePayMethod} (${payRef})` : basePayMethod;
    if (payCurrency !== 'USD') contadoPayMethod += ` [${payCurrency}]`;

    // 1. Registrar el Gasto o Cuenta por Pagar
    if (totalInvoiceUSD >= 0) {
        if (paymentStatus === 'contado') {
            const newExpense = { 
                id: 'exp_' + Date.now(), 
                date: new Date(invoiceDate).toISOString(), 
                description: `Compra Mercancía: ${providerName}`,
                amountUSD: totalInvoiceUSD,
                responsibleName: 'Sistema (Surtidor)',
                paymentMethod: contadoPayMethod,
                referenceNumber: invoiceNum
            };
            expenses.push(newExpense);
            saveExpenses();
            if (typeof renderExpenses === 'function') renderExpenses();
        } else {
            const dueDate = new Date(invoiceDate);
            dueDate.setDate(dueDate.getDate() + creditDays);
            const newPayable = {
                id: 'pay_' + Date.now(),
                date: new Date(invoiceDate).toISOString(),
                dueDate: dueDate.toISOString(),
                provider: providerName,
                invoiceNum: invoiceNum,
                amountUSD: totalInvoiceUSD,
                status: 'pending'
            };
            payables.push(newPayable);
            tenantSet('freshpos_payables', JSON.stringify(payables));
            if (typeof window.renderPayables === 'function') window.renderPayables();
        }
    }

    // 2. Guardar un historial detallado de las facturas ingresadas
    let purchasesLogRaw = tenantGet('freshpos_purchases_log');
    let purchasesLog = purchasesLogRaw ? JSON.parse(purchasesLogRaw) : [];
    purchasesLog.push({
        id: 'pur_' + Date.now(),
        date: new Date(invoiceDate).toISOString(),
        invoiceNum: invoiceNum,
        paymentStatus: paymentStatus,
        paymentMethod: paymentStatus === 'contado' ? contadoPayMethod : 'A Crédito',
        paymentCurrency: paymentStatus === 'contado' ? payCurrency : null,
        provider: providerName,
        totalUSD: totalInvoiceUSD,
        itemsCount: processableItems.length,
        items: processableItems.map(i => ({
            name: i.cleanName || i.rawText,
            qtyBoxes: i.qtyBoxes,
            unitsPerBox: i.unitsPerBox,
            boxPriceGross: i.boxPriceGross
        }))
    });
    tenantSet('freshpos_purchases_log', JSON.stringify(purchasesLog));

    saveProducts();
    renderProducts();
    renderInventory();

    // 3. Alertas de Variación de Costos
    if (costVariations.length > 0) {
        const variationsHtml = `<div class="text-left max-h-40 overflow-y-auto mt-4 space-y-2 text-sm bg-slate-50 p-4 rounded-xl border border-slate-200">${costVariations.join('<br>')}</div>`;
        Swal.fire({
            title: '¡Alerta de Precios!',
            html: `Se actualizaron <b>${updatedCount}</b> productos.<br>Sin embargo, detectamos una subida importante en tus costos de compra:<br>${variationsHtml}<br><br><span class="text-xs text-slate-500">Te sugerimos ir al Inventario y ajustar los precios de venta.</span>`,
            icon: 'warning',
            confirmButtonColor: '#f59e0b',
            confirmButtonText: 'Entendido'
        });
    } else {
        Swal.fire({
            title: '¡Inventario Actualizado!',
            html: `Se actualizaron <b>${updatedCount}</b> productos y se crearon <b>${createdCount}</b> nuevos.<br>Se omitieron ${ignoredItems.length} variantes.`,
            icon: 'success',
            confirmButtonColor: '#10b981'
        });
    }

    document.getElementById('cancel-ocr-btn').click();
};

// ==========================================
// MOBILE SERVER & ORDERS LOGIC
// ==========================================
let incomingOrders = [];
const notificationSound = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTdvT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT1");

function initMobileServer() {
    if (window.electronAPI) {
        // Load Persistent Data
        loadMobileData();

        // Setup navigation for the new Mobile Payments view
        const navMobilePayments = document.getElementById('nav-mobile-payments');
        if (navMobilePayments) {
            navMobilePayments.addEventListener('click', (e) => {
                e.preventDefault();
                switchView('view-mobile-payments');
                renderMobilePaymentsRegistry();
            });
        }
        // Track the active tunnel URL so QR codes always use it
        let activeTunnelUrl = null;
        const TOPIC = 'puntopila_caja_pos_tunnel_url_secret_eb6044';

        // Inicializar QR Permanente inmediatamente
        const permanentQR = document.getElementById('permanent-qr-display');
        if (permanentQR && typeof QRCode !== 'undefined') {
            // SMART START: Si tenemos un dominio estático configurado, empezar con ese link directo
            // de lo contrario, usar ntfy.sh como puente.
            const initialLink = (settings.ngrokDomain) ? `https://${settings.ngrokDomain}/mobile` : `https://ntfy.sh/${TOPIC}`;
            
            QRCode.toDataURL(initialLink, { margin: 2, scale: 10, color: { dark: '#f59e0b' } }, (err, url) => {
                if (!err) permanentQR.src = url;
            });
        }

        // Solicitar actualización inmediata de discovery para reflejar cambios en ntfy.sh
        window.electronAPI.requestDiscoveryUpdate();

        // Recibir información del servidor desde electron
        window.electronAPI.onServerInfo((info) => {
            const localMobileUrl = `http://${info.ip}:${info.port}/mobile`;

            document.getElementById('server-ip-display').textContent = localMobileUrl;
            document.getElementById('server-qr-display').src = info.qr;
            document.getElementById('server-status-dot').classList.replace('bg-slate-300', 'bg-emerald-500');

            // Solo generar QR de descarga con IP local si NO hay túnel aún
            if (!activeTunnelUrl) {
                window.electronAPI.generateDownloadQR(localMobileUrl);
            }

            // Sincronizar productos iniciales
            syncProductsToMobile();
        });

        // Mostrar estado "Conectando..." hasta que el túnel real se establezca.
        const remoteUrlEl = document.getElementById('link-mobile-display');
        if(remoteUrlEl) {
            remoteUrlEl.innerText = "CONECTANDO TÚNEL REMOTO...";
            remoteUrlEl.href = "#";
        }

        // Temporizador de seguridad para el túnel status
        let tunnelTimeout = setTimeout(() => {
            const statusUrl = document.getElementById('link-mobile-display');
            if (statusUrl && (statusUrl.innerText.includes('CONECTANDO') || statusUrl.innerText.includes('Iniciando'))) {
                statusUrl.innerText = "ERROR - TÚNEL CAÍDO (REINTENTANDO...)";
                statusUrl.classList.add('text-rose-500');
            }
        }, 30000); // 30 segundos

        // Recibir info del túnel (URL Pública para acceso remoto)
        window.electronAPI.onTunnelInfo((info) => {
            console.log('[INIT] onTunnelInfo RECEIVED:', JSON.stringify(info));
            clearTimeout(tunnelTimeout);
            const passContainer = document.getElementById('tunnel-password-container');
            const passDisplay = document.getElementById('tunnel-password-display');
            
            // ELEMENTOS DE LA UI DE LINKS
            const linkMobile = document.getElementById('link-mobile-display');
            const linkJefe = document.getElementById('link-jefe-display');
            const linkDownload = document.getElementById('link-download-display');

            if (!info || !info.url) { console.log('[INIT] SKIP - no url'); return; }
            console.log('[INIT] urlClean about to process');
            const urlClean = info.url.replace(/\/$/, ""); 
            activeTunnelUrl = urlClean;
            window.lastRemoteUrl = urlClean; // Sincronizar con shareLink

            // Calcular URLs
            const mobileUrl = settings.launcherUrl 
                ? (settings.launcherUrl.startsWith('http') ? settings.launcherUrl : `https://${settings.launcherUrl}`) 
                : urlClean + "/mobile";
            const jefeUrl = urlClean + "/jefe";
            const downloadUrl = urlClean + "/download";

            // Actualizar textos de links
            if (linkMobile) linkMobile.innerText = mobileUrl;
            if (linkJefe) linkJefe.innerText = jefeUrl;
            if (linkDownload) linkDownload.innerText = downloadUrl;

            // Generar QR en canvas individuales
            if (typeof QRCode !== 'undefined') {
                const qrOpts = (color) => ({ width: 144, margin: 1, color: { dark: color, light: '#ffffff' } });

                const canvasMobile = document.getElementById('qr-mobile');
                if (canvasMobile) QRCode.toCanvas(canvasMobile, mobileUrl, qrOpts('#4f46e5'), () => {});

                const canvasJefe = document.getElementById('qr-jefe');
                if (canvasJefe) QRCode.toCanvas(canvasJefe, jefeUrl, qrOpts('#92400e'), () => {});

                const canvasDownload = document.getElementById('qr-download');
                if (canvasDownload) QRCode.toCanvas(canvasDownload, downloadUrl, qrOpts('#065f46'), () => {});
            }

            // Notificar a electron para backups y QR decorado en main
            window.electronAPI.generateQR(urlClean + '/mobile');
            window.electronAPI.generateDownloadQR(urlClean + '/download');

            if (info.provider === 'cloudflare' || info.provider === 'ngrok') {
                if (passContainer) passContainer.classList.add('hidden');
            } else if (info.provider === 'localtunnel') {
                // localtunnel necesita bypass de IP
                window.electronAPI.getPublicIP().then(ip => {
                    if (passContainer && passDisplay) {
                        passContainer.classList.remove('hidden');
                        passDisplay.innerText = ip;
                    }
                });
            }
        });


        // Recibir el QR remoto generado
        window.electronAPI.onRemoteQR((qrData) => {
            const remoteQr = document.getElementById('remote-qr-display');
            if (remoteQr) remoteQr.src = qrData;
        });

        // Recibir el QR de descarga generado
        window.electronAPI.onDownloadQR((qrData) => {
            const downloadQr = document.getElementById('download-qr-display');
            if (downloadQr) downloadQr.src = qrData;
        });

        // Recibir nuevos pedidos en tiempo real
        window.electronAPI.onIncomingOrder((order) => {
            handleNewIncomingOrder(order);
            saveMobileData();
            if (isVisible('view-mobile-deliveries')) renderMobileDeliveries();
        });

        // Listen for detected payments
        window.electronAPI.onPaymentDetected((payment) => {
            handleIncomingPayment(payment);
            if (isVisible('view-mobile-deliveries')) renderMobileDeliveries();
        });

        // Escuchar solicitudes de sincronización (cuando un nuevo móvil se conecta)
        window.electronAPI.onRequestSync(() => {
            syncProductsToMobile();
        });

        // 🟢 ESCUCHA REMOTA: Cambios desde la App del Jefe
        window.electronAPI.on('product-updated-remote-full', (updatedProd) => {
            console.log("☁️ Actualización remota recibida:", updatedProd);
            
            // 1. Actualizar array local
            const index = products.findIndex(p => p.id === updatedProd.id);
            if (index !== -1) {
                products[index] = { ...products[index], ...updatedProd };
                
                // 2. Notificar éxito visual
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Actualización Remota',
                        text: `El Jefe actualizó: ${updatedProd.name}`,
                        icon: 'info',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 3000
                    });
                }
                
                // 3. Refrescar vistas
                if (typeof renderProducts === 'function') renderProducts();
                if (typeof renderInventory === 'function') renderInventory();
                
                // 4. Persistir localmente
                if (typeof saveProducts === 'function') saveProducts();
            }
        });

        window.electronAPI.on('exchange-rate-updated-remote', (newRate) => {
            console.log("💵 Cambio de tasa remoto:", newRate);
            
            if (newRate && !isNaN(newRate)) {
                settings.exchangeRate = newRate;
                localStorage.setItem('freshpos_settings', JSON.stringify(settings));
                
                // Actualizar el input de la tasa si existe en pantalla
                const input = document.getElementById('exchange-rate-input');
                if (input) {
                    input.value = newRate.toFixed(2);
                }
                
                // Actualizar precios de productos y carrito
                updatePricesWithNewRate(newRate, 'exchangeRate');
                
                // Actualizar UI de tasa
                const rateDisplays = document.querySelectorAll('.current-rate-display');
                rateDisplays.forEach(el => el.textContent = newRate.toFixed(2));
                
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Tasa Actualizada',
                        text: `Nueva tasa: Bs ${newRate.toFixed(2)}`,
                        icon: 'success',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 4000
                    });
                }
                
                // Actualizar previsualizaciones si el modal de producto está abierto
                if (window.updatePricePreviews) window.updatePricePreviews();

                // Refrescar interfaces
                requestAnimationFrame(() => {
                    if (typeof renderProducts === 'function') renderProducts();
                    const inventoryEl = document.getElementById('view-inventory');
                    if (inventoryEl && !inventoryEl.classList.contains('hidden')) {
                        if (typeof renderInventory === 'function') renderInventory();
                    }
                    if (typeof updateCartUI === 'function') updateCartUI();
                    if (typeof renderReports === 'function') renderReports();
                });
            }
        });

        // Solicitar estado actual del túnel (por si ya conectó antes de que este listener existiera)
        window.electronAPI.requestTunnelInfo();
    }

    // UI Listeners (Safely Check for Elements)
    const closePanelBtn = document.getElementById('close-orders-panel');
    const ordersPanel = document.getElementById('incoming-orders-panel');

    if (closePanelBtn) {
        closePanelBtn.onclick = () => window.closeMobileOrdersPanel();
    }

    const toastTrigger = document.getElementById('order-toast-trigger');
    const orderNotif = document.getElementById('order-notification');
    if (toastTrigger && orderNotif) {
        toastTrigger.onclick = () => {
            orderNotif.classList.replace('translate-y-0', 'translate-y-20');
            orderNotif.classList.replace('opacity-100', 'opacity-0');
            orderNotif.classList.add('pointer-events-none');
            window.openMobileOrdersPanel();
        };
    }
}

function handleNewIncomingOrder(order) {
    // Protección contra eventos duplicados (Double-Taps del móvil o reconexiones de socket)
    if (incomingOrders.find(o => o.id === order.id)) {
        console.log(`Orden ${order.id} ignorada por ser duplicada.`);
        return;
    }

    incomingOrders.unshift(order);
    notificationSound.play().catch(e => console.log("Sound error:", e));

    // Intentar match automático con pagos ya registrados
    const matchedPayment = mobilePaymentsRegistry.find(p => p.ref === order.payment?.originRef);
    if (matchedPayment) {
        order.paymentStatus = 'verified';
    }

    // Update Bell Badge
    const badge = document.getElementById('bell-badge');
    const ordersPanel = document.getElementById('incoming-orders-panel');
    if (!ordersPanel.classList.contains('orders-panel-open')) {
        badge.classList.remove('hidden');
        badge.textContent = parseInt(badge.textContent) + 1;
    }

    // Show Toast
    const toast = document.getElementById('order-notification');
    if (toast) {
        toast.classList.replace('translate-y-20', 'translate-y-0');
        toast.classList.replace('opacity-100', 'opacity-100'); // Ensure visible
        toast.classList.remove('pointer-events-none');
    }

    renderIncomingOrders();
}

// Mobile Payment Logic
async function loadMobileData() {
    if (!window.electronAPI) return;
    
    const ordersRes = await window.electronAPI.loadData({ filename: 'mobile_orders.json' });
    if (ordersRes.success && ordersRes.data) {
        incomingOrders = ordersRes.data;
        renderIncomingOrders();
    }

    const paymentsRes = await window.electronAPI.loadData({ filename: 'mobile_payments.json' });
    if (paymentsRes.success && paymentsRes.data) {
        mobilePaymentsRegistry = paymentsRes.data;
    }
}

async function saveMobileData() {
    if (!window.electronAPI) return;
    await window.electronAPI.saveData({ filename: 'mobile_orders.json', data: incomingOrders });
    await window.electronAPI.saveData({ filename: 'mobile_payments.json', data: mobilePaymentsRegistry });
}

function handleIncomingPayment(payment) {
    console.log("💳 Pago detectado:", payment);
    
    // Evitar duplicados por referencia
    if (mobilePaymentsRegistry.find(p => p.ref === payment.ref)) return;

    mobilePaymentsRegistry.unshift({
        ...payment,
        timestamp: new Date().toISOString(),
        status: 'detected'
    });

    // Buscar si hay una orden pendiente con esta referencia
    const pendingOrder = incomingOrders.find(o => o.payment?.originRef === payment.ref);
    if (pendingOrder) {
        pendingOrder.paymentStatus = 'verified';
        renderIncomingOrders();
        
        Swal.fire({
            title: 'Pago Verificado ✅',
            text: `Se detectó el pago de ${pendingOrder.payment.originName} por Bs ${payment.amount}`,
            icon: 'success',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 4000
        });
    }

    saveMobileData();
    if (isVisible('view-mobile-payments')) renderMobilePaymentsRegistry();
    if (isVisible('view-mobile-deliveries')) renderMobileDeliveries();
}

function renderMobileDeliveries() {
    const grid = document.getElementById('mobile-deliveries-grid');
    const empty = document.getElementById('mobile-deliveries-empty');
    const count = document.getElementById('mobile-deliveries-pending-count');

    if (!grid || !empty || !count) return;

    count.textContent = incomingOrders.length;

    if (incomingOrders.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = '';
    
    incomingOrders.forEach((order, index) => {
        const div = document.createElement('div');
        div.className = "bg-white p-6 rounded-[32px] shadow-sm border border-slate-200 animate-fade-in flex flex-col";
        
        const isVerified = order.paymentStatus === 'verified';

        div.innerHTML = `
            <div class="flex justify-between items-start mb-6">
                <div class="max-w-[70%]">
                    <p class="text-[10px] font-black text-brand-600 uppercase tracking-widest mb-1">Pedido #${order.id}</p>
                    <h4 class="text-xl font-black text-slate-800 leading-tight uppercase truncate">${order.payment?.originName || 'CLIENTE S.N'}</h4>
                    <div class="flex items-center gap-2 mt-2">
                        <a href="https://wa.me/${order.payment?.originPhone}" target="_blank" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm shadow-sm hover:bg-emerald-100 transition-colors">
                            <i class="fab fa-whatsapp"></i>
                        </a>
                        <p class="text-xs font-black text-slate-500">${order.payment?.originPhone || ''}</p>
                    </div>
                </div>
                <div class="text-right">
                    <span class="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-[9px] font-black uppercase tracking-tighter">
                        ${new Date(order.timestamp).toLocaleDateString()}
                    </span>
                    <p class="text-xs text-slate-400 font-bold mt-1">${new Date(order.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                </div>
            </div>

            <div class="flex-1 space-y-3 mb-6">
                <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100 italic text-xs text-slate-500">
                    ${order.items.map(item => {
                        const rate = settings?.exchangeRate || 1;
                        const priceVES = item.priceVES || (item.priceUSD * rate) || (item.price * rate) || 0;
                        return `
                            <div class="flex justify-between font-bold mb-1">
                                <span>${item.qty}x ${item.name}</span>
                                <span class="text-slate-800">Bs ${Math.round(priceVES * item.qty).toLocaleString()}</span>
                            </div>
                        `;
                    }).join('')}
                    <div class="mt-2 pt-2 border-t border-slate-200 flex justify-between font-black text-slate-800">
                        <span>TOTAL</span>
                        <span>Bs ${order.totalVES.toLocaleString()}</span>
                    </div>
                </div>

                ${order.payment?.method === 'pago_movil' ? `
                    <div class="p-4 rounded-2xl ${isVerified ? 'bg-emerald-50 border border-emerald-100' : 'bg-blue-50 border border-blue-100'}">
                        <div class="flex justify-between items-center">
                            <span class="text-[9px] font-black text-slate-500 uppercase">PAGO MÓVIL 🤳</span>
                            <span class="px-2 py-0.5 ${isVerified ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'} rounded-full text-[8px] font-black uppercase tracking-widest">
                                ${isVerified ? 'VERIFICADO' : 'PENDIENTE'}
                            </span>
                        </div>
                        <div class="mt-2 flex justify-between text-[11px] font-bold">
                            <span class="text-slate-400 uppercase text-[9px]">REF:</span>
                            <span class="${isVerified ? 'text-emerald-700' : 'text-blue-700'}">...${order.payment.originRef}</span>
                        </div>
                    </div>
                ` : `
                    <div class="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-center">
                        <p class="text-[10px] font-black text-amber-600 uppercase">PAGO EN EFECTIVO 💵</p>
                    </div>
                `}
            </div>

            <div class="grid grid-cols-2 gap-3 mt-auto">
                <button onclick="rejectMobileOrder(${index})" class="py-4 px-4 rounded-2xl bg-white border-2 border-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-colors">Cancelar</button>
                <button onclick="completeMobileOrder(${index})" class="py-4 px-4 rounded-2xl ${isVerified ? 'bg-emerald-600 shadow-emerald-500/30' : 'bg-brand-600 shadow-brand-500/30'} text-white font-black text-[10px] uppercase tracking-widest shadow-lg hover:scale-[1.03] active:scale-95 transition-all">
                    ${isVerified ? 'Completar' : 'Facturar'}
                </button>
            </div>
        `;
        grid.appendChild(div);
    });
}

window.rejectMobileOrder = (index) => {
    Swal.fire({
        title: '¿Rechazar Pedido?',
        text: "Esta acción eliminará el pedido de la lista permanentemente.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    }).then(res => {
        if (res.isConfirmed) {
            incomingOrders.splice(index, 1);
            saveMobileData();
            renderMobileDeliveries();
            renderIncomingOrders();
        }
    });
}

window.completeMobileOrder = (index) => {
    const order = incomingOrders[index];
    
    // 1. Cargar datos al POS
    cart = [];
    order.items.forEach(item => {
        const p = products.find(prod => prod.id === item.id);
        if (p) {
            cart.push({
                ...p,
                priceUSD: parseFloat(p.priceUSD || p.price || 0),
                priceVES: parseFloat(p.priceVES || (p.priceUSD * settings.exchangeRate) || 0),
                qty: item.qty
            });
        }
    });

    // 2. Cargar datos del cliente
    document.getElementById('pos-client-name').value = order.payment?.originName || '';
    document.getElementById('pos-client-phone').value = order.payment?.originPhone || '';
    document.getElementById('pos-client-document').value = order.payment?.originCI || 'V-00000000';
    
    // 3. Establecer método de pago sugerido
    window.checkoutMethod = order.payment?.method === 'pago_movil' ? 'Pago Móvil' : 'Divisas';
    
    // 4. Ir al POS para finalizar la factura
    switchView('view-pos');
    updateCartUI();
    
    // 5. Eliminar de la cola y guardar
    incomingOrders.splice(index, 1);
    saveMobileData();
    renderMobileDeliveries();
    renderIncomingOrders();

    Swal.fire({
        title: 'Pedido Cargado 📦',
        text: 'Los datos del pedido están listos en la caja. Verifica y haz clic en COBRAR.',
        icon: 'success',
        timer: 3000,
        showConfirmButton: false
    });

    // Abrir el modal de checkout automáticamente después de un breve delay
    setTimeout(() => {
        const checkoutBtn = document.getElementById('show-checkout-btn');
        if (checkoutBtn) checkoutBtn.click();
    }, 800);
}

// Re-hacer el check para que no use isVisible global si no está exportada
function refreshMobileUI() {
    const isVisibleLocal = (id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    };
    if (isVisibleLocal('view-mobile-deliveries')) renderMobileDeliveries();
    if (isVisibleLocal('incoming-orders-panel')) renderIncomingOrders();
}

function sendToAppManagement() {
    if (cart.length === 0) return;

    const clientName = document.getElementById('pos-client-name')?.value.trim() || 'CLIENTE POS';
    const clientPhone = document.getElementById('pos-client-phone')?.value.trim() || '';
    const clientCI = document.getElementById('pos-client-document')?.value.trim() || '';
    const obs = document.getElementById('checkout-observations').value.trim();

    // Mapping POS methods to App methods
    const methodMap = {
        'cash-usd': 'divisas',
        'cash-ves': 'efectivo_bs',
        'card-ves': 'card',
        'pago-movil': 'pago_movil'
    };

    const orderData = {
        id: 'POS-' + Math.floor(Math.random()*9000 + 1000), // Random 4 digit for display
        items: JSON.parse(JSON.stringify(cart)), // Profunda para evitar referencias
        totalVES: currentTotalVES,
        totalUSD: currentTotalUSD,
        payment: {
            method: methodMap[checkoutMethod] || 'divisas',
            originName: clientName,
            originPhone: clientPhone,
            originCI: clientCI,
            originRef: '---', 
            observations: obs
        },
        timestamp: new Date().toISOString(),
        paymentStatus: (checkoutMethod === 'card-ves') ? 'pending' : 'verified'
    };

    incomingOrders.push(orderData);
    saveMobileData();

    // UI Feedback & Cleanup
    const closeBtn = document.querySelector('.close-checkout-modal');
    if (closeBtn) closeBtn.click();
    
    cart = [];
    updateCartUI();
    renderProducts();

    refreshMobileUI();

    Swal.fire({
        title: '¡Enviado a Gestión! 📦',
        text: 'El pedido ha sido movido a la lista de entregas pendientes.',
        icon: 'success',
        timer: 2000,
        showConfirmButton: false
    });
}

function renderMobilePaymentsRegistry() {
    const tbody = document.getElementById('mobile-payments-registry-table');
    if (!tbody) return;

    if (mobilePaymentsRegistry.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-20 text-center text-slate-400 font-bold uppercase italic opacity-50">No hay pagos registrados aún</td></tr>`;
        return;
    }

    tbody.innerHTML = mobilePaymentsRegistry.map(p => `
        <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
            <td class="py-4 px-6 font-medium text-slate-500 text-xs">${new Date(p.timestamp).toLocaleString()}</td>
            <td class="py-4 px-6">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs">
                        <i class="fas fa-university"></i>
                    </div>
                    <div>
                        <p class="font-bold text-slate-700 text-sm">${p.bank || 'Desconocido'}</p>
                        <p class="text-[10px] text-slate-400 font-bold uppercase">${p.phone || ''}</p>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6">
                <span class="font-black text-slate-800 text-lg">Bs ${p.amount}</span>
            </td>
            <td class="py-4 px-6">
                <span class="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black tracking-widest">${p.ref}</span>
            </td>
            <td class="py-4 px-6">
                <span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1 w-fit">
                    <i class="fas fa-check-circle"></i> DETECTADO
                </span>
            </td>
        </tr>
    `).join('');
}

window.clearPaymentRegistry = () => {
    Swal.fire({
        title: '¿Limpiar registro?',
        text: "Se borrarán todos los pagos detectados guardados.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, borrar',
        cancelButtonText: 'Cancelar'
    }).then(res => {
        if (res.isConfirmed) {
            mobilePaymentsRegistry = [];
            saveMobileData();
            renderMobilePaymentsRegistry();
        }
    });
}

function renderIncomingOrders() {
    const list = document.getElementById('incoming-orders-list');
    if (incomingOrders.length === 0) {
        list.innerHTML = `
            <div class="text-center py-20 opacity-30 h-full flex flex-col items-center justify-center">
                <div class="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                    <i class="fas fa-ghost text-4xl"></i>
                </div>
                <p class="font-bold text-slate-400">No hay pedidos nuevos</p>
            </div>`;
        return;
    }

    list.innerHTML = '';
    incomingOrders.forEach((order, index) => {
        const div = document.createElement('div');
        div.className = "bg-white p-6 rounded-[32px] shadow-sm border border-slate-200 animate-fade-in";

        let paymentInfoHtml = '';
        if (order.payment) {
            const isPM = order.payment.method === 'pago_movil';
            paymentInfoHtml = `
                <div class="mt-4 p-4 rounded-2xl ${isPM ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50 border border-slate-100'}">
                    <div class="flex items-center gap-2 mb-2">
                        <i class="fas ${isPM ? 'fa-mobile-alt text-blue-600' : 'fa-hand-holding-dollar text-slate-500'}"></i>
                        <span class="text-[10px] font-black uppercase tracking-wider text-slate-500">Método: ${order.payment.method.replace('_', ' ')}</span>
                    </div>
                    ${isPM ? `
                        <div class="grid grid-cols-2 gap-y-2 text-[11px]">
                            <p class="text-slate-400 font-bold text-[9px] uppercase">Referencia:</p>
                            <p class="text-blue-700 font-black text-right">...${order.payment.originRef}</p>
                            <p class="text-slate-400 font-bold text-[9px] uppercase">Nombre:</p>
                            <p class="text-slate-700 font-black text-right truncate">${order.payment.originName}</p>
                            <p class="text-slate-400 font-bold text-[9px] uppercase">C.I / Tlf:</p>
                            <p class="text-slate-700 font-bold text-right">${order.payment.originCI} / ${order.payment.originPhone}</p>
                        </div>
                    ` : `
                        <p class="text-[11px] font-bold text-slate-600">El cliente pagará en efectivo al retirar.</p>
                    `}
                </div>
            `;
        }

        div.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="max-w-[70%]">
                    <p class="text-xs font-black text-brand-600 uppercase tracking-tighter mb-1">Pedido #${order.id}</p>
                    <h4 class="text-lg font-black text-slate-800 leading-tight truncate uppercase">${order.payment?.originName || 'Cliente Sin Nombre'}</h4>
                    <div class="flex items-center gap-2 mt-1">
                        <a href="https://wa.me/${order.payment?.originPhone}" target="_blank" class="text-emerald-500 hover:text-emerald-600 transition-colors">
                            <i class="fab fa-whatsapp font-bold"></i>
                            <span class="text-xs font-bold">${order.payment?.originPhone || 'Sin Telf'}</span>
                        </a>
                        <span class="text-slate-300">|</span>
                        <p class="text-[10px] text-slate-400 font-bold">${new Date(order.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-xl font-black text-slate-800">Bs ${order.totalVES.toLocaleString()}</p>
                    <p class="text-[10px] font-bold text-slate-400">$${order.totalUSD.toFixed(2)}</p>
                </div>
            </div>

            <div class="bg-slate-50 rounded-2xl p-4 mb-4 border border-slate-100">
                <div class="space-y-1 mb-3">
                    ${order.items.map(item => {
                        const rate = settings?.exchangeRate || 1;
                        const priceVES = item.priceVES || (item.priceUSD * rate) || (item.price * rate) || 0;
                        return `
                            <div class="flex justify-between text-[11px]">
                                <span class="text-slate-600 font-medium">${item.qty}x ${item.name}</span>
                                <span class="font-bold text-slate-800">Bs ${Math.round(priceVES * item.qty).toLocaleString()}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${paymentInfoHtml}
                ${order.payment?.observations ? `
                    <div class="mt-3 pt-3 border-t border-slate-200">
                        <p class="text-[10px] font-black text-amber-600 uppercase mb-1">Nota del cliente:</p>
                        <p class="text-xs text-slate-500 italic">"${order.payment.observations}"</p>
                    </div>
                ` : ''}
            </div>

            <div class="grid grid-cols-2 gap-3">
                <button onclick="rejectOrder(${index})" class="py-3 px-4 rounded-2xl bg-slate-100 text-slate-500 font-bold text-xs hover:bg-slate-200 transition-colors uppercase tracking-widest">Ignorar</button>
                <button onclick="approveOrder(${index})" class="py-3 px-4 rounded-2xl ${order.paymentStatus === 'verified' ? 'bg-emerald-600' : 'bg-brand-600'} text-white font-black text-xs shadow-lg shadow-brand-500/20 hover:scale-[1.02] transition-all uppercase tracking-widest">
                    ${order.paymentStatus === 'verified' ? '<i class="fas fa-check-circle mr-1"></i> Verificado' : 'Cobrar'}
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.approveOrder = (index) => {
    const order = incomingOrders[index];

    // 1. Limpiar carrito actual
    cart = [];

    // 2. Cargar items del pedido al carrito
    order.items.forEach(item => {
        const p = products.find(prod => prod.id === item.id);
        if (p) {
            // Asegurar que los precios no sean NaN
            const priceUSD = parseFloat(p.priceUSD || p.price || 0);
            const priceVES = parseFloat(p.priceVES || (priceUSD * settings.exchangeRate) || 0);
            const promoPrice = parseFloat(p.promoPrice || 0);
            const promoPriceVES = parseFloat(p.promoPriceVES || (promoPrice * settings.exchangeRate) || 0);

            cart.push({
                id: p.id,
                name: p.name,
                priceUSD: priceUSD,
                priceVES: priceVES,
                promoPrice: promoPrice,
                promoPriceVES: promoPriceVES,
                qty: item.qty,
                img: p.img
            });
        }
    });

    // 3. Quitar de la lista y cerrar panel
    incomingOrders.splice(index, 1);
    saveMobileData();
    document.getElementById('incoming-orders-panel').classList.remove('orders-panel-open');

    // 4. Ir al POS y actualizar UI
    document.getElementById('nav-pos').click();
    updateCartUI();
    renderIncomingOrders();

    // 5. Scroll al final (cart)
    setTimeout(() => {
        const checkoutBtn = document.getElementById('show-checkout-btn') || document.getElementById('confirm-payment-btn');
        if (checkoutBtn) checkoutBtn.scrollIntoView({ behavior: 'smooth' });
    }, 500);

    Swal.fire({
        title: 'Pedido Cargado 🥤',
        text: 'Los productos se han cargado al carrito. Procede con el cobro legal.',
        icon: 'success',
        timer: 2000,
        showConfirmButton: false
    });
};

// ==========================================
// COMPARTIR LINK (SIN QR)
// ==========================================
window.shareLink = (type) => {
    let url = "";
    let msg = "¡Hola! 🥤 Entra al sistema desde aquí: \n\n";

    // Usar la variable global que se actualiza con el túnel
    const baseUrl = window.lastRemoteUrl ? window.lastRemoteUrl.replace(/\/$/, '') : "";

    if (type === 'local') {
        url = document.getElementById('server-ip-display').textContent;
        msg = "¡Hola! 🥤 Entra al Punto de Venta (WiFi Local) desde aquí: \n\n";
    } else if (type === 'download') {
        url = baseUrl ? `${baseUrl}/download` : "https://ntfy.sh/puntopila_caja_pos_tunnel_url_secret_eb6044";
        msg = "¡Instala la App! 📱📥\nEntra aquí para descargar e instalar en tu celular: \n\n";
    } else if (type === 'permanent') {
        if (baseUrl) {
            url = `${baseUrl}/mobile`;
        } else {
            url = `https://ntfy.sh/puntopila_caja_pos_tunnel_url_secret_eb6044`;
        }
        msg = "⭐ *PUNTO MÓVIL* ⭐\nEntra aquí para gestionar pedidos desde tu móvil:\n\n";
    } else if (type === 'jefe') {
        url = baseUrl ? `${baseUrl}/jefe` : "";
        msg = "📊 *PANEL DEL JEFE* 📊\nAccede al dashboard de supervisión remota:\n\n";
    } else {
        url = baseUrl || "Túnel aún no iniciado...";
        msg = "¡Hola! 🥤 Entra al sistema desde aquí: \n\n";

        const passContainer = document.getElementById('tunnel-password-container');
        const passEl = document.getElementById('tunnel-password-display');
        const pass = passEl ? passEl.innerText : '';

        if (passContainer && !passContainer.classList.contains('hidden') && pass && pass !== '---') {
            msg += `🔑 Clave de acceso: ${pass}\n\n`;
        }
    }

    if (!url || url.includes('Iniciando') || url.includes('Detectando') || url.includes('no iniciado')) {
        Swal.fire('Espera un momento', 'El enlace aún no está listo o el túnel está iniciando. Intenta en 5 segundos.', 'warning');
        return;
    }

    const waLink = `https://wa.me/?text=${encodeURIComponent(msg + url)}`;
    window.open(waLink, '_blank');
};

// ==========================================
// DESCARGAR QR EN PDF (PUNTO MÓVIL) — DISEÑO PREMIUM
// ==========================================
window.downloadDecoratedQR = async () => {
    if (typeof jspdf === 'undefined') {
        Swal.fire('Error', 'Librería PDF no disponible.', 'error');
        return;
    }

    // Precargar imagen del celular desde variable global (cargada via script en index.html)
    let phoneImgB64 = window.PHONE_SCAN_QR_B64 || null;


    const { jsPDF } = window.jspdf;

    // Obtener la URL activa del túnel (usando variables globales)
    const activeUrl = window.lastRemoteUrl || "";
    const targetUrl = settings.launcherUrl 
        ? (settings.launcherUrl.startsWith('http') ? settings.launcherUrl : `https://${settings.launcherUrl}`) 
        : (activeUrl ? activeUrl + "/mobile" : "");

    if (!targetUrl) {
        Swal.fire('Espera un momento', 'El enlace aún no está listo. Intenta en unos segundos.', 'warning');
        return;
    }

    const storeName = settings.storeName || "Punto Pila";

    // Generar 2 QRs: mobile y download
    QRCode.toDataURL(targetUrl, { margin: 1, scale: 12, color: { dark: '#1e1b4b', light: '#ffffff' } }, (err, qrUrl) => {
        if (err) {
            Swal.fire('Error', 'No se pudo generar el código QR.', 'error');
            return;
        }

        // Crear PDF en orientación horizontal (landscape A5 tipo tent-card/mesa)
        const doc = new jsPDF('l', 'mm', 'a5'); // landscape A5: 210 x 148mm
        const W = 210, H = 148;

        // ── FONDO GENERAL ──────────────────────────────────────────
        doc.setFillColor(248, 249, 254); // casi blanco con toque azul
        doc.rect(0, 0, W, H, 'F');

        // ── FRANJA SUPERIOR (HEADER GRADIENT SIMULADO) ──────────────
        // capa oscura principal
        doc.setFillColor(30, 27, 75); // indigo-950
        doc.rect(0, 0, W, 32, 'F');
        // acento violeta encima (diagonal faux-gradient)
        doc.setFillColor(79, 70, 229); // indigo-600
        doc.triangle(0, 0, 140, 0, 0, 32, 'F');

        // ── CIRCULO DECORATIVO SUPERIOR DERECHA ─────────────────────
        doc.setFillColor(99, 102, 241, 0.15); // indigo translucido
        doc.circle(190, 5, 28, 'F');
        doc.setFillColor(129, 140, 248, 0.10);
        doc.circle(195, 20, 18, 'F');

        // ── NOMBRE DEL NEGOCIO Y SLOGAN ─────────────────────────────
        doc.setTextColor(165, 180, 252);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text("CONECTADO A:", 14, 12);

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.text(storeName.toUpperCase(), 14, 21);

        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(224, 231, 255); // indigo-100
        doc.text("PUNTO DE VENTA DIGITAL  •  ESCANEA Y PIDE DESDE TU CELULAR", 14, 27);

        // ── FRANJA INFERIOR OSCURA ───────────────────────────────────
        doc.setFillColor(30, 27, 75);
        doc.rect(0, H - 18, W, 18, 'F');

        // ── TEXTO URL EN FOOTER ───────────────────────────────────────
        const shortUrl = targetUrl.replace(/^https?:\/\//, '').slice(0, 50);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(165, 180, 252);
        doc.text("ENLACE DIRECTO: " + shortUrl, 14, H - 7);

        // BADGE "ESCANEAR" derecha footer
        doc.setFillColor(79, 70, 229);
        doc.roundedRect(162, H - 14, 36, 10, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.text("GRATIS SIN APP", 180, H - 7.5, null, null, "center");

        // ── CONTENEDOR BLANCO CENTRAL (QR + INSTRUCCIONES) ───────────
        const cardX = 14, cardY = 38, cardW = 110, cardH = 96;
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.roundedRect(cardX, cardY, cardW, cardH, 4, 4, 'FD');

        // ── TITULO CARD ───────────────────────────────────────────────
        doc.setTextColor(30, 27, 75);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Escanea el código QR", cardX + cardW / 2, cardY + 12, null, null, "center");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text("con la cámara de tu teléfono", cardX + cardW / 2, cardY + 18, null, null, "center");

        // ── QR CODE CENTRADO ─────────────────────────────────────────
        const qrSize = 54; // Ligeramente más grande para balancear
        const qrX = cardX + (cardW - qrSize) / 2;
        const qrY = cardY + 22;
        // borde sutil alrededor del QR
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 2, 2, 'F');
        doc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);

        // ── INSTRUCCION DEBAJO DEL QR ─────────────────────────────────
        doc.setTextColor(71, 85, 105);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text("1. Abre la cámara de tu celular", cardX + cardW / 2, qrY + qrSize + 6, null, null, "center");
        doc.text("2. Apunta al código QR", cardX + cardW / 2, qrY + qrSize + 11, null, null, "center");
        doc.text("3. Toca el enlace que aparece", cardX + cardW / 2, qrY + qrSize + 16, null, null, "center");

        // ── PANEL DERECHO: INSTRUCCIONES GRANDES ─────────────────────
        const rightX = cardX + cardW + 14;
        const rightW = W - rightX - 14;
        const circleCX = rightX + rightW / 2;
        const circleCY = 60;
        const circleR = 20;

        // Círculo de fondo (azul claro)
        doc.setFillColor(219, 234, 254); // blue-100
        doc.circle(circleCX, circleCY, circleR, 'F');

        if (phoneImgB64) {
            // Imagen del celular escaneando QR — ligeramente más grande que el círculo
            const imgSize = circleR * 2.2;
            doc.addImage(phoneImgB64, 'PNG', circleCX - imgSize / 2, circleCY - imgSize / 2, imgSize, imgSize);
        } else {
            // Fallback: texto @
            doc.setTextColor(79, 70, 229);
            doc.setFontSize(24);
            doc.setFont("helvetica", "bold");
            doc.text("@", circleCX, circleCY + 8, null, null, "center");
        }

        doc.setTextColor(30, 27, 75);
        doc.setFontSize(15);
        doc.setFont("helvetica", "bold");
        doc.text("\u00a1Pide desde", circleCX, 89, null, null, "center");
        doc.text("tu celular!", circleCX, 97, null, null, "center");

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        const instrLines = ["Accede al men\u00fa, haz tu", "pedido y p\u00e1galo todo", "desde la palma de tu mano."];
        instrLines.forEach((line, i) => {
            doc.text(line, circleCX, 106 + (i * 5.5), null, null, "center");
        });

        // Badge WiFi
        doc.setFillColor(236, 253, 245);
        doc.setDrawColor(167, 243, 208);
        doc.roundedRect(rightX, 115, rightW, 10, 2, 2, 'FD');
        doc.setTextColor(5, 150, 105);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        doc.text("Funciona con WiFi del local", rightX + rightW / 2, 121.5, null, null, "center");

        // ── GUARDAR ───────────────────────────────────────────────────
        doc.save(`QR_Mesa_${storeName.replace(/\s+/g,'_')}.pdf`);

        Swal.fire({
            title: '¡PDF Descargado!',
            text: 'Tu tarjeta de mesa está lista. ¡Imprímela y pégala!',
            icon: 'success',
            timer: 3000,
            showConfirmButton: false
        });
    });
};


window.rejectOrder = (index) => {
    incomingOrders.splice(index, 1);
    renderIncomingOrders();
};

let _syncMobileTimer = null;
function syncProductsToMobile() {
    if (_syncMobileTimer) return;
    _syncMobileTimer = setTimeout(() => { _syncMobileTimer = null; }, 3000);
    console.log("Iniciando syncProductsToMobile...");
    if ((!products || products.length === 0) && !isInitialDataLoaded) {
        console.warn("Intento de sincronización con lista de productos vacía antes de carga inicial. Abortando.");
        return;
    }

    if (window.electronAPI) {
        const syncBtn = document.getElementById('sync-mobile-now-btn');
        let originalContent = '';
        
        if (syncBtn) {
            originalContent = syncBtn.innerHTML;
            syncBtn.innerHTML = '<i class="fas fa-spinner animate-spin mr-2"></i> Enviando...';
            syncBtn.disabled = true;
        }

        try {
            console.log(`Sincronizando ${products.length} productos a móviles...`);
            
            // Mapeo seguro con fallbacks
            const syncData = {
                products: products.map(p => {
                    const priceUSD = parseFloat(p.priceUSD || p.price || 0);
                    const rate = parseFloat(settings.exchangeRate || 36.5);
                    return {
                        ...p,
                        price: priceUSD,
                        priceVES: parseFloat(p.priceVES) || (priceUSD * rate) || 0
                    };
                }),
                exchangeRate: parseFloat(settings.exchangeRate || 36.5),
                companyName: settings.companyName || 'Punto Pila',
                mobileTitle: settings.mobileTitle,
                mobileColor: settings.mobileColor,
                mobileBg: settings.mobileBg,
                mobileBgOpacity: settings.mobileBgOpacity,
                mobileBgBlur: settings.mobileBgBlur,
                storeId: _getStoreId(),
                isLoaded: true
            };

            window.electronAPI.syncProducts(syncData);
            console.log("Evento syncProducts enviado a Electron.");

            // Éxito: Feedback visual
            if (syncBtn) {
                setTimeout(() => {
                    syncBtn.innerHTML = '<i class="fas fa-check mr-2"></i> ¡Listo!';
                    setTimeout(() => {
                        syncBtn.innerHTML = originalContent;
                        syncBtn.disabled = false;
                    }, 1500);
                }, 800);
            }
        } catch (error) {
            console.error("Error en mapeo de sincronización:", error);
            if (syncBtn) {
                syncBtn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Error';
                syncBtn.classList.add('bg-red-50', 'text-red-500');
                setTimeout(() => {
                    syncBtn.innerHTML = originalContent;
                    syncBtn.disabled = false;
                    syncBtn.classList.remove('bg-red-50', 'text-red-500');
                }, 2000);
            }
        }
    } else {
        console.error("electronAPI no detectado en syncProductsToMobile");
    }
}

// Interceptar cambios en data para sincronizar r-t
const originalSaveProducts = saveProducts;
saveProducts = function () {
    originalSaveProducts();
    syncProductsToMobile();
};

const originalSaveSettings = saveSettings;
saveSettings = function () {
    originalSaveSettings();
    syncProductsToMobile();
};

// Sincronización de Nube (Status UI)
if (window.electronAPI && window.electronAPI.onSyncStatus) {
    window.electronAPI.onSyncStatus((status) => {
        const cloudBadge = document.getElementById('cloud-sync-status');
        if (cloudBadge) {
            if (status.ok) {
                cloudBadge.className = 'flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 transition-all duration-500';
                cloudBadge.innerHTML = '<i class="fas fa-check-circle"></i> <span class="text-[10px] font-black uppercase tracking-tighter">Nube Sincronizada</span>';
                cloudBadge.classList.remove('animate-pulse');
            } else {
                cloudBadge.className = 'flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-lg border border-rose-100 transition-all duration-500';
                cloudBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span class="text-[10px] font-black uppercase tracking-tighter">Fallo Nube</span>';
                cloudBadge.classList.remove('animate-pulse');
            }
        }
    });
}

function initSettingsView() {
    try {
        const appNameInput = document.getElementById('settings-app-name');
        const companyNameInput = document.getElementById('settings-company-name');
        const companyFooterInput = document.getElementById('settings-company-footer');
        const fontSizeRange = document.getElementById('settings-font-size-range');
        const fontSizeVal = document.getElementById('settings-font-size-val');
        const saveBtn = document.getElementById('save-settings-btn');
        const previewContainer = document.getElementById('settings-ticket-preview');
        const previewName = document.getElementById('preview-company-name');
        const previewFooter = document.getElementById('preview-company-footer');
        const bossPhoneInput = document.getElementById('boss-phone-input');
        const callmebotKeyInput = document.getElementById('callmebot-key-input');
        
        // Móvil
        const mobileTitleInput = document.getElementById('settings-mobile-title');
        const mobileColorInput = document.getElementById('settings-mobile-color');
        const selectBgBtn = document.getElementById('btn-select-mobile-bg');
        const bgStatus = document.getElementById('settings-mobile-bg-status');
        
        const opacityRange = document.getElementById('settings-mobile-opacity');
        const opacityVal = document.getElementById('settings-mobile-opacity-val');
        const blurRange = document.getElementById('settings-mobile-blur');
        const blurVal = document.getElementById('settings-mobile-blur-val');
        
        // Ngrok
        const ngrokTokenInput = document.getElementById('settings-ngrok-token');
        const ngrokDomainInput = document.getElementById('settings-ngrok-domain');


        if (!appNameInput || !saveBtn) {
            console.warn('Config view elements not fully found:', { appNameInput: !!appNameInput, saveBtn: !!saveBtn });
            return;
        }

        // Load current values
        appNameInput.value = settings.appName || 'Punto Pila';
        companyNameInput.value = settings.companyName || 'Punto Pila';
        companyFooterInput.value = settings.companyFooter || '';
        fontSizeRange.value = settings.ticketFontSize || 10;
        fontSizeVal.textContent = (settings.ticketFontSize || 10) + 'px';
        if (bossPhoneInput) bossPhoneInput.value = settings.bossPhone || '';
        if (callmebotKeyInput) callmebotKeyInput.value = settings.callmebotKey || '';
        
        if (mobileTitleInput) mobileTitleInput.value = settings.mobileTitle || '';
        if (mobileColorInput) mobileColorInput.value = settings.mobileColor || '#2563eb';
        if (bgStatus && settings.mobileBg) bgStatus.classList.remove('hidden');
        
        if (opacityRange) {
            opacityRange.value = settings.mobileBgOpacity || 100;
            opacityVal.textContent = opacityRange.value + '%';
        }
        if (blurRange) {
            blurRange.value = settings.mobileBgBlur || 0;
            blurVal.textContent = blurRange.value + 'px';
        }
        
        if (ngrokTokenInput) ngrokTokenInput.value = settings.ngrokAuthToken || '';
        if (ngrokDomainInput) ngrokDomainInput.value = settings.ngrokDomain || '';
        const launcherUrlInput = document.getElementById('settings-launcher-url');
        if (launcherUrlInput) launcherUrlInput.value = settings.launcherUrl || '';

        const googleSheetIdInput = document.getElementById('settings-google-sheet-id');
        if (googleSheetIdInput) googleSheetIdInput.value = settings.googleSheetId || localStorage.getItem('google_sheet_id') || '';

        if (previewContainer) previewContainer.style.fontSize = (settings.ticketFontSize || 10) + 'px';
        if (previewName) previewName.textContent = companyNameInput.value;
        if (previewFooter) previewFooter.textContent = companyFooterInput.value;

        // Real-time preview
        if (companyNameInput && previewName) {
            companyNameInput.addEventListener('input', () => { previewName.textContent = companyNameInput.value; });
        }
        if (companyFooterInput && previewFooter) {
            companyFooterInput.addEventListener('input', () => { previewFooter.textContent = companyFooterInput.value; });
        }
        if (fontSizeRange && fontSizeVal && previewContainer) {
            fontSizeRange.addEventListener('input', () => {
                fontSizeVal.textContent = fontSizeRange.value + 'px';
                previewContainer.style.fontSize = fontSizeRange.value + 'px';
            });
        }

        if (opacityRange && opacityVal) {
            opacityRange.addEventListener('input', () => {
                opacityVal.textContent = opacityRange.value + '%';
            });
        }
        if (blurRange && blurVal) {
            blurRange.addEventListener('input', () => {
                blurVal.textContent = blurRange.value + 'px';
            });
        }
        
        if (selectBgBtn) {
            selectBgBtn.onclick = async () => {
                if (!window.electronAPI || !window.electronAPI.selectMobileBg) return;
                const result = await window.electronAPI.selectMobileBg();
                if (result) {
                    settings.mobileBg = result;
                    if (bgStatus) bgStatus.classList.remove('hidden');
                    Swal.fire({ title: 'Fondo Cargado', text: 'La imagen se aplicará al guardar.', icon: 'success' });
                }
            };
        }

        saveBtn.onclick = () => {
            settings.appName = appNameInput.value;
            settings.companyName = companyNameInput.value;
            settings.companyFooter = companyFooterInput.value;
            settings.ticketFontSize = parseInt(fontSizeRange.value);
            
            if (mobileTitleInput) settings.mobileTitle = mobileTitleInput.value.trim();
            if (mobileColorInput) settings.mobileColor = mobileColorInput.value;
            
            if (opacityRange) settings.mobileBgOpacity = parseInt(opacityRange.value);
            if (blurRange) settings.mobileBgBlur = parseInt(blurRange.value);


            if (bossPhoneInput) {
                const cleanedPhone = normalizeVEPhone(bossPhoneInput.value.trim());
                settings.bossPhone = cleanedPhone;
                localStorage.setItem('boss_phone', cleanedPhone); // Sincronizar con motor tradicional
                console.log(`[SETTINGS] Teléfono del jefe guardado: ${cleanedPhone}`);
            }
            const adminPinEl = document.getElementById('admin-pin-config');
            if (adminPinEl) {
                settings.adminPin = adminPinEl.value.trim() || '3244';
            }
            if (callmebotKeyInput) settings.callmebotKey = callmebotKeyInput.value.trim();

            if (ngrokTokenInput) settings.ngrokAuthToken = ngrokTokenInput.value.trim();
            if (ngrokDomainInput) settings.ngrokDomain = ngrokDomainInput.value.trim();


            saveSettings(); // uses helper
            
            // Sync change to Mobile
            syncProductsToMobile();


            // Apply changes
            const h1 = document.getElementById('main-brand-logo');
            if (h1) h1.innerHTML = settings.appName.replace('POS', '<span class="text-brand-600">POS</span>');

            const ticketBrand = document.getElementById('branding-ticket-name');
            if (ticketBrand) ticketBrand.textContent = settings.companyName;

            const fs = settings.ticketFontSize + 'px';
            document.documentElement.style.setProperty('--ticket-font-size', fs);

            const printContainer = document.getElementById('print-ticket-container');
            if (printContainer) {
                printContainer.style.fontSize = fs;
                const footerEl = printContainer.querySelector('div.text-center:last-child');
                if (footerEl) footerEl.innerHTML = `<span>${settings.companyFooter}</span><br><span>¡Gracias por preferirnos!</span>`;
            }

            Swal.fire('¡Éxito!', 'Configuración guardada correctamente.', 'success');
        };
        console.log('✅ initSettingsView initialized correctly');
    } catch (e) {
        console.error('❌ Error in initSettingsView:', e);
    }
}

function initClientSearch() {
    const searchInput = document.getElementById('pos-client-search');
    const resultsDiv = document.getElementById('pos-client-results');
    const clientIdHidden = document.getElementById('pos-client-id');

    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            resultsDiv.classList.add('hidden');
            clientIdHidden.value = '';
            // Clear other meta-fields as well
            document.getElementById('pos-client-document').value = '';
            document.getElementById('pos-client-name').value = '';
            document.getElementById('pos-client-phone').value = '';
            return;
        }

        // Solo mostrar clientes (no proveedores) en la búsqueda del POS
        const filtered = clients.filter(c =>
            (c.type || 'cliente') === 'cliente' &&
            (c.name.toLowerCase().includes(query) ||
            (c.phone && c.phone.includes(query)))
        );

        if (filtered.length > 0) {
            resultsDiv.innerHTML = filtered.map(c => `
                <div class="px-6 py-3 hover:bg-brand-50 cursor-pointer border-b border-slate-50 last:border-0 client-search-item" data-id="${c.id}" data-name="${c.name}">
                    <p class="font-bold text-slate-800 text-sm">${c.name}</p>
                    <p class="text-[10px] text-slate-400 uppercase font-black tracking-widest">${c.phone || 'Sin teléfono'}</p>
                </div>
            `).join('');
            resultsDiv.classList.remove('hidden');

            document.querySelectorAll('.client-search-item').forEach(item => {
                item.onclick = () => {
                    const id = item.dataset.id;
                    const name = item.dataset.name;
                    const client = clients.find(c => c.id === id);
                    
                    searchInput.value = name;
                    clientIdHidden.value = id;
                    
                    if (client) {
                        document.getElementById('pos-client-document').value = client.document || '';
                        document.getElementById('pos-client-name').value = client.name || '';
                        document.getElementById('pos-client-phone').value = client.phone || '';
                    }

                    resultsDiv.classList.add('hidden');
                };
            });
        } else {
            resultsDiv.innerHTML = `
                <div class="px-6 py-4 text-center">
                    <p class="text-slate-400 text-xs font-bold mb-2">No se encontraron clientes</p>
                    <button onclick="document.getElementById('nav-clients').click()" class="text-[10px] font-black uppercase text-brand-600 bg-brand-50 px-3 py-1.5 rounded-lg border border-brand-100 hover:bg-brand-100 transition-all">Crear Cliente</button>
                </div>
            `;
            resultsDiv.classList.remove('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.classList.add('hidden');
        }
    });
}

function continueInvoice(ticketNum) {
    const sale = sales.find(s => s.ticket === ticketNum);
    if (!sale) return;

    Swal.fire({
        title: '¿Continuar Factura?',
        text: `Se cargará la factura #${ticketNum} en el carrito actual.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, continuar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1d4ed8'
    }).then(res => {
        if (res.isConfirmed) {
            cart = [];
            sale.items.forEach(item => {
                const p = products.find(prod => prod.id === item.id);
                if (p) {
                    cart.push({ ...p, qty: item.qty });
                } else {
                    // Fallback para productos que ya no existen
                    cart.push({
                        id: item.id,
                        name: item.name,
                        price: item.unitPriceUSD || item.price || 0,
                        qty: item.qty,
                        category: item.category || 'Otros',
                        img: ''
                    });
                }
            });

            const searchInput = document.getElementById('pos-client-search');
            const clientIdHidden = document.getElementById('pos-client-id');
            if (sale.client) {
                searchInput.value = sale.client?.name || '';
                clientIdHidden.value = sale.client.id || '';
            }

            updateCartUI();
            document.getElementById('nav-pos').click();

            Swal.fire({
                title: 'Carrito Cargado 🥤',
                text: 'Procede con la edición o el cobro.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        }
    });
}

// ==========================================
// SECRET ADMIN INTERFACE
// ==========================================
window.LicenseManager = window.LicenseManager || {};
window.LicenseManager.renderLicenseAdmin = async function(container) {
    if (!container) return;
    container.innerHTML = '<div class="text-center py-4 text-slate-400 text-xs"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando licencias de Google Sheets...</div>';
    
    var sheetId = settings.googleSheetId || localStorage.getItem('google_sheet_id') || '';
    if (!sheetId) {
        container.innerHTML = '<div class="p-4 bg-amber-50 text-amber-800 rounded-xl text-xs"><b>No hay Google Sheet configurado.</b> Pega el enlace de tu hoja de Google Sheets en el campo superior y presiona PROBAR.</div>';
        return;
    }

    try {
        var fetchRes = await fetchGoogleSheetCSV(sheetId);
        if (!fetchRes.ok) {
            container.innerHTML = '<div class="p-4 bg-rose-50 text-rose-800 rounded-xl text-xs"><b>Error al conectar con Google Sheets.</b> Verifica que la hoja sea pública.</div>';
            return;
        }
        var csv = fetchRes.text;
        var lines = csv.split('\n').filter(function(l) { return l.trim(); });
        if (lines.length < 2) {
            container.innerHTML = '<div class="p-4 bg-slate-50 text-slate-600 rounded-xl text-xs">La hoja no contiene licencias activas.</div>';
            return;
        }

        var header = lines[0];
        var cols = header.split(',').map(function(c) { return c.replace(/"/g, '').trim(); });
        var codeIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'licensekey' || name === 'membershipcode' || name === 'codigo' || name === 'key' || name === 'licencia'; });
        var clientIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'clientname' || name === 'cliente' || name === 'nombre'; });
        var activeIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'status' || name === 'activo' || name === 'estado'; });
        var machineIdx = cols.findIndex(function(c) { var name = c.toLowerCase().replace(/[^a-z0-9]/g, ''); return name === 'machineid' || name === 'machine'; });

        var rowsHTML = '';
        for (var i = 1; i < lines.length; i++) {
            var r = lines[i].split(',').map(function(c) { return c.replace(/"/g, '').trim(); });
            var key = codeIdx > -1 ? (r[codeIdx] || '') : r[0];
            var client = clientIdx > -1 ? (r[clientIdx] || '') : 'Cliente ' + i;
            var status = activeIdx > -1 ? (r[activeIdx] || '') : 'ACTIVE';
            var machine = machineIdx > -1 ? (r[machineIdx] || '') : 'Registrada';

            var isActive = (status.toUpperCase() === 'ACTIVE' || status.toUpperCase() === 'SI' || status === '1');
            var stBadge = isActive
                ? '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">🟢 Activo</span>'
                : '<span class="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full">🔴 Inactivo</span>';

            rowsHTML += `
                <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div class="space-y-0.5">
                        <div class="font-bold text-slate-800 text-xs">${client}</div>
                        <div class="font-mono text-[11px] text-indigo-600 font-bold">${key}</div>
                        <div class="text-[10px] text-slate-400 font-mono">ID Hardware: ${machine || 'N/A'}</div>
                    </div>
                    <div>${stBadge}</div>
                </div>
            `;
        }

        container.innerHTML = `<div class="space-y-2 mt-2 max-h-60 overflow-y-auto pr-1">${rowsHTML}</div>`;
    } catch(e) {
        container.innerHTML = '<div class="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">Error: ' + e.message + '</div>';
    }
};

window.renderAdminFeaturesList = function() {
    const el = document.getElementById('admin-features-list');
    if (!el) return;
    
    const featScanner = localStorage.getItem('feat_scanner') === 'true';
    const featMobile = localStorage.getItem('feat_mobile') !== 'false';
    const featAi = localStorage.getItem('feat_ai') === 'true';
    const bossPhone = localStorage.getItem('boss_phone') || '';
    const bizName = localStorage.getItem('business_name') || 'Punto Pila';
    const bizPhoneFooter = localStorage.getItem('business_phone_footer') || '0414-1006858';
    const adminPin = settings.adminPin || '3244';

    el.innerHTML = `
        <div class="space-y-4 text-xs font-sans">
            <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100 space-y-3">
                <div class="font-bold text-indigo-900 uppercase text-[11px] flex items-center gap-1.5">
                    <i class="fas fa-store text-indigo-600"></i> Datos Generales del Comercio
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="font-bold text-slate-600 text-[10px] block mb-1">Nombre del Negocio</label>
                        <input type="text" id="business-name-input" value="${bizName}" class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
                    </div>
                    <div>
                        <label class="font-bold text-slate-600 text-[10px] block mb-1">Teléfono del Jefe (WhatsApp)</label>
                        <input type="text" id="boss-phone-input" value="${bossPhone}" placeholder="04141234567" class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="font-bold text-slate-600 text-[10px] block mb-1">Pie de Recibo / WhatsApp</label>
                        <input type="text" id="business-phone-footer-input" value="${bizPhoneFooter}" class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
                    </div>
                    <div>
                        <label class="font-bold text-slate-600 text-[10px] block mb-1">PIN de Administrador</label>
                        <input type="password" id="admin-pin-config" value="${adminPin}" maxlength="6" class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
                    </div>
                </div>
            </div>

            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div class="font-bold text-slate-800 uppercase text-[11px] flex items-center gap-1.5 mb-2">
                    <i class="fas fa-sliders-h text-brand-600"></i> Módulos y Funciones del Sistema
                </div>
                <div class="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                    <div>
                        <div class="font-bold text-slate-800">📷 Escáner de Código de Barras</div>
                        <div class="text-[10px] text-slate-400">Permite usar la cámara de la laptop o escáner USB</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="toggle-scanner" ${featScanner ? 'checked' : ''} class="sr-only peer">
                        <div class="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600"></div>
                    </label>
                </div>
                <div class="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                    <div>
                        <div class="font-bold text-slate-800">📱 Módulo Móvil (Comandos por Celular)</div>
                        <div class="text-[10px] text-slate-400">Habilita comandera en dispositivos móviles</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="toggle-mobile" ${featMobile ? 'checked' : ''} class="sr-only peer">
                        <div class="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600"></div>
                    </label>
                </div>
                <div class="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                    <div>
                        <div class="font-bold text-slate-800">🤖 Diagnóstico de Rendimiento con IA</div>
                        <div class="text-[10px] text-slate-400">Asistente inteligente de recomendaciones de ventas</div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="toggle-ai" ${featAi ? 'checked' : ''} class="sr-only peer">
                        <div class="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600"></div>
                    </label>
                </div>
            </div>
            
            <button onclick="window.applySecretSettings()" class="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow transition-all flex items-center justify-center gap-2 text-sm">
                <i class="fas fa-save"></i> Guardar Todo y Aplicar
            </button>
        </div>
    `;
};

let secretBuffer = '';
document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') {
        secretBuffer += e.key;
        if (secretBuffer.length > 20) secretBuffer = secretBuffer.slice(-20);
        if (secretBuffer.endsWith('32447974')) {
            const modal = document.getElementById('secret-admin-modal');
            if (modal) {
                window.renderAdminFeaturesList();
                const googleSheetIdInput = document.getElementById('settings-google-sheet-id');
                if (googleSheetIdInput) googleSheetIdInput.value = settings.googleSheetId || localStorage.getItem('google_sheet_id') || '';
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
            secretBuffer = '';
        }
    }
});

window.applySecretSettings = () => {
    const elScan = document.getElementById('toggle-scanner');
    const elMob = document.getElementById('toggle-mobile');
    const elAi = document.getElementById('toggle-ai');
    const elBp = document.getElementById('boss-phone-input');
    const elBn = document.getElementById('business-name-input');
    const elBpf = document.getElementById('business-phone-footer-input');

    const scanner = elScan ? elScan.checked : false;
    const mobile = elMob ? elMob.checked : true;
    const ai = elAi ? elAi.checked : false;
    const bossPhone = elBp ? normalizeVEPhone(elBp.value.trim()) : '';
    const bizName = elBn ? elBn.value.trim() : 'Punto Pila';
    const bizPhone = elBpf ? elBpf.value.trim() : '0414-1006858';
    
    const adminPinEl = document.getElementById('admin-pin-config');
    const adminPin = adminPinEl && adminPinEl.value.trim() ? adminPinEl.value.trim() : '3244';

    const launcherUrlEl = document.getElementById('settings-launcher-url');
    const launcherUrl = launcherUrlEl ? launcherUrlEl.value.trim() : '';

    const googleSheetIdEl = document.getElementById('settings-google-sheet-id');
    const googleSheetId = googleSheetIdEl ? googleSheetIdEl.value.trim() : '';

    localStorage.setItem('feat_scanner', scanner);
    localStorage.setItem('feat_mobile', mobile);
    localStorage.setItem('feat_ai', ai);
    localStorage.setItem('boss_phone', bossPhone);
    localStorage.setItem('business_name', bizName);
    localStorage.setItem('business_phone_footer', bizPhone);
    localStorage.setItem('launcher_url', launcherUrl);
    localStorage.setItem('google_sheet_id', googleSheetId);
    localStorage.removeItem('callmebot_key');

    // Sincronizar con Ajustes estándar
    settings.bossPhone = bossPhone;
    settings.adminPin = adminPin;
    settings.launcherUrl = launcherUrl;
    settings.googleSheetId = googleSheetId;
    saveSettings(); 

    // Forzar actualización de QRs si ya hay un túnel activo
    if (window.lastRemoteUrl) {
        window.electronAPI.requestTunnelInfo(); // Pedir info para regenerar QRs con el nuevo launcher
    }

    console.log(`[CONFIG] Teléfono del jefe guardado (normalizado): ${bossPhone}`);



    applyAppBranding();

    const navServer = document.getElementById('nav-server');
    const navPurchases = document.getElementById('nav-purchases');
    const mobileBell = document.getElementById('mobile-orders-bell');

    if (navServer) navServer.style.display = mobile ? '' : 'none';
    if (navPurchases) navPurchases.style.display = ai ? '' : 'none';
    if (mobileBell) {
        mobileBell.style.display = mobile ? '' : 'none';
        // Ya no ocultamos al padre para evitar borrar el título "Catálogo"
    }
}

// --- RECUPERACIÓN DE CONTRASEÑA ---
async function recoverBossPassword() {
    try {
        const boss = await window.db.getUser('boss');
        if (!boss || !boss.phone) {
            return Swal.fire({ icon: 'error', title: 'No se puede recuperar', text: 'No se encontró el usuario boss en el sistema.', confirmButtonColor: '#6366f1' });
        }
        const maskedPhone = boss.phone.slice(0, -4).replace(/\d/g, '*') + boss.phone.slice(-4);
        Swal.fire({
            title: 'Recuperar contraseña',
            html: '<p class="mb-1">Confirma el teléfono del jefe:</p><b style="font-size:18px;letter-spacing:2px">' + maskedPhone + '</b><br><br><input id="recover-phone" class="swal2-input" placeholder="Últimos 4 dígitos" maxlength="4" inputmode="numeric" style="text-align:center;font-size:20px;letter-spacing:8px;width:140px">',
            confirmButtonText: 'Verificar',
            confirmButtonColor: '#6366f1',
            showLoaderOnConfirm: true,
            preConfirm: () => {
                const input = document.getElementById('recover-phone').value.trim();
                if (!input || input.length !== 4) { Swal.showValidationMessage('Ingresa los 4 últimos dígitos'); return false; }
                if (input !== boss.phone.slice(-4)) { Swal.showValidationMessage('Teléfono incorrecto'); return false; }
                return true;
            }
        }).then(result => {
            if (!result.isConfirmed) return;
            const recoveredPass = 'boss' + boss.phone.slice(-4);
            Swal.fire({
                icon: 'success',
                title: 'Contraseña recuperada',
                html: '<b>Usuario:</b> boss<br><b>Contraseña:</b> <code style="background:#f1f5f9;padding:4px 8px;border-radius:6px;font-size:16px;font-weight:900">' + recoveredPass + '</code><br><br><small>Puedes cambiarla en Configuración > Usuarios</small>',
                confirmButtonColor: '#6366f1'
            });
        });
    } catch (e) {
        console.error('[Recover] Error:', e);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo recuperar la contraseña. Contacta al proveedor.', confirmButtonColor: '#6366f1' });
    }
}

window.applyAppBranding = () => {
    const bizName = localStorage.getItem('business_name') || 'Caja Fresh';
    const bizPhone = localStorage.getItem('business_phone_footer') || '0414-1006858';
    
    // Actualizar Tickets
    const tName = document.getElementById('branding-ticket-name');
    const tFooter = document.getElementById('branding-ticket-footer');
    if (tName) tName.textContent = bizName;
    if (tFooter) tFooter.innerHTML = `${bizName} | ${bizPhone}<br>¡Gracias por preferirnos!`;

    // Actualizar Sidebar
    const sName = document.querySelector('aside h1');
    if (sName) {
        sName.innerHTML = `${bizName.split(' ')[0]} <span class="text-brand-600">${bizName.split(' ').slice(1).join(' ') || 'POS'}</span>`;
    }

    // Actualizar PDF Template
    const pdfHeader = document.getElementById('branding-pdf-header-name');
    const pdfFooter = document.getElementById('branding-pdf-footer-line');
    if (pdfHeader) pdfHeader.textContent = bizName;
    if (pdfFooter) pdfFooter.textContent = `© ${new Date().getFullYear()} ${bizName} | ADMINISTRACIÓN`;
    
    // Actualizar Título de la página
    document.title = `${bizName} - Sistema de Ventas`;
};

window.syncLauncherUrl = () => {
    const launcherUrlEl = document.getElementById('settings-launcher-url');
    if (!launcherUrlEl) return;

    let url = launcherUrlEl.value.trim();
    if (!url) {
        alert('⚠️ Por favor, pega tu link de Vercel antes de vincular.');
        return;
    }

    // Asegurar que tenga protocolo
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }

    // Guardar en settings y localStorage
    settings.launcherUrl = url;
    saveSettings();
    localStorage.setItem('launcher_url', url);

    // Generar el QR del nuevo recuadro exclusivo
    updateLauncherQR(url);

    // Feedback Visual FUERTE en el botón
    const btn = document.getElementById('btn-sync-launcher');
    if (btn) {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> ✅ VINCULADO CON ÉXITO';
        btn.style.backgroundColor = '#16a34a';
        btn.style.transform = 'scale(1.05)';
        
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.backgroundColor = '';
            btn.style.transform = '';
        }, 4000);
    }

    // Forzar actualización de señal en la red (Discovery)
    if (window.electronAPI && window.electronAPI.requestDiscoveryUpdate) {
        window.electronAPI.requestDiscoveryUpdate(); 
    }

    // Confirmación visual
    alert('✅ ¡Lanzador Punto Móvil vinculado!\n\nTu link permanente es:\n' + url + '\n\nVe a la sección "Servidor" para ver tu nuevo QR exclusivo de Punto Móvil (el recuadro morado grande).\n\n¡Escanéalo con el celular para probarlo!');

    console.log(`[PUNTO MOVIL] Lanzador vinculado con éxito: ${url}`);
};

// Función para generar/actualizar el QR del Lanzador exclusivo
function updateLauncherQR(url) {
    const section = document.getElementById('launcher-qr-section');
    const qrImg = document.getElementById('launcher-qr-display');
    const urlText = document.getElementById('launcher-url-text');

    if (!url || !section || !qrImg) return;

    // Mostrar la sección
    section.classList.remove('hidden');

    // Actualizar el link de texto
    if (urlText) {
        urlText.textContent = url.replace('https://', '').toUpperCase();
        urlText.href = url;
    }

    // Generar el QR
    if (typeof QRCode !== 'undefined') {
        QRCode.toDataURL(url, { margin: 2, scale: 12, color: { dark: '#4f46e5' } }, (err, qrDataUrl) => {
            if (!err) {
                qrImg.src = qrDataUrl;
            }
        });
    }
}

// Cargar el QR del Lanzador al iniciar (si ya fue configurado)
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const savedUrl = settings.launcherUrl || localStorage.getItem('launcher_url') || '';
        if (savedUrl) {
            updateLauncherQR(savedUrl.startsWith('http') ? savedUrl : 'https://' + savedUrl);
        }
    }, 2000); // Esperar a que el DOM esté listo
});

document.addEventListener('DOMContentLoaded', () => {
    applyAppBranding();
    initAutomatedReporting();
    setTimeout(() => {
        const mobile = localStorage.getItem('feat_mobile') !== 'false';
        const ai = localStorage.getItem('feat_ai') === 'true';
        const navServer = document.getElementById('nav-server');
        const navPurchases = document.getElementById('nav-purchases');
        const mobileBell = document.getElementById('mobile-orders-bell');
        if (navServer) navServer.style.display = mobile ? '' : 'none';
        if (navPurchases) navPurchases.style.display = ai ? '' : 'none';
        if (mobileBell) {
            mobileBell.style.display = mobile ? '' : 'none';
        }
    }, 500);
});

// ==========================================
// BARCODE SCANNER LOGIC
// ==========================================
let posBarcodeBuffer = '';
let posBarcodeTimeout = null;

document.addEventListener('keydown', (e) => {
    const viewPos = document.getElementById('view-pos');
    if (viewPos && !viewPos.classList.contains('hidden') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key.length === 1) {
            posBarcodeBuffer += e.key;
            if (posBarcodeTimeout) clearTimeout(posBarcodeTimeout);
            posBarcodeTimeout = setTimeout(() => { posBarcodeBuffer = ''; }, 100);
        } else if (e.key === 'Enter' && posBarcodeBuffer.length >= 2) {
            const p = products.find(prod => prod.barcode === posBarcodeBuffer);
            const searchInput = document.getElementById('search-product');
            const preventTrigger = document.activeElement === searchInput;

            if (p) {
                const checkoutModal = document.getElementById('checkout-modal');
                if (!checkoutModal || checkoutModal.classList.contains('hidden')) {
                    addToCart(p);
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Agregado: ${p.name}`, showConfirmButton: false, timer: 1000 });
                }
            } else if (!preventTrigger && posBarcodeBuffer.length > 5) {
                Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: `Código no registrado: ${posBarcodeBuffer}`, showConfirmButton: false, timer: 1500 });
            }
            posBarcodeBuffer = '';
        }
    }
});

// ==========================================
// REPORTE WHATSAPP (CADA 2 VENTAS)
// ==========================================
window.sendWhatsAppReport = (manual = false) => {
    const rawPhone = localStorage.getItem('boss_phone') || settings.bossPhone || '';
    const bossPhone = normalizeVEPhone(rawPhone);
    if (!bossPhone) {
        if (manual) Swal.fire('Configuración Faltante', 'Configura el teléfono del jefe en Configuración y pulsa Guardar.', 'warning');
        console.warn('[WA-REPORT] No hay teléfono de jefe configurado.');
        return;
    }
    console.log(`[WA-REPORT] Teléfono normalizado: ${bossPhone} (original: ${rawPhone})`);

    let reportSales = [];
    const lastReportTime = parseInt(localStorage.getItem('last_whatsapp_report_time')) || (Date.now() - 7200000);

    if (manual) {
        const today = new Date().toDateString();
        reportSales = sales.filter(s => new Date(s.date).toDateString() === today);
    } else {
        // Filtrar ventas posteriores al último reporte
        reportSales = sales.filter(s => (s.timestamp || 0) > lastReportTime);
    }

    if (reportSales.length === 0) {
        if (manual) Swal.fire('Sin Datos', 'No hay ventas para reportar.', 'info');
        return;
    }

    const totalUSD = reportSales.reduce((acc, s) => acc + s.totalUSD, 0);
    const totalVES = reportSales.reduce((acc, s) => acc + s.totalVES, 0);
    const firstTicket = reportSales[0].ticket || reportSales[0].id || '1';
    const lastTicket = reportSales[reportSales.length - 1].ticket || reportSales[reportSales.length - 1].id || String(reportSales.length);
    // Para el nombre del archivo usamos número limpio (sin ceros a la izquierda)
    const firstNum = parseInt(firstTicket, 10) || firstTicket;
    const lastNum = parseInt(lastTicket, 10) || lastTicket;

    // Intentar envío profesional (Background PDF) si está listo
    if (window.isWhatsappAutomatedReady) {
        if (manual) Swal.fire({ title: 'Generando Reporte PDF...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        
        createReportPDF(reportSales, totalUSD, totalVES).then(pdfBase64 => {
            const filename = `Reporte_Tickets_${firstNum}_al_${lastNum}.pdf`;
            window.electronAPI.sendWhatsAppPDF(bossPhone, pdfBase64, filename).then(res => {
                if (res.success) {
                    if (manual) {
                        Swal.fire({ icon: 'success', title: '¡PDF Enviado!', text: 'El reporte se envió correctamente.', timer: 2000, showConfirmButton: false });
                    } else {
                        localStorage.setItem('last_whatsapp_report_time', Date.now());
                        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'PDF de Auditoría automática enviado ✅', showConfirmButton: false, timer: 3000 });
                    }
                } else {
                    throw new Error(res.error);
                }
            }).catch(err => {
                console.error('Error enviando PDF:', err);
                sendWhatsAppTextFallback(bossPhone, reportSales, totalUSD, totalVES, manual);
                if (!manual) localStorage.setItem('last_whatsapp_report_time', Date.now());
            });
        }).catch(err => {
            console.error('Error generando PDF:', err);
            sendWhatsAppTextFallback(bossPhone, reportSales, totalUSD, totalVES, manual);
            if (!manual) localStorage.setItem('last_whatsapp_report_time', Date.now());
        });
    } else {
        sendWhatsAppTextFallback(bossPhone, reportSales, totalUSD, totalVES, manual);
        if (!manual) localStorage.setItem('last_whatsapp_report_time', Date.now());
    }
};

// ==========================================
// AUTOMATED REPORTING TIMER (2 HOURS)
// ==========================================
function initAutomatedReporting() {
    console.log('⏲️ Iniciando Reloj de Reportes WhatsApp (2h)...');
    
    // Inyectar tiempo inicial si no existe
    if (!localStorage.getItem('last_whatsapp_report_time')) {
        localStorage.setItem('last_whatsapp_report_time', Date.now());
    }

    const TWO_HOURS = 2 * 60 * 60 * 1000;
    
    setInterval(() => {
        const lastReportTime = parseInt(localStorage.getItem('last_whatsapp_report_time')) || Date.now();
        const timePassed = Date.now() - lastReportTime;

        if (timePassed >= TWO_HOURS) {
            console.log('📢 Es hora de enviar el reporte automático (2h pasado)');
            // Solo enviar si hay ventas nuevas para no molestar si el negocio está cerrado
            const hasNewSales = sales.some(s => (s.timestamp || 0) > lastReportTime);
            if (hasNewSales) {
                sendWhatsAppReport(false);
            } else {
                console.log('🔇 No hay ventas nuevas en este ciclo de 2h. Saltando.');
                localStorage.setItem('last_whatsapp_report_time', Date.now()); // Resetear timer igual
            }
        }
    }, 60000); // Revisar cada minuto
}

// Función auxiliar para generar el PDF en Base64
async function createReportPDF(reportSales, totalUSD, totalVES) {
    return new Promise((resolve, reject) => {
        const template = document.getElementById('whatsapp-pdf-template');
        if (!template) return reject('Template no encontrado');

        // Llenar datos en el template
        document.getElementById('pdf-report-date').textContent = new Date().toLocaleString();
        const first = reportSales[0].ticket || reportSales[0].id || '1';
        const last = reportSales[reportSales.length - 1].ticket || reportSales[reportSales.length - 1].id || String(reportSales.length);
        document.getElementById('pdf-report-range').textContent = `Tickets #${parseInt(first,10)||first} al #${parseInt(last,10)||last}`;
        document.getElementById('pdf-total-usd').textContent = formatUSD(totalUSD);
        document.getElementById('pdf-total-ves').textContent = formatVES(totalVES);

        const tableBody = document.getElementById('pdf-sales-table-body');
        tableBody.innerHTML = reportSales.map(s => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px; font-size: 11px; font-weight: 700;">#${parseInt(s.ticket || s.id, 10) || s.id || '-'}</td>
                <td style="padding: 10px; font-size: 11px;">${s.client ? s.client.name : 'Cliente General'}</td>
                <td style="padding: 10px; font-size: 11px; text-align: right; font-weight: 700;">${formatUSD(s.totalUSD)}</td>
                <td style="padding: 10px; font-size: 11px; text-align: right; font-weight: 700;">${formatVES(s.totalVES)}</td>
            </tr>
        `).join('');

        const opt = {
            margin: [0.5, 0.5],
            filename: 'reporte.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        // Generar como Data URI String
        if (window.html2pdf) {
            html2pdf().set(opt).from(template).output('datauristring').then(resolve).catch(reject);
        } else {
            reject('html2pdf no está cargado');
        }
    });
}

// Fallback a envío de texto tradicional
function sendWhatsAppTextFallback(bossPhone, reportSales, totalUSD, totalVES, manual) {
    const firstTicket = reportSales[0].ticket || reportSales[0].id || '1';
    const lastTicket = reportSales[reportSales.length - 1].ticket || reportSales[reportSales.length - 1].id || String(reportSales.length);
    const firstNum = parseInt(firstTicket, 10) || firstTicket;
    const lastNum = parseInt(lastTicket, 10) || lastTicket;
    const head = manual ? "*REPORTE MANUAL*" : "*REPORTE AUTOMÁTICO (CADA 2 VENTAS)*";
    const waMsg = `${head} 🚨\n*Tickets*: #${firstNum} al #${lastNum}\n*Total USD*: ${formatUSD(totalUSD)}\n*Total VES*: ${formatVES(totalVES)}\n*Ventas*: ${reportSales.length}\n_Generado por FreshPOS_`;

    // Normalizar teléfono siempre
    const phone = normalizeVEPhone(bossPhone);
    console.log(`[WA-TEXT] Enviando a: ${phone}, Motor listo: ${window.isWhatsappAutomatedReady}`);

    if (window.isWhatsappAutomatedReady) {
        window.electronAPI.sendWhatsAppBackground(phone, waMsg)
            .then(res => {
                if (res && res.success) {
                    console.log('[WA-TEXT] ✅ Mensaje enviado exitosamente.');
                    if (!manual) Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Reporte enviado ✅', showConfirmButton: false, timer: 3000 });
                } else {
                    console.error('[WA-TEXT] ❌ Fallo en envío:', res?.error);
                    Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Error enviando: ' + (res?.error || 'Desconocido'), showConfirmButton: false, timer: 4000 });
                }
            })
            .catch(err => {
                console.error('[WA-TEXT] ❌ Error de comunicación:', err);
                Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Error de comunicación con WhatsApp', showConfirmButton: false, timer: 4000 });
            });
        return;
    }

    // Fallback: abrir WhatsApp manualmente
    const waUrl = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(waMsg)}`;
    if (manual) {
        Swal.fire({
            title: '¿Enviar Reporte?',
            text: 'El motor automático no está listo. Se abrirá WhatsApp para envío manual.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Enviar',
            confirmButtonColor: '#10b981',
            reverseButtons: true
        }).then((r) => {
            if (r.isConfirmed) window.location.assign(waUrl);
        });
    } else {
        window.location.assign(waUrl);
    }
}

/**
 * ALERTAS DE STOCK BAJO
 */
function checkLowStockAlerts() {
    const lowStockItems = products.filter(p => p.stock <= (p.minStock || 5));
    if (lowStockItems.length === 0) return;

    // Solo notificar si han pasado más de 6 horas desde la última alerta
    const lastAlert = localStorage.getItem('freshpos_last_stock_alert');
    const now = Date.now();
    
    if (!lastAlert || (now - parseInt(lastAlert)) > (6 * 60 * 60 * 1000)) {
        let alertMsg = `*⚠️ ALERTA DE STOCK BAJO (${settings.appName})*\n\n`;
        lowStockItems.forEach(item => {
            alertMsg += `- *${item.name}*: Quedan ${item.stock} (Límite: ${item.minStock || 5})\n`;
        });
        alertMsg += `\n_Favor reponer inventario._`;

        if (window.isWhatsappAutomatedReady && settings.bossPhone) {
            window.electronAPI.sendWhatsAppBackground(settings.bossPhone, alertMsg);
            localStorage.setItem('freshpos_last_stock_alert', now.toString());
            console.log("✅ Alerta de stock bajo enviada a WhatsApp.");
        }
    }
}

// ==========================================
// WHATSAPP AUTOMATION EVENT LISTENERS
// ==========================================
window.isWhatsappAutomatedReady = false;
if (window.electronAPI) {
    const handleStatus = ({ status, error, percent, message, qr }) => {

        const qrPlaceholder = document.getElementById('wa-qr-placeholder');
        const qrImg = document.getElementById('wa-qr-img');
        const connectedView = document.getElementById('wa-connected-view');
        const errorView = document.getElementById('wa-error-view');
        const statusBadge = document.getElementById('wa-status-badge');
        const placeholderText = document.querySelector('#wa-qr-placeholder p');
        const errorText = document.getElementById('wa-error-text');

        if (status === 'qr' || qr) {
            window.isWhatsappAutomatedReady = false;
            if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
            if (connectedView) connectedView.classList.add('hidden');
            if (qrImg) {
                qrImg.src = qr || qrImg.src;
                qrImg.classList.remove('hidden');
            }
            if (statusBadge) {
                statusBadge.textContent = 'ESPERANDO ESCANEO';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-blue-500 text-white text-[8px] font-bold uppercase animate-pulse';
            }
        } else if (status === 'ready') {
            window.isWhatsappAutomatedReady = true;
            if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
            if (qrImg) qrImg.classList.add('hidden');
            if (connectedView) connectedView.classList.remove('hidden');
            if (statusBadge) {
                statusBadge.textContent = 'CONECTADO';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold uppercase transition-all shadow-sm';
            }
        } else if (status === 'authenticated') {
            if (qrImg) qrImg.classList.add('hidden');
            if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');
            if (placeholderText) {
                placeholderText.innerHTML = '<span class="text-blue-500 font-bold"><i class="fas fa-check-circle animate-pulse"></i> ¡Escaneo Exitoso!</span><br/>Sincronizando mensajes (esto puede tardar unos minutos en teléfonos llenos)...';
            }
            if (statusBadge) {
                statusBadge.textContent = 'AUTENTICADO';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-blue-500 text-white text-[8px] font-bold uppercase transition-all shadow-sm animate-pulse';
            }
        } else if (status === 'loading' || status === 'starting') {
            if (statusBadge) {
                statusBadge.textContent = percent ? `CARGANDO ${percent}%` : 'INICIANDO...';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 text-[8px] font-bold uppercase transition-all';
            }
            if (placeholderText) placeholderText.textContent = message || 'Preparando motor de WhatsApp...';
        } else if (status === 'error') {
            window.isWhatsappAutomatedReady = false;
            if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
            if (qrImg) qrImg.classList.add('hidden');
            if (connectedView) connectedView.classList.add('hidden');
            if (errorView) errorView.classList.remove('hidden');
            if (statusBadge) {
                statusBadge.textContent = 'ERROR';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-rose-600 text-white text-[8px] font-bold uppercase transition-all';
            }
            if (errorText) errorText.innerHTML = `${error || 'Fallo crítico'}`;
        } else if (status === 'disconnected') {
            window.isWhatsappAutomatedReady = false;
            if (connectedView) connectedView.classList.add('hidden');
            if (errorView) errorView.classList.add('hidden');
            if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');
            if (qrImg) qrImg.classList.add('hidden');
            if (statusBadge) {
                statusBadge.textContent = 'DESCONECTADO';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-slate-400 text-white text-[8px] font-bold uppercase transition-all';
            }
        }
    };

    window.electronAPI.onWhatsAppStatus(handleStatus);

    // Verificación manual de conexión
    window.verifyWhatsAppConnection = async () => {
        const statusBadge = document.getElementById('wa-status-badge');
        if (statusBadge) {
            statusBadge.textContent = 'VERIFICANDO...';
            statusBadge.className = 'px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 text-[8px] font-bold uppercase animate-pulse';
        }

        try {
            const result = await window.electronAPI.getWhatsAppStatus();
            console.log('[WA-VERIFY] Resultado:', result);
            handleStatus(result);
            
            if (result.status === 'ready') {
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '✅ WhatsApp ACTIVO y funcionando', showConfirmButton: false, timer: 3000 });
            } else {
                Swal.fire({ 
                    icon: 'warning', 
                    title: 'WhatsApp Desconectado', 
                    html: '<b>La sesión expiró.</b><br>Vuelve a escanear el código QR que aparecerá abajo.',
                    confirmButtonColor: '#10b981'
                });
            }
        } catch (e) {
            console.error('[WA-VERIFY] Error:', e);
            Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'No se pudo verificar', showConfirmButton: false, timer: 3000 });
        }
    };

    // Desvincular manualmente
    window.logoutWhatsAppConnection = () => {
        Swal.fire({
            title: '¿Desvincular WhatsApp?',
            text: 'Se cerrará la sesión actual y tendrás que volver a escanear un código QR nuevo.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Sí, Desvincular'
        }).then(async (result) => {
            if (result.isConfirmed) {
                const statusBadge = document.getElementById('wa-status-badge');
                if (statusBadge) {
                    statusBadge.textContent = 'DESVINCULANDO...';
                    statusBadge.className = 'px-2 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-bold uppercase animate-pulse';
                }
                
                try {
                    await window.electronAPI.logoutWhatsApp();
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Cuenta desvinculada', showConfirmButton: false, timer: 3000 });
                } catch (e) {
                    console.error('[WA-LOGOUT] Error:', e);
                }
            }
        });
    };

    // --- NUEVAS FUNCIONES DE RECUPERACIÓN WA ---
    window.retryWhatsAppEngine = async () => {
        const statusBadge = document.getElementById('wa-status-badge');
        const errorView = document.getElementById('wa-error-view');
        const qrPlaceholder = document.getElementById('wa-qr-placeholder');
        
        if (statusBadge) {
            statusBadge.textContent = 'REINTENTANDO...';
            statusBadge.className = 'px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 text-[8px] font-bold uppercase animate-pulse';
        }
        
        if (errorView) errorView.classList.add('hidden');
        if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');

        try {
            await window.electronAPI.initWhatsApp();
        } catch(e) {
            console.error('[WA-RETRY] Error:', e);
        }
    };

    window.forceResetWhatsApp = () => {
        Swal.fire({
            title: '¿Forzar Cierre y Limpiar?',
            html: 'Se cerrarán todos los procesos de WhatsApp y se borrará la sesión actual.<br><br><span class="text-rose-500 font-bold uppercase text-xs">⚠️ ÚSALO SI EL MOTOR ESTÁ "TRABADO" O DA ERROR DE BROWSER</span>',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Sí, Limpiar Todo'
        }).then(async (result) => {
            if (result.isConfirmed) {
                const statusBadge = document.getElementById('wa-status-badge');
                if (statusBadge) {
                    statusBadge.textContent = 'LIMPIANDO SISTEMA...';
                    statusBadge.className = 'px-2 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-bold uppercase animate-pulse';
                }
                
                try {
                    await window.electronAPI.logoutWhatsApp();
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Sistema limpiado. Espera el nuevo QR.', showConfirmButton: false, timer: 4000 });
                } catch (e) {
                    console.error('[WA-FORCE-RESET] Error:', e);
                }
            }
        });
    };

    // ESCUCHA DE PAGO MÓVIL (AUTOMATIZACIÓN SMS/GMAIL)
    window.electronAPI.onPaymentDetected((payment) => {
        console.log('💰 Pago Móvil Recibido:', payment);
        
        // BUSCAR SI HAY ALGUNA ORDEN MÓVIL PENDIENTE QUE COINCIDA CON EL MONTO
        const matchingOrder = incomingOrders.find(o => Math.abs(o.totalVES - payment.amount) < 1); // Tolerancia 1 Bs.
        
        let htmlTitle = '¡PAGO RECIBIDO! 💸';
        let htmlBody = `
            <div class="text-center p-4">
                <p class="text-3xl font-black text-emerald-600 mb-2">Bs. ${payment.amount}</p>
                <div class="flex flex-col gap-1 items-center justify-center">
                    <span class="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black uppercase tracking-widest">Referencia: ${payment.reference}</span>
                    <span class="text-[10px] font-bold text-slate-400 mt-1">${payment.bank}</span>
                </div>
            </div>
        `;

        if (matchingOrder) {
            htmlTitle = '¡PAGO VINCULADO! 🤝';
            htmlBody = `
                <div class="text-center p-4">
                    <div class="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                        <p class="text-[10px] font-black uppercase text-emerald-600 tracking-tighter mb-1">Coincide con un pedido:</p>
                        <p class="text-sm font-black text-slate-800">${matchingOrder.payment.originName || 'Cliente Móvil'}</p>
                        <p class="text-[10px] font-bold text-slate-400">Orden #${matchingOrder.id} • Bs. ${matchingOrder.totalVES}</p>
                    </div>
                    <p class="text-3xl font-black text-emerald-600 mb-2">Bs. ${payment.amount}</p>
                    <p class="text-[10px] font-bold text-slate-400 uppercase">Banco: ${payment.bank} | Ref: ${payment.reference}</p>
                </div>
            `;
        }
        
        Swal.fire({
            title: htmlTitle,
            html: htmlBody,
            icon: 'success',
            showCancelButton: true,
            confirmButtonText: matchingOrder ? 'Cobrar Este Pedido' : 'Usar en Venta Actual',
            cancelButtonText: 'Ignorar',
            confirmButtonColor: '#10b981',
            timer: 20000,
            timerProgressBar: true
        }).then((result) => {
            if (result.isConfirmed) {
                // Si hay un matchingOrder, ejecutar approveOrder automáticamente
                if (matchingOrder) {
                    const idx = incomingOrders.findIndex(o => o.id === matchingOrder.id);
                    if (idx > -1) {
                        window.approveOrder(idx);
                        // Una vez aprobado (cargado al POS), abrir el modal de pago y autocompletar
                        setTimeout(() => {
                            const checkoutBtn = document.getElementById('show-checkout-btn');
                            if (checkoutBtn) checkoutBtn.click();
                            
                            setTimeout(() => {
                                fillPaymentData(payment);
                            }, 500);
                        }, 500);
                    }
                } else {
                    // Si no hay matchingOrder, solo llenar datos en el checkout si está abierto
                    fillPaymentData(payment);
                }
            }
        });

        function fillPaymentData(pay) {
            const modal = document.getElementById('checkout-modal');
            if (modal && modal.classList.contains('modal-open')) {
                const inputAmount = document.getElementById('amount-received');
                const inputObs = document.getElementById('checkout-observations');
                const tabCard = document.querySelector('[data-method="card-ves"]');
                
                if (tabCard) tabCard.click();
                if (inputAmount) {
                    inputAmount.value = pay.amount;
                    inputAmount.dispatchEvent(new Event('input'));
                }
                if (inputObs) inputObs.value = `${pay.bank} PM Ref: ${pay.reference}`;

                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Datos vinculados', showConfirmButton: false, timer: 2000 });
            } else if (!matchingOrder) {
                Swal.fire('Atención', 'Abre la ventana de cobro [PAGAR] para usar estos datos.', 'info');
            }
        }

        // Sonido de notificación
        try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play();
        } catch(e) {}
    });

    // Pedir estado inicial
    window.electronAPI.getWhatsAppStatus().then(handleStatus).catch(console.error);
}


// ==========================================
// REPORTS PDF EXPORT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('download-report-pdf-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            const el = document.getElementById('view-reports');
            if (el) {
                const btns = el.querySelectorAll('button');
                btns.forEach(b => b.style.display = 'none');
                const opt = { margin: 0.2, filename: 'Cierre.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'legal', orientation: 'landscape' } };
                Swal.fire({ title: 'Generando PDF...', allowInsideClick: false, didOpen: () => Swal.showLoading() });
                if (window.html2pdf) {
                    html2pdf().set(opt).from(el).save().then(() => { btns.forEach(b => b.style.display = ''); Swal.close(); }).catch(() => { btns.forEach(b => b.style.display = ''); Swal.fire('Error', 'No se pudo generar.', 'error'); });
                } else {
                    Swal.fire('Error', 'html2pdf no cargado.', 'error');
                }
            }
        });
    }
});

window.generateLibroIVA = function() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        Swal.fire('Error', 'Librería jsPDF no cargada.', 'error');
        return;
    }
    
    const nombreEmpresa = settings.companyName || settings.appName || 'Punto Pila';
    const rifEmpresa = settings.rif || 'J-00000000-0';
    
    const doc = new window.jspdf.jsPDF('landscape');
    
    doc.setFontSize(16);
    doc.text(`LIBRO DE VENTAS (IVA)`, 14, 15);
    
    doc.setFontSize(10);
    doc.text(`Razón Social: ${nombreEmpresa}`, 14, 22);
    doc.text(`RIF: ${rifEmpresa}`, 14, 27);
    doc.text(`Mes/Año: ${new Date().toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })}`, 14, 32);

    const bodyData = [];
    let consecutivo = 1;
    let totalVentas = 0;
    let totalBase = 0;
    let totalIva = 0;
    
    const ivaRate = 0.16;

    sales.forEach(sale => {
        const rate = sale.exchangeRate || settings.exchangeRate || 36.5;
        const saleTotalVES = sale.totalVES || (sale.totalUSD * rate);
        
        const baseItem = saleTotalVES / (1 + ivaRate);
        const ivaItem = saleTotalVES - baseItem;

        totalVentas += saleTotalVES;
        totalBase += baseItem;
        totalIva += ivaItem;

        bodyData.push([
            consecutivo++,
            new Date(sale.date).toLocaleDateString('es-VE'),
            sale.client?.document || 'V-000000',
            sale.client?.name || 'Cliente Genérico',
            sale.ticket,
            '01-Reg',
            formatVES(saleTotalVES).replace('Bs ', ''),
            formatVES(baseItem).replace('Bs ', ''),
            '16%',
            formatVES(ivaItem).replace('Bs ', '')
        ]);
    });

    bodyData.push([
        '', '', '', 'TOTALES', '', '', 
        formatVES(totalVentas).replace('Bs ', ''), 
        formatVES(totalBase).replace('Bs ', ''), 
        '', 
        formatVES(totalIva).replace('Bs ', '')
    ]);

    doc.autoTable({
        startY: 38,
        headStyles: { fillColor: [30, 58, 138], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        head: [['Nº', 'Fecha', 'RIF/CI', 'Razón Social', 'Factura', 'Tipo Trans.', 'Total Ventas', 'Base Imponible', '% IVA', 'Impuesto IVA']],
        body: bodyData,
    });

    doc.save(`Libro_IVA_${new Date().getTime()}.pdf`);
};

window.lockSession = () => {
    if (currentRole === 'admin') {
        currentRole = 'cashier';
        const restricted = ['view-inventory', 'view-reports', 'view-analytics', 'view-settings', 'view-purchases', 'view-expenses'];
        const navs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];
        // Note: nav-cierre, nav-pos and nav-help are NOT restricted.
        let kick = false;
        restricted.forEach(v => { const el = document.getElementById(v); if (el && !el.classList.contains('hidden')) kick = true; });
        if (kick) { const nav = document.getElementById('nav-pos'); if (nav) nav.click(); }

        // Hide administrative sidebar links
        navs.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
        
        // Hide specific admin buttons
        const addProdBtn = document.getElementById('add-product-btn'); if (addProdBtn) addProdBtn.classList.add('hidden');
        const openAddProd = document.getElementById('open-add-product'); if (openAddProd) openAddProd.classList.add('hidden');
        const addExpBtn = document.querySelector('[onclick="openExpenseModal()"]'); if (addExpBtn) addExpBtn.classList.add('hidden');

        const text = document.getElementById('role-text');
        const badge = document.getElementById('role-status-badge');
        if (text) text.textContent = 'Modo Cajero';
        if (badge) { badge.className = 'absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center'; badge.innerHTML = '<i class="fas fa-check text-[8px] text-white"></i>'; }
        
        renderInventory(); // Re-render to hide actions
        renderCredits();   // Re-render to hide actions
        renderExpenses();  // Re-render to hide actions

        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `Sesión Protegida`, showConfirmButton: false, timer: 1500 });
    } else {
        const m = document.getElementById('pin-modal');
        if (m) { m.classList.remove('hidden'); m.classList.add('flex'); setTimeout(() => document.getElementById('admin-pin-input').focus(), 100); }
    }
};


window.verifyAdminPin = () => {
    const pinVal = document.getElementById('admin-pin-input').value;
    const correctPin = settings.adminPin || '3244';
    if (pinVal === correctPin) {
        currentRole = 'admin';
        document.getElementById('pin-modal').classList.add('hidden');
        document.getElementById('pin-modal').classList.remove('flex');
        document.getElementById('admin-pin-input').value = '';
        
        // Show administrative sidebar links
        const navs = ['nav-inventory', 'nav-reports', 'nav-analytics', 'nav-settings', 'nav-purchases', 'nav-expenses'];

        navs.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); });

        // Show specific admin buttons
        const addProdBtn = document.getElementById('add-product-btn'); if (addProdBtn) addProdBtn.classList.remove('hidden');
        const openAddProd = document.getElementById('open-add-product'); if (openAddProd) openAddProd.classList.remove('hidden');
        const addExpBtn = document.querySelector('[onclick="openExpenseModal()"]'); if (addExpBtn) addExpBtn.classList.remove('hidden');

        const text = document.getElementById('role-text');
        const badge = document.getElementById('role-status-badge');
        if (text) text.textContent = 'Modo Administrador';
        if (badge) {
            badge.className = 'absolute -bottom-1 -right-1 bg-brand-500 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center';
            badge.innerHTML = '<i class="fas fa-shield-alt text-[8px] text-white"></i>';
        }

        renderInventory(); // Re-render to show actions
        renderCredits();   // Re-render to show actions
        renderExpenses();  // Re-render to show actions

        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Acceso Concedido`, text: 'Bienvenido, Administrador', showConfirmButton: false, timer: 2000 });
    } else {
        Swal.fire({ icon: 'error', title: 'PIN Incorrecto', text: 'El acceso ha sido denegado.', timer: 2000 });
        document.getElementById('admin-pin-input').value = '';
    }
};



// Listen for Fiao Button
document.addEventListener('click', (e) => {
    if (e.target.id === 'fiao-payment-btn') {
        if (cart.length === 0) return Swal.fire('Carrito Vacío', '', 'info');
        window.pendingStatus = 'pending';
        processPayment();
    }
});

// ==========================================
// ACCOUNTS RECEIVABLE (FIAOS)
// ==========================================
async function renderCredits() {
    const tableBody = document.getElementById('credits-table-body');
    const totalDisplayUSD = document.getElementById('credits-summary-total');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    
    let pendingSales = [];
    if (window.db) {
        pendingSales = await window.db.getCredits();
    } else {
        pendingSales = sales.filter(s => s.status === 'pending');
    }
    
    let totalUSD = 0;

    pendingSales.forEach(credit => {
        // Handle both DB credit format and memory sale format
        const ticket = credit.sale_ticket || credit.sale_id || credit.ticket || 'N/A';
        const clientName = credit.client_name || credit.client?.name || 'Desconocido';
        const date = credit.date || new Date().toISOString();
        const amountOwed = credit.amount_owed || credit.sale_total || credit.totalUSD || 0;
        const amountPaid = credit.amount_paid || 0;
        const pendingAmount = amountOwed - amountPaid;
        
        totalUSD += pendingAmount;
        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-50 transition-colors cursor-pointer';
        row.innerHTML = `
            <td class="px-6 py-4 font-mono font-bold text-slate-400 text-center">#${ticket}</td>
            <td class="px-6 py-4 font-bold text-slate-700">${clientName}</td>
            <td class="px-6 py-4 text-sm text-slate-500">${new Date(date).toLocaleDateString()}</td>
            <td class="px-6 py-4 text-right font-black text-rose-600">
                ${formatUSD(pendingAmount)}
                <div class="text-[10px] text-slate-400 font-medium">Deuda original: ${formatUSD(amountOwed)}</div>
            </td>
            <td class="px-6 py-4 text-center">
                <button onclick="settleCredit('${credit.id || ticket}', ${pendingAmount})" class="px-4 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg font-bold text-xs hover:bg-emerald-200 transition-all">
                    Abonar / Pagar
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    if (totalDisplayUSD) totalDisplayUSD.textContent = `Deuda Pendiente: ${formatUSD(totalUSD)}`;
}

function settleCredit(creditId, maxAmount) {
    Swal.fire({
        title: 'Abonar a la Deuda',
        html: `
            <p class="mb-4 text-sm text-slate-500">Monto pendiente: <strong class="text-rose-500">${formatUSD(maxAmount)}</strong></p>
            <input type="number" id="abono-amount" class="swal2-input" placeholder="Monto a abonar (USD)" max="${maxAmount}" step="0.01">
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'Registrar Pago',
        preConfirm: () => {
            const amount = parseFloat(document.getElementById('abono-amount').value);
            if (!amount || amount <= 0 || amount > maxAmount) {
                Swal.showValidationMessage('Ingrese un monto válido');
                return false;
            }
            return amount;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const amount = result.value;
            if (window.db && creditId.startsWith('cred_')) {
                await window.db.addCreditPayment(creditId, amount, 'Efectivo');
            } else {
                // Fallback a localStorage si es viejo ticket
                const saleIndex = sales.findIndex(s => s.ticket === creditId);
                if (saleIndex > -1) {
                    sales[saleIndex].status = 'paid';
                    sales[saleIndex].paymentDate = new Date().toISOString();
                    saveSales();
                }
            }
            renderCredits();
            Swal.fire('¡Pago Registrado!', `Se abonó ${formatUSD(amount)} a la cuenta.`, 'success');
        }
    });
}

// ==========================================
// EXPENSE MANAGEMENT
// ==========================================
function renderExpenses() {
    const tableBody = document.getElementById('expenses-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    
    // Ordenar por fecha (más recientes primero)
    const sortedExpenses = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedExpenses.forEach(exp => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-50 transition-all border-b border-slate-100';
        row.innerHTML = `
            <td class="px-6 py-4 text-[11px] font-bold text-slate-400">
                ${new Date(exp.date).toLocaleDateString()}
                <div class="text-[9px] font-medium opacity-60">${new Date(exp.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            </td>
            <td class="px-6 py-4">
                <div class="font-bold text-slate-700 text-sm">${exp.description}</div>
                <div class="flex gap-2 mt-1">
                    <span class="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black uppercase tracking-widest">${exp.responsibleName || 'N/A'}</span>
                    <span class="px-2 py-0.5 bg-brand-50 text-brand-600 rounded text-[9px] font-black uppercase tracking-widest">${exp.paymentMethod || 'Efectivo'}</span>
                    ${exp.referenceNumber ? `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[9px] font-black uppercase tracking-widest">Ref: ${exp.referenceNumber}</span>` : ''}
                </div>
            </td>
            <td class="px-6 py-4 text-right">
                <div class="font-black text-rose-500 text-lg">${formatUSD(exp.amountUSD)}</div>
                <div class="text-[10px] font-bold text-slate-400">≈ ${formatVES(exp.amountUSD * settings.exchangeRate)}</div>
            </td>
            <td class="px-6 py-4 text-center">
                <button onclick="deleteExpense('${exp.id}')" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

function openExpenseModal() {
    Swal.fire({
        title: 'Registrar Gasto de Negocio',
        html: `
            <div class="space-y-4 py-4 text-left">
                <div>
                    <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Descripción del Gasto</label>
                    <input id="exp-desc" class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-3 px-4 outline-none focus:border-brand-500 transition-all font-bold text-slate-700" placeholder="Ej: Pago de Luz, Alquiler, Hielo...">
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Monto en USD ($)</label>
                        <input id="exp-amount" type="number" step="0.01" class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-3 px-4 outline-none focus:border-brand-500 transition-all font-black text-rose-600" placeholder="0.00">
                    </div>
                    <div>
                        <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Responsable</label>
                        <input id="exp-responsible" class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-3 px-4 outline-none focus:border-brand-500 transition-all font-bold text-slate-700" placeholder="Nombre">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Método de Pago</label>
                        <select id="exp-method" class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-3 px-4 outline-none focus:border-brand-500 transition-all font-bold text-slate-700">
                            <option value="efectivo">Efectivo USD</option>
                            <option value="pago-movil">Pago Móvil</option>
                            <option value="zelle">Zelle</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="efectivo-ves">Efectivo BS</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Referencia / Comprobante</label>
                        <input id="exp-ref" class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-3 px-4 outline-none focus:border-brand-500 transition-all font-bold text-slate-700" placeholder="Nro de Operación">
                    </div>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-save mr-2"></i> Guardar Gasto',
        confirmButtonColor: '#3b82f6',
        preConfirm: () => {
            const description = document.getElementById('exp-desc').value.trim();
            const amountUSD = parseFloat(document.getElementById('exp-amount').value);
            const responsibleName = document.getElementById('exp-responsible').value.trim();
            const paymentMethod = document.getElementById('exp-method').value;
            const referenceNumber = document.getElementById('exp-ref').value.trim();

            if (!description || isNaN(amountUSD) || amountUSD <= 0) {
                Swal.showValidationMessage('La descripción y el monto son obligatorios');
                return false;
            }

            return { description, amountUSD, responsibleName, paymentMethod, referenceNumber };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const data = result.value;
            
            // Validación de Monto Alto (> $500)
            if (data.amountUSD > 500) {
                const confirmHigh = await Swal.fire({
                    title: '¿Confirmar Gasto Elevado?',
                    text: `Estás registrando un gasto de ${formatUSD(data.amountUSD)}. ¿Es correcto?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, es correcto',
                    cancelButtonText: 'Corregir'
                });
                if (!confirmHigh.isConfirmed) return openExpenseModal(); // Reabrir modal
            }

            const newExpense = { 
                id: 'exp_' + Date.now(), 
                date: new Date().toISOString(), 
                ...data 
            };

            expenses.push(newExpense);
            saveExpenses();
            renderExpenses();

            // Sincronizar inmediatamente con la nube
            if (window.cloudSync) {
                window.cloudSync.pushExpense(newExpense).catch(console.error);
            }

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'Gasto registrado correctamente',
                showConfirmButton: false,
                timer: 3000
            });
        }
    });
}

function deleteExpense(id) {
    Swal.fire({
        title: '¿Eliminar Gasto?',
        text: "Esta acción no se puede deshacer.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, Eliminar'
    }).then((result) => {
        if (result.isConfirmed) {
            expenses = expenses.filter(e => e.id !== id);
            saveExpenses();
            renderExpenses();
            Swal.fire('Eliminado', 'El gasto ha sido removido.', 'success');
        }
    });
}

// ==========================================
// STORE IDENTITY (MULTI-TENANT)
// ==========================================
function renderStoreIdentityWidget() {
    const idEl     = document.getElementById('store-id-display');
    const nameEl   = document.getElementById('branch-name-display');
    if (!idEl || !nameEl) return;

    if (settings.storeId) {
        idEl.textContent   = `🔑 ${settings.storeId}`;
        nameEl.textContent = settings.branchName || 'Sucursal sin nombre';
    } else {
        idEl.textContent   = '⚠️ Sin configurar';
        nameEl.textContent = 'Haz clic en ⚙️ para configurar';
    }
}

window.openStoreIdentityModal = function() {
    const currentId   = settings.storeId   || '';
    const currentName = settings.branchName || '';

    Swal.fire({
        title: '<i class="fas fa-building mr-2 text-indigo-500"></i>Identidad de Sucursal',
        html: `
            <div class="space-y-4 text-left mt-2">
                <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 font-medium">
                    <i class="fas fa-info-circle mr-1"></i>
                    El <b>ID de Sucursal</b> aísla todos los datos de este negocio. 
                    <br><br><b>Multi-Tenant:</b> En la web, el ID se detectará automáticamente desde el subdominio (ej: <code>sucursal.puntopila.ve</code>).
                </div>
                <div>
                    <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">ID Único de Sucursal *</label>
                    <input id="swal-store-id" 
                        class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-indigo-500 font-black text-slate-800 font-mono" 
                        placeholder="ej. panaderia_catia_01"
                        value="${currentId}"
                        oninput="this.value = this.value.toLowerCase().replace(/[^a-z0-9_]/g,'')">
                    <p class="text-[9px] text-slate-400 mt-1">Solo letras minúsculas, números y guiones bajos.</p>
                </div>
                <div>
                    <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Nombre de la Sucursal</label>
                    <input id="swal-branch-name" 
                        class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-indigo-500 font-bold text-slate-800" 
                        placeholder="ej. Sede Principal Catia"
                        value="${currentName}">
                </div>
                <button onclick="
                    const n = 'store_' + Date.now().toString(36);
                    document.getElementById('swal-store-id').value = n;
                " class="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-black rounded-xl transition-all border border-indigo-200">
                    <i class="fas fa-magic mr-1"></i> Auto-generar ID único
                </button>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-save mr-2"></i>Guardar',
        confirmButtonColor: '#6366f1',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const newId   = document.getElementById('swal-store-id').value.trim();
            const newName = document.getElementById('swal-branch-name').value.trim();
            if (!newId) {
                Swal.showValidationMessage('El ID de Sucursal es obligatorio');
                return false;
            }
            // Advertir si el ID cambia (datos no se borran, solo cambia el namespace)
            if (currentId && currentId !== newId) {
                const confirmed = confirm(`⚠️ Estás cambiando el ID de "${currentId}" a "${newId}". Los datos del namespace anterior seguirán en localStorage pero no se cargarán automáticamente. ¿Continuar?`);
                if (!confirmed) return false;
            }
            return { storeId: newId, branchName: newName };
        }
    }).then(res => {
        if (res.isConfirmed) {
            settings.storeId    = res.value.storeId;
            settings.branchName = res.value.branchName;
            saveSettings();

            // Migrar datos existentes al nuevo namespace
            migrateLegacyToTenant();

            renderStoreIdentityWidget();

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `Sucursal configurada: ${settings.storeId}`,
                showConfirmButton: false,
                timer: 3000
            });
        }
    });
}

// ==========================================
// SUPPLIERS (PROVEEDORES)
// ==========================================

window.saveSuppliers = function() {
    tenantSet('freshpos_suppliers', JSON.stringify(suppliers));
}

window.renderSuppliersDropdown = function() {
    const select = document.getElementById('carga-provider');
    if (!select) return;
    
    const currentVal = select.value;
    
    select.innerHTML = '<option value="">Proveedor Ocasional</option>';
    suppliers.sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
        select.innerHTML += `<option value="${s.name}">${s.name}</option>`;
    });
    
    if (currentVal && suppliers.find(s => s.name === currentVal)) {
        select.value = currentVal;
    }
    
    if (typeof window.autoFillInvoiceNum === 'function') {
        window.autoFillInvoiceNum();
    }
}

window.autoFillInvoiceNum = function() {
    const provider = document.getElementById('carga-provider');
    const invoiceInput = document.getElementById('carga-invoice-num');
    if (!provider || !invoiceInput || !provider.value) {
        if (invoiceInput && !provider.value) invoiceInput.value = '';
        return;
    }
    
    const count = payables.filter(p => p.provider === provider.value).length;
    invoiceInput.value = String(count + 1).padStart(3, '0');
}

window.addNewSupplier = function() {
    Swal.fire({
        title: 'Nuevo Proveedor',
        html: `
            <div class="space-y-4 text-left">
                <div>
                    <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Nombre Comercial</label>
                    <input id="swal-sup-name" class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-brand-500 font-bold text-slate-800" placeholder="Ej. Polar, Nestlé">
                </div>
                <div>
                    <label class="block text-[10px] font-black uppercase text-slate-400 mb-1">Contacto / Teléfono</label>
                    <input id="swal-sup-phone" class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-brand-500 font-bold text-slate-800" placeholder="Opcional">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-save mr-2"></i> Guardar',
        confirmButtonColor: '#10b981',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const name = document.getElementById('swal-sup-name').value.trim();
            if (!name) {
                Swal.showValidationMessage('El nombre es obligatorio');
                return false;
            }
            return { name, phone: document.getElementById('swal-sup-phone').value.trim() };
        }
    }).then(res => {
        if (res.isConfirmed) {
            suppliers.push({
                id: 'sup_' + Date.now(),
                name: res.value.name,
                phone: res.value.phone
            });
            saveSuppliers();
            renderSuppliersDropdown();
            
            const select = document.getElementById('carga-provider');
            if (select) select.value = res.value.name;
            
            Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Proveedor agregado', showConfirmButton: false, timer: 2000});
        }
    });
}

// ==========================================
// GESTION PROVEEDORES (KARDEX)
// ==========================================
window.renderProveedores = function() {
    const grid = document.getElementById('proveedores-grid');
    if (!grid) return;
    
    // Unificar todos los proveedores registrados y los que existen en el historial
    let allProviderNames = new Set(suppliers.map(s => s.name));
    
    // Sumar tambien los ocasionales o eliminados que aun tienen data
    const rawLogs = tenantGet('freshpos_purchases_log');
    const logs = rawLogs ? JSON.parse(rawLogs) : [];
    logs.forEach(l => { if(l.provider) allProviderNames.add(l.provider); });
    payables.forEach(p => { if(p.provider) allProviderNames.add(p.provider); });
    
    const countEl = document.getElementById('proveedores-count');
    if(countEl) countEl.textContent = allProviderNames.size;
    
    grid.innerHTML = '';
    
    if (allProviderNames.size === 0) {
        grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 font-bold italic">No hay proveedores registrados.</div>`;
        return;
    }
    
    Array.from(allProviderNames).sort().forEach(name => {
        // Calcular estadisticas
        const providerLogs = logs.filter(l => l.provider === name);
        const providerPayables = payables.filter(p => p.provider === name);
        
        let totalPurchased = providerLogs.reduce((acc, l) => acc + (l.totalUSD || 0), 0);
        let currentDebt = providerPayables.filter(p => p.status === 'pending')
                                          .reduce((acc, p) => acc + (p.amountUSD - (p.paidAmountUSD || 0)), 0);
                                          
        grid.innerHTML += `
            <div onclick="openSupplierDetails('${name.replace(/'/g, "\\'")}')" class="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between h-full">
                <div>
                    <div class="w-12 h-12 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-transform">
                        <i class="fas fa-truck-fast text-xl"></i>
                    </div>
                    <h3 class="text-xl font-black text-slate-800 tracking-tight leading-tight mb-2">${name}</h3>
                    <p class="text-xs font-bold text-slate-500 mb-4">${providerLogs.length} facturas registradas</p>
                </div>
                <div class="pt-4 border-t border-slate-100 flex justify-between items-end">
                    <div>
                        <div class="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">Deuda Activa</div>
                        <div class="text-lg font-black ${currentDebt > 0 ? 'text-rose-600' : 'text-emerald-500'}">$${currentDebt.toFixed(2)}</div>
                    </div>
                    <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-brand-500 group-hover:text-white transition-colors">
                        <i class="fas fa-chevron-right text-sm"></i>
                    </div>
                </div>
            </div>
        `;
    });
}

window.openSupplierDetails = function(name) {
    const modal = document.getElementById('supplier-details-modal');
    const content = document.getElementById('supplier-details-content');
    document.getElementById('supplier-details-name').textContent = name;
    
    const rawLogs = tenantGet('freshpos_purchases_log');
    const logs = rawLogs ? JSON.parse(rawLogs) : [];
    
    const providerLogs = logs.filter(l => l.provider === name).sort((a,b) => new Date(b.date) - new Date(a.date));
    const providerPayables = payables.filter(p => p.provider === name).sort((a,b) => new Date(b.date) - new Date(a.date));
    
    let html = '';
    
    // SECCION 1: DEUDAS Y PAGOS
    html += `<div class="mb-8">
        <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><i class="fas fa-file-invoice-dollar"></i> Estado de Cuentas (Deudas y Pagos)</h4>`;
    
    if (providerPayables.length === 0) {
        html += `<div class="bg-white rounded-2xl p-6 border border-slate-100 text-center text-slate-400 font-bold italic text-sm shadow-sm">No hay registro de cuentas por cobrar/pagar para este proveedor.</div>`;
    } else {
        html += `<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"><table class="w-full text-left"><tbody class="divide-y divide-slate-100">`;
        providerPayables.forEach(p => {
            const isPending = p.status === 'pending';
            const paid = p.paidAmountUSD || 0;
            const remaining = p.amountUSD - paid;
            
            let histHTML = '';
            if (p.paymentHistory && p.paymentHistory.length > 0) {
                histHTML = `<div class="mt-3 pl-3 border-l-2 border-brand-200">
                    <div class="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">Pagos/Abonos Registrados:</div>`;
                p.paymentHistory.forEach(ph => {
                    histHTML += `<div class="text-[10px] text-slate-500 font-bold flex flex-col mb-1.5 w-48">
                        <div class="flex justify-between items-center">
                            <span>${new Date(ph.date).toLocaleDateString()}</span>
                            <span class="text-emerald-500">+$${ph.amountUSD.toFixed(2)}</span>
                        </div>
                        <div class="text-[8px] text-slate-400 font-medium">${ph.method || 'No especificado'}</div>
                    </div>`;
                });
                histHTML += `</div>`;
            }
            
            html += `
                <tr class="hover:bg-slate-50">
                    <td class="px-6 py-4 align-top">
                        <div class="text-xs font-bold text-slate-500">${new Date(p.date).toLocaleDateString()}</div>
                        <div class="text-[10px] font-black text-slate-400 uppercase mt-1">Factura #${p.invoiceNum || 'S/N'}</div>
                    </td>
                    <td class="px-6 py-4 align-top">
                        <div class="text-sm font-black text-slate-800">$${p.amountUSD.toFixed(2)}</div>
                        ${paid > 0 ? `<div class="text-[9px] font-bold text-emerald-500 mt-1">Pagado: $${paid.toFixed(2)}</div>` : ''}
                        ${isPending ? `<div class="text-[9px] font-bold text-rose-500">Resta: $${remaining.toFixed(2)}</div>` : ''}
                        ${histHTML}
                    </td>
                    <td class="px-6 py-4 align-top text-right">
                        ${isPending 
                            ? `<span class="bg-rose-100 text-rose-600 px-3 py-1 rounded-lg text-[9px] font-black uppercase">Pendiente</span>`
                            : `<span class="bg-emerald-100 text-emerald-600 px-3 py-1 rounded-lg text-[9px] font-black uppercase">Pagado</span>`
                        }
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
    }
    html += `</div>`;
    
    // SECCION 2: HISTORIAL DE MERCANCIA
    html += `<div>
        <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><i class="fas fa-boxes-packing"></i> Historial de Mercancía Recibida</h4>`;
        
    if (providerLogs.length === 0) {
        html += `<div class="bg-white rounded-2xl p-6 border border-slate-100 text-center text-slate-400 font-bold italic text-sm shadow-sm">No hay registro de ingreso de mercancía.</div>`;
    } else {
        html += `<div class="space-y-4">`;
        providerLogs.forEach(l => {
            let itemsHTML = '';
            if (l.items && l.items.length > 0) {
                itemsHTML = `<div class="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3">`;
                l.items.forEach(item => {
                    itemsHTML += `
                        <div class="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                            <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm text-slate-400 text-xs shrink-0">
                                <i class="fas fa-box"></i>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-[11px] font-black text-slate-700 truncate" title="${item.name}">${item.name}</div>
                                <div class="text-[9px] font-bold text-slate-500 mt-0.5">${item.qtyBoxes} bulto(s) x ${item.unitsPerBox} ud | Costo: $${item.boxPriceGross ? item.boxPriceGross.toFixed(2) : '0.00'}</div>
                            </div>
                        </div>
                    `;
                });
                itemsHTML += `</div>`;
            } else {
                itemsHTML = `<div class="mt-4 pt-4 border-t border-slate-100 text-[10px] text-slate-400 italic">No hay detalle de productos para esta factura antigua.</div>`;
            }
            
            html += `
                <div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                    <div class="flex flex-wrap justify-between items-start gap-4">
                        <div>
                            <div class="text-xs font-bold text-slate-500 mb-1">${new Date(l.date).toLocaleDateString()} a las ${new Date(l.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                            <div class="text-sm font-black text-slate-800">Factura #${l.invoiceNum || 'S/N'}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-lg font-black text-brand-600">$${(l.totalUSD || 0).toFixed(2)}</div>
                            <div class="text-[9px] font-bold text-slate-400 uppercase mt-1">${l.itemsCount} producto(s) recibidos</div>
                        </div>
                    </div>
                    ${itemsHTML}
                </div>
            `;
        });
        html += `</div>`;
    }
    html += `</div>`;
    
    content.innerHTML = html;
    modal.classList.remove('hidden');
}

// ==========================================
// CIERRE DE CAJA (CLOSEOUT)
// ==========================================

window.savePayables = function() {
    tenantSet('freshpos_payables', JSON.stringify(payables));
}

window.renderPayables = function() {
    const tbody = document.getElementById('payables-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    let totalDebt = 0;
    const sorted = [...payables].sort((a,b) => new Date(b.date) - new Date(a.date));
    
    const showPaidEl = document.getElementById('show-paid-payables');
    const showPaid = showPaidEl ? showPaidEl.checked : false;

    let hasVisibleItems = false;

    sorted.forEach(p => {
        const paidAmount = p.paidAmountUSD || 0;
        const remaining = p.amountUSD - paidAmount;
        if (p.status === 'pending') totalDebt += remaining;
        
        // Filter out paid items unless checkbox is checked
        if (!showPaid && p.status === 'paid') return;
        
        hasVisibleItems = true;

        const isPending = p.status === 'pending';
        const statusBadge = isPending 
            ? `<span class="bg-rose-100 text-rose-600 px-2 py-1 rounded-md text-[9px] font-black uppercase">Pendiente</span>` 
            : `<span class="bg-emerald-100 text-emerald-600 px-2 py-1 rounded-md text-[9px] font-black uppercase">Pagado</span>`;
        
        const actionBtn = isPending
            ? `<button onclick="markPayableAsPaid('${p.id}')" class="px-3 py-1 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[10px] font-black uppercase shadow-sm transition-all"><i class="fas fa-check mr-1"></i> Pagar</button>`
            : `<span class="text-slate-400 text-xs italic">Saldado</span>`;

        let dueDateText = '';
        if (isPending) {
            const daysLeft = Math.ceil((new Date(p.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
            if (daysLeft < 0) {
                dueDateText = `<div class="text-[9px] text-rose-500 font-bold mt-1">Vencido hace ${Math.abs(daysLeft)} días</div>`;
            } else if (daysLeft === 0) {
                dueDateText = `<div class="text-[9px] text-amber-500 font-bold mt-1">Vence Hoy</div>`;
            } else {
                dueDateText = `<div class="text-[9px] text-slate-400 mt-1">Vence en ${daysLeft} días</div>`;
            }
        }

        let historyHTML = '';
        if (p.paymentHistory && p.paymentHistory.length > 0) {
            historyHTML = `<div class="mt-2 pl-3 border-l-2 border-brand-200">
                <div class="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">Historial de Abonos:</div>`;
            p.paymentHistory.forEach(ph => {
                historyHTML += `<div class="text-[10px] text-slate-500 font-bold flex flex-col mb-1.5 max-w-[180px]">
                    <div class="flex justify-between items-center">
                        <span>${new Date(ph.date).toLocaleDateString()}</span>
                        <span class="text-emerald-500">+$${ph.amountUSD.toFixed(2)}</span>
                    </div>
                    <div class="text-[8px] text-slate-400 font-medium">${ph.method || 'No especificado'}</div>
                </div>`;
            });
            historyHTML += `</div>`;
        }

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors border-b border-slate-50';
        tr.innerHTML = `
            <td class="py-4 px-6 text-[11px] font-bold text-slate-500 align-top">
                ${new Date(p.date).toLocaleDateString()}
                <div class="text-[9px] font-black text-slate-400 uppercase mt-1"># ${p.invoiceNum || 'S/N'}</div>
            </td>
            <td class="py-4 px-6 text-sm font-black text-slate-700 align-top">${p.provider}</td>
            <td class="py-4 px-6 align-top">
                <div class="text-sm font-black text-slate-800" title="Total Factura">$${p.amountUSD.toFixed(2)}</div>
                ${paidAmount > 0 && p.status === 'pending' ? `<div class="text-[9px] font-bold text-emerald-500 mt-1">Abonado: $${paidAmount.toFixed(2)}</div><div class="text-[9px] font-bold text-rose-500 mb-2">Resta: $${remaining.toFixed(2)}</div>` : ''}
                ${historyHTML}
            </td>
            <td class="py-4 px-6 text-center align-top">
                ${statusBadge}
                ${dueDateText}
            </td>
            <td class="py-4 px-6 text-right align-top">${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });
    
    if (!hasVisibleItems) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-slate-400 font-bold italic">No hay cuentas por pagar ${!showPaid ? 'pendientes' : ''}.</td></tr>`;
    }

    const debtEl = document.getElementById('payables-total-debt');
    if (debtEl) debtEl.textContent = `$${totalDebt.toFixed(2)}`;
}

window.markPayableAsPaid = function(id) {
    const idx = payables.findIndex(p => p.id === id);
    if (idx === -1) return;
    const payable = payables[idx];
    const maxAmount = payable.amountUSD - (payable.paidAmountUSD || 0);

    Swal.fire({
        title: 'Registrar Abono / Pago',
        html: `
            <p class="text-sm text-slate-500 mb-4">Factura: <b>${payable.invoiceNum || 'S/N'}</b> | Proveedor: <b>${payable.provider}</b></p>
            <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Deuda Restante:</p>
            <h3 class="text-3xl font-black text-rose-600 mb-6">$${maxAmount.toFixed(2)}</h3>
            
            <div class="text-left space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-[11px] font-black uppercase text-slate-400 tracking-widest mb-2">Monto del Pago</label>
                        <input type="number" id="swal-pay-amount" class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-brand-500 font-bold text-slate-800" value="${maxAmount.toFixed(2)}" min="0.01" step="0.01">
                    </div>
                    <div>
                        <label class="block text-[11px] font-black uppercase text-slate-400 tracking-widest mb-2">Moneda</label>
                        <select id="swal-pay-currency" class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-brand-500 font-bold text-slate-800">
                            <option value="USD">Dólares (USD)</option>
                            <option value="VES">Bolívares (VES)</option>
                            <option value="EUR">Euros (EUR)</option>
                        </select>
                    </div>
                </div>
                <div class="bg-rose-50 rounded-xl p-3 text-center border border-rose-100">
                    <div class="text-[10px] font-black uppercase text-rose-400 tracking-widest">Abono exacto a la deuda (USD)</div>
                    <div id="swal-pay-usd-preview" class="text-xl font-black text-rose-600 mt-1">$${maxAmount.toFixed(2)}</div>
                    <input type="hidden" id="swal-final-usd-amount" value="${maxAmount.toFixed(2)}">
                </div>
                <div>
                    <label class="block text-[11px] font-black uppercase text-slate-400 tracking-widest mb-2">Método de Pago</label>
                    <select id="swal-pay-method" class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-brand-500 font-bold text-slate-800">
                        <option value="Efectivo (Caja)">Efectivo (Caja)</option>
                        <option value="Pago Móvil">Pago Móvil</option>
                        <option value="Transferencia Bancaria">Transferencia Bancaria</option>
                        <option value="Zelle">Zelle / Divisas Electrónicas</option>
                        <option value="Punto de Venta">Punto de Venta</option>
                        <option value="Efectivo (Directo Socio)">Efectivo (Directo Socio)</option>
                    </select>
                </div>
                <div>
                    <label id="swal-ref-label" class="block text-[11px] font-black uppercase text-slate-400 tracking-widest mb-2">Procedencia del Dinero</label>
                    <input type="text" id="swal-pay-ref" class="w-full bg-slate-50 border-2 border-slate-200 rounded-xl py-3 px-4 outline-none focus:border-brand-500 font-bold text-slate-800" placeholder="Ej. Caja Principal, Socio X...">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        didOpen: () => {
            const methodSelect = document.getElementById('swal-pay-method');
            const refLabel = document.getElementById('swal-ref-label');
            const refInput = document.getElementById('swal-pay-ref');
            const currencySelect = document.getElementById('swal-pay-currency');
            const amountInput = document.getElementById('swal-pay-amount');
            const previewUSD = document.getElementById('swal-pay-usd-preview');
            const finalUSD = document.getElementById('swal-final-usd-amount');
            
            const updateCalculation = () => {
                const amt = parseFloat(amountInput.value) || 0;
                const cur = currencySelect.value;
                let usdEquiv = amt;
                
                if (cur === 'VES') {
                    usdEquiv = amt / settings.exchangeRate;
                } else if (cur === 'EUR') {
                    const eurRate = settings.euroRate || 40.0;
                    usdEquiv = (amt * eurRate) / settings.exchangeRate;
                }
                
                previewUSD.textContent = '$' + usdEquiv.toFixed(2);
                finalUSD.value = usdEquiv.toFixed(2);
            };

            currencySelect.addEventListener('change', updateCalculation);
            amountInput.addEventListener('input', updateCalculation);
            
            methodSelect.addEventListener('change', () => {
                const val = methodSelect.value;
                if (val.includes('Efectivo')) {
                    refLabel.textContent = 'Procedencia del Dinero';
                    refInput.placeholder = 'Ej. Caja Principal, Socio X...';
                } else {
                    refLabel.textContent = 'Banco / Referencia';
                    refInput.placeholder = 'Ej. Banesco Ref 1234';
                }
            });
        },
        confirmButtonText: 'Registrar Pago',
        confirmButtonColor: '#10b981',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const originalAmount = parseFloat(document.getElementById('swal-pay-amount').value);
            const currency = document.getElementById('swal-pay-currency').value;
            const amount = parseFloat(document.getElementById('swal-final-usd-amount').value);
            const baseMethod = document.getElementById('swal-pay-method').value;
            const ref = document.getElementById('swal-pay-ref').value.trim();
            let method = ref ? `${baseMethod} (${ref})` : baseMethod;
            
            if (currency !== 'USD') {
                method += ` [Abono original: ${originalAmount} ${currency}]`;
            }
            
            if (isNaN(amount) || amount <= 0) {
                Swal.showValidationMessage('Monto inválido');
                return false;
            }
            // Warning if they overpay
            if (amount > maxAmount + 0.1) {
                Swal.showValidationMessage(`El abono ($${amount.toFixed(2)}) supera la deuda ($${maxAmount.toFixed(2)})`);
                return false;
            }
            
            return { amount, method };
        }
    }).then(res => {
        if (res.isConfirmed && res.value) {
            const amountToPay = res.value.amount;
            const paymentMethod = res.value.method;

            payable.paidAmountUSD = (payable.paidAmountUSD || 0) + amountToPay;
            
            // Si ya se pagó todo o quedó un margen de error de céntimos
            if (payable.paidAmountUSD >= payable.amountUSD - 0.01) {
                payable.status = 'paid';
                payable.paidAmountUSD = payable.amountUSD; // sanitize floating point
            }
            
            savePayables();

            // Generar Gasto
            const newExpense = { 
                id: 'exp_' + Date.now(), 
                date: new Date().toISOString(), 
                description: `Abono Factura ${payable.invoiceNum || 'S/N'}: ${payable.provider}`,
                amountUSD: amountToPay,
                responsibleName: 'Sistema (Cuentas por Pagar)',
                paymentMethod: paymentMethod,
                referenceNumber: payable.invoiceNum || 'S/N'
            };
            expenses.push(newExpense);
            saveExpenses();
            
            payable.paymentHistory = payable.paymentHistory || [];
            payable.paymentHistory.push({
                date: new Date().toISOString(),
                amountUSD: amountToPay,
                method: paymentMethod
            });
            savePayables();
            
            renderPayables();
            if (typeof renderExpenses === 'function') renderExpenses();

            Swal.fire({
                toast: true, position: 'top-end',
                title: 'Abono Registrado y Gasto Generado',
                icon: 'success', showConfirmButton: false, timer: 3000
            });
        }
    });
}
/* ===== CIERRE DE CAJA — INTERFAZ COMPLETA ===== */

function _getDenomVal(id) {
    return parseFloat(document.getElementById(id)?.value || 0);
}
function _setDenomTotal(denomId, totalId, multiplier) {
    const count = _getDenomVal(denomId);
    const total = count * multiplier;
    const el = document.getElementById(totalId);
    if (el) el.textContent = multiplier >= 1 ? '$' + total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : total.toFixed(2);
    return total;
}
function _setDenomTotalVES(denomId, totalId, multiplier) {
    const count = _getDenomVal(denomId);
    const total = count * multiplier;
    const el = document.getElementById(totalId);
    if (el) el.textContent = 'Bs ' + total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return total;
}
function _calcDenomUSD() {
    let t = 0;
    t += _setDenomTotal('denom-usd-100', 'denom-usd-100-total', 100);
    t += _setDenomTotal('denom-usd-50', 'denom-usd-50-total', 50);
    t += _setDenomTotal('denom-usd-20', 'denom-usd-20-total', 20);
    t += _setDenomTotal('denom-usd-10', 'denom-usd-10-total', 10);
    t += _setDenomTotal('denom-usd-5', 'denom-usd-5-total', 5);
    t += _setDenomTotal('denom-usd-1', 'denom-usd-1-total', 1);
    t += _getDenomVal('denom-usd-coins');
    const el = document.getElementById('denom-usd-coins-total');
    if (el) el.textContent = '$' + _getDenomVal('denom-usd-coins').toFixed(2);
    const totalEl = document.getElementById('cierre-usd-total-counted');
    if (totalEl) totalEl.textContent = formatUSD(t);
    return t;
}
function _calcDenomVES() {
    let t = 0;
    t += _setDenomTotalVES('denom-ves-100', 'denom-ves-100-total', 100);
    t += _setDenomTotalVES('denom-ves-50', 'denom-ves-50-total', 50);
    t += _setDenomTotalVES('denom-ves-20', 'denom-ves-20-total', 20);
    t += _setDenomTotalVES('denom-ves-10', 'denom-ves-10-total', 10);
    t += _setDenomTotalVES('denom-ves-5', 'denom-ves-5-total', 5);
    t += _setDenomTotalVES('denom-ves-2', 'denom-ves-2-total', 2);
    t += _setDenomTotalVES('denom-ves-1', 'denom-ves-1-total', 1);
    t += _getDenomVal('denom-ves-coins');
    const el = document.getElementById('denom-ves-coins-total');
    if (el) el.textContent = 'Bs ' + _getDenomVal('denom-ves-coins').toFixed(2);
    const totalEl = document.getElementById('cierre-ves-total-counted');
    if (totalEl) totalEl.textContent = formatVES(t);
    return t;
}

window.toggleCollapse = (id) => {
    const el = document.getElementById(id);
    const chevron = document.getElementById(id + '-chevron');
    if (!el) return;
    const isHidden = el.classList.contains('hidden');
    el.classList.toggle('hidden');
    if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
};

function _calcCierreTotals() {
    let usd = 0, ves = 0, eur = 0, card = 0, pm = 0, transfer = 0;
    let txCount = 0;
    sales.forEach(s => {
        if (s.status === 'pending') return;
        txCount++;
        const m = s.method;
        if (m === 'cash-usd') usd += Number(s.totalUSD) || 0;
        else if (m === 'cash-ves') ves += Number(s.totalVES) || 0;
        else if (m === 'cash-eur') eur += Number(s.totalEUR) || 0;
        else if (m === 'card-ves' || m === 'card') card += Number(s.totalVES) || 0;
        else if (m === 'pago-movil') pm += Number(s.totalVES) || 0;
        else if (m === 'transfer') transfer += Number(s.totalVES) || 0;
    });
    const er = settings.exchangeRate || 50;
    const totalUSD = usd + (ves / er) + (card / er) + (pm / er) + (transfer / er) + eur;
    const totalVES = ves + card + pm + transfer + (eur * (settings.euroRate || er));
    return { usd, ves, eur, card, pm, transfer, totalUSD, totalVES, txCount };
}

window.closeCierreModal = () => {
    const modal = document.getElementById('cierre-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
};

window.calcularCuadre = () => {
    const totals = window._lastCierreTotals || _calcCierreTotals();
    const countUSD = _calcDenomUSD();
    const countVES = _calcDenomVES();
    const countPM = parseFloat(document.getElementById('cierre-count-pm')?.value) || 0;
    const countCard = parseFloat(document.getElementById('cierre-count-card')?.value) || 0;
    const container = document.getElementById('cierre-diff-container');
    if (!container) return;

    const cashUSD = totals.usd;
    const cashVES = totals.ves;
    const diffUSD = countUSD - cashUSD;
    const diffVES = countVES - cashVES;
    const diffPM = countPM - (totals.pm || 0);
    const diffCard = countCard - (totals.card || 0);

    if (countUSD > 0 || countVES > 0 || countPM > 0 || countCard > 0) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
        return;
    }

    const setDiff = (elId, containerId, iconId, diff, fmt) => {
        const el = document.getElementById(elId);
        const c = document.getElementById(containerId);
        const ic = document.getElementById(iconId);
        if (el) el.textContent = (diff >= 0 ? '+' : '') + fmt(diff);
        if (c) {
            c.className = 'flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-all ' +
                (Math.abs(diff) < 0.01 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                 diff > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-700');
        }
        if (ic) {
            ic.className = 'fas text-base ' +
                (Math.abs(diff) < 0.01 ? 'fa-circle-check text-emerald-500' :
                 diff > 0 ? 'fa-circle-exclamation text-amber-500' : 'fa-circle-xmark text-red-500');
        }
    };

    setDiff('cierre-diff-usd', 'cierre-diff-usd-container', 'cierre-diff-usd-icon', diffUSD, formatUSD);
    setDiff('cierre-diff-ves', 'cierre-diff-ves-container', 'cierre-diff-ves-icon', diffVES, formatVES);
    setDiff('cierre-diff-pm', 'cierre-diff-pm-container', 'cierre-diff-pm-icon', diffPM, formatVES);
    setDiff('cierre-diff-card', 'cierre-diff-card-container', 'cierre-diff-card-icon', diffCard, formatVES);
};

window.verHistorialArqueos = async () => {
    const modal = document.getElementById('historial-arqueos-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const tbody = document.getElementById('arqueos-history-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-sm text-slate-400 font-medium italic"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando...</td></tr>';

    try {
        const sid = _getStoreId();
        let cashups = [];
        if (window.electronAPI?.db?.getCashups) {
            cashups = await window.electronAPI.db.getCashups(sid);
        }
        if (!cashups || cashups.length === 0) {
            if (dailyHistory.length > 0) {
                tbody.innerHTML = dailyHistory.slice().reverse().map(d => {
                    const dateStr = d.date ? new Date(d.date).toLocaleDateString() : '---';
                    return `<tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 pr-3 text-xs font-semibold text-slate-600">${dateStr}</td>
                        <td class="py-3 px-3 text-xs font-black text-emerald-600 text-right">${formatUSD(d.salesUSD || 0)}</td>
                        <td class="py-3 px-3 text-xs font-black text-slate-700 text-right">---</td>
                        <td class="py-3 px-3 text-xs font-black text-indigo-600 text-right">---</td>
                        <td class="py-3 pl-3 text-xs font-black text-slate-400 text-right">---</td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-sm text-slate-400 font-medium italic">Sin arqueos registrados</td></tr>';
            }
            return;
        }
        tbody.innerHTML = cashups.slice(0, 30).map(c => {
            const dateStr = c.date ? new Date(c.date).toLocaleDateString() : '---';
            const diffUSD = (Number(c.counted_usd) || 0) - (Number(c.sales_usd) || 0);
            const diffClass = Math.abs(diffUSD) < 0.01 ? 'text-emerald-600' : diffUSD > 0 ? 'text-amber-600' : 'text-red-500';
            return `<tr class="hover:bg-slate-50 transition-colors">
                <td class="py-3 pr-3 text-xs font-semibold text-slate-600">${dateStr}</td>
                <td class="py-3 px-3 text-xs font-black text-emerald-600 text-right">${formatUSD(c.sales_usd || 0)}</td>
                <td class="py-3 px-3 text-xs font-black text-slate-700 text-right">${formatVES(c.sales_ves || 0)}</td>
                <td class="py-3 px-3 text-xs font-black text-indigo-600 text-right">${formatVES(c.sales_card || 0)}</td>
                <td class="py-3 pl-3 text-xs font-black text-right ${diffClass}">${diffUSD >= 0 ? '+' : ''}${formatUSD(diffUSD)}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('[CIERRE-Z] Error cargando historial:', e);
        tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-sm text-red-400 font-medium italic">Error al cargar historial</td></tr>';
    }
};

window.openCierreModal = async () => {
    const modal = document.getElementById('cierre-modal');
    if (!modal) return;

    // Reset denomination inputs
    document.querySelectorAll('[id^="denom-"]').forEach(el => { if (el.type === 'number') el.value = '0'; });
    document.querySelectorAll('[id$="-total-counted"]').forEach(el => { el.textContent = el.id.includes('ves') ? 'Bs 0' : '$0.00'; });
    const diffContainer = document.getElementById('cierre-diff-container');
    if (diffContainer) diffContainer.classList.add('hidden');

    const dateDisplay = document.getElementById('cierre-date-display');
    if (dateDisplay) dateDisplay.textContent = new Date().toLocaleString();

    const totals = _calcCierreTotals();
    window._lastCierreTotals = totals;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('cierre-usd-amount', formatUSD(totals.usd));
    set('cierre-ves-amount', formatVES(totals.ves));
    set('cierre-eur-amount', formatEUR(totals.eur));
    set('cierre-card-amount', formatVES(totals.card));
    set('cierre-pm-amount', formatVES(totals.pm));
    set('cierre-transfer-amount', formatVES(totals.transfer));
    set('cierre-total-general', formatUSD(totals.totalUSD));
    set('cierre-total-general-ves', formatVES(totals.totalVES));
    set('cierre-tx-count', `${totals.txCount} transacciones`);

    try {
        const sid = _getStoreId();
        const today = new Date().toISOString().split('T')[0];
        if (window.electronAPI?.db?.getCashupByDate) {
            const lastCashup = await window.electronAPI.db.getCashupByDate(sid, today);
            if (lastCashup) {
                set('cierre-opening-usd', formatUSD(lastCashup.opening_usd || 0));
                set('cierre-opening-ves', formatVES(lastCashup.opening_ves || 0));
            } else {
                set('cierre-opening-usd', '$0.00');
                set('cierre-opening-ves', 'Bs 0');
            }
        }
    } catch (e) {
        console.warn('[CIERRE-Z] No se pudo cargar apertura:', e);
        set('cierre-opening-usd', '$0.00');
        set('cierre-opening-ves', 'Bs 0');
    }

    try {
        const saved = JSON.parse(localStorage.getItem('freshpos_last_cierre_state'));
        if (saved && saved.date === new Date().toISOString().split('T')[0]) {
            ['cierre-count-pm', 'cierre-count-card'].forEach(id => {
                const el = document.getElementById(id);
                if (el && saved[id]) el.value = saved[id];
            });
        }
    } catch(e) {}

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        const content = document.getElementById('cierre-modal-content');
        if (content) {
            content.classList.remove('scale-95');
            content.classList.add('scale-100');
        }
    }, 10);
};

window.printCierreZ = () => {
    const totals = window._lastCierreTotals || _calcCierreTotals();
    const countUSD = _calcDenomUSD();
    const countVES = _calcDenomVES();
    const countPM = parseFloat(document.getElementById('cierre-count-pm')?.value) || 0;
    const countCard = parseFloat(document.getElementById('cierre-count-card')?.value) || 0;
    const dateStr = new Date().toLocaleString();
    const lines = `
╔══════════════════════════════════╗
║        CORTE Z — CIERRE          ║
║  ${dateStr.padEnd(31)}║
╠══════════════════════════════════╣
║ VENTAS DEL DÍA                   ║
╠══════════════════════════════════╣
║ Efectivo USD: ${formatUSD(totals.usd).padStart(19)} ║
║ Efectivo VES: ${formatVES(totals.ves).padStart(19)} ║
║ Efectivo EUR: ${formatEUR(totals.eur).padStart(19)} ║
║ Punto Venta:  ${formatVES(totals.card).padStart(19)} ║
║ Pago Móvil:   ${formatVES(totals.pm).padStart(19)} ║
║ Transferencia:${formatVES(totals.transfer).padStart(19)} ║
╠══════════════════════════════════╣
║ TOTAL USD:    ${formatUSD(totals.totalUSD).padStart(19)} ║
║ TOTAL VES:    ${formatVES(totals.totalVES).padStart(19)} ║
║ Transacciones: ${String(totals.txCount).padStart(18)} ║
╠══════════════════════════════════╣
║ CUADRE DE CAJA                   ║
╠══════════════════════════════════╣
║ Efectivo USD: ${formatUSD(countUSD).padStart(19)} ║
║ Efectivo VES: ${formatVES(countVES).padStart(19)} ║
║ Pago Móvil:   ${formatVES(countPM).padStart(19)} ║
║ Punto:        ${formatVES(countCard).padStart(19)} ║
╠══════════════════════════════════╣
║ DIFERENCIAS                      ║
╠══════════════════════════════════╣
║ Dif USD: ${(countUSD - totals.usd >= 0 ? '+' : '') + formatUSD(countUSD - totals.usd).padStart(21)} ║
║ Dif VES: ${(countVES - totals.ves >= 0 ? '+' : '') + formatVES(countVES - totals.ves).padStart(21)} ║
║ Dif PM:  ${(countPM - (totals.pm || 0) >= 0 ? '+' : '') + formatVES(countPM - (totals.pm || 0)).padStart(21)} ║
║ Dif Card:${(countCard - (totals.card || 0) >= 0 ? '+' : '') + formatVES(countCard - (totals.card || 0)).padStart(21)} ║
╚══════════════════════════════════╝
    `;
    const printWin = window.open('', '_blank');
    printWin.document.write(`<pre style="font-family:monospace;font-size:13px;line-height:1.4">${lines}</pre>`);
    printWin.document.close();
    printWin.print();
};

window.confirmFinalCierre = () => {
    if (sales.length === 0) return Swal.fire('Caja Vacía', 'No hay ventas para cerrar hoy.', 'info');

    const totals = window._lastCierreTotals || _calcCierreTotals();
    const countUSD = _calcDenomUSD();
    const countVES = _calcDenomVES();

    Swal.fire({
        title: '¿Confirmar Cierre de Caja?',
        html: `
            <div class="text-left text-sm space-y-1.5">
                <p class="font-semibold text-slate-700">📊 Resumen:</p>
                <p>💵 USD: ${formatUSD(totals.usd)}</p>
                <p>🇻🇪 VES: ${formatVES(totals.ves)}</p>
                <p>💳 Punto: ${formatVES(totals.card)}</p>
                <p>📱 P.Móvil: ${formatVES(totals.pm)}</p>
                <p>🏦 Transf.: ${formatVES(totals.transfer)}</p>
                ${countUSD > 0 || countVES > 0 ? `<hr class="my-2"><p class="text-xs font-bold">💰 Conteo: ${countUSD > 0 ? formatUSD(countUSD) : ''} ${countVES > 0 ? formatVES(countVES) : ''}</p>` : ''}
                <hr class="my-2">
                <p class="font-black text-lg">💰 Total: ${formatUSD(totals.totalUSD)}</p>
                <p class="text-xs text-amber-600 mt-2">⚠️ Se guardará en DB y se enviará reporte al jefe.</p>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'Sí, Finalizar y Enviar'
    }).then((result) => {
        if (result.isConfirmed) sendCierreToBoss();
    });
};

function _getCierreMsg() {
    const totals = window._lastCierreTotals || _calcCierreTotals();
    const countUSD = _calcDenomUSD();
    const countVES = _calcDenomVES();
    const diffUSD = countUSD - totals.usd;
    const diffVES = countVES - totals.ves;

    let msg = `🧾 *CIERRE DE CAJA - ${settings.appName}*\n`;
    msg += `📅 Fecha: ${new Date().toLocaleDateString()}\n`;
    msg += `👤 Cajero: ${currentRole.toUpperCase()}\n`;
    msg += `🆔 Sucursal: ${settings.storeId || 'N/A'}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💵 *Efectivo USD:* ${formatUSD(totals.usd)}\n`;
    msg += `🇻🇪 *Efectivo BS:* ${formatVES(totals.ves)}\n`;
    msg += `💶 *Efectivo EUR:* ${formatEUR(totals.eur)}\n`;
    msg += `💳 *Punto Venta:* ${formatVES(totals.card)}\n`;
    msg += `📱 *Pago Móvil:* ${formatVES(totals.pm)}\n`;
    msg += `🏦 *Transferencia:* ${formatVES(totals.transfer)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *TOTAL USD:* ${formatUSD(totals.totalUSD)}\n`;
    msg += `🇻🇪 *TOTAL VES:* ${formatVES(totals.totalVES)}\n`;
    msg += `🔄 *Transacciones:* ${totals.txCount}\n`;
    const countPM = parseFloat(document.getElementById('cierre-count-pm')?.value) || 0;
    const countCard = parseFloat(document.getElementById('cierre-count-card')?.value) || 0;
    const diffPM = countPM - (totals.pm || 0);
    const diffCard = countCard - (totals.card || 0);

    if (countUSD > 0 || countVES > 0 || countPM > 0 || countCard > 0) {
        msg += `━━━━  CONTEO  ━━━━━━\n`;
        if (countUSD > 0) {
            msg += `💵 USD contado: ${formatUSD(countUSD)}\n`;
            msg += `📊 Dif USD: ${diffUSD >= 0 ? '+' : ''}${formatUSD(diffUSD)}\n`;
        }
        if (countVES > 0) {
            msg += `🇻🇪 VES contado: ${formatVES(countVES)}\n`;
            msg += `📊 Dif VES: ${diffVES >= 0 ? '+' : ''}${formatVES(diffVES)}\n`;
        }
        if (countPM > 0) {
            msg += `📱 P.Móvil contado: ${formatVES(countPM)}\n`;
            msg += `📊 Dif P.Móvil: ${diffPM >= 0 ? '+' : ''}${formatVES(diffPM)}\n`;
        }
        if (countCard > 0) {
            msg += `💳 Punto contado: ${formatVES(countCard)}\n`;
            msg += `📊 Dif Punto: ${diffCard >= 0 ? '+' : ''}${formatVES(diffCard)}\n`;
        }
        msg += `━━  DESGLOSE  ────\n`;
        const u100 = _getDenomVal('denom-usd-100');
        const u50 = _getDenomVal('denom-usd-50');
        const u20 = _getDenomVal('denom-usd-20');
        const u10 = _getDenomVal('denom-usd-10');
        const u5 = _getDenomVal('denom-usd-5');
        const u1 = _getDenomVal('denom-usd-1');
        const v100 = _getDenomVal('denom-ves-100');
        const v50 = _getDenomVal('denom-ves-50');
        const v20 = _getDenomVal('denom-ves-20');
        const v10 = _getDenomVal('denom-ves-10');
        if (u100 > 0) msg += `💵 $100 x${u100}\n`;
        if (u50 > 0) msg += `💵 $50 x${u50}\n`;
        if (u20 > 0) msg += `💵 $20 x${u20}\n`;
        if (u10 > 0) msg += `💵 $10 x${u10}\n`;
        if (u5 > 0) msg += `💵 $5 x${u5}\n`;
        if (u1 > 0) msg += `💵 $1 x${u1}\n`;
        if (v100 > 0) msg += `🇻🇪 Bs100 x${v100}\n`;
        if (v50 > 0) msg += `🇻🇪 Bs50 x${v50}\n`;
        if (v20 > 0) msg += `🇻🇪 Bs20 x${v20}\n`;
        if (v10 > 0) msg += `🇻🇪 Bs10 x${v10}\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `✅ *Caja Cerrada con Éxito*`;
    return msg;
}

async function _saveCashupToDB() {
    try {
        const totals = window._lastCierreTotals || _calcCierreTotals();
        const countUSD = _calcDenomUSD();
        const countVES = _calcDenomVES();
        const sid = _getStoreId();
        if (!sid) return;

        const openingUSD = parseFloat(document.getElementById('cierre-opening-usd')?.textContent?.replace(/[$,]/g, '') || 0);
        const openingVES = parseFloat(document.getElementById('cierre-opening-ves')?.textContent?.replace(/[Bs,\s]/g, '') || 0);

        const countPM = parseFloat(document.getElementById('cierre-count-pm')?.value) || 0;
        const countCard = parseFloat(document.getElementById('cierre-count-card')?.value) || 0;

        const cashup = {
            id: 'cashup_' + Date.now(),
            date: new Date().toISOString().split('T')[0],
            opening_usd: openingUSD,
            opening_ves: openingVES,
            cash_usd: totals.usd,
            cash_ves: totals.ves,
            sales_usd: totals.usd,
            sales_ves: totals.ves,
            sales_pago_movil: totals.pm,
            sales_transfer: totals.transfer,
            sales_card: totals.card,
            sales_eur: totals.eur,
            expenses_total: 0,
            transaction_count: totals.txCount,
            counted_usd: countUSD,
            counted_ves: countVES,
            counted_pm: countPM,
            counted_card: countCard,
            diff_usd: countUSD - totals.usd,
            diff_ves: countVES - totals.ves,
            diff_pm: countPM - (totals.pm || 0),
            diff_card: countCard - (totals.card || 0),
            cashier_name: currentRole || 'unknown',
            status: 'closed',
            notes: ''
        };

        if (window.electronAPI?.db?.saveCashup) {
            await window.electronAPI.db.saveCashup(sid, cashup);
        }
    } catch (e) {
        console.error('[CIERRE-Z] Error DB:', e);
    }
}

function sendCierreToBoss() {
    const totals = window._lastCierreTotals || _calcCierreTotals();
    const rawMsg = _getCierreMsg();

    const bossPhoneInput = (settings.bossPhone || localStorage.getItem('boss_phone') || "");
    const bossPhone = normalizeVEPhone(bossPhoneInput);
    const apiKey = settings.callmebotKey || "";

    console.log(`[CIERRE-Z] Teléfono normalizado: ${bossPhone} (original: ${bossPhoneInput})`);

    if (!bossPhone) {
        Swal.fire({
            title: 'Configuración Requerida',
            html: 'Para enviar el reporte, primero debes escribir el <b>Teléfono del Jefe</b> en la sección de <b>Configuración</b> y pulsar <b>Guardar</b>.',
            icon: 'warning',
            confirmButtonColor: '#3b82f6'
        });
        return;
    }

    const doFinalize = () => {
        _saveCashupToDB().then(() => finalizeAndClear());
    };

    if (window.isWhatsappAutomatedReady && window.electronAPI?.sendWhatsAppBackground) {
        Swal.fire({ title: 'Enviando Reporte...', text: 'Usando motor interno de WhatsApp...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        window.electronAPI.sendWhatsAppBackground(bossPhone, rawMsg)
            .then(res => {
                if (res?.success) { doFinalize(); }
                else {
                    console.error('[CIERRE-Z] Fallo motor interno:', res?.error);
                    Swal.fire({
                        title: 'Error de Conexión',
                        text: `El motor de WhatsApp falló: ${res?.error || 'Desconocido'}. ¿Abrir manual?`,
                        icon: 'error', showCancelButton: true, confirmButtonText: 'Abrir WhatsApp'
                    }).then((r) => {
                        if (r.isConfirmed) window.open(`https://wa.me/${bossPhone}?text=${rawMsg.replace(/\n/g, '%0A')}`, '_blank');
                        doFinalize();
                    });
                }
            })
            .catch((err) => {
                console.error('[CIERRE-Z] Excepción del motor:', err);
                Swal.fire({
                    title: 'Error Crítico',
                    text: `Error de comunicación: ${err.message}. ¿Abrir manual?`,
                    icon: 'error', showCancelButton: true, confirmButtonText: 'Abrir WhatsApp'
                }).then((r) => {
                    if (r.isConfirmed) window.open(`https://wa.me/${bossPhone}?text=${rawMsg.replace(/\n/g, '%0A')}`, '_blank');
                    doFinalize();
                });
            });
    } else {
        const urlMsg = rawMsg.replace(/\n/g, '%0A');
        if (apiKey) {
            fetch(`https://api.callmebot.com/whatsapp.php?phone=${bossPhone}&text=${urlMsg}&apikey=${apiKey}`)
                .then(() => doFinalize())
                .catch(() => doFinalize());
        } else {
            window.open(`https://wa.me/${bossPhone}?text=${urlMsg}`, '_blank');
            doFinalize();
        }
    }
}

function finalizeAndClear() {
    const today = new Date().toISOString();
    const totals = window._lastCierreTotals || _calcCierreTotals();
    const daySalesUSD = sales.reduce((acc, s) => acc + (Number(s.totalUSD) || 0), 0);
    const dayProfitUSD = sales.reduce((acc, s) => acc + ((Number(s.totalUSD) || 0) - (Number(s.totalCostUSD) || 0)), 0);
    const dayExpensesUSD = typeof expenses !== 'undefined' && Array.isArray(expenses) ? expenses.reduce((acc, e) => acc + (Number(e.amountUSD) || 0), 0) : 0;

    dailyHistory.push({
        date: today,
        salesUSD: daySalesUSD,
        profitUSD: dayProfitUSD,
        expensesUSD: dayExpensesUSD,
        totals: totals
    });

    if (dailyHistory.length > 90) dailyHistory.shift();
    saveHistory();

    if (window.db) {
        window.db.getCredits().then(pending => {
            if (pending && pending.length > 0) {
                pending.forEach(p => {
                    if (p.status === 'pending') {
                        window.db.saveCredit(p).catch(() => {});
                    }
                });
            }
        }).catch(() => {});
    }
    sales = sales.filter(s => s.status === 'pending');
    if (sales.length === 0) sales = [];
    saveSales();
    if (window.db && window.db.saveSale) {
        sales.forEach(s => {
            window.db.saveSale(s).catch(e => console.error('[DB] Error saving pending sale:', e));
        });
    }

    if (typeof expenses !== 'undefined') {
        expenses = [];
        saveExpenses();
    }

    renderReports();
    if (typeof renderExpenses === 'function') renderExpenses();

    window._lastCierreTotals = null;

    const modal = document.getElementById('cierre-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    Swal.fire('¡Cierre Exitoso!', 'El reporte ha sido enviado, guardado en DB y la caja está limpia.', 'success');
}

// --- MOVIMIENTOS / MERMA ---
window.openMovementModal = () => {
    const modal = document.getElementById('movement-modal');
    if (!modal) return;
    const sel = document.getElementById('movement-product-select');
    if (sel) {
        sel.innerHTML = '<option value="">Seleccionar producto...</option>';
        (window.products || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name}${p.sku ? ' (' + p.sku + ')' : ''}`;
            sel.appendChild(opt);
        });
    }
    const mf = document.getElementById('movement-form');
    if (mf) mf.reset();
    const mpi = document.getElementById('movement-product-id');
    if (mpi) mpi.value = '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        const content = modal.querySelector('.bg-white');
        if (content) content.classList.remove('scale-95');
    }, 10);
};

window.closeMovementModal = () => {
    const modal = document.getElementById('movement-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    const content = modal.querySelector('.bg-white');
    if (content) content.classList.add('scale-95');
};

window.saveMovement = async (e) => {
    e.preventDefault();
    const sid = _getStoreId();
    if (!sid) return Swal.fire('Error', 'No hay sucursal activa.', 'error');

    const productSel = document.getElementById('movement-product-select');
    const productId = productSel?.value;
    const productName = productSel?.selectedOptions?.[0]?.textContent || '';
    const type = document.getElementById('movement-type')?.value;
    const qty = parseFloat(document.getElementById('movement-qty')?.value || 0);
    const reason = document.getElementById('movement-reason')?.value || '';

    if (!productId) return Swal.fire('Validación', 'Selecciona un producto.', 'warning');
    if (!qty || qty <= 0) return Swal.fire('Validación', 'Ingresa una cantidad válida.', 'warning');

    const movement = {
        id: 'mov_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        product_id: productId,
        product_name: productName,
        type,
        quantity: type === 'entry' ? qty : -qty,
        reason,
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        cashier_name: window.currentRole || 'unknown'
    };

    try {
        if (window.electronAPI?.db?.saveMovement) {
            await window.electronAPI.db.saveMovement(sid, movement);
        }
        Swal.fire({ icon: 'success', title: 'Movimiento Registrado', timer: 1500, showConfirmButton: false });
        closeMovementModal();
        renderMovements();
    } catch (e) {
        console.error('[MOVEMENTS] Error guardando:', e);
        Swal.fire({ icon: 'error', title: 'Error', text: e.message });
    }
};

window.renderMovements = async () => {
    const tbody = document.getElementById('movements-table-body');
    if (!tbody) return;

    const sid = _getStoreId();
    const typeFilter = document.getElementById('movement-type-filter')?.value || 'all';
    const dateFrom = document.getElementById('movement-date-from')?.value || '';
    const dateTo = document.getElementById('movement-date-to')?.value || '';

    tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-sm text-slate-400 italic">Cargando...</td></tr>';

    try {
        let movements = [];
        if (window.electronAPI?.db?.getMovements) {
            movements = await window.electronAPI.db.getMovements(sid, dateFrom, dateTo, typeFilter) || [];
        }

        if (!movements.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-sm text-slate-400 italic">No hay movimientos registrados</td></tr>';
            return;
        }

        const typeBadge = (t) => {
            const map = {
                entry: '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">ENTRADA</span>',
                exit: '<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">SALIDA</span>',
                waste: '<span class="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold">MERMA</span>',
                expiry: '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">VENCIMIENTO</span>',
                adjustment: '<span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">AJUSTE</span>'
            };
            return map[t] || t;
        };

        tbody.innerHTML = movements.map(m => `
            <tr class="hover:bg-slate-50/50 transition-colors">
                <td class="py-3 px-6 text-sm text-slate-600 font-medium">${m.date || ''}</td>
                <td class="py-3 px-6 text-sm text-slate-800 font-semibold">${m.product_name || ''}</td>
                <td class="py-3 px-6">${typeBadge(m.type)}</td>
                <td class="py-3 px-6 text-sm text-right font-bold ${m.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
                <td class="py-3 px-6 text-sm text-slate-500 max-w-[200px] truncate" title="${(m.reason || '').replace(/"/g, '&quot;')}">${m.reason || '-'}</td>
                <td class="py-3 px-6 text-sm text-slate-500">${m.cashier_name || '-'}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('[MOVEMENTS] Error cargando:', e);
        tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-sm text-red-400 italic">Error al cargar movimientos</td></tr>';
    }
};

/**
 * RENDERIZAR REGISTRO DE AUDITORÍA
 */
function renderAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    const logsSorted = [...auditLogs].reverse(); // Los más recientes primero
    
    const countEl = document.getElementById('audit-log-count');
    if (countEl) countEl.textContent = auditLogs.length;

    if (!tbody) return;

    if (logsSorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-20 text-center text-slate-400 font-medium italic">No hay registros de actividad aún</td></tr>`;
        return;
    }

    tbody.innerHTML = logsSorted.map(log => `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="py-4 px-6 border-b border-slate-50">
                <div class="text-[11px] font-bold text-slate-800">${new Date(log.timestamp).toLocaleDateString()}</div>
                <div class="text-[10px] text-slate-400 font-mono">${new Date(log.timestamp).toLocaleTimeString()}</div>
            </td>
            <td class="py-4 px-6 border-b border-slate-50">
                <span class="px-2 py-0.5 ${log.role === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'} rounded-lg text-[9px] font-black uppercase">
                    ${log.role}
                </span>
            </td>
            <td class="py-4 px-6 border-b border-slate-50 text-center">
                <span class="text-[10px] font-black underline decoration-2 underline-offset-4 uppercase tracking-tighter ${getAuditTypeColor(log.type)}">
                    ${log.type}
                </span>
            </td>
            <td class="py-4 px-6 border-b border-slate-50">
                <div class="text-xs font-bold text-slate-600">${log.description}</div>
                ${log.details ? `
                    <div class="group relative mt-1">
                        <div class="text-[8px] text-slate-400 font-mono truncate max-w-[200px] cursor-help" title='${JSON.stringify(log.details)}'>Detalles: ${JSON.stringify(log.details).substring(0, 50)}...</div>
                    </div>` : ''}
            </td>
        </tr>
    `).join('');
}

function getAuditTypeColor(type) {
    if (type.includes('DELETE')) return 'text-rose-600';
    if (type.includes('SALE')) return 'text-emerald-600';
    if (type.includes('PRICE') || type.includes('UPDATE')) return 'text-amber-600';
    return 'text-indigo-600';
}

// ==========================================
// CLOUD SYNC — Multi-Sucursal Integration
// ==========================================

// Push sale to cloud after each transaction
function cloudSyncPushSale(saleRecord) {
    if (window.cloudSync) {
        if (window.electronAPI && window.electronAPI.cloudSyncLog) {
            window.electronAPI.cloudSyncLog(`Iniciando envío de venta ticket #${saleRecord.ticket}`);
        }
        window.cloudSync.pushSale(saleRecord)
            .then(res => {
                console.log('[CloudSync] Sale push success:', res);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Venta Sincronizada',
                        text: `Ticket #${saleRecord.ticket} enviado a la nube con éxito.`,
                        icon: 'success',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 3000
                    });
                }
            })
            .catch(e => {
                console.error('[CloudSync] Sale push error:', e);
                if (window.electronAPI && window.electronAPI.cloudSyncLog) {
                    window.electronAPI.cloudSyncLog(`ERROR enviando venta #${saleRecord.ticket}: ${e.message}`);
                }
            });
    } else {
        console.warn('[CloudSync] window.cloudSync no disponible');
    }
}

// Push stock alerts to cloud after inventory changes
function cloudSyncPushAlerts() {
    if (window.cloudSync) {
        window.cloudSync.pushAlerts(products).catch(e => console.error('[CloudSync] Alerts push error:', e));
    }
}

// Push current cart live state to cloud (debounced)
const cloudSyncPushLiveState = debounce(() => {
    if (window.cloudSync) {
        const checkoutBtn = document.getElementById('show-checkout-btn');
        if (!checkoutBtn) return;
        const totalUSD = parseFloat(checkoutBtn.dataset.totalUsd) || 0;
        const totalVES = parseFloat(checkoutBtn.dataset.totalVes) || 0;
        window.cloudSync.pushLiveState(cart, { usd: totalUSD, ves: totalVES }, 'POS').catch(() => {});
    }
}, 3000);

// Cloud Config UI (called from settings panel)
function openCloudConfig() {
    const currentSettings = JSON.parse(localStorage.getItem('freshpos_settings') || '{}');
    
    Swal.fire({
        title: '<i class="fas fa-cloud"></i> Configuración Multi-Sucursal',
        html: `
            <div style="text-align:left; font-size:13px;">
                <p style="color:#64748b; margin-bottom:16px; font-size:11px;">
                    Conecta este POS a la nube para que el jefe pueda supervisarlo desde su teléfono.
                </p>
                <div style="margin-bottom:12px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Supabase URL</label>
                    <input id="swal-sb-url" class="swal2-input" placeholder="https://xxxxx.supabase.co" value="${currentSettings.supabaseUrl || ''}" style="font-size:12px;">
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Supabase Anon Key</label>
                    <input id="swal-sb-key" class="swal2-input" placeholder="eyJhbGciOiJIUzI1NiIs..." value="${currentSettings.supabaseKey || ''}" style="font-size:12px;">
                </div>
                <hr style="border-color:#1e293b; margin:16px 0">
                <div style="margin-bottom:12px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Nombre de la Marca</label>
                    <input id="swal-brand" class="swal2-input" placeholder="Ej: Zona Fresh" value="${currentSettings.brandName || settings.companyName || 'Caja Fresh'}" style="font-size:12px;">
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Nombre de esta Sucursal</label>
                    <input id="swal-store" class="swal2-input" placeholder="Ej: Sucursal Centro" value="${currentSettings.storeName || 'Sucursal Principal'}" style="font-size:12px;">
                </div>
                <hr style="border-color:#1e293b; margin:16px 0">
                <div style="margin-bottom:8px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#3b82f6; margin-bottom:4px;">Túnel: Dominio Propio (Cloudflare)</label>
                    <p style="font-size:9px; color:#64748b; margin-bottom:8px;">Opcional: Si tienes un túnel configurado en Cloudflare.</p>
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Dominio (ej: puntopila.emprende.ve)</label>
                    <input id="swal-cf-domain" class="swal2-input" placeholder="tudominio.com" value="${currentSettings.cloudflareDomain || 'puntopila.emprende.ve'}" style="font-size:12px;">
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:4px;">Cloudflare Token</label>
                    <input id="swal-cf-token" class="swal2-input" type="password" placeholder="Tu Cloudflare Token" value="${currentSettings.cloudflareToken || ''}" style="font-size:12px;">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-plug"></i> Conectar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#3b82f6',
        preConfirm: () => {
            return {
                supabaseUrl: document.getElementById('swal-sb-url').value.trim().replace(/\/$/, ''),
                supabaseKey: document.getElementById('swal-sb-key').value.trim(),
                brandName: document.getElementById('swal-brand').value.trim(),
                storeName: document.getElementById('swal-store').value.trim(),
                cloudflareDomain: document.getElementById('swal-cf-domain').value.trim(),
                cloudflareToken: document.getElementById('swal-cf-token').value.trim(),
                storeId: currentSettings.storeId || 'store_' + Date.now().toString(36)
            };
        }
    }).then(result => {
        if (result.isConfirmed && result.value) {
            const cfg = result.value;
            
            // Save to local settings
            settings.supabaseUrl = cfg.supabaseUrl;
            settings.supabaseKey = cfg.supabaseKey;
            settings.storeId = cfg.storeId;
            settings.storeName = cfg.storeName;
            settings.brandName = cfg.brandName;
            settings.cloudflareDomain = cfg.cloudflareDomain;
            settings.cloudflareToken = cfg.cloudflareToken;
            localStorage.setItem('freshpos_settings', JSON.stringify(settings));
            
            // Send to main process
            if (window.cloudSync) {
                window.cloudSync.configure(cfg).then(res => {
                    if (res.success) {
                        Swal.fire({
                            icon: 'success',
                            title: '¡Conectado a la Nube!',
                            text: `Sucursal "${cfg.storeName}" registrada. El jefe podrá ver los datos desde /jefe`,
                            timer: 3000,
                            showConfirmButton: false
                        });
                    } else {
                        Swal.fire('Error', 'No se pudo conectar: ' + (res.error || 'Error desconocido'), 'error');
                    }
                });
            }
        }
    });
}

// Listen for cloud sync status updates
if (window.cloudSync) {
    window.cloudSync.onStatusChange((status) => {
        const indicator = document.getElementById('cloud-sync-indicator');
        if (indicator) {
            if (status.synced) {
                indicator.innerHTML = '<i class="fas fa-cloud text-emerald-500 hover:scale-110 transition-all"></i>';
                indicator.title = `Sincronizado: ${status.storeName || 'Cloud'}. Clic para forzar sincronización.`;
            } else if (status.enabled) {
                indicator.innerHTML = '<i class="fas fa-cloud text-amber-500 animate-pulse hover:scale-110 transition-all"></i>';
                indicator.title = `Sincronizando / Error: ${status.error || 'Pendiente'}. Clic para forzar sincronización.`;
            }
        }
    });
    
    // Initial status check
    window.cloudSync.getStatus().then(status => {
        if (status.enabled) {
            console.log('[CloudSync] Conectado como:', status.storeName);
        }
    });

    window.forceManualSync = async function() {
        try {
            Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Sincronizando...', showConfirmButton: false });
            await window.api.cloudSyncPushCatalog(products);
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Sincronización manual enviada', timer: 2000, showConfirmButton: false });
        } catch (e) {
            Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Error al sincronizar', text: e.message, timer: 3000, showConfirmButton: false });
        }
    };

    window.cloudSync.onProductUpdatedRemoteFull((prod) => {
        const idx = products.findIndex(p => p.id === prod.id);
        if (idx !== -1) {
            products[idx] = { ...products[idx], ...prod };
        } else {
            products.push(prod);
        }
        
        // Efectos secundarios necesarios
        saveProducts();
        if (typeof renderInventory === 'function') renderInventory();
        if (typeof renderProducts === 'function') renderProducts();
        syncDashboardData();
        
        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Producto actualizado por el Jefe', text: prod.name, timer: 3000, showConfirmButton: false });
    });

    window.cloudSync.onProductUpdatedRemote((data) => {
        const prod = products.find(p => p.id === data.id);
        if (prod) {
            prod.priceUSD = data.priceUSD;
            
            saveProducts();
            if (typeof renderInventory === 'function') renderInventory();
            if (typeof renderProducts === 'function') renderProducts();
            syncDashboardData();
            
            Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Precio actualizado remotamente', text: data.name, timer: 3000, showConfirmButton: false });
        }
    });

    window.cloudSync.onExchangeRateUpdatedRemote((rate) => {
        if (typeof updateExchangeRate === 'function') updateExchangeRate(rate);
        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Tasa BCV actualizada por el Jefe', text: `Nueva tasa: Bs ${rate}`, timer: 3000, showConfirmButton: false });
    });

    // Listener: catálogo importado desde la nube (primera sincronización)
    if (window.electronAPI && window.electronAPI.on) {
        window.electronAPI.on('catalog-pulled-from-cloud', async (data) => {
            console.log(`[SYNC] 📦 Catálogo importado desde la nube: ${data.count} productos. Recargando...`);
            await loadProductsFromDB();
            if (typeof renderProducts === 'function') renderProducts();
            if (typeof syncDashboardData === 'function') syncDashboardData();
            Swal.fire({ 
                toast: true, position: 'top-end', icon: 'success', 
                title: `✅ ${data.count} productos sincronizados desde la nube`, 
                timer: 4000, showConfirmButton: false 
            });
        });
    }
}

// MIGRACIÓN Y BOOTSTRAP INICIAL
setTimeout(() => {
    migrateLegacyToTenant();
}, 2000);

// ==========================================
// CLOUDFLARE TUNNEL — Configuración desde Settings
// ==========================================
window.saveCloudflareTunnel = function() {
    const subdomainInput = document.getElementById('settings-cf-domain');
    const tokenInput     = document.getElementById('settings-cf-token');
    const statusDiv      = document.getElementById('cf-tunnel-status');
    if (!subdomainInput || !tokenInput) return;

    let subdomainVal = subdomainInput.value.trim().toLowerCase();
    let tokenVal     = tokenInput.value.trim();

    // 1. Limpieza inteligente del campo Subdominio
    if (subdomainVal) {
        if (subdomainVal.includes('://')) {
            try {
                const url = new URL(subdomainVal);
                subdomainVal = url.hostname;
            } catch(e) {
                subdomainVal = subdomainVal.replace(/^https?:\/\//, '');
            }
        }
        if (subdomainVal.includes('.')) {
            const parts = subdomainVal.split('.');
            if ((parts[0] === 'www' || parts[0] === 'http' || parts[0] === 'https') && parts.length > 1) {
                subdomainVal = parts[1];
            } else {
                subdomainVal = parts[0];
            }
        }
        subdomainVal = subdomainVal.replace(/[^a-z0-9-]/g, '');
        subdomainInput.value = subdomainVal; // Actualizar campo visible
    }

    // 2. Detectar si el usuario pegó la URL de su negocio en el campo Token por confusión
    if (tokenVal) {
        let isUrlOrSubdomain = false;
        let extractedSubdomain = '';

        if (tokenVal.startsWith('http://') || tokenVal.startsWith('https://') || tokenVal.includes('.') || tokenVal.length < 40) {
            isUrlOrSubdomain = true;
            let tempVal = tokenVal.toLowerCase();
            if (tempVal.includes('://')) {
                try {
                    const url = new URL(tempVal);
                    tempVal = url.hostname;
                } catch(e) {
                    tempVal = tempVal.replace(/^https?:\/\//, '');
                }
            }
            if (tempVal.includes('.')) {
                extractedSubdomain = tempVal.split('.')[0];
            } else {
                extractedSubdomain = tempVal;
            }
            extractedSubdomain = extractedSubdomain.replace(/[^a-z0-9-]/g, '');
        }

        // Si se detecta que es una URL o subdominio, y no empieza con "eyJh" (el token real)
        if (isUrlOrSubdomain && !tokenVal.startsWith('eyJh')) {
            if (extractedSubdomain) {
                subdomainInput.value = extractedSubdomain;
                subdomainVal = extractedSubdomain;
            }
            tokenInput.value = ''; // Limpiar el token erróneo
            
            Swal.fire({
                title: '¿URL en campo de Token? 💡',
                html: `Hemos detectado que intentabas poner el subdominio/URL <b>"${extractedSubdomain || tokenVal}"</b> en el campo del Token.<br><br>` +
                      `Lo hemos movido automáticamente al campo de <b>"Subdominio de este negocio"</b>.<br><br>` +
                      `Ahora, en este campo de <b>Token</b>, debes pegar el token JWT de Cloudflare (ej. un texto muy largo que empieza con <b>eyJh...</b>).`,
                icon: 'info',
                confirmButtonColor: '#f97316'
            });
            return;
        }
    }

    // 3. Extraer el token real (JWT) si pegan todo el comando de instalación de Cloudflare
    const jwtMatch = tokenVal.match(/(eyJh[A-Za-z0-9_-]+)/);
    if (jwtMatch) {
        tokenVal = jwtMatch[1];
        tokenInput.value = tokenVal; // Mostrar el token limpio en la UI
    }

    // 4. Validación estricta final del token
    if (tokenVal && (tokenVal.startsWith('http://') || tokenVal.startsWith('https://') || tokenVal.includes('/') || tokenVal.includes('.'))) {
        Swal.fire({
            title: 'Token Inválido ⚠️',
            text: 'Has pegado una URL en el campo del Token. Por favor, introduce el token JWT de Cloudflare (ej. eyJh...)',
            icon: 'warning',
            confirmButtonColor: '#f97316'
        });
        return;
    }

    if (!subdomainVal && !tokenVal) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Completa al menos el subdominio o el token', timer: 3000, showConfirmButton: false });
        return;
    }

    const subdomain = subdomainVal;
    const token = tokenVal;

    const fullDomain = subdomain ? `${subdomain}.puntopila.emprende.ve` : (settings.cloudflareDomain || 'puntopila.emprende.ve');
    settings.cloudflareDomain = fullDomain;
    if (token) settings.cloudflareToken = token;
    localStorage.setItem('freshpos_settings', JSON.stringify(settings));

    // Notificar al proceso principal para activar el túnel y guardarlo en settings.json
    if (window.electronAPI && window.electronAPI.saveData) {
        window.electronAPI.saveData({ filename: 'settings.json', data: settings }).then(() => {
            if (window.electronAPI.restartTunnels) {
                window.electronAPI.restartTunnels();
            }
        });
    }

    // Actualizar UI de estado
    if (statusDiv) {
        statusDiv.innerHTML = `<i class="fas fa-circle text-emerald-400 text-[8px] animate-pulse"></i> <span class="text-emerald-400">Activo: ${fullDomain}</span>`;
    }

    Swal.fire({
        toast: true, position: 'top-end', icon: 'success',
        title: `Túnel configurado: ${fullDomain}`,
        html: `<div class="text-xs mt-1 text-slate-500">📱 App Móvil: <b>${fullDomain}/mobile</b><br>👔 App Jefe: <b>${fullDomain}/jefe</b></div>`,
        timer: 5000, showConfirmButton: false
    });
};

// ==========================================
// SYNC DIAGNOSTIC TOOLS
// ==========================================
window.testCloudSyncManual = async function() {
    console.log('[DIAGNOSTIC] 🔍 Probando conexión Supabase...');
    const statusBadge = document.getElementById('sync-status-badge');
    const storeIdSpan = document.getElementById('sync-store-id');
    
    if (statusBadge) {
        statusBadge.className = 'px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 animate-pulse';
        statusBadge.textContent = 'Probando...';
    }

    try {
        const stats = await window.cloudSync.getStatus();
        console.log('[DIAGNOSTIC] 📊 Estado CloudSync:', stats);
        
        if (statusBadge) {
            if (stats.enabled) {
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600';
                statusBadge.textContent = 'Conectado';
            } else {
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-rose-100 text-rose-600';
                statusBadge.textContent = 'Desconectado';
            }
        }
        
        if (storeIdSpan) {
            storeIdSpan.textContent = stats.storeId || 'Sin definir';
        }

        if (!stats.enabled) {
            Swal.fire({
                icon: 'warning',
                title: 'Sincronización Inactiva',
                text: 'La nube no está configurada o las credenciales son incorrectas.',
                confirmButtonColor: '#3b82f6'
            });
        } else {
            Swal.fire({
                icon: 'success',
                title: 'Conexión Exitosa',
                html: `<div class="text-sm text-left"><b>Sede:</b> ${stats.storeId}<br><b>URL:</b> ${stats.url ? stats.url.substring(0,25) + '...' : '---'}</div>`,
                timer: 3000,
                showConfirmButton: false
            });
        }
    } catch (e) {
        console.error('[DIAGNOSTIC] ❌ Error en prueba:', e);
        if (statusBadge) {
            statusBadge.className = 'px-2 py-0.5 rounded-full bg-rose-100 text-rose-600';
            statusBadge.textContent = 'Error';
        }
        Swal.fire({ icon: 'error', title: 'Error de Conexión', text: e.message });
    }
};

// Actualizar UI de Sync al abrir modal admin
const originalOpenAdmin = window.openAdminModal;
window.openAdminModal = function() {
    if (typeof originalOpenAdmin === 'function') originalOpenAdmin();
    setTimeout(window.testCloudSyncManual, 200);
};

// Cargar valores actuales en la UI al iniciar
function initCloudflareTunnelUI() {
    const subdomainInput = document.getElementById('settings-cf-domain');
    const tokenInput     = document.getElementById('settings-cf-token');
    const statusDiv      = document.getElementById('cf-tunnel-status');
    if (!subdomainInput) return;

    const domain = settings.cloudflareDomain || '';
    if (domain && domain.includes('.puntopila.emprende.ve')) {
        subdomainInput.value = domain.replace('.puntopila.emprende.ve', '');
    } else if (domain) {
        subdomainInput.value = domain;
    }
    if (tokenInput && settings.cloudflareToken) tokenInput.value = settings.cloudflareToken;
    if (statusDiv && domain) {
        statusDiv.innerHTML = `<i class="fas fa-circle text-emerald-400 text-[8px]"></i> <span class="text-emerald-400">Configurado: ${domain}</span>`;
    }
}

// Llamar al init cuando se abre la vista de settings
document.addEventListener('DOMContentLoaded', () => {
    const navSettings = document.getElementById('nav-settings');
    if (navSettings) {
        navSettings.addEventListener('click', () => setTimeout(initCloudflareTunnelUI, 100));
    }
    const forgotBtn = document.getElementById('forgot-password-btn');
    if (forgotBtn) forgotBtn.addEventListener('click', recoverBossPassword);
});

// ==========================================
// TRANSFERENCIAS DE INVENTARIO
// ==========================================

window.renderTransfers = async function() {
    const tbody = document.getElementById('transfers-table-body');
    if (!tbody) return;
    try {
        const transfers = await window.db.getTransfers();
        if (!transfers || transfers.length === 0) {
            tbody.innerHTML = `<tr id="transfers-empty-row">
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <i class="fas fa-right-left text-3xl mb-2 block"></i>
                    <p class="font-medium">No hay transferencias registradas</p>
                    <p class="text-xs">Crea una nueva transferencia para mover stock entre sucursales</p>
                </td>
            </tr>`;
            return;
        }
        tbody.innerHTML = '';
        transfers.forEach(t => {
            const statusBadge = t.status === 'COMPLETED'
                ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"><i class="fas fa-check-circle mr-1"></i>Completada</span>'
                : '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200"><i class="fas fa-clock mr-1"></i>Pendiente</span>';
            const actions = t.status === 'COMPLETED'
                ? `<button onclick="window.deleteTransfer('${t.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mx-auto" title="Eliminar"><i class="fas fa-trash-alt"></i></button>`
                : `<div class="flex items-center justify-center gap-1">
                    <button onclick="window.completeTransfer('${t.id}')" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center" title="Completar"><i class="fas fa-check"></i></button>
                    <button onclick="window.deleteTransfer('${t.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                   </div>`;
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition-colors group";
            tr.innerHTML = `
                <td class="py-3 px-6 font-bold text-slate-800">${t.product_name || '---'}</td>
                <td class="py-3 px-6 text-right font-mono font-bold text-slate-800">${t.quantity}</td>
                <td class="py-3 px-6 text-slate-600">${t.from_store || '---'}</td>
                <td class="py-3 px-6 text-slate-600">${t.to_store || '---'}</td>
                <td class="py-3 px-6">${statusBadge}</td>
                <td class="py-3 px-6 text-slate-500 text-sm">${t.date ? new Date(t.date).toLocaleDateString() : '---'}</td>
                <td class="py-3 px-6 text-center">${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) {
        console.error('Error loading transfers:', e);
    }
};

window.openTransferModal = function(editTransfer) {
    const isEdit = !!editTransfer;
    const stores = ['Sucursal Principal', 'Almacén Norte', 'Almacén Sur', 'Depósito Central'];
    const storeOpts = stores.map(s => `<option value="${s}">${s}</option>`).join('');
    const productsHtml = (typeof products !== 'undefined' && products.length)
        ? products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')
        : '<option value="">No hay productos disponibles</option>';

    Swal.fire({
        title: isEdit ? 'Editar Transferencia' : 'Nueva Transferencia',
        html: `
            <div class="text-left space-y-3">
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Producto</label>
                    <select id="swal-transfer-product" class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-cyan-500 outline-none">${productsHtml}</select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Cantidad</label>
                    <input type="number" id="swal-transfer-qty" value="${isEdit ? editTransfer.quantity : 1}" min="1" class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-cyan-500 outline-none">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Origen</label>
                    <select id="swal-transfer-from" class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-cyan-500 outline-none">${storeOpts}</select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Destino</label>
                    <select id="swal-transfer-to" class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-cyan-500 outline-none">${storeOpts}</select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Notas (opcional)</label>
                    <textarea id="swal-transfer-notes" rows="2" class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-cyan-500 outline-none">${isEdit ? (editTransfer.notes || '') : ''}</textarea>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Guardar Cambios' : 'Crear Transferencia',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#06b6d4',
        preConfirm: () => {
            const productSel = document.getElementById('swal-transfer-product');
            const productId = productSel.value;
            const productName = productSel.options[productSel.selectedIndex]?.text || '';
            const qty = parseInt(document.getElementById('swal-transfer-qty').value) || 1;
            const fromStore = document.getElementById('swal-transfer-from').value;
            const toStore = document.getElementById('swal-transfer-to').value;
            const notes = document.getElementById('swal-transfer-notes').value;
            if (!productId) { Swal.showValidationMessage('Selecciona un producto'); return false; }
            if (!fromStore || !toStore) { Swal.showValidationMessage('Selecciona origen y destino'); return false; }
            if (fromStore === toStore) { Swal.showValidationMessage('Origen y destino no pueden ser iguales'); return false; }
            return { productId, productName, quantity: qty, fromStore, toStore, notes };
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        const d = res.value;
        const transfer = {
            id: isEdit ? editTransfer.id : generateId(),
            product_id: d.productId,
            product_name: d.productName,
            quantity: d.quantity,
            from_store: d.fromStore,
            to_store: d.toStore,
            notes: d.notes || '',
            date: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            status: isEdit ? editTransfer.status : 'PENDING',
            cashier_name: window.currentRole || 'admin'
        };
        try {
            await window.db.saveTransfer(transfer);
            Swal.fire({ title: 'Guardado', icon: 'success', timer: 1500, showConfirmButton: false });
            window.renderTransfers();
        } catch(e) {
            Swal.fire('Error', 'No se pudo guardar la transferencia: ' + e.message, 'error');
        }
    });
};

window.completeTransfer = async function(id) {
    try {
        await window.db.updateTransferStatus(id, 'COMPLETED');
        Swal.fire({ title: 'Transferencia Completada', icon: 'success', timer: 1500, showConfirmButton: false });
        window.renderTransfers();
    } catch(e) {
        Swal.fire('Error', 'No se pudo completar la transferencia: ' + e.message, 'error');
    }
};

window.deleteTransfer = async function(id) {
    Swal.fire({
        title: '¿Eliminar transferencia?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Eliminar'
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        try {
            await window.db.deleteTransfer(id);
            window.renderTransfers();
        } catch(e) {
            Swal.fire('Error', 'No se pudo eliminar: ' + e.message, 'error');
        }
    });
};

// ==========================================
// PEDIDOS AL ALMACÉN (PURCHASE ORDERS)
// ==========================================

let poStatusFilter = 'all';

window.renderPurchaseOrders = async function(status) {
    if (status !== undefined) poStatusFilter = status;
    const tbody = document.getElementById('po-table-body');
    if (!tbody) return;
    document.querySelectorAll('.po-filter-btn').forEach(btn => {
        const s = btn.getAttribute('data-status');
        if (s === poStatusFilter) {
            btn.className = 'po-filter-btn px-4 py-2 rounded-xl text-xs font-bold border border-brand-500 bg-brand-500 text-white transition-all';
        } else {
            btn.className = 'po-filter-btn px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all';
        }
    });
    try {
        const orders = await window.db.getPurchaseOrders(poStatusFilter);
        if (!orders || orders.length === 0) {
            tbody.innerHTML = `<tr id="po-empty-row">
                <td colspan="6" class="py-12 text-center text-slate-400">
                    <i class="fas fa-cart-shopping text-3xl mb-2 block"></i>
                    <p class="font-medium">No hay pedidos registrados</p>
                    <p class="text-xs">Crea un nuevo pedido de compra para solicitar productos al almacén</p>
                </td>
            </tr>`;
            return;
        }
        let storeType = 'kiosko';
        try { const s = await window.db.getSettings(); storeType = s?.storeType || 'kiosko'; } catch(e) {}
        tbody.innerHTML = '';
        orders.forEach(po => {
            let badge = '';
            if (po.status === 'PENDING') badge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200"><i class="fas fa-clock mr-1"></i>Pendiente</span>';
            else if (po.status === 'APPROVED') badge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200"><i class="fas fa-check-circle mr-1"></i>Aprobado</span>';
            else if (po.status === 'RECEIVED') badge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200"><i class="fas fa-warehouse mr-1"></i>Recibido</span>';
            else badge = '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">' + po.status + '</span>';

            const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
            const totalItems = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
            const totalCost = po.total_cost || items.reduce((sum, it) => sum + ((it.quantity || 0) * (it.cost_price || 0)), 0);

            const isWarehouse = storeType === 'warehouse';
            let actions = '';
            if (po.status === 'PENDING') {
                if (isWarehouse) {
                    actions = `<div class="flex items-center justify-center gap-1">
                        <button onclick="window.approvePO('${po.id}','${po.from_store}')" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center" title="Aprobar"><i class="fas fa-check"></i></button>
                        <button onclick="window.deletePO('${po.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </div>`;
                } else {
                    actions = `<div class="flex items-center justify-center gap-1">
                        <span class="text-xs text-amber-500 italic">Esperando aprobación</span>
                        <button onclick="window.deletePO('${po.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </div>`;
                }
            } else if (po.status === 'APPROVED') {
                if (!isWarehouse) {
                    actions = `<div class="flex items-center justify-center gap-1">
                        <button onclick="window.openReceivePOModal('${po.id}')" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center" title="Recibir"><i class="fas fa-truck-loading"></i></button>
                        <button onclick="window.deletePO('${po.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                    </div>`;
                } else {
                    actions = `<button onclick="window.deletePO('${po.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mx-auto" title="Eliminar"><i class="fas fa-trash-alt"></i></button>`;
                }
            } else {
                actions = `<button onclick="window.deletePO('${po.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mx-auto" title="Eliminar"><i class="fas fa-trash-alt"></i></button>`;
            }

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition-colors group";
            tr.innerHTML = `
                <td class="py-3 px-6 font-bold text-slate-800 font-mono">#${po.id.slice(-6).toUpperCase()}</td>
                <td class="py-3 px-6 text-right font-mono font-bold text-slate-800">${totalItems}</td>
                <td class="py-3 px-6 text-right font-mono font-bold text-slate-800">${formatUSD(totalCost)}</td>
                <td class="py-3 px-6">${badge}</td>
                <td class="py-3 px-6 text-slate-500 text-sm">${po.date ? new Date(po.date).toLocaleDateString() : '---'}</td>
                <td class="py-3 px-6 text-center">${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) {
        console.error('Error loading purchase orders:', e);
    }
};

window._poAllProducts = [];

window.openPOModal = async function() {
    const settings = await window.db.getSettings();
    const isKiosko = (settings || {}).storeType === 'kiosko';
    window._poStoreId = settings?.storeId || '';
    window._poWarehouseStoreId = null;
    window._poAllProducts = products ? [...products] : [];

    if (isKiosko && window.cloudSync?.getWarehouseProducts) {
        try {
            const [whProducts, whStoreId] = await Promise.all([
                window.cloudSync.getWarehouseProducts(),
                window.cloudSync.getWarehouseStoreId().catch(() => null)
            ]);
            window._poWarehouseStoreId = whStoreId || null;
            if (whProducts && whProducts.length > 0) {
                whProducts.forEach(wp => {
                    if (!window._poAllProducts.find(p => p.id === wp.product_id)) {
                        window._poAllProducts.push({
                            id: wp.product_id,
                            name: wp.name + ' 📦',
                            costPrice: parseFloat(wp.price) || 0,
                            priceUSD: parseFloat(wp.price) || 0
                        });
                    }
                });
            }
        } catch(e) {
            console.warn('[PO] Could not fetch warehouse products:', e.message);
        }
    }

    const productsHtml = window._poAllProducts.length
        ? window._poAllProducts.map(p => `<div class="flex items-center justify-between py-2 border-b border-slate-100 po-product-row" data-id="${p.id}" data-name="${p.name}" data-price="${p.costPrice || p.priceUSD || 0}">
            <span class="font-bold text-sm text-slate-700">${p.name}</span>
            <span class="text-xs text-slate-400">${formatUSD(p.costPrice || p.priceUSD || 0)}</span>
           </div>`).join('')
        : '<p class="text-xs text-slate-400 py-2">No hay productos disponibles</p>';

    Swal.fire({
        title: 'Nuevo Pedido al Almacén',
        html: `
            <div class="text-left space-y-3">
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Buscar producto</label>
                    <input type="text" id="swal-po-search" placeholder="Escribe para buscar..." class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-emerald-500 outline-none" oninput="window.filterPOProducts(this.value)">
                </div>
                <div id="swal-po-products" class="max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2 space-y-0.5">
                    ${productsHtml}
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Items seleccionados</label>
                    <div id="swal-po-cart" class="max-h-32 overflow-y-auto border border-slate-100 rounded-xl p-2 text-sm text-slate-400">
                        <span class="italic">Ninguno</span>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 mb-1">Notas (opcional)</label>
                    <textarea id="swal-po-notes" rows="2" class="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:border-emerald-500 outline-none"></textarea>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Crear Pedido',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        didOpen: () => {
            window._poCart = [];
            document.getElementById('swal-po-products')?.querySelectorAll('.po-product-row').forEach(row => {
                row.addEventListener('click', function() {
                    const id = this.dataset.id;
                    const name = this.dataset.name;
                    const price = parseFloat(this.dataset.price) || 0;
                    const existing = window._poCart.find(i => i.product_id === id);
                    if (existing) {
                        existing.quantity++;
                    } else {
                        window._poCart.push({ product_id: id, product_name: name, quantity: 1, cost_price: price });
                    }
                    window.updatePOCartUI();
                });
            });
        },
        preConfirm: () => {
            const cart = window._poCart || [];
            if (cart.length === 0) { Swal.showValidationMessage('Agrega al menos un producto'); return false; }
            const notes = document.getElementById('swal-po-notes')?.value || '';
            const totalCost = cart.reduce((sum, i) => sum + (i.quantity * i.cost_price), 0);
            return { items: cart, notes, total_cost: totalCost };
        }
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        const d = res.value;
        let whStoreId = window._poWarehouseStoreId;
        if (!whStoreId && window.cloudSync?.getWarehouseStoreId) {
            try { whStoreId = await window.cloudSync.getWarehouseStoreId(); } catch(e) {}
        }
        const po = {
            id: generateId(),
            order_type: 'purchase',
            store_id: window._poStoreId,
            from_store: whStoreId || '',
            to_store: window._poStoreId,
            status: 'PENDING',
            items: d.items,
            notes: d.notes,
            total_cost: d.total_cost,
            date: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            created_by: window.currentRole || 'admin'
        };
        try {
            await window.db.savePurchaseOrder(po);
            if (window.cloudSync?.pushPurchaseOrder) {
                window.cloudSync.pushPurchaseOrder(po).catch(e => console.warn('[PO] Sync error:', e.message));
            }
            Swal.fire({ title: 'Pedido Creado', icon: 'success', timer: 1500, showConfirmButton: false });
            window.renderPurchaseOrders();
        } catch(e) {
            Swal.fire('Error', 'No se pudo crear el pedido: ' + e.message, 'error');
        }
    });
};

window.filterPOProducts = function(q) {
    const rows = document.querySelectorAll('.po-product-row');
    const val = q.toLowerCase().trim();
    rows.forEach(row => {
        const name = (row.dataset.name || '').toLowerCase();
        row.style.display = (!val || name.includes(val)) ? '' : 'none';
    });
};

window.updatePOCartUI = function() {
    const cart = window._poCart || [];
    const container = document.getElementById('swal-po-cart');
    if (!container) return;
    if (cart.length === 0) {
        container.innerHTML = '<span class="italic">Ninguno</span>';
        return;
    }
    container.innerHTML = cart.map((item, idx) =>
        `<div class="flex items-center justify-between py-1 text-xs border-b border-slate-50">
            <span class="font-bold text-slate-700">${item.product_name}</span>
            <div class="flex items-center gap-2">
                <span class="text-slate-500">x${item.quantity}</span>
                <span class="font-mono text-slate-600">${formatUSD(item.quantity * item.cost_price)}</span>
                <button onclick="window.removePOItem(${idx})" class="text-red-400 hover:text-red-600"><i class="fas fa-times"></i></button>
            </div>
        </div>`
    ).join('');
};

window.removePOItem = function(idx) {
    if (!window._poCart) return;
    window._poCart.splice(idx, 1);
    window.updatePOCartUI();
};

window.approvePO = async function(id, fromStoreId) {
    const settings = await window.db.getSettings();
    const storeType = settings?.storeType || 'kiosko';
    if (storeType !== 'warehouse') {
        Swal.fire('Solo Almacén', 'Solo el almacén puede aprobar pedidos.', 'info');
        return;
    }
    Swal.fire({
        title: '¿Aprobar pedido?',
        text: 'Se descontará el stock del almacén',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'Aprobar y descontar stock'
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        try {
            const orders = await window.db.getPurchaseOrders('all');
            const po = orders.find(o => o.id === id);
            const items = typeof po?.items === 'string' ? JSON.parse(po.items) : (po?.items || []);
            const sid = fromStoreId || settings?.storeId || '';
            if (window.cloudSync?.approvePurchaseOrder) {
                await window.cloudSync.approvePurchaseOrder(id, items, sid);
            } else {
                await window.db.updatePOStatus(id, 'APPROVED');
            }
            Swal.fire({ title: 'Pedido Aprobado', text: 'Stock descontado del almacén', icon: 'success', timer: 2000, showConfirmButton: false });
            window.renderPurchaseOrders();
        } catch(e) {
            Swal.fire('Error', 'No se pudo aprobar: ' + e.message, 'error');
        }
    });
};

window.openReceivePOModal = async function(poId) {
    try {
        const orders = await window.db.getPurchaseOrders('all');
        const po = orders.find(o => o.id === poId);
        if (!po) { Swal.fire('Error', 'Pedido no encontrado', 'error'); return; }
        const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);

        const itemsHtml = items.map((item, idx) => `
            <div class="flex items-center justify-between py-2 border-b border-slate-100">
                <div>
                    <p class="font-bold text-sm text-slate-700">${item.product_name}</p>
                    <p class="text-xs text-slate-400">Pedido: ${item.quantity}</p>
                </div>
                <div>
                    <label class="text-xs text-slate-500 mr-2">Recibido</label>
                    <input type="number" id="swal-receive-qty-${idx}" value="${item.quantity}" min="0" max="${item.quantity}" class="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-center focus:border-blue-500 outline-none">
                </div>
            </div>
        `).join('');

        Swal.fire({
            title: 'Recibir Pedido',
            html: `
                <p class="text-xs text-slate-500 mb-4">Registra las cantidades recibidas para el pedido <strong class="text-slate-700">#${po.id.slice(-6).toUpperCase()}</strong></p>
                <div class="text-left space-y-1 max-h-60 overflow-y-auto">${itemsHtml}</div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Confirmar Recepción',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#3b82f6',
            preConfirm: () => {
                const received = items.map((item, idx) => {
                    const qty = parseInt(document.getElementById(`swal-receive-qty-${idx}`)?.value) || 0;
                    return { ...item, received_qty: qty };
                });
                return received;
            }
        }).then(async (res) => {
            if (!res.isConfirmed) return;
            try {
                const settings = await window.db.getSettings();
                const sid = settings?.storeId || '';
                if (window.cloudSync?.receivePurchaseOrder) {
                    await window.cloudSync.receivePurchaseOrder(poId, res.value, sid);
                } else {
                    await window.db.receivePO(poId, res.value);
                }
                Swal.fire({ title: 'Pedido Recibido', text: 'El stock ha sido actualizado', icon: 'success', timer: 2000, showConfirmButton: false });
                window.renderPurchaseOrders();
            } catch(e) {
                Swal.fire('Error', 'No se pudo recibir el pedido: ' + e.message, 'error');
            }
        });
    } catch(e) {
        Swal.fire('Error', 'Error al cargar pedido: ' + e.message, 'error');
    }
};

window.deletePO = async function(id) {
    Swal.fire({
        title: '¿Eliminar pedido?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Eliminar'
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        try {
            await window.db.deletePO(id);
            window.renderPurchaseOrders();
        } catch(e) {
            Swal.fire('Error', 'No se pudo eliminar: ' + e.message, 'error');
        }
    });
};

// ==================================================================
// MATERIA PRIMA / INGREDIENTES — MÓDULO RECONECTADO
// Habilita el modal de ingredientes (openIngredientsModal) y el
// formulario de escandallo/recetas (addRecipeRow) dentro del producto.
// ==================================================================

// Toggle mostrar/ocultar contraseña en el login
window.toggleLoginPassword = function() {
    var input = document.getElementById('login-password');
    var icon = document.getElementById('login-eye-icon');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        if (icon) icon.className = 'fas fa-eye';
    }
};

// Tabs del Panel de Rendimientos (Analytics)
window.switchAnalyticsTab = function(tab) {
    var tabs = ['resumen', 'graficos', 'productos', 'empleados'];
    tabs.forEach(function(t) {
        var content = document.getElementById('tab-content-' + t);
        var btn = document.getElementById('tab-btn-' + t);
        if (content) content.classList.toggle('hidden', t !== tab);
        if (btn) {
            var high = (t === tab);
            btn.classList.toggle('border-brand-600', high);
            btn.classList.toggle('text-brand-600', high);
            btn.classList.toggle('border-transparent', !high);
            btn.classList.toggle('text-slate-400', !high);
        }
    });
    if (typeof renderAnalytics === 'function') renderAnalytics();
};

// Exportar a Excel (vista Exportar) — exporta los datos según el tipo
window.exportReport = function(type) {
    var rows = [];
    var _d = new Date();
    var todayStr = [_d.getFullYear(), String(_d.getMonth() + 1).padStart(2, '0'), String(_d.getDate()).padStart(2, '0')].join('-');
    if (type === 'sales') {
        var fromEl = document.getElementById('export-sales-from');
        var toEl = document.getElementById('export-sales-to');
        var fromVal = fromEl ? fromEl.value : '';
        var toVal = toEl ? toEl.value : '';
        var allSales = (typeof sales !== 'undefined' && Array.isArray(sales)) ? sales : [];
        var salesList = allSales.filter(function(s) {
            if (!s.date) return false;
            var d = String(s.date).slice(0, 10);
            if (fromVal && d < fromVal) return false;
            if (toVal && d > toVal) return false;
            if (!fromVal && !toVal) return d === todayStr;
            return true;
        });
        rows = salesList.map(function(s) {
            return {
                'Ticket': s.ticketNumber || s.ticket_number || '',
                'Fecha': s.timestamp || '',
                'Cliente': (s.clientName || s.client_name || ''),
                'Total USD': s.totalUSD != null ? s.totalUSD : (s.total || 0),
                'Total VES': s.totalVES != null ? s.totalVES : (s.total_ves || 0),
                'Método': s.method || ''
            };
        });
    } else if (type === 'products') {
        var prods = typeof products !== 'undefined' ? products : [];
        rows = prods.map(function(p) {
            return {
                'ID': p.id || '',
                'Producto': p.name || '',
                'Categoría': p.category || '',
                'Stock': p.stock != null ? p.stock : 0,
                'Precio USD': p.priceUSD != null ? p.priceUSD : (p.price_usd || 0),
                'Precio VES': p.priceVES != null ? p.priceVES : (p.price_ves || 0)
            };
        });
    } else if (type === 'clients') {
        var clientsArr = (typeof clients !== 'undefined' && Array.isArray(clients)) ? clients : [];
        rows = clientsArr.map(function(c) {
            return { 'Nombre': c.name || '', 'Documento': c.document || '', 'Teléfono': c.phone || '', 'Crédito': c.credit || 0 };
        });
    } else if (type === 'movements') {
        var movs = (typeof movements !== 'undefined' && Array.isArray(movements)) ? movements : [];
        rows = movs.map(function(m) {
            return { 'Producto': m.productName || m.product_id || '', 'Tipo': m.type || '', 'Cantidad': m.qty != null ? m.qty : 0, 'Razón': m.reason || '', 'Fecha': m.timestamp || '' };
        });
    }
    if (!rows.length) {
        Swal.fire('Sin datos', 'No hay datos para exportar en esta categoría.', 'info');
        return;
    }
    window.exportToCSV('reporte-' + type + '.csv', rows);
};

window.exportToCSV = function(filename, rows) {
    if (!rows || !rows.length) return;
    var headers = Object.keys(rows[0]);
    var csv = headers.join(',') + '\n';
    csv += rows.map(function(r) {
        return headers.map(function(h) {
            var v = r[h] != null ? r[h] : '';
            v = String(v).replace(/"/g, '""');
            if (String(v).indexOf(',') > -1 || String(v).indexOf('"') > -1 || String(v).indexOf('\n') > -1) {
                v = '"' + v + '"';
            }
            return v;
        }).join(',');
    }).join('\n');
    var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 150);
};

// ─── Ingredientes (Materia Prima) ────────────────────────────────
var _ingredients = [];
var _ingRows = [];

async function loadIngredients(force) {
    if (typeof window.db === 'undefined' || !window.db.getIngredients) return _ingredients;
    try {
        var sid = _getStoreId();
        _ingredients = await window.db.getIngredients(sid);
        return _ingredients || [];
    } catch (e) {
        console.error('[Ingredientes] Error cargando:', e);
        return _ingredients;
    }
}

window.openIngredientsModal = async function() {
    await loadIngredients(true);
    var modal = document.getElementById('ingredients-modal');
    if (!modal) {
        Swal.fire('No disponible', 'El módulo de Materia Prima no está disponible en esta versión.', 'warning');
        return;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderIngredients();
};

window.renderIngredients = function() {
    var tbody = document.getElementById('ingredients-tbody');
    if (!tbody) return;
    var filter = (document.getElementById('search-ingredient') || {}).value || '';
    var list = _ingredients.filter(function(i) {
        return !filter || (i.name || '').toLowerCase().indexOf(filter.toLowerCase()) > -1;
    });
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400 text-xs font-medium">No hay ingredientes registrados.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(function(ing, idx) {
        var stk = '<span style="color:#dc2626;font-weight:bold;">' + (ing.stock || 0) + '</span>';
        if (ing.minStock != null && Number(ing.stock || 0) < Number(ing.minStock)) stk += ' ⚠️';
        return '<tr class="hover:bg-slate-50" style="border-bottom:1px solid #f1f5f9;">' +
            '<td class="py-2 px-3 text-xs text-slate-500">' + (idx + 1) + '</td>' +
            '<td class="py-2 px-3 font-semibold text-slate-700">' + (ing.name || 'Sin nombre') + '</td>' +
            '<td class="py-2 px-3 text-xs text-slate-500">' + (ing.unit || '') + '</td>' +
            '<td class="py-2 px-3">' + st + '</td>' +
            '<td class="py-2 px-3 text-right whitespace-nowrap">' +
                '<button onclick="editIngredient(\'' + (ing.id || '') + '\')" class="text-[10px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-md mr-1">✏️</button>' +
                '<button onclick="deleteIngredient(\'' + (ing.id || '') + '\')" class="text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-md">🗑️</button>' +
            '</td></tr>';
    }).join('');
};

window.editIngredient = async function(id) {
    var ing = _ingredients.find(function(i) { return i.id === id; });
    if (!ing) return;
    var title = document.getElementById('ingredient-form-title');
    if (title) title.textContent = 'Editar Ingrediente';
    document.getElementById('ing-id').value = ing.id || '';
    document.getElementById('ing-name').value = ing.name || '';
    document.getElementById('ing-unit').value = ing.unit || '';
    document.getElementById('ing-stock').value = ing.stock || 0;
    document.getElementById('ing-minStock').value = ing.minStock != null ? ing.minStock : 0;
    document.getElementById('ing-cost').value = ing.cost != null ? ing.cost : 0;
    var cancelBtn = document.getElementById('ing-cancel-btn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
};

window.deleteIngredient = async function(id) {
    var conf = await Swal.fire({ title: '¿Eliminar ingrediente?', text: 'Se quitará de todos los escandallos.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Sí, eliminar' });
    if (!conf.isConfirmed) return;
    try {
        var sid = _getStoreId();
        if (window.db && window.db.deleteIngredient) await window.db.deleteIngredient(sid, id);
        _ingredients = _ingredients.filter(function(i) { return i.id !== id; });
        renderIngredients();
    } catch (e) {
        Swal.fire('Error', 'No se pudo eliminar: ' + e.message, 'error');
    }
};

window.saveIngredient = async function(event) {
    if (event && event.preventDefault) event.preventDefault();
    var name = (document.getElementById('ing-name') || {}).value || '';
    if (!name.trim()) { Swal.fire('Campo requerido', 'Escribe el nombre del ingrediente.', 'warning'); return; }
    var ing = {
        id: document.getElementById('ing-id').value || generateId(),
        name: name.trim(),
        unit: (document.getElementById('ing-unit') || {}).value || 'unidad',
        stock: parseFloat((document.getElementById('ing-stock') || {}).value) || 0,
        minStock: parseFloat((document.getElementById('ing-minStock') || {}).value) || 0,
        cost: parseFloat((document.getElementById('ing-cost') || {}).value) || 0
    };
    try {
        var sid = _getStoreId();
        if (window.db && window.db.saveIngredient) await window.db.saveIngredient(sid, ing);
        var idx = _ingredients.findIndex(function(i) { return i.id === ing.id; });
        if (idx > -1) _ingredients[idx] = ing; else _ingredients.push(ing);
        resetIngredientForm();
        renderIngredients();
        Swal.fire({ icon: 'success', title: 'Ingrediente guardado', timer: 1200, showConfirmButton: false });
    } catch (e) {
        Swal.fire('Error', 'No se pudo guardar: ' + e.message, 'error');
    }
};

window.resetIngredientForm = function() {
    var title = document.getElementById('ingredient-form-title');
    if (title) title.textContent = 'Nuevo Ingrediente';
    ['ing-id', 'ing-name', 'ing-unit', 'ing-stock', 'ing-minStock', 'ing-cost'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            if (id === 'ing-unit') el.value = '';
            else if (id === 'ing-stock' || id === 'ing-minStock' || id === 'ing-cost') el.value = 0;
            else el.value = '';
        }
    });
    var cancelBtn = document.getElementById('ing-cancel-btn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
};

// =========== Escandallos / Recetas (botón + dentro del modal de producto) ===========
async function loadIngredientOptions() {
    await loadIngredients();
    var sel = document.getElementById('recipe-ing-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione Ingrediente...</option>' + _ingredients.map(function(i) {
        return '<option value="' + (i.id || '') + '">' + (i.name || '') + ' (' + (i.unit || '') + ')</option>';
    }).join('');
}

async function renderRecipeSelect() {
    await loadIngredientOptions();
}

window.addRecipeRow = async function() {
    await loadIngredients();
    var select = document.getElementById('recipe-ing-select');
    var qtyInput = document.getElementById('recipe-ing-qty');
    var tbody = document.getElementById('recipe-tbody');
    if (!select || !tbody) return;
    var ingId = select.value;
    var ing = _ingredients.find(function(i) { return i.id === ingId; });
    if (!ing) { Swal.fire('Selecciona', 'Primero elige un ingrediente.', 'warning'); return; }
    var qty = parseFloat(qtyInput ? qtyInput.value : 1) || 1;
    var existing = _ingRows.find(function(r) { return r.ingredient_id === ingId; });
    if (existing) existing.quantity = existing.quantity + qty; else _ingRows.push({ ingredient_id: ingId, name: ing.name, unit: ing.unit, quantity: qty });
    renderIngredientsTableRows();
    var emptyState = document.getElementById('recipe-empty-state');
    if (emptyState) emptyState.style.display = 'none';
};

window.removeRecipeRow = function(index) {
    if (index >= 0 && index < _ingRows.length) _ingRows.splice(index, 1);
    renderIngredientsTableRows();
};

function renderIngredientsTableRows() {
    var tbody = document.getElementById('recipe-tbody');
    if (!tbody) return;
    if (!_ingRows.length) {
        tbody.innerHTML = '';
        var emptyState = document.getElementById('recipe-empty-state');
        if (emptyState) emptyState.style.display = '';
        return;
    }
    tbody.innerHTML = _ingRows.map(function(r, idx) {
        return '<tr style="border-bottom:1px solid #f1f5f9;">' +
            '<td class="py-2 px-3 text-sm font-semibold">' + (r.name || r.ingredient_id || '') + '</td>' +
            '<td class="py-2 px-3 text-center text-sm">' + r.quantity + ' ' + (r.unit || '') + '</td>' +
            '<td class="py-2 px-3 text-center"><button type="button" onclick="removeRecipeRow(' + idx + ')" class="text-rose-500 hover:text-rose-700 text-xs"><i class="fas fa-times"></i></button></td>' +
        '</tr>';
    }).join('');
}

// exportReport helper usado por renderAnalytics
window._render_recipe = renderIngredientsTableRows;

// ==================================================================
// FUNCIONES UI FALTANTES — RESTAURADAS / IMPLEMENTADAS
// ==================================================================

// --- Sidebar principal ---
window.toggleSidebar = function() {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar-collapsed');
    const btn = document.getElementById('sidebar-toggle-btn');
    if (btn) { const i = btn.querySelector('i'); if (i) i.className = sidebar.classList.contains('sidebar-collapsed') ? 'fas fa-bars' : 'fas fa-times'; }
};

// --- Toggle secciones colapsables del menu ---
window.toggleSection = function(headerEl) {
    if (!headerEl) return;
    const content = headerEl.nextElementSibling;
    if (!content) return;
    const hidden = content.style.display === 'none';
    content.style.display = hidden ? '' : 'none';
    const icon = headerEl.querySelector('i.fa-chevron-down, i.fa-chevron-right');
    if (icon) icon.className = hidden ? 'fas fa-chevron-down text-xs' : 'fas fa-chevron-right text-xs';
};

// --- Carrito lateral ---
window.toggleCartSidebar = function() {
    const cart = document.getElementById('cart-sidebar');
    const floatBtn = document.getElementById('cart-toggle-float');
    if (!cart) return;
    const collapsed = cart.classList.toggle('cart-collapsed');
    if (floatBtn) floatBtn.classList.toggle('hidden', !collapsed);
};

// --- Panel cuentas por cobrar ---
window.toggleCuentas = function() {
    const panel = document.getElementById('cuentas-panel') || document.getElementById('credits-panel');
    if (panel) { panel.classList.toggle('hidden'); return; }
    if (typeof window.openCreditsModal === 'function') window.openCreditsModal();
};

// --- Toggle descuento ---
window.toggleDescuento = function() {
    const row = document.getElementById('cart-discount-row') || document.getElementById('discount-input-row') || document.getElementById('discount-panel');
    if (row) row.classList.toggle('hidden');
};

// --- Filtro tabla de ventas ---
window.filterSalesTable = function(query) {
    const tbody = document.getElementById('reports-table-body');
    if (!tbody) return;
    const q = (query || '').toLowerCase().trim();
    tbody.querySelectorAll('tr').forEach(r => { r.style.display = (!q || r.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
};

// --- Toggle masivo features admin ---
window.adminToggleAll = function(val) {
    document.querySelectorAll('.feat-toggle').forEach(el => {
        el.checked = val;
        const id = el.getAttribute('data-id');
        if (typeof setFeatEnabled === 'function') setFeatEnabled(id, val);
        if (typeof applySingleFeature === 'function') applySingleFeature(id, val);
    });
};

// --- Sync Provisionar → POS ---
window.syncProvisionarToPOS = async () => {
    if (!window.Provisionar || !window.Provisionar._getMateriales) { Swal.fire('No disponible', 'El modulo Provisionar no esta cargado.', 'info'); return; }
    const mats = window.Provisionar._getMateriales();
    if (!mats || !mats.length) { Swal.fire('Sin materiales', 'No hay materiales para sincronizar.', 'info'); return; }
    const rate = settings.exchangeRate || 36.5;
    let creados = 0, actualizados = 0;
    for (const m of mats) {
        const costo = m.costoPlancha || (m.areaM2 && m.costoM2 ? m.areaM2 * m.costoM2 : (m.costoM2 || 10));
        const precioUSD = parseFloat((costo * 1.3).toFixed(2));
        const existing = products.find(p => p.id === m.id || p.provisionarId === m.id);
        if (existing) { existing.priceUSD = precioUSD; existing.priceVES = Math.round(precioUSD * rate / 10) * 10; existing.costPrice = parseFloat(costo.toFixed(2)); actualizados++; }
        else { products.push({ id: m.id, name: m.nombre, priceUSD: precioUSD, priceVES: Math.round(precioUSD * rate / 10) * 10, costPrice: parseFloat(costo.toFixed(2)), stock: m.stock || 0, minStock: 1, category: 'Acrilico', provisionarId: m.id, barcode: '', img_url: '' }); creados++; }
    }
    if (typeof saveProducts === 'function') saveProducts();
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof renderInventory === 'function') renderInventory();
    Swal.fire({ toast: true, position: 'top-end', title: `Sincronizado: ${creados} creados, ${actualizados} actualizados`, icon: 'success', showConfirmButton: false, timer: 3000 });
};

// --- Tipo de sucursal ---
window.getStoreType = () => settings.storeType || 'kiosko';
window.setStoreType = (type) => {
    settings.storeType = type;
    if (typeof saveSettings === 'function') saveSettings();
    const active = 'flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 border-emerald-500 bg-emerald-500 text-white flex items-center justify-center gap-1.5';
    const inactive = 'flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 border-slate-200 bg-white text-slate-500 hover:border-emerald-300 flex items-center justify-center gap-1.5';
    const kb = document.getElementById('store-type-kiosko'); const wb = document.getElementById('store-type-warehouse');
    if (kb) kb.className = type === 'kiosko' ? active : inactive;
    if (wb) wb.className = type === 'warehouse' ? active : inactive;
    if (window.cloudSync && typeof window.cloudSync.configure === 'function') window.cloudSync.configure({ storeType: type });
    Swal.fire({ toast: true, position: 'top-end', title: `Sucursal: ${type === 'kiosko' ? 'Kiosko' : 'Almacen'}`, icon: 'success', showConfirmButton: false, timer: 2000 });
};
