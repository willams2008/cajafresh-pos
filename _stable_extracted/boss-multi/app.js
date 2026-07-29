// boss-multi/app.js

let supabaseUrl = localStorage.getItem('sb_url') || '';
let supabaseKey = localStorage.getItem('sb_key') || '';
let bossPin = localStorage.getItem('boss_pin') || '0000';
let bossName = localStorage.getItem('boss_name') || '';
let businessName = localStorage.getItem('business_name') || '';

let allStores = [];
let allSnapshots = [];
let allAlerts = [];
let currentStoreId = null;
let currentAppTab = 'panel'; // Main app tabs: panel, cobrar, inventario, financiero, pos
let currentDetailTab = 'sales'; // Tabs inside store detail view
let currentDetailDate = new Date().toISOString().split('T')[0];
let currentProducts = []; // Para edición

let exchangeRate = parseFloat(localStorage.getItem('boss_exchange_rate')) || 42.50;
let euroRate = parseFloat(localStorage.getItem('boss_euro_rate')) || 1.08;

// PIN Logic
let enteredPin = '';
const pinDots = document.querySelectorAll('.pin-dot');

async function init() {
    try {
        const res = await fetch('/api/boss/config');
        const cfg = await res.json();
        if (cfg.supabaseUrl && cfg.supabaseKey) {
            supabaseUrl = cfg.supabaseUrl;
            supabaseKey = cfg.supabaseKey;
            localStorage.setItem('sb_url', supabaseUrl);
            localStorage.setItem('sb_key', supabaseKey);
        }
    } catch(e) {}

    if (!supabaseUrl || !supabaseKey) {
        document.getElementById('loading').style.display = 'none';
        toggleConfig();
    } else {
        checkAuth();
    }
}

function checkAuth() {
    if (!bossName || !businessName) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('setup-container').style.display = 'block';
        document.getElementById('pin-container').style.display = 'none';
    } else {
        document.getElementById('setup-container').style.display = 'none';
        document.getElementById('pin-container').style.display = 'flex';
        document.getElementById('login-greeting').innerText = `Hola, ${bossName}`;

        if (sessionStorage.getItem('boss_auth')) {
            showApp();
        } else {
            document.getElementById('loading').style.display = 'none';
        }
    }
}

window.saveBossSetup = function () {
    const n = document.getElementById('setup-boss-name').value.trim();
    const b = document.getElementById('setup-business-name').value.trim();
    if (!n || !b) {
        alert("Por favor completa los datos.");
        return;
    }
    bossName = n;
    businessName = b;
    localStorage.setItem('boss_name', bossName);
    localStorage.setItem('business_name', businessName);
    checkAuth();
}

document.getElementById('keypad').addEventListener('click', (e) => {
    const val = e.target.getAttribute('data-val');
    if (!val) return;

    if (val === 'del') {
        enteredPin = enteredPin.slice(0, -1);
    } else if (enteredPin.length < 4) {
        enteredPin += val;
    }

    updatePinDots();

    if (enteredPin.length === 4) {
        if (enteredPin === bossPin) {
            sessionStorage.setItem('boss_auth', 'true');
            showApp();
        } else {
            enteredPin = '';
            updatePinDots();
            alert('PIN Incorrecto');
        }
    }
});

function updatePinDots() {
    pinDots.forEach((dot, i) => {
        dot.classList.toggle('active', i < enteredPin.length);
    });
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('currency-bar').style.display = 'flex';

    if (bossName && businessName) {
        document.getElementById('banner-title').innerText = `Bienvenido, ${bossName}`;
        document.getElementById('banner-subtitle').innerText = `a ${businessName} — Tu resumen del día.`;
        // Update slogans in both headers
        const slogan = `Conectado a ${businessName}`;
        const s1 = document.getElementById('hdr-slogan');
        const s2 = document.getElementById('main-hdr-slogan');
        if (s1) s1.textContent = slogan;
        if (s2) s2.textContent = slogan;
    }

    loadDashboard();
}



// Data Fetching
async function sbGet(table, query = '') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return await res.json();
    } catch (e) {
        clearTimeout(timeoutId);
        console.error('Fetch error:', e);
        return [];
    }
}

async function loadDashboard() {
    const syncIcon = document.querySelector('.fa-sync-alt');
    if (syncIcon) syncIcon.classList.add('fa-spin');

    try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextDay = tomorrow.toISOString().split('T')[0];

        const [stores, snapshots, alerts, sales, expenses] = await Promise.all([
            sbGet('stores', '?order=name.asc'),
            sbGet('store_snapshots', `?date=eq.${today}&order=timestamp.desc`),
            sbGet('store_alerts', '?order=created_at.desc'),
            sbGet('store_sales', `?date=gte.${today}&date=lt.${nextDay}`),
            sbGet('store_expenses', `?date=eq.${today}`)
        ]);

        allStores = Array.isArray(stores) ? stores : [];
        allSnapshots = Array.isArray(snapshots) ? snapshots : [];
        allAlerts = Array.isArray(alerts) ? alerts : [];
        window.allSalesToday = Array.isArray(sales) ? sales : [];
        window.allExpensesToday = Array.isArray(expenses) ? expenses : [];

        // Update Currency Bar with latest data from stores
        if (allStores.length > 0) {
            const firstStore = allStores[0];
            // Assuming exchange_rate is stored in the store or snapshot
            // For now use the defaults or fetch from a config table if exists
            document.getElementById('rate-bcv').innerText = `Bs ${exchangeRate.toFixed(2)}`;
            document.getElementById('rate-eur').innerText = `Bs ${(exchangeRate * euroRate).toFixed(2)}`;
            document.getElementById('rate-mkt').innerText = `Bs ${(exchangeRate + 2).toFixed(2)}`;
        }

        renderStores();
        renderGlobal();

        // Cargar datos de otras pestañas si están activas
        if (currentAppTab === 'inventory') loadGlobalInventory();
        if (currentAppTab === 'financial') loadGlobalFinancial();

    } catch (e) {
        console.error('Error fetching data:', e);
    } finally {
        document.getElementById('loading').style.display = 'none';
        if (syncIcon) syncIcon.classList.remove('fa-spin');
    }
}



// Auto-refresh cada 60 segundos
setInterval(() => {
    if (document.getElementById('app').style.display === 'block' && !document.getElementById('detail-view').classList.contains('active')) {
        loadDashboard();
    }
}, 60000);

function renderStores(storesToRender = allStores) {
    const el = document.getElementById('stores-list');
    const countBadge = document.getElementById('stores-count');

    if (countBadge) countBadge.textContent = storesToRender.length;

    if (storesToRender.length === 0) {
        el.innerHTML = '<div class="empty">No hay sucursales que coincidan.</div>';
        return;
    }

    el.innerHTML = storesToRender.map(store => {
        const snap = allSnapshots.find(s => s.store_id === store.id);
        const isOnline = (Date.now() - new Date(store.last_seen).getTime()) < 120000;

        // CALCULAR MÉTRICAS EN TIEMPO REAL DESDE store_sales
        const storeSales = (window.allSalesToday || []).filter(s => s.store_id === store.id);
        const storeExpenses = (window.allExpensesToday || []).filter(e => e.store_id === store.id);
        const totalUSD = storeSales.reduce((acc, s) => acc + (Number(s.total_usd) || 0), 0);
        const totalExpUSD = storeExpenses.reduce((acc, e) => acc + (Number(e.amount_usd) || 0), 0);
        const tickets = storeSales.length;
        // Margen = Total - Costo - Gastos
        const totalCost = storeSales.reduce((acc, s) => acc + (Number(s.total_cost_usd) || 0), 0);
        const profit = totalUSD - totalCost - totalExpUSD;

        return `
        <div class="card" style="padding:16px; margin-bottom:12px; position:relative;" onclick="openDetail('${store.id}')">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="font-weight:900; font-size:16px;">${store.name}</div>
                <div style="font-size:9px; font-weight:900; color:${isOnline ? 'var(--primary)' : 'var(--text-muted)'}; text-transform:uppercase; display:flex; align-items:center; gap:4px;">
                    <div style="width:6px; height:6px; border-radius:50%; background:currentColor;"></div>
                    ${isOnline ? 'En Línea' : 'Desconectado'}
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
                <div style="text-align:center; background:var(--bg); border-radius:8px; padding:8px;">
                    <div style="font-size:16px; font-weight:900;">${fmtUSD(totalUSD)}</div>
                    <div style="font-size:8px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Ventas</div>
                </div>
                <div style="text-align:center; background:var(--bg); border-radius:8px; padding:8px;">
                    <div style="font-size:16px; font-weight:900;">${tickets}</div>
                    <div style="font-size:8px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Tickets</div>
                </div>
                <div style="text-align:center; background:var(--bg); border-radius:8px; padding:8px;">
                    <div style="font-size:16px; font-weight:900; color:var(--primary);">${fmtUSD(profit)}</div>
                    <div style="font-size:8px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Margen</div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function filterStores(query) {
    const q = query.toLowerCase().trim();
    const filtered = allStores.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (q === 'online' && (Date.now() - new Date(s.last_seen).getTime()) < 120000) ||
        (q === 'offline' && (Date.now() - new Date(s.last_seen).getTime()) >= 120000)
    );
    renderStores(filtered);
}

function renderGlobal() {
    // Solo tomar el último snapshot de cada sucursal para no sumar duplicados
    const latestSnaps = [];
    allStores.forEach(store => {
        const storeSnaps = allSnapshots.filter(s => s.store_id === store.id);
        if (storeSnaps.length > 0) {
            latestSnaps.push(storeSnaps[0]);
        }
    });

    // CALCULAR TOTALES GLOBALES DESDE store_sales PARA TIEMPO REAL
    const totalUSD = (window.allSalesToday || []).reduce((acc, s) => acc + (Number(s.total_usd) || 0), 0);
    const totalTickets = (window.allSalesToday || []).length;

    const totalSalesProfit = (window.allSalesToday || []).reduce((acc, s) => acc + (Number(s.total_usd) || 0) - (Number(s.total_cost_usd) || 0), 0);
    const totalExpenses = (window.allExpensesToday || []).reduce((acc, e) => acc + (Number(e.amount_usd) || 0), 0);
    const totalProfit = totalSalesProfit - totalExpenses;
    const avgTicket = totalTickets > 0 ? totalUSD / totalTickets : 0;

    // Desglose de pagos basado en allSalesToday
    let cash = 0, zelle = 0, pm = 0, card = 0;
    if (window.allSalesToday) {
        window.allSalesToday.forEach(s => {
            const m = String(s.method || '').toLowerCase();
            const valUSD = Number(s.total_usd) || 0;
            const valVES = Number(s.total_ves) || (valUSD * exchangeRate);

            if (m.includes('cash-usd') || m === 'cash' || m === 'zelle') {
                cash += valUSD;
            } else if (m.includes('pago-movil') || m === 'pm' || m === 'pago_movil') {
                pm += valVES;
            } else if (m.includes('card') || m.includes('punto')) {
                card += valVES;
            } else if (m.includes('cash-ves')) {
                cash += valUSD; // O podrías sumarlo a una categoría de BS
            }
        });
    }

    // Stock bajo global (productos con stock <= 5 del allSnapshots o store_products)
    const lowStockCount = latestSnaps.reduce((acc, s) => acc + (Number(s.low_stock_count) || 0), 0);

    // Actualizar barra rápida
    document.getElementById('g-total').innerText = fmtUSD(totalUSD);
    document.getElementById('g-tickets').innerText = totalTickets.toLocaleString();
    if (document.getElementById('g-cash')) document.getElementById('g-cash').innerText = fmtUSD(cash);
    if (document.getElementById('g-zelle')) document.getElementById('g-zelle').innerText = fmtUSD(zelle);
    if (document.getElementById('g-pm')) document.getElementById('g-pm').innerText = 'Bs ' + pm.toLocaleString('es-VE', { minimumFractionDigits: 0 });

    // Actualizar tarjetas del bento grid
    if (document.getElementById('g-monthly')) document.getElementById('g-monthly').innerText = fmtUSD(totalUSD);
    if (document.getElementById('g-profit')) {
        const profitEl = document.getElementById('g-profit');
        profitEl.innerText = fmtUSD(totalProfit);
        profitEl.style.color = totalProfit >= 0 ? 'var(--primary)' : 'var(--error)';
    }
    if (document.getElementById('g-avg-ticket')) document.getElementById('g-avg-ticket').innerText = fmtUSD(avgTicket);
    if (document.getElementById('g-low-stock')) {
        const el = document.getElementById('g-low-stock');
        el.innerText = lowStockCount;
        el.style.color = lowStockCount > 0 ? 'var(--error)' : 'var(--primary)';
    }

    // -------------------------------------------------------------
    // GENERAR ESTADÍSTICAS GENERALES (BENTO GRID)
    // -------------------------------------------------------------
    const statsContainer = document.getElementById('global-stats-container');
    if (statsContainer && window.allSalesToday) {
        const sales = window.allSalesToday;

        // 1. Agrupar Ventas por Hora (6am a 10pm)
        const hoursMap = {};
        for (let i = 6; i <= 22; i++) hoursMap[i] = 0;

        sales.forEach(s => {
            if (!s.date) return;
            try {
                const dateObj = new Date(s.date);
                const h = dateObj.getHours();
                if (h >= 6 && h <= 22) {
                    hoursMap[h] += Number(s.total_usd) || 0;
                }
            } catch (e) { }
        });

        let maxHourVal = 0;
        let peakHour = 12;
        Object.keys(hoursMap).forEach(h => {
            if (hoursMap[h] > maxHourVal) { maxHourVal = hoursMap[h]; peakHour = h; }
        });

        const peakHourLabel = `${peakHour}:00 - ${parseInt(peakHour) + 1}:00`;

        const hourBars = Object.keys(hoursMap).map(h => {
            const val = hoursMap[h];
            const pct = maxHourVal > 0 ? (val / maxHourVal) * 100 : 0;
            const isPeak = (h == peakHour);
            const hourLabel = h > 12 ? (h - 12) + 'p' : (h == 12 ? '12p' : '');
            return `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; group">
                <div style="height:${pct}%; width:100%; max-width:24px; background:${isPeak ? 'var(--primary)' : 'var(--primary-light)'}; border-radius:4px 4px 0 0; min-height:4px; position:relative;" title="${val.toFixed(2)}$"></div>
                <div style="font-size:8px; color:var(--text-muted);">${hourLabel}</div>
            </div>`;
        }).join('');

        // 2. Desglose de Métodos de Pago
        const methodTotal = cash + zelle + (pm / exchangeRate);
        const methodsData = [
            { name: 'Efectivo', val: cash, color: '#10b981' },
            { name: 'Zelle', val: zelle, color: '#8b5cf6' },
            { name: 'Pago Móvil', val: pm / exchangeRate, color: '#0ea5e9' }
        ].sort((a, b) => b.val - a.val);

        const methodBars = methodsData.map(m => {
            const pct = methodTotal > 0 ? ((m.val / methodTotal) * 100).toFixed(0) : 0;
            return `
            <div style="margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; margin-bottom:4px;">
                    <span>${m.name}</span>
                    <div>
                        <span>${fmtUSD(m.val)}</span>
                        <span style="font-size:10px;color:var(--text-muted);margin-left:6px;">${pct}%</span>
                    </div>
                </div>
                <div style="height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:${m.color}; border-radius:4px; transition:width 0.6s;"></div>
                </div>
            </div>`;
        }).join('');

        // 3. Top Productos Generales
        const prodCount = {};
        sales.forEach(s => {
            let items = s.items;
            if (typeof items === 'string') {
                try { items = JSON.parse(items); } catch (e) { items = []; }
            }
            if (Array.isArray(items)) {
                items.forEach(i => {
                    const name = i.name || 'Desconocido';
                    prodCount[name] = (prodCount[name] || 0) + (Number(i.qty) || 1);
                });
            }
        });

        const sortedProds = Object.entries(prodCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const prodsHtml = sortedProds.length === 0 ? '<div class="empty">Sin datos de ventas aún.</div>' : sortedProds.map(([name, qty], idx) => {
            const colors = ['#f59e0b', '#94a3b8', '#cd7f32', '#64748b', '#94a3b8'];
            const color = colors[idx] || '#cbd5e1';
            return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--outline);">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:24px; height:24px; border-radius:50%; background:${color}20; color:${color}; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900;">${idx + 1}</div>
                    <div style="font-size:12px; font-weight:700; color:var(--text); text-transform:uppercase; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
                </div>
                <div style="font-size:12px; font-weight:900; color:var(--primary);">${qty} <span style="font-size:9px; color:var(--text-muted); font-weight:600;">unds</span></div>
            </div>`;
        }).join('');

        statsContainer.innerHTML = `
            <!-- Gráfica por hora Global -->
            <div class="card" style="margin-bottom:16px; padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <div style="font-size:14px; font-weight:800;"><i class="fas fa-chart-bar" style="color:var(--primary); margin-right:8px;"></i>Ventas Globales por Hora</div>
                    <div style="font-size:10px; font-weight:700; background:var(--primary-light); color:var(--primary); padding:3px 10px; border-radius:12px;">Pico: ${peakHourLabel}</div>
                </div>
                <div style="display:flex; align-items:flex-end; gap:3px; height:100px; border-bottom:1px solid var(--outline); padding-bottom:4px;">
                    ${hourBars}
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr; gap:16px; margin-bottom:24px;">
                <!-- Distribución de pagos Global -->
                <div class="card" style="margin-bottom:0; padding:16px;">
                    <div style="font-size:14px; font-weight:800; margin-bottom:16px;">
                        <i class="fas fa-chart-pie" style="color:var(--primary); margin-right:8px;"></i>Distribución Global de Pagos
                    </div>
                    ${methodBars}
                </div>

                <!-- Top productos Global -->
                <div class="card" style="margin-bottom:0; padding:16px;">
                    <div style="font-size:14px; font-weight:800; margin-bottom:16px;">
                        <i class="fas fa-crown" style="color:#f59e0b; margin-right:8px;"></i>Top Productos (Todas las Sucursales)
                    </div>
                    ${prodsHtml}
                </div>
            </div>
        `;
    }
}

// Config Functions
function toggleConfig() {
    const modal = document.getElementById('config-modal');
    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
        document.getElementById('cfg-url').value = supabaseUrl;
        document.getElementById('cfg-key').value = supabaseKey;
        document.getElementById('cfg-pin').value = bossPin;
    }
}

function saveConfig() {
    supabaseUrl = document.getElementById('cfg-url').value.trim();
    supabaseKey = document.getElementById('cfg-key').value.trim();
    bossPin = document.getElementById('cfg-pin').value.trim();

    localStorage.setItem('sb_url', supabaseUrl);
    localStorage.setItem('sb_key', supabaseKey);
    localStorage.setItem('boss_pin', bossPin);

    alert('Configuración guardada');
    location.reload();
}

// ==========================================
// NAVEGACIÓN PRINCIPAL (BOTTOM NAV)
// ==========================================
window.switchMainTab = function (tabId, el) {
    currentAppTab = tabId;

    // UI: Cambiar pestaña activa en el nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (el) el.classList.add('active');

    // UI: Cambiar vista visible
    document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));
    const targetView = document.getElementById(`view-${tabId}`);
    if (targetView) targetView.classList.remove('hidden');

    // Cambiar Título del Header
    const titles = {
        'panel': 'Panel de Control',
        'inventory': 'Inventario Global',
        'financial': 'Balance General',
        'pos': 'Cajas en Vivo'
    };
    document.getElementById('header-title').textContent = titles[tabId] || 'Punto Pila';

    // Cargar datos específicos
    if (tabId === 'inventory') loadGlobalInventory();
    if (tabId === 'financial') loadGlobalFinancial();
    if (tabId === 'pos') loadLiveState();
};

// Navigation
function openDetail(storeId) {
    currentStoreId = storeId;
    currentDetailDate = new Date().toISOString().split('T')[0];
    const store = allStores.find(s => s.id === storeId);
    document.getElementById('detail-title').textContent = store.name;
    document.getElementById('detail-view').classList.add('active');
    setTab('sales');
}

function closeDetail() {
    document.getElementById('detail-view').classList.remove('active');
}

async function setTab(tab) {
    currentTab = tab;
    document.getElementById('tab-sales').classList.toggle('active', tab === 'sales');
    document.getElementById('tab-inventory').classList.toggle('active', tab === 'inventory');
    const perfTab = document.getElementById('tab-performance');
    if (perfTab) perfTab.classList.toggle('active', tab === 'performance');

    const content = document.getElementById('detail-content');
    content.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';

    const datePickerHtml = (tab === 'sales' || tab === 'performance') ? `
        <div style="margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; background: var(--bg); padding: 12px; border-radius: 12px; border: 1px solid var(--outline);">
            <div style="font-size: 13px; font-weight: 800; color: var(--text-muted);">
                <i class="fas fa-calendar-alt" style="margin-right: 6px;"></i> Fecha:
            </div>
            <input type="date" value="${currentDetailDate}" 
                   onchange="currentDetailDate = this.value; setTab('${tab}')"
                   style="border: none; background: #fff; padding: 6px 12px; border-radius: 8px; font-family: inherit; font-weight: 700; color: var(--text); outline: none; border: 1px solid var(--outline); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
        </div>
    ` : '';

    if (tab === 'sales') {
        const nextDate = new Date(currentDetailDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];
        const sales = await sbGet('store_sales', `?store_id=eq.${currentStoreId}&date=gte.${currentDetailDate}&date=lt.${nextDateStr}&order=timestamp.desc`);
        let htmlStr = '';
        if (!Array.isArray(sales) || sales.length === 0) {
            htmlStr = '<div class="empty">No hay ventas registradas en esta fecha.</div>';
        } else {
            htmlStr = sales.map(s => {
                let itemsList = s.items_json;
                if (typeof itemsList === 'string') { try { itemsList = JSON.parse(itemsList); } catch (e) { } }
                const itemsStr = Array.isArray(itemsList) ? itemsList.map(i => `${i.qty || i.quantity || 1}x ${i.name}`).join(', ') : 'Varios items';
                const ves = s.total_ves || (s.total_usd * (s.exchange_rate || exchangeRate));
                const eur = s.total_usd / euroRate;
                const rate = s.exchange_rate || exchangeRate;

                return `
                <div class="card" style="padding:16px; margin-bottom:12px;">
                     <!-- Cabecera del ticket -->
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                        <div>
                            <div style="font-size:14px;font-weight:900;color:var(--primary);">Ticket #${s.ticket}</div>
                            ${s.client ? `<div style="font-size:12px;font-weight:700;color:var(--text);margin-top:2px;"><i class="fas fa-user" style="font-size:10px;color:var(--text-muted);"></i> ${s.client}</div>` : ''}
                            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${itemsStr}</div>
                            <div style="font-size:10px;color:var(--text-muted);margin-top:4px;"><i class="fas fa-clock"></i> ${new Date(s.date).toLocaleString()}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:22px;font-weight:900;color:var(--text);">${fmtUSD(s.total_usd)}</div>
                            <div style="margin-top:6px;">${fmtMethod(s.method)}</div>
                        </div>
                    </div>
                    <!-- Desglose multi-moneda -->
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-top:12px;border-top:1px dashed var(--outline);">
                        <div style="text-align:center;background:#f8fafc;border-radius:8px;padding:8px;">
                            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;font-weight:800;margin-bottom:3px;">Bolívares</div>
                            <div style="font-size:12px;font-weight:900;color:var(--secondary);">Bs ${Number(ves).toLocaleString('es-VE', { minimumFractionDigits: 0 })}</div>
                        </div>
                        <div style="text-align:center;background:#f8fafc;border-radius:8px;padding:8px;">
                            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;font-weight:800;margin-bottom:3px;">Euros</div>
                            <div style="font-size:12px;font-weight:900;">${eur.toFixed(2)}€</div>
                        </div>
                        <div style="text-align:center;background:#f8fafc;border-radius:8px;padding:8px;">
                            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;font-weight:800;margin-bottom:3px;">Tasa</div>
                            <div style="font-size:12px;font-weight:900;color:var(--primary);">Bs ${rate.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
            `}).join('');
        }
        content.innerHTML = datePickerHtml + htmlStr;
    } else if (tab === 'performance') {
        const nextDate = new Date(currentDetailDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        const [snaps, sales, expenses] = await Promise.all([
            sbGet('store_snapshots', `?store_id=eq.${currentStoreId}&date=gte.${currentDetailDate}&date=lt.${nextDateStr}&order=timestamp.desc&limit=1`),
            sbGet('store_sales', `?store_id=eq.${currentStoreId}&date=gte.${currentDetailDate}&date=lt.${nextDateStr}`),
            sbGet('store_expenses', `?store_id=eq.${currentStoreId}&date=gte.${currentDetailDate}&date=lt.${nextDateStr}`)
        ]);

        const snap = snaps[0] || {};

        // Top productos
        const topProds = {};
        // Métodos de pago + horas
        const methodsMap = {};
        const hoursMap = {};
        let totalUSD = 0;

        sales.forEach(s => {
            const m = s.method || 'otro';
            const val = Number(s.total_usd || 0);
            methodsMap[m] = (methodsMap[m] || 0) + val;
            totalUSD += val;

            // Hora de la venta — timestamp o date
            const rawTs = s.timestamp || s.date;
            const hour = rawTs ? new Date(rawTs).getHours() : 0;
            hoursMap[hour] = (hoursMap[hour] || 0) + val;

            let items = s.items_json;
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { } }
            if (Array.isArray(items)) {
                items.forEach(i => {
                    const name = i.name || 'Producto';
                    const qty = Number(i.qty || i.quantity || 1);
                    topProds[name] = (topProds[name] || 0) + qty;
                });
            }
        });

        const sortedProds = Object.entries(topProds).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxProd = sortedProds[0]?.[1] || 1;
        const avgTicket = sales.length > 0 ? (totalUSD / sales.length) : 0;
        const peakHourEntry = Object.entries(hoursMap).sort((a, b) => b[1] - a[1])[0];
        const peakHourLabel = peakHourEntry ? `${peakHourEntry[0]}:00` : '--:--';

        const totalExpUSD = Array.isArray(expenses) ? expenses.reduce((acc, e) => acc + (Number(e.amount_usd) || 0), 0) : 0;
        const totalSalesCost = sales.reduce((acc, s) => acc + (Number(s.total_cost_usd) || 0), 0);
        // El beneficio real se calcula restando el costo de las ventas y los gastos.
        // Se hace un max con snap.profit_usd por si el costo en las ventas en vivo falta, 
        // pero idealmente es totalUSD - totalSalesCost - totalExpUSD.
        let calcProfit = totalUSD - totalSalesCost;
        if (calcProfit <= 0 && snap.profit_usd) calcProfit = snap.profit_usd;
        const realProfit = calcProfit - totalExpUSD;

        // Gráfica de barras por hora (6am - 10pm)
        const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6 a 22
        const maxHourVal = Math.max(...hours.map(h => hoursMap[h] || 0), 0.01);
        const hourBars = hours.map(h => {
            const val = hoursMap[h] || 0;
            const pct = Math.round((val / maxHourVal) * 100);
            const isPeak = peakHourEntry && parseInt(peakHourEntry[0]) === h;
            return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
                <div style="font-size:9px;font-weight:800;color:${val > 0 ? 'var(--primary)' : 'var(--text-muted)'};">
                    ${val > 0 ? '$' + val.toFixed(0) : ''}
                </div>
                <div style="width:100%;height:70px;display:flex;align-items:flex-end;justify-content:center;">
                    <div style="width:80%;background:${isPeak ? 'var(--primary)' : '#d1fae5'};height:${Math.max(pct, 2)}%;border-radius:4px 4px 0 0;transition:height 0.4s;min-height:3px;"></div>
                </div>
                <div style="font-size:8px;font-weight:700;color:var(--text-muted);">${h}h</div>
            </div>`;
        }).join('');

        // Barras de métodos de pago
        const methodColors = {
            'cash': '#10b981', 'cash-usd': '#10b981', 'efectivo': '#10b981',
            'zelle': '#3b82f6',
            'pm': '#f59e0b', 'pago_movil': '#f59e0b', 'pago-movil': '#f59e0b',
            'card': '#8b5cf6', 'tarjeta': '#8b5cf6'
        };
        const methodNames = {
            'cash': 'Efectivo $', 'cash-usd': 'Efectivo $', 'efectivo': 'Efectivo',
            'zelle': 'Zelle', 'pm': 'Pago Móvil', 'pago_movil': 'Pago Móvil',
            'pago-movil': 'Pago Móvil', 'card': 'Tarjeta', 'tarjeta': 'Tarjeta'
        };
        const sortedMethods = Object.entries(methodsMap).sort((a, b) => b[1] - a[1]);
        const maxMethod = sortedMethods[0]?.[1] || 1;

        const methodBars = sortedMethods.length === 0
            ? '<div class="empty">Sin datos de pagos aún.</div>'
            : sortedMethods.map(([m, val]) => {
                const pct = Math.round((val / totalUSD) * 100);
                const color = methodColors[m] || '#6b7280';
                const name = methodNames[m] || m;
                return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:10px;height:10px;border-radius:50%;background:${color};"></div>
                            <span style="font-size:13px;font-weight:700;">${name}</span>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:13px;font-weight:900;color:${color};">${fmtUSD(val)}</span>
                            <span style="font-size:10px;color:var(--text-muted);margin-left:6px;">${pct}%</span>
                        </div>
                    </div>
                    <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.6s;"></div>
                    </div>
                </div>`;
            }).join('');

        content.innerHTML = datePickerHtml + `
            <!-- KPIs row -->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:14px;text-align:center;">
                    <div style="font-size:9px;font-weight:800;color:#059669;text-transform:uppercase;letter-spacing:1px;">Ventas Hoy</div>
                    <div style="font-size:22px;font-weight:900;color:#10b981;margin:4px 0;">${fmtUSD(totalUSD)}</div>
                    <div style="font-size:10px;color:#6ee7b7;">${sales.length} tickets</div>
                </div>
                <div style="background:#f8fafc;border:1px solid var(--outline);border-radius:14px;padding:14px;text-align:center;">
                    <div style="font-size:9px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Ganancia Est.</div>
                    <div style="font-size:22px;font-weight:900;color:var(--text);margin:4px 0;">${fmtUSD(realProfit)}</div>
                    <div style="font-size:10px;color:var(--text-muted);">Ticket prom. ${fmtUSD(avgTicket)}</div>
                </div>
            </div>

            <!-- Gráfica por hora -->
            <div class="card" style="margin-bottom:16px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="font-size:14px;font-weight:800;"><i class="fas fa-chart-bar" style="color:var(--primary);margin-right:8px;"></i>Ventas por Hora</div>
                    <div style="font-size:10px;font-weight:700;background:var(--primary-light);color:var(--primary);padding:3px 10px;border-radius:12px;">Pico: ${peakHourLabel}</div>
                </div>
                <div style="display:flex;align-items:flex-end;gap:3px;height:100px;border-bottom:1px solid var(--outline);padding-bottom:4px;">
                    ${hourBars}
                </div>
            </div>

            <!-- Distribución de pagos -->
            <div class="card" style="margin-bottom:16px;padding:16px;">
                <div style="font-size:14px;font-weight:800;margin-bottom:16px;">
                    <i class="fas fa-chart-pie" style="color:var(--primary);margin-right:8px;"></i>Distribución de Pagos
                </div>
                ${methodBars}
            </div>

            <!-- Top productos -->
            <div class="card" style="margin-bottom:16px;padding:16px;">
                <div style="font-size:14px;font-weight:800;margin-bottom:16px;">
                    <i class="fas fa-crown" style="color:#f59e0b;margin-right:8px;"></i>Top Productos Hoy
                </div>
                ${sortedProds.length === 0
                ? '<div class="empty">Sin datos de ventas aún.</div>'
                : sortedProds.map(([name, qty], idx) => {
                    const pct = Math.round((qty / maxProd) * 100);
                    const rankColors = ['#f59e0b', '#94a3b8', '#cd7f32', '#6b7280', '#6b7280'];
                    return `
                        <div style="margin-bottom:14px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <span style="font-size:13px;font-weight:900;color:${rankColors[idx]};width:18px;">#${idx + 1}</span>
                                    <span style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${name}</span>
                                </div>
                                <span style="font-size:12px;font-weight:900;background:var(--primary-light);color:var(--primary);padding:3px 10px;border-radius:12px;white-space:nowrap;">${qty} und</span>
                            </div>
                            <div style="height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
                                <div style="height:100%;width:${pct}%;background:var(--primary);border-radius:3px;"></div>
                            </div>
                        </div>`;
                }).join('')}
            </div>

            <!-- Gastos -->
            <div class="card" style="margin-bottom:16px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="font-size:14px;font-weight:800;"><i class="fas fa-receipt" style="color:var(--error);margin-right:8px;"></i>Gastos del Día</div>
                    <button onclick="showExpenseForm()" style="background:var(--error);color:#fff;border:none;border-radius:10px;padding:6px 14px;font-size:12px;font-weight:800;cursor:pointer;">
                        <i class="fas fa-plus"></i> Añadir
                    </button>
                </div>
                <div id="expense-form" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px;margin-bottom:14px;">
                    <div style="margin-bottom:10px;">
                        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Tipo de Gasto</label>
                        <select id="expense-type" style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;background:#fff;">
                            <option value="alquiler">🏠 Alquiler</option>
                            <option value="servicios">💡 Servicios</option>
                            <option value="nomina">👷 Nómina / Personal</option>
                            <option value="proveedor">📦 Proveedores / Mercancía</option>
                            <option value="transporte">🚗 Transporte</option>
                            <option value="mantenimiento">🔧 Mantenimiento</option>
                            <option value="marketing">📢 Marketing</option>
                            <option value="impuesto">📋 Impuestos</option>
                            <option value="otro">📌 Otro</option>
                        </select>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Descripción</label>
                        <input id="expense-desc" type="text" placeholder="Ej: Pago mes de mayo..." style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;">
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
                        <div>
                            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Método de Pago</label>
                            <select id="expense-method" style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;background:#fff;">
                                <option value="efectivo">💵 Efectivo USD</option>
                                <option value="efectivo-bs">💵 Efectivo Bs</option>
                                <option value="pago-movil">📱 Pago Móvil</option>
                                <option value="zelle">⚡ Zelle</option>
                                <option value="transferencia">🏦 Transferencia</option>
                                <option value="tarjeta">💳 Punto de Venta</option>
                                <option value="otro">📌 Otro</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Nro. Referencia (Opcional)</label>
                            <input id="expense-ref" type="text" placeholder="Ej: 123456" style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;">
                        </div>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Responsable / Autorizado por</label>
                        <input id="expense-resp" type="text" placeholder="Ej: Carlos" style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;">
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
                        <div>
                            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Monto USD</label>
                            <input id="expense-usd" type="number" step="0.01" max="9999999" placeholder="0.00" style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;">
                        </div>
                        <div>
                            <label style="font-size:11px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;">Monto Bs</label>
                            <input id="expense-ves" type="number" step="1" max="99999999" placeholder="0" style="width:100%;padding:10px;border:1px solid var(--outline);border-radius:8px;font-size:14px;font-family:inherit;">
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button onclick="saveExpense('${currentStoreId}')" style="flex:1;background:var(--error);color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:800;cursor:pointer;">Guardar Gasto</button>
                        <button onclick="document.getElementById('expense-form').style.display='none'" style="background:var(--outline);color:var(--text);border:none;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;">Cancelar</button>
                    </div>
                </div>
                <div id="expense-list"><div class="empty">Cargando gastos...</div></div>
            </div>
        `;
        loadExpenses(currentStoreId);
    } else {

        currentProducts = await sbGet('store_products', `?store_id=eq.${currentStoreId}&order=name.asc`);
        if (!Array.isArray(currentProducts) || currentProducts.length === 0) {
            content.innerHTML = '<div class="empty">No hay productos sincronizados o faltan tablas.</div>';
        } else {
            content.innerHTML = `
        <div style="margin-bottom:16px">
            <div style="position:relative">
                <i class="fas fa-search" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:13px"></i>
                <input 
                    type="text" 
                    id="inv-search" 
                    placeholder="Buscar producto..." 
                    oninput="filterInventory(this.value)"
                    style="width:100%;padding:12px 14px 12px 40px;background:#f8fafc;border:1px solid var(--outline);border-radius:12px;font-size:14px;box-sizing:border-box;"
                >
            </div>
        </div>
        <div id="inv-grid">
            ${renderInventoryCards(currentProducts)}
        </div>`;
        }

    }
}

// Tasa de cambio configurada desde arriba
// (eliminadas declaraciones duplicadas)


function renderInventoryCards(products) {
    return products.map(p => {
        const stockColor = p.stock <= 0 ? 'var(--error)' : p.stock <= 5 ? '#f59e0b' : 'var(--primary)';
        const stockBg = p.stock <= 0 ? '#fef2f2' : p.stock <= 5 ? '#fffbeb' : '#f0fdf4';
        const stockLabel = p.stock <= 0 ? 'Sin stock' : p.stock <= 5 ? 'Stock bajo' : 'En stock';
        return `
        <div style="display:flex; align-items:center; gap:14px; padding:14px 0; border-bottom:1px solid var(--outline);">
            <!-- Icono o imagen pequeña -->
            <div style="width:44px; height:44px; border-radius:10px; background:#f1f5f9; flex-shrink:0; overflow:hidden; display:flex; align-items:center; justify-content:center; font-size:18px;">
                ${p.img_url
                ? `<img src="${p.img_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-box&quot; style=&quot;color:#94a3b8&quot;></i>'">`
                : '<i class="fas fa-box" style="color:#94a3b8"></i>'}
            </div>
            <!-- Info -->
            <div style="flex:1; min-width:0;">
                <div style="font-weight:800; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-top:2px;">${p.category || 'General'}</div>
                <div style="display:flex; gap:8px; margin-top:6px; align-items:center;">
                    <span style="font-size:13px; font-weight:900; color:var(--primary);">${fmtUSD(p.price || 0)}</span>
                    ${p.price_ves > 0 ? `<span style="font-size:11px; color:var(--text-muted); font-weight:700;">Bs ${Number(p.price_ves).toLocaleString('es-VE', { minimumFractionDigits: 0 })}</span>` : ''}
                </div>
            </div>
            <!-- Stock + Acciones -->
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0;">
                <div style="background:${stockBg}; color:${stockColor}; font-size:11px; font-weight:900; padding:4px 10px; border-radius:20px; white-space:nowrap;">
                    ${p.stock ?? 0} uds
                </div>
                <div style="font-size:9px; color:${stockColor}; font-weight:700;">${stockLabel}</div>
                <button onclick="openEditModal('${p.product_id}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px; font-size:15px; line-height:1;">
                    <i class="fas fa-pen"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');
}

function filterInventory(query) {
    const grid = document.getElementById('inv-grid');
    if (!grid || !currentProducts) return;
    const q = query.toLowerCase().trim();
    const filtered = q
        ? currentProducts.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
        : currentProducts;
    grid.innerHTML = filtered.length > 0
        ? renderInventoryCards(filtered)
        : `<div class="empty" style="grid-column:1/-1">Sin resultados para "${query}"</div>`;
}

function openEditModal(productId) {
    let product = (window.currentProducts || []).find(p => p.product_id === productId);
    if (!product && window.allGlobalProducts) {
        product = window.allGlobalProducts.find(p => p.product_id === productId);
    }
    if (!product) return;

    currentStoreId = product.store_id;

    document.getElementById('edit-product-id').value = productId;
    document.getElementById('edit-product-title').innerText = `Editar: ${product.name}`;

    // Badges informativos
    document.getElementById('edit-current-stock').textContent = product.stock ?? '—';
    document.getElementById('edit-current-id').textContent = productId;

    // Precios
    const usd = product.price || 0;
    const ves = product.price_ves || (usd * exchangeRate) || 0;
    const eur = usd > 0 ? (usd / euroRate).toFixed(2) : 0;

    document.getElementById('edit-product-usd').value = usd;
    document.getElementById('edit-product-ves').value = ves;
    document.getElementById('edit-product-eur').value = eur;
    document.getElementById('edit-product-stock').value = product.stock || 0;
    document.getElementById('edit-product-img').value = product.img_url || '';
    document.getElementById('edit-product-promo').value = product.promo_price || '';
    document.getElementById('edit-product-variants').value = product.variants || '';
    document.getElementById('edit-product-expiry').value = product.expiry_date || '';

    updateConversionHint();
    document.getElementById('edit-product-modal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('edit-product-modal').classList.remove('active');
}

function updateConversionHint() {
    const usd = parseFloat(document.getElementById('edit-product-usd').value) || 0;
    const ves = parseFloat(document.getElementById('edit-product-ves').value) || 0;
    const eur = parseFloat(document.getElementById('edit-product-eur').value) || 0;
    const hint = document.getElementById('edit-conversion-hint');
    const vesFmt = ves > 0 ? `Bs ${ves.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : 'Bs —';
    const eurFmt = eur > 0 ? `${eur.toFixed(2)} €` : '— €';
    const usdFmt = usd > 0 ? `$${usd.toFixed(2)}` : '';
    hint.textContent = `${vesFmt}${usdFmt ? ' | ' + usdFmt : ''} | ${eurFmt}`;
}

function autoCalcVES() {
    const usd = parseFloat(document.getElementById('edit-product-usd').value) || 0;
    if (usd > 0) {
        document.getElementById('edit-product-ves').value = (usd * exchangeRate).toFixed(2);
        updateConversionHint();
    }
}

function autoCalcUSD() {
    const ves = parseFloat(document.getElementById('edit-product-ves').value) || 0;
    if (ves > 0 && exchangeRate > 0) {
        document.getElementById('edit-product-usd').value = (ves / exchangeRate).toFixed(2);
        updateConversionHint();
    }
}

function autoCalcEUR() {
    const usd = parseFloat(document.getElementById('edit-product-usd').value) || 0;
    if (usd > 0) {
        document.getElementById('edit-product-eur').value = (usd / euroRate).toFixed(2);
        updateConversionHint();
    }
}

async function saveProductEdits() {
    const productId = document.getElementById('edit-product-id').value;
    const priceUSD = parseFloat(document.getElementById('edit-product-usd').value) || 0;
    const priceVES = parseFloat(document.getElementById('edit-product-ves').value) || 0;
    const priceEUR = parseFloat(document.getElementById('edit-product-eur').value) || 0;
    const promoPrice = parseFloat(document.getElementById('edit-product-promo').value) || 0;
    const stock = parseInt(document.getElementById('edit-product-stock').value) || 0;
    const imgUrl = document.getElementById('edit-product-img').value.trim();
    const variants = document.getElementById('edit-product-variants').value.trim();
    const expiry = document.getElementById('edit-product-expiry').value.trim();

    if (!productId || !currentStoreId) {
        console.error('[BOSS-SYNC] ❌ Falta productId o currentStoreId', { productId, currentStoreId });
        alert('Error: no hay producto o sucursal seleccionada.');
        return;
    }

    console.log(`[BOSS-SYNC] 🚀 Iniciando guardado para: ${productId} en sucursal: ${currentStoreId}`);
    const btn = document.getElementById('btn-save-product');
    btn.innerText = 'Guardando...';
    btn.disabled = true;

    const cmd = {
        store_id: currentStoreId,
        command_type: 'UPDATE_PRODUCT_FULL',
        payload: {
            product_id: productId,
            new_price_usd: priceUSD,
            new_price_ves: priceVES,
            new_price_eur: priceEUR,
            new_promo_price: promoPrice,
            new_stock: stock,
            new_img: imgUrl,
            new_variants: variants,
            new_expiry: expiry
        },
        status: 'pending'
    };

    try {
        // 1. Enviar comando remoto al POS
        console.log('[BOSS-SYNC] 📤 Enviando comando a store_commands...', cmd);
        const cmdRes = await fetch(`${supabaseUrl}/rest/v1/store_commands`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(cmd)
        });

        if (!cmdRes.ok) {
            const errText = await cmdRes.text();
            console.error('[BOSS-SYNC] ❌ Error POST store_commands:', errText);
            alert('Error al enviar comando al POS: ' + errText);
            return;
        }
        console.log('[BOSS-SYNC] ✅ Comando registrado en nube.');

        // 2. Actualizar store_products DIRECTAMENTE en Supabase
        const rowId = `${currentStoreId}_${productId}`;
        console.log(`[BOSS-SYNC] ☁️ Actualizando store_products para rowId: ${rowId}`);

        const patchBody = {
            price: priceUSD,
            price_ves: priceVES,
            price_eur: priceEUR,
            promo_price: promoPrice,
            stock: stock,
            variants: variants,
            expiry_date: expiry,
            updated_at: new Date().toISOString()
        };
        if (imgUrl) patchBody.img_url = imgUrl;

        const patchRes = await fetch(`${supabaseUrl}/rest/v1/store_products?id=eq.${encodeURIComponent(rowId)}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(patchBody)
        });

        if (!patchRes.ok) {
            const patchErr = await patchRes.text();
            console.error('[BOSS-SYNC] ❌ Error PATCH store_products:', patchErr);
            if (patchErr.includes('column') && patchErr.includes('does not exist')) {
                alert('⚠️ Error de Base de Datos: Faltan columnas en la tabla "store_products".\n\nPor favor, ejecuta el SQL de actualización en tu panel de Supabase.');
            } else {
                alert('Error al sincronizar con la nube: ' + patchErr);
            }
            return;
        }

        const patchedData = await patchRes.json();
        console.log('[BOSS-SYNC] ✅ Fila actualizada en Supabase:', patchedData);

        if (patchedData.length === 0) {
            console.warn(`[BOSS-SYNC] ⚠️ CUIDADO: El PATCH fue exitoso (200 OK) pero NO se actualizó ninguna fila. ¿Existe el ID ${rowId}?`);
            alert('Atención: El producto se guardó pero no se encontró la fila correspondiente en la nube. Verifica que la sucursal esté sincronizada.');
        }


        // 3. Actualizar array local para que el modal refleje datos correctos
        const localProd = (currentProducts || []).find(p => p.product_id === productId);
        if (localProd) {
            localProd.price = priceUSD;
            localProd.price_ves = priceVES;
            localProd.price_eur = priceEUR;
            localProd.promo_price = promoPrice;
            localProd.stock = stock;
            localProd.variants = variants;
            localProd.expiry_date = expiry;
            if (imgUrl) localProd.img_url = imgUrl;
        }

        // También actualizar en allGlobalProducts si existe
        if (window.allGlobalProducts) {
            const globalProd = window.allGlobalProducts.find(p => p.product_id === productId && p.store_id === currentStoreId);
            if (globalProd) {
                globalProd.price = priceUSD;
                globalProd.price_ves = priceVES;
                globalProd.price_eur = priceEUR;
                globalProd.promo_price = promoPrice;
                globalProd.stock = stock;
                globalProd.variants = variants;
                globalProd.expiry_date = expiry;
                if (imgUrl) globalProd.img_url = imgUrl;
            }
        }

        closeEditModal();
        // Refrescar inventario con datos actualizados
        if (currentAppTab === 'inventory') {
            renderGlobalInventory(window.allGlobalProducts);
        } else {
            await setTab('inventory');
        }

    } catch (e) {
        alert('Error de red: ' + e.message);
    } finally {
        btn.innerText = 'Guardar';
        btn.disabled = false;
    }
}

// Helpers
function fmtUSD(val) {
    const n = Number(val);
    if (isNaN(n)) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtMethod(m) {
    const methods = {
        'cash-usd': { label: 'Efectivo $', icon: 'fa-dollar-sign', color: '#4edea3' },
        'cash-ves': { label: 'Efectivo Bs', icon: 'fa-money-bill-wave', color: '#4edea3' },
        'cash-eur': { label: 'Efectivo €', icon: 'fa-euro-sign', color: '#4edea3' },
        'pago-movil': { label: 'Pago Móvil', icon: 'fa-mobile-alt', color: '#ffbd2e' },
        'pagomovil': { label: 'Pago Móvil', icon: 'fa-mobile-alt', color: '#ffbd2e' },
        'zelle': { label: 'Zelle', icon: 'fa-bolt', color: '#6d28d9' },
        'card-ves': { label: 'Tarjeta', icon: 'fa-credit-card', color: '#3b82f6' },
        'card': { label: 'Tarjeta', icon: 'fa-credit-card', color: '#3b82f6' },
        'transfer': { label: 'Transferencia', icon: 'fa-university', color: '#a855f7' },
        'crédito': { label: 'Fiado/Crédito', icon: 'fa-hand-holding-dollar', color: '#f59e0b' },
        'fiado': { label: 'Fiado/Crédito', icon: 'fa-hand-holding-dollar', color: '#f59e0b' }
    };
    const meta = methods[String(m).toLowerCase()] || { label: m, icon: 'fa-wallet', color: 'inherit' };
    return `<i class="fas ${meta.icon}" style="font-size:10px;color:${meta.color}"></i> <span style="font-size:10px;font-weight:900;text-transform:uppercase;color:#fff">${meta.label}</span>`;
}

// Auto-Refresh Logic
setInterval(() => {
    if (sessionStorage.getItem('boss_auth')) {
        loadDashboard();
    }
}, 30000); // 30 seconds

// ==========================================
// GASTOS
// ==========================================
function showExpenseForm() {
    const form = document.getElementById('expense-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function loadExpenses(storeId) {
    const today = new Date().toISOString().split('T')[0];
    const expenses = await sbGet('store_expenses', `?store_id=eq.${storeId}&date=eq.${today}&order=created_at.desc`);
    const el = document.getElementById('expense-list');
    if (!el) return;

    if (!Array.isArray(expenses) || expenses.length === 0) {
        el.innerHTML = '<div class="empty">Sin gastos registrados hoy.</div>';
        return;
    }

    const typeEmojis = {
        alquiler: '🏠', servicios: '💡', nomina: '👷', proveedor: '📦',
        transporte: '🚗', mantenimiento: '🔧', marketing: '📢', impuesto: '📋', otro: '📌'
    };
    const totalGastosUSD = expenses.reduce((a, e) => a + (Number(e.amount_usd) || 0), 0);

    el.innerHTML = `
        <div style="margin-bottom:12px;padding:10px;background:#fff5f5;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:700;color:var(--error);">Total Gastos Hoy</span>
            <span style="font-size:16px;font-weight:900;color:var(--error);">${fmtUSD(totalGastosUSD)}</span>
        </div>
        ${expenses.map(e => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--outline);">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;">${typeEmojis[e.expense_type] || '📌'}</span>
                <div>
                    <div style="font-size:13px;font-weight:700;">${e.description || e.expense_type}</div>
                    <div style="font-size:10px;color:var(--text-muted);text-transform:capitalize;">
                        ${e.expense_type} &bull; ${e.payment_method || 'efectivo'}
                        ${e.responsible_name ? `&bull; Resp: ${e.responsible_name}` : ''}
                    </div>
                    ${e.reference_number ? `<div style="font-size:9px;color:var(--text-muted);">Ref: ${e.reference_number}</div>` : ''}
                </div>
            </div>
            <div style="text-align:right;display:flex;align-items:center;gap:10px;">
                <div>
                    <div style="font-size:13px;font-weight:900;color:var(--error);">${fmtUSD(e.amount_usd || 0)}</div>
                    ${e.amount_ves > 0 ? `<div style="font-size:10px;color:var(--text-muted);">Bs ${Number(e.amount_ves).toLocaleString('es-VE', { minimumFractionDigits: 0 })}</div>` : ''}
                </div>
                <button onclick="deleteExpense('${e.id}')" style="background:none;border:none;color:#fca5a5;cursor:pointer;font-size:14px;padding:4px;">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        </div>`).join('')}
    `;
}

async function saveExpense(storeId) {
    const type = document.getElementById('expense-type')?.value;
    const desc = document.getElementById('expense-desc')?.value.trim();
    const method = document.getElementById('expense-method')?.value;
    const ref = document.getElementById('expense-ref')?.value.trim();
    const resp = document.getElementById('expense-resp')?.value.trim();
    const usd = parseFloat(document.getElementById('expense-usd')?.value) || 0;
    const ves = parseFloat(document.getElementById('expense-ves')?.value) || 0;

    if (!type || (usd === 0 && ves === 0)) {
        alert('Ingresa al menos un monto para el gasto.');
        return;
    }

    if (usd > 9999999 || ves > 99999999) {
        alert('El monto ingresado es demasiado alto. Por favor, verifica e intenta de nuevo.');
        return;
    }

    if (!resp) {
        alert('Por favor, ingresa el nombre de la persona responsable o autorizada para este gasto.');
        return;
    }

    const expense = {
        store_id: storeId,
        expense_type: type,
        description: desc || type,
        amount_usd: usd,
        amount_ves: ves,
        payment_method: method,
        reference_number: ref,
        responsible_name: resp,
        date: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
    };

    const btn = document.querySelector('#expense-form button');
    if (btn) btn.textContent = 'Guardando...';

    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/store_expenses`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(expense)
        });

        if (!res.ok) {
            const err = await res.text();
            if (err.includes('store_expenses') && err.includes('does not exist')) {
                alert('⚠️ Tabla "store_expenses" no existe en Supabase.\n\nEjecuta este SQL en tu Supabase:\n\nCREATE TABLE store_expenses (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  store_id text,\n  expense_type text,\n  description text,\n  amount_usd numeric DEFAULT 0,\n  amount_ves numeric DEFAULT 0,\n  date date,\n  created_at timestamptz DEFAULT now()\n);');
            } else {
                alert('Error al guardar: ' + err);
            }
            return;
        }

        // Limpiar formulario
        document.getElementById('expense-desc').value = '';
        document.getElementById('expense-usd').value = '';
        document.getElementById('expense-ves').value = '';
        if (document.getElementById('expense-ref')) document.getElementById('expense-ref').value = '';
        if (document.getElementById('expense-resp')) document.getElementById('expense-resp').value = '';

        document.getElementById('expense-form').style.display = 'none';

        // Actualizar datos
        loadExpenses(storeId);
        loadDashboard(); // Recargar el dashboard completo para actualizar el margen global
    } catch (e) {
        alert('Error de red: ' + e.message);
    }
}

async function deleteExpense(expenseId) {
    if (!confirm('¿Eliminar este gasto?')) return;
    try {
        await fetch(`${supabaseUrl}/rest/v1/store_expenses?id=eq.${expenseId}`, {
            method: 'DELETE',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });
        loadExpenses(currentStoreId);
    } catch (e) {
        alert('Error al eliminar: ' + e.message);
    }
}

// ==========================================
// INVENTARIO GLOBAL
// ==========================================
async function loadGlobalInventory() {
    const list = document.getElementById('global-inventory-list');
    if (!list) return;

    // Si ya tenemos productos cargados en loadDashboard (opcional, pero store_products es grande)
    // Vamos a buscar todos los productos de todas las tiendas
    list.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';

    try {
        const products = await sbGet('store_products', '?order=name.asc');
        window.allGlobalProducts = Array.isArray(products) ? products : [];
        renderGlobalInventory(window.allGlobalProducts);
    } catch (e) {
        list.innerHTML = '<div class="empty">Error cargando inventario global.</div>';
    }
}

function renderGlobalInventory(products) {
    const list = document.getElementById('global-inventory-list');
    if (products.length === 0) {
        list.innerHTML = '<div class="empty">No hay productos sincronizados.</div>';
        return;
    }

    list.innerHTML = products.map(p => {
        const store = allStores.find(s => s.id === p.store_id);
        const storeName = store ? store.name : 'Sede Desconocida';
        const stockColor = p.stock <= 0 ? 'var(--error)' : p.stock <= 5 ? 'var(--warning)' : 'var(--primary)';

        return `
        <div class="card" style="padding:12px; margin-bottom:10px; display:flex; align-items:center; gap:12px; cursor:pointer;" onclick="openEditModal('${p.product_id}')">
            <div style="width:40px; height:40px; border-radius:8px; background:var(--bg); display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">
                ${p.img_url ? `<img src="${p.img_url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : '<i class="fas fa-box" style="color:var(--text-muted)"></i>'}
            </div>
            <div style="flex:1; min-width:0;">
                <div style="font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
                <div style="font-size:9px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-top:2px;">
                    <i class="fas fa-store" style="font-size:8px;"></i> ${storeName}
                </div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:14px; font-weight:900; color:var(--text);">${fmtUSD(p.price)}</div>
                <div style="font-size:10px; font-weight:800; color:${stockColor}; margin-top:2px;">${p.stock} uds</div>
            </div>
            <div style="padding-left: 8px;">
                <i class="fas fa-pen" style="color:var(--text-muted); font-size:12px;"></i>
            </div>
        </div>
        `;
    }).join('');
}

window.filterGlobalInventory = function (query) {
    if (!window.allGlobalProducts) return;
    const q = query.toLowerCase().trim();
    const filtered = window.allGlobalProducts.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (allStores.find(s => s.id === p.store_id)?.name || '').toLowerCase().includes(q)
    );
    renderGlobalInventory(filtered);
};

// ==========================================
// BALANCE FINANCIERO GLOBAL
// ==========================================
async function loadGlobalFinancial() {
    const content = document.getElementById('financial-summary-content');
    if (!content) return;

    // Usamos los datos ya cargados en loadDashboard
    const sales = window.allSalesToday || [];
    const snapshots = allSnapshots || [];

    const totalUSD = snapshots.reduce((a, s) => a + (Number(s.total_usd) || 0), 0);
    const totalProfit = snapshots.reduce((a, s) => a + (Number(s.profit_usd) || 0), 0);

    // Agrupar por tienda para el desglose
    const storeBreakdown = allStores.map(store => {
        const snap = snapshots.find(s => s.store_id === store.id) || {};
        return {
            name: store.name,
            total: Number(snap.total_usd) || 0,
            profit: Number(snap.profit_usd) || 0,
            tickets: Number(snap.tickets) || 0
        };
    }).sort((a, b) => b.total - a.total);

    content.innerHTML = `
        <div class="card" style="background:var(--secondary); color:white; padding:20px; border:none;">
            <div style="font-size:12px; font-weight:800; opacity:0.7; text-transform:uppercase;">Ventas Totales Hoy</div>
            <div style="font-size:32px; font-weight:900; margin:5px 0;">${fmtUSD(totalUSD)}</div>
            <div style="display:flex; justify-content:space-between; margin-top:15px; padding-top:15px; border-top:1px solid rgba(255,255,255,0.1);">
                <div>
                    <div style="font-size:10px; opacity:0.7;">Ganancia Neta</div>
                    <div style="font-size:16px; font-weight:800; color:var(--primary);">${fmtUSD(totalProfit)}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:10px; opacity:0.7;">Tickets Totales</div>
                    <div style="font-size:16px; font-weight:800;">${sales.length}</div>
                </div>
            </div>
        </div>

        <div style="font-size:13px; font-weight:800; margin:20px 0 12px; color:var(--text);">Desglose por Sucursal</div>
        
        ${storeBreakdown.map(s => `
        <div class="card" style="padding:14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-size:14px; font-weight:800;">${s.name}</div>
                <div style="font-size:10px; color:var(--text-muted); font-weight:700;">${s.tickets} ventas hoy</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:16px; font-weight:900; color:var(--primary);">${fmtUSD(s.total)}</div>
                <div style="font-size:10px; color:var(--text-muted); font-weight:700;">Margen: ${fmtUSD(s.profit)}</div>
            </div>
        </div>
        `).join('')}
    `;
}

// ==========================================
// VISTA EN VIVO (LIVE POS)
// ==========================================
async function loadLiveState() {
    const list = document.getElementById('view-pos');
    if (!list || currentAppTab !== 'pos') return;

    try {
        const states = await sbGet('store_live_state', '?order=last_activity.desc');
        renderLiveState(Array.isArray(states) ? states : []);
    } catch (e) {
        console.error('Error loading live states:', e);
    }
}

function renderLiveState(states) {
    const container = document.getElementById('view-pos');
    if (!container) return;

    if (states.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <i class="fas fa-tv" style="font-size: 40px; color: var(--outline); margin-bottom: 16px; display: block;"></i>
                No hay terminales activos transmitiendo en vivo.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="pulso-banner" style="padding: 20px; margin-bottom: 16px; background: linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%);">
            <div class="title" style="font-size: 20px;">Cajas en Tiempo Real</div>
            <div class="subtitle">Monitorea la actividad de tus cajeros.</div>
        </div>
        <div id="live-states-grid">
            ${states.map(s => {
        const store = allStores.find(st => st.id === s.store_id);
        const storeName = store ? store.name : 'Sede Desconocida';
        const cart = Array.isArray(s.cart_data) ? s.cart_data : [];
        const lastSeen = new Date(s.last_activity);
        const diffSecs = Math.floor((new Date() - lastSeen) / 1000);
        const statusColor = diffSecs < 60 ? '#10b981' : '#94a3b8';
        const statusText = diffSecs < 60 ? 'ACTIVO AHORA' : `VISTO HACE ${Math.floor(diffSecs / 60)}m`;

        return `
                <div class="card" style="padding:0; overflow:hidden; border-top:4px solid ${statusColor};">
                    <div style="padding:16px; background:var(--bg); display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--outline);">
                        <div>
                            <div style="font-size:15px; font-weight:900;">${storeName}</div>
                            <div style="font-size:9px; font-weight:800; color:${statusColor}; letter-spacing:0.5px;">● ${statusText}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:10px; font-weight:700; color:var(--text-muted);">CARRITO ACTUAL</div>
                            <div style="font-size:16px; font-weight:900; color:var(--primary);">${fmtUSD(s.total_usd)}</div>
                        </div>
                    </div>
                    <div style="padding:12px; max-height:200px; overflow-y:auto;">
                        ${cart.length === 0 ? '<div class="empty" style="padding:10px; font-size:11px;">Caja en espera (vacía)</div>' : cart.map(item => `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--bg); font-size:12px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="background:var(--primary-light); color:var(--primary); width:18px; height:18px; display:flex; align-items:center; justify-content:center; border-radius:4px; font-size:10px; font-weight:900;">${item.qty}</span>
                                    <span style="font-weight:700; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</span>
                                </div>
                                <span style="font-weight:800; color:var(--text-muted);">${fmtUSD(item.price_usd * item.qty)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div style="padding:8px 16px; background:var(--bg); border-top:1px solid var(--outline); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:10px; font-weight:700; color:var(--text-muted);">VISTA: ${s.current_view}</span>
                        <button onclick="openDetail('${s.store_id}')" style="background:none; border:none; color:var(--info); font-size:11px; font-weight:800; cursor:pointer;">Ver Sede <i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
                `;
    }).join('')}
        </div>
    `;
}

// Actualizar vista en vivo cada 5 segundos si la pestaña está activa
setInterval(() => {
    if (currentAppTab === 'pos') loadLiveState();
}, 5000);

// ==========================================
// REMOTE RATE UPDATE (Gritarle a las cajas)
// ==========================================
window.openRateModal = function () {
    document.getElementById('new-exchange-rate').value = exchangeRate;
    document.getElementById('rate-modal').classList.add('active');
};

window.closeRateModal = function () {
    document.getElementById('rate-modal').classList.remove('active');
};

window.saveRemoteRate = async function () {
    const newRate = parseFloat(document.getElementById('new-exchange-rate').value);
    if (!newRate || isNaN(newRate)) {
        alert("Ingresa una tasa válida.");
        return;
    }

    const btn = document.getElementById('btn-save-rate');
    btn.innerText = 'Actualizando...';
    btn.disabled = true;

    try {
        // 1. Guardar localmente en el Jefe
        exchangeRate = newRate;
        localStorage.setItem('boss_exchange_rate', newRate);

        // 2. Enviar comandos a TODAS las sucursales
        const commandPromises = allStores.map(store => {
            const cmd = {
                store_id: store.id,
                command_type: 'UPDATE_EXCHANGE_RATE',
                payload: { new_rate: newRate },
                status: 'pending'
            };
            return fetch(`${supabaseUrl}/rest/v1/store_commands`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(cmd)
            });
        });

        await Promise.all(commandPromises);

        alert(`✅ Tasa actualizada a Bs ${newRate.toFixed(2)}. Las cajas se sincronizarán en segundos.`);
        closeRateModal();
        loadDashboard(); // Refrescar UI del jefe
    } catch (e) {
        alert("Error al sincronizar tasa: " + e.message);
    } finally {
        btn.innerText = 'Actualizar Todo';
        btn.disabled = false;
    }
};

window.logoutBoss = function () {
    if (confirm('¿Estás seguro de cerrar sesión? Se borrarán las credenciales locales de este navegador.')) {
        localStorage.clear();
        location.reload();
    }
};

window.forceAllSync = async function () {
    if (!confirm('Esto ordenará a todas las cajas conectadas que envíen su catálogo completo a la nube. ¿Continuar?')) return;

    try {
        const promises = allStores.map(store => {
            const cmd = {
                store_id: store.id,
                command_type: 'PUSH_FULL_CATALOG',
                payload: {},
                status: 'pending'
            };
            return fetch(`${supabaseUrl}/rest/v1/store_commands`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(cmd)
            });
        });

        await Promise.all(promises);
        alert('✅ Comandos de sincronización enviados a todas las sucursales.');
        toggleConfig();
    } catch (e) {
        alert('Error al enviar comandos: ' + e.message);
    }
};

// ==========================================
// SINCRONIZAR NUBE (botón visible en Currency Bar)
// ==========================================
window.doCloudSync = async function() {
    const btn = document.getElementById('btn-cloud-sync');
    const icon = btn ? btn.querySelector('i') : null;
    
    if (btn) {
        btn.disabled = true;
        btn.style.background = 'rgba(255,255,255,0.05)';
    }
    if (icon) {
        icon.className = 'fas fa-spinner fa-spin';
    }

    try {
        if (!supabaseUrl || !supabaseKey || allStores.length === 0) {
            alert('No hay sucursales conectadas para sincronizar.');
            return;
        }

        const promises = allStores.map(store => {
            const cmd = {
                store_id: store.id,
                command_type: 'PUSH_FULL_CATALOG',
                payload: {},
                status: 'pending'
            };
            return fetch(`${supabaseUrl}/rest/v1/store_commands`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(cmd)
            });
        });

        await Promise.all(promises);

        if (icon) {
            icon.className = 'fas fa-check';
            setTimeout(() => { icon.className = 'fas fa-cloud-upload-alt'; }, 2500);
        }
    } catch (e) {
        alert('❌ Error al sincronizar: ' + e.message);
        if (icon) icon.className = 'fas fa-cloud-upload-alt';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.background = 'rgba(255,255,255,0.15)';
        }
    }
};

window.logoutBoss = function () {
    if (confirm('¿Estás seguro de cerrar sesión? Se borrarán las credenciales locales de este navegador.')) {
        localStorage.clear();
        location.reload();
    }
};

init();
