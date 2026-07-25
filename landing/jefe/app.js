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

window.saveBossSetup = function() {
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
    }
    
    loadDashboard();
}



// Data Fetching
async function sbGet(table, query = '') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
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

async function sbFetch(table, method, data, query = '') {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
            method,
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
            },
            body: data ? JSON.stringify(data) : undefined
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
        return true;
    } catch (e) {
        console.error(`sbFetch error ${method} ${table}:`, e);
        throw e;
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
        if (currentAppTab === 'orders') loadPurchaseOrders();

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
                <div class="card" style="padding:16px; margin-bottom:12px; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="font-weight:900; font-size:16px; cursor:pointer;" onclick="openDetail('${store.id}')">${store.name}</div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="font-size:9px; font-weight:900; color:${isOnline ? 'var(--primary)' : 'var(--text-muted)'}; text-transform:uppercase; display:flex; align-items:center; gap:4px;">
                        <div style="width:6px; height:6px; border-radius:50%; background:currentColor;"></div>
                        ${isOnline ? 'En Línea' : 'Desconectado'}
                    </div>
                    <button onclick="event.stopPropagation();openDeleteStoreModal('${store.id}','${store.name}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;font-size:13px;" title="Eliminar sucursal"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
            <div style="cursor:pointer;" onclick="openDetail('${store.id}')">
            
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
            ${totalExpUSD > 0 ? `
            <div style="margin-top:10px;padding:8px 10px;background:#fff5f5;border-radius:8px;border-left:3px solid var(--error);display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-receipt" style="font-size:10px;color:var(--error);"></i>
                    <span style="font-size:10px;font-weight:700;color:var(--error);">${storeExpenses.length} gasto${storeExpenses.length !== 1 ? 's' : ''} hoy</span>
                </div>
                <span style="font-size:11px;font-weight:900;color:var(--error);">- ${fmtUSD(totalExpUSD)}</span>
            </div>` : ''}
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
    if (document.getElementById('g-pm')) document.getElementById('g-pm').innerText = 'Bs ' + pm.toLocaleString('es-VE', {minimumFractionDigits:0});

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
        for(let i=6; i<=22; i++) hoursMap[i] = 0;
        
        sales.forEach(s => {
            if(!s.date) return;
            try {
                const dateObj = new Date(s.date);
                const h = dateObj.getHours();
                if(h >= 6 && h <= 22) {
                    hoursMap[h] += Number(s.total_usd) || 0;
                }
            } catch(e) {}
        });

        let maxHourVal = 0;
        let peakHour = 12;
        Object.keys(hoursMap).forEach(h => {
            if(hoursMap[h] > maxHourVal) { maxHourVal = hoursMap[h]; peakHour = h; }
        });
        
        const peakHourLabel = `${peakHour}:00 - ${parseInt(peakHour)+1}:00`;

        const hourBars = Object.keys(hoursMap).map(h => {
            const val = hoursMap[h];
            const pct = maxHourVal > 0 ? (val / maxHourVal) * 100 : 0;
            const isPeak = (h == peakHour);
            const hourLabel = h > 12 ? (h-12)+'p' : (h==12?'12p':'');
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
        ].sort((a,b) => b.val - a.val);

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
                try { items = JSON.parse(items); } catch(e){ items = []; }
            }
            if(Array.isArray(items)) {
                items.forEach(i => {
                    const name = i.name || 'Desconocido';
                    prodCount[name] = (prodCount[name] || 0) + (Number(i.qty) || 1);
                });
            }
        });

        const sortedProds = Object.entries(prodCount).sort((a,b) => b[1] - a[1]).slice(0, 5);
        const prodsHtml = sortedProds.length === 0 ? '<div class="empty">Sin datos de ventas aún.</div>' : sortedProds.map(([name, qty], idx) => {
            const colors = ['#f59e0b', '#94a3b8', '#cd7f32', '#64748b', '#94a3b8'];
            const color = colors[idx] || '#cbd5e1';
            return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--outline);">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:24px; height:24px; border-radius:50%; background:${color}20; color:${color}; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900;">${idx+1}</div>
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
window.switchMainTab = function(tabId, el) {
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
        'inventory': 'Inventario',
        'financial': 'Balance General',
        'pos': 'Cajas en Vivo',
        'orders': 'Pedidos',
        'movements': 'Movimientos'
    };
    document.getElementById('header-title').textContent = titles[tabId] || 'Punto Pila';
    
    if (tabId === 'inventory') loadGlobalInventory();
    if (tabId === 'financial') loadGlobalFinancial();
    if (tabId === 'pos') loadLiveState();
    if (tabId === 'orders') loadPurchaseOrders();
    if (tabId === 'movements') loadMovements();
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
    document.getElementById('tab-expenses').classList.toggle('active', tab === 'expenses');
    const perfTab = document.getElementById('tab-performance');
    if (perfTab) perfTab.classList.toggle('active', tab === 'performance');
    const ordersTab = document.getElementById('tab-orders');
    if (ordersTab) ordersTab.classList.toggle('active', tab === 'orders');
    
    const content = document.getElementById('detail-content');
    content.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';

    const datePickerHtml = (tab === 'sales' || tab === 'performance' || tab === 'expenses') ? `
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
        const nextDay = new Date(currentDetailDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDateStr = nextDay.toISOString().split('T')[0];
        
        const rawSales = await sbGet('store_sales', `?date=gte.${currentDetailDate}&date=lt.${nextDateStr}`);
        const sales = Array.isArray(rawSales) ? rawSales.filter(s => String(s.store_id).trim() == String(currentStoreId).trim()) : [];
        let htmlStr = '';
        if (sales.length === 0) {
            htmlStr = `<div class="empty">No hay ventas registradas (Store: ${currentStoreId}, Hoy: ${Array.isArray(rawSales) ? rawSales.length : 'Err'}).</div>`;
        } else {
            htmlStr = sales.map(s => {
                let itemsList = s.items_json;
                if (typeof itemsList === 'string') { try { itemsList = JSON.parse(itemsList); } catch(e){} }
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
                            <div style="font-size:12px;font-weight:900;color:var(--secondary);">Bs ${Number(ves).toLocaleString('es-VE',{minimumFractionDigits:0})}</div>
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
    } else if (tab === 'expenses') {
        const nextDay = new Date(currentDetailDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDateStr = nextDay.toISOString().split('T')[0];
        const rawExpenses = await sbGet('store_expenses', `?date=gte.${currentDetailDate}&date=lt.${nextDateStr}&order=timestamp.desc`);
        const expenses = rawExpenses.filter(e => e.store_id === currentStoreId);
        let htmlStr = '';
        if (!Array.isArray(expenses) || expenses.length === 0) {
            htmlStr = '<div class="empty">No hay gastos registrados en esta fecha.</div>';
        } else {
            const totalExp = expenses.reduce((a, e) => a + (Number(e.amount_usd) || 0), 0);
            htmlStr = `
                <div style="background: #fff1f2; border: 1px solid #fecaca; padding: 16px; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 11px; font-weight: 800; color: #b91c1c; text-transform: uppercase;">Total Gastos Día</div>
                    <div style="font-size: 20px; font-weight: 900; color: #e11d48;">${fmtUSD(totalExp)}</div>
                </div>
            `;
            htmlStr += expenses.map(e => `
                <div class="card" style="padding:16px; margin-bottom:12px; border-left: 4px solid #e11d48;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <div style="font-size:14px; font-weight:800; color:var(--text);">${e.description}</div>
                            <div style="display:flex; gap:6px; margin-top:8px;">
                                <span style="font-size:9px; font-weight:800; background:#f1f5f9; color:#64748b; padding:2px 8px; border-radius:6px; text-transform:uppercase;">${e.responsible_name || 'N/A'}</span>
                                <span style="font-size:9px; font-weight:800; background:#fff1f2; color:#e11d48; padding:2px 8px; border-radius:6px; text-transform:uppercase;">${e.payment_method || 'Efectivo'}</span>
                            </div>
                            <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">
                                <i class="fas fa-clock"></i> ${new Date(e.timestamp || e.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                ${e.reference_number ? ` • <i class="fas fa-hashtag"></i> Ref: ${e.reference_number}` : ''}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:18px; font-weight:900; color:#e11d48;">${fmtUSD(e.amount_usd)}</div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        content.innerHTML = datePickerHtml + htmlStr;
    } else if (tab === 'performance') {
        const nextDay = new Date(currentDetailDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDateStr = nextDay.toISOString().split('T')[0];

        const [rawSnaps, rawSales, rawExpenses] = await Promise.all([
            sbGet('store_snapshots', `?date=gte.${currentDetailDate}&date=lt.${nextDateStr}&order=timestamp.desc`),
            sbGet('store_sales', `?date=gte.${currentDetailDate}&date=lt.${nextDateStr}`),
            sbGet('store_expenses', `?date=gte.${currentDetailDate}&date=lt.${nextDateStr}`)
        ]);

        const snaps = Array.isArray(rawSnaps) ? rawSnaps.filter(s => String(s.store_id).trim() == String(currentStoreId).trim()) : [];
        const sales = Array.isArray(rawSales) ? rawSales.filter(s => String(s.store_id).trim() == String(currentStoreId).trim()) : [];
        const expenses = Array.isArray(rawExpenses) ? rawExpenses.filter(e => String(e.store_id).trim() == String(currentStoreId).trim()) : [];

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
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e){} }
            if (Array.isArray(items)) {
                items.forEach(i => {
                    const name = i.name || 'Producto';
                    const qty = Number(i.qty || i.quantity || 1);
                    topProds[name] = (topProds[name] || 0) + qty;
                });
            }
        });

        const sortedProds = Object.entries(topProds).sort((a,b) => b[1]-a[1]).slice(0,5);
        const maxProd = sortedProds[0]?.[1] || 1;
        const avgTicket = sales.length > 0 ? (totalUSD / sales.length) : 0;
        const peakHourEntry = Object.entries(hoursMap).sort((a,b) => b[1]-a[1])[0];
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
        const hours = Array.from({length: 17}, (_, i) => i + 6); // 6 a 22
        const maxHourVal = Math.max(...hours.map(h => hoursMap[h] || 0), 0.01);
        const hourBars = hours.map(h => {
            const val = hoursMap[h] || 0;
            const pct = Math.round((val / maxHourVal) * 100);
            const isPeak = peakHourEntry && parseInt(peakHourEntry[0]) === h;
            return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
                <div style="font-size:9px;font-weight:800;color:${val>0?'var(--primary)':'var(--text-muted)'};">
                    ${val > 0 ? '$'+val.toFixed(0) : ''}
                </div>
                <div style="width:100%;height:70px;display:flex;align-items:flex-end;justify-content:center;">
                    <div style="width:80%;background:${isPeak?'var(--primary)':'#d1fae5'};height:${Math.max(pct,2)}%;border-radius:4px 4px 0 0;transition:height 0.4s;min-height:3px;"></div>
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
        const sortedMethods = Object.entries(methodsMap).sort((a,b) => b[1]-a[1]);
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
                        const rankColors = ['#f59e0b','#94a3b8','#cd7f32','#6b7280','#6b7280'];
                        return `
                        <div style="margin-bottom:14px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <span style="font-size:13px;font-weight:900;color:${rankColors[idx]};width:18px;">#${idx+1}</span>
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
    } else if (tab === 'orders') {
        const orders = await sbGet('store_purchase_orders', `?order=timestamp.desc`);
        const storeOrders = Array.isArray(orders) ? orders.filter(o => o.from_store === currentStoreId || o.to_store === currentStoreId) : [];
        
        if (storeOrders.length === 0) {
            content.innerHTML = '<div class="empty">No hay pedidos para esta sucursal.</div>';
            return;
        }
        
        const storeMap = {};
        allStores.forEach(s => { storeMap[s.id] = s.name; });
        
        content.innerHTML = storeOrders.map(po => {
            let items = [];
            try { items = JSON.parse(po.items_json || '[]'); } catch(e) {}
            const totalItems = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
            
            let badge = ''; let badgeColor = '';
            if (po.status === 'PENDING') { badge = 'Pendiente'; badgeColor = '#f59e0b'; }
            else if (po.status === 'APPROVED') { badge = 'Aprobado'; badgeColor = '#10b981'; }
            else if (po.status === 'RECEIVED') { badge = 'Recibido'; badgeColor = '#3b82f6'; }
            else { badge = po.status; badgeColor = '#6b7280'; }
            
            const fromName = storeMap[po.from_store] || po.from_store || '—';
            const toName = storeMap[po.to_store] || po.to_store || '—';
            const total = po.total_cost || items.reduce((sum, it) => sum + ((it.quantity||0)*(it.cost_price||0)), 0);
            
            return `
            <div class="card" style="padding: 16px; margin-bottom: 12px; border-left: 4px solid ${badgeColor};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div>
                        <div style="font-weight: 800; font-size: 14px;">#${po.id.slice(-6).toUpperCase()}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${po.date ? new Date(po.date).toLocaleDateString() : '—'}</div>
                    </div>
                    <span style="background: ${badgeColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;">${badge}</span>
                </div>
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
                    <b style="color: var(--text);">${fromName}</b> → <b style="color: var(--text);">${toName}</b>
                </div>
                <div style="display: flex; gap: 16px; font-size: 13px;">
                    <span>Items: <b>${totalItems}</b></span>
                    <span>Total: <b>$${total.toFixed(2)}</b></span>
                </div>
                ${items.length > 0 ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--outline); font-size: 12px; color: var(--text-muted);">
                    ${items.map(it => `<div>• ${it.product_name} x${it.quantity} — $${((it.quantity||0)*(it.cost_price||0)).toFixed(2)}</div>`).join('')}
                </div>` : ''}
            </div>`;
        }).join('');
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
                    ${p.price_ves > 0 ? `<span style="font-size:11px; color:var(--text-muted); font-weight:700;">Bs ${Number(p.price_ves).toLocaleString('es-VE',{minimumFractionDigits:0})}</span>` : ''}
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
    const vesFmt = ves > 0 ? `Bs ${ves.toLocaleString('es-VE', {minimumFractionDigits:2})}` : 'Bs —';
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
        alert('Error: no hay producto o sucursal seleccionada.');
        return;
    }

    const btn = document.getElementById('btn-save-product');
    btn.innerText = 'Guardando...';
    btn.disabled = true;

    const product = currentProducts.find(p => p.product_id === productId);

    const cmd = {
        store_id: currentStoreId,
        command_type: 'UPDATE_PRODUCT_FULL',
        payload: { 
            product_id: productId, 
            new_name: product ? product.name : 'Producto',
            new_category: product ? product.category : 'General',
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
        const cmdRes = await fetch(`${supabaseUrl}/rest/v1/store_commands`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(cmd)
        });
        
        if (!cmdRes.ok) {
            const errText = await cmdRes.text();
            alert('Error al enviar comando al POS: ' + errText);
            return;
        }

        // 2. Actualizar store_products DIRECTAMENTE en Supabase
        //    Para que la App del Jefe vea los cambios sin esperar al POS
        const rowId = `${currentStoreId}_${productId}`;
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

        await fetch(`${supabaseUrl}/rest/v1/store_products?id=eq.${encodeURIComponent(rowId)}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(patchBody)
        });

        // 3. Actualizar array local para que el modal refleje datos correctos
        const localProd = currentProducts.find(p => p.product_id === productId);
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

        closeEditModal();
        // Refrescar inventario con datos actualizados
        await setTab('inventory');

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
// TOAST NOTIFICATION
// ==========================================
function showToast(message, duration = 3000) {
    // Eliminar toast anterior si existe
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: #1e293b;
        color: #f1f5f9;
        padding: 12px 20px;
        border-radius: 14px;
        font-size: 13px;
        font-weight: 700;
        font-family: inherit;
        box-shadow: 0 8px 30px rgba(0,0,0,0.25);
        z-index: 9999;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        max-width: 300px;
        text-align: center;
        border: 1px solid rgba(255,255,255,0.1);
        white-space: nowrap;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animar entrada
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Animar salida y eliminar
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

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
        <div style="margin-bottom:12px;padding:12px;background:linear-gradient(135deg,#fff5f5,#fff0f0);border-radius:12px;border:1px solid #fecaca;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <div style="font-size:10px;font-weight:800;color:var(--error);text-transform:uppercase;letter-spacing:0.5px;">Total Gastos Hoy</div>
                <div style="font-size:18px;font-weight:900;color:var(--error);">${fmtUSD(totalGastosUSD)}</div>
            </div>
            <div style="font-size:24px;">💸</div>
        </div>
        ${expenses.map(e => `
        <div style="padding:12px;margin-bottom:8px;background:#fff;border:1px solid #fee2e2;border-radius:12px;border-left:4px solid var(--error);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
                <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0;">
                    <span style="font-size:20px;flex-shrink:0;">${typeEmojis[e.expense_type] || '📌'}</span>
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.description || e.expense_type}</div>
                        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
                            <span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;padding:2px 8px;border-radius:20px;background:#fff0f0;color:var(--error);text-transform:uppercase;">
                                <i class="fas fa-tag" style="font-size:7px;"></i> ${e.expense_type}
                            </span>
                            ${e.payment_method ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;padding:2px 8px;border-radius:20px;background:#eff6ff;color:#2563eb;text-transform:capitalize;">
                                <i class="fas fa-wallet" style="font-size:7px;"></i> ${e.payment_method}
                            </span>` : ''}
                            ${e.responsible_name ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;padding:2px 8px;border-radius:20px;background:#f0fdf4;color:#15803d;">
                                <i class="fas fa-user" style="font-size:7px;"></i> ${e.responsible_name}
                            </span>` : ''}
                            ${e.reference_number ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;">
                                <i class="fas fa-hashtag" style="font-size:7px;"></i> ${e.reference_number}
                            </span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                    <div style="font-size:14px;font-weight:900;color:var(--error);">${fmtUSD(e.amount_usd || 0)}</div>
                    ${e.amount_ves > 0 ? `<div style="font-size:10px;font-weight:700;color:var(--text-muted);">Bs ${Number(e.amount_ves).toLocaleString('es-VE',{minimumFractionDigits:0})}</div>` : ''}
                    <button onclick="deleteExpense('${e.id}', '${storeId}')" style="background:none;border:none;color:#fca5a5;cursor:pointer;font-size:13px;padding:2px 4px;margin-top:2px;" title="Eliminar gasto">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
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
    if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }

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
                alert('⚠️ Tabla "store_expenses" no existe en Supabase.\n\nEjecuta este SQL en tu Supabase:\n\nCREATE TABLE store_expenses (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  store_id text,\n  expense_type text,\n  description text,\n  payment_method text,\n  reference_number text,\n  responsible_name text,\n  amount_usd numeric DEFAULT 0,\n  amount_ves numeric DEFAULT 0,\n  date date,\n  created_at timestamptz DEFAULT now()\n);');
            } else {
                alert('Error al guardar: ' + err);
            }
            return;
        }

        // Limpiar formulario
        ['expense-desc','expense-usd','expense-ves','expense-ref','expense-resp'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('expense-form').style.display = 'none';

        // Mostrar toast de éxito
        showToast('✅ Gasto registrado correctamente');

        // Refrescar lista de gastos + dashboard global
        await loadExpenses(storeId);
        loadDashboard(); // Actualiza métricas globales (margen, gastos, etc.)
    } catch(e) {
        alert('Error de red: ' + e.message);
    } finally {
        if (btn) { btn.textContent = 'Guardar Gasto'; btn.disabled = false; }
    }
}

async function deleteExpense(expenseId, storeId) {
    if (!confirm('¿Eliminar este gasto?')) return;
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/store_expenses?id=eq.${expenseId}`, {
            method: 'DELETE',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });
        if (!res.ok) { alert('Error al eliminar gasto.'); return; }
        showToast('🗑️ Gasto eliminado');
        // Refrescar lista Y dashboard para actualizar margen
        await loadExpenses(storeId || currentStoreId);
        loadDashboard();
    } catch(e) {
        alert('Error al eliminar: ' + e.message);
    }
}

// ==========================================
// INVENTARIO GLOBAL
// ==========================================
async function loadGlobalInventory() {
    const list = document.getElementById('global-inventory-list');
    if (!list) return;

    list.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
    
    try {
        const products = await sbGet('store_products', '?order=name.asc');
        const activeStoreIds = new Set(allStores.map(s => s.id));
        window.allGlobalProducts = Array.isArray(products) ? products.filter(p => activeStoreIds.has(p.store_id)) : [];
        
        const sel = document.getElementById('inv-store-filter');
        if (sel) {
            const currentValue = sel.value;
            sel.innerHTML = '<option value="">Todas las tiendas</option>' +
                allStores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
            if (currentValue) sel.value = currentValue;
        }
        
        renderGlobalInventory(window.allGlobalProducts);
    } catch (e) {
        list.innerHTML = '<div class="empty">Error cargando inventario.</div>';
    }
}

function getFilteredProducts() {
    if (!window.allGlobalProducts) return [];
    const sel = document.getElementById('inv-store-filter');
    const storeId = sel ? sel.value : '';
    const searchEl = document.getElementById('global-inv-search');
    const query = searchEl ? searchEl.value.toLowerCase().trim() : '';
    
    const activeStoreIds = new Set(allStores.map(s => s.id));
    return window.allGlobalProducts.filter(p => {
        if (!activeStoreIds.has(p.store_id)) return false;
        if (storeId && p.store_id !== storeId) return false;
        if (query && !p.name.toLowerCase().includes(query) &&
            !(allStores.find(s => s.id === p.store_id)?.name || '').toLowerCase().includes(query)) return false;
        return true;
    });
}

function renderGlobalInventory(products) {
    const list = document.getElementById('global-inventory-list');
    if (!products) products = getFilteredProducts();
    
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
            <div style="padding-left:8px;">
                <i class="fas fa-pen" style="color:var(--text-muted); font-size:12px;"></i>
            </div>
        </div>
        `;
    }).join('');
}

window.filterGlobalInventory = function(query) {
    renderGlobalInventory(getFilteredProducts());
};

window.filterGlobalInventoryByStore = function(storeId) {
    renderGlobalInventory(getFilteredProducts());
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
    }).sort((a,b) => b.total - a.total);

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
                const statusText = diffSecs < 60 ? 'ACTIVO AHORA' : `VISTO HACE ${Math.floor(diffSecs/60)}m`;

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
window.openRateModal = function() {
    document.getElementById('new-exchange-rate').value = exchangeRate;
    document.getElementById('rate-modal').classList.add('active');
};

window.closeRateModal = function() {
    document.getElementById('rate-modal').classList.remove('active');
};

window.saveRemoteRate = async function() {
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

// ==========================================
// PEDIDOS / PURCHASE ORDERS
// ==========================================
async function loadPurchaseOrders() {
    const container = document.getElementById('orders-content');
    if (!container) return;
    
    try {
        const orders = await sbGet('store_purchase_orders', '?order=timestamp.desc');
        
        if (!orders || orders.length === 0) {
            container.innerHTML = `<div class="empty">
                <i class="fas fa-cart-shopping" style="font-size: 40px; color: var(--outline); margin-bottom: 16px; display: block;"></i>
                No hay pedidos registrados entre sucursales.
            </div>`;
            return;
        }
        
        // Build store name map
        const storeMap = {};
        allStores.forEach(s => { storeMap[s.id] = s.name; });
        
        let html = '';
        orders.forEach(po => {
            let items = [];
            try { items = JSON.parse(po.items_json || '[]'); } catch(e) {}
            const totalItems = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
            
            let badge = '';
            let badgeColor = '';
            if (po.status === 'PENDING') { badge = 'Pendiente'; badgeColor = '#f59e0b'; }
            else if (po.status === 'APPROVED') { badge = 'Aprobado'; badgeColor = '#10b981'; }
            else if (po.status === 'RECEIVED') { badge = 'Recibido'; badgeColor = '#3b82f6'; }
            else { badge = po.status; badgeColor = '#6b7280'; }
            
            const fromName = storeMap[po.from_store] || po.from_store || '—';
            const toName = storeMap[po.to_store] || po.to_store || '—';
            const dateStr = po.date ? new Date(po.date).toLocaleDateString() : '—';
            const total = po.total_cost || items.reduce((sum, it) => sum + ((it.quantity||0)*(it.cost_price||0)), 0);
            
            html += `<div class="card" style="padding: 16px; margin-bottom: 12px; border-left: 4px solid ${badgeColor};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div>
                        <div style="font-weight: 800; font-size: 14px;">#${po.id.slice(-6).toUpperCase()}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${dateStr}</div>
                    </div>
                    <span style="background: ${badgeColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;">${badge}</span>
                </div>
                <div style="display: flex; gap: 16px; font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
                    <span><b style="color: var(--text);">${fromName}</b> → <b style="color: var(--text);">${toName}</b></span>
                </div>
                <div style="display: flex; gap: 16px; font-size: 13px;">
                    <span>Items: <b>${totalItems}</b></span>
                    <span>Total: <b>$${total.toFixed(2)}</b></span>
                    <span>Creado por: <b>${po.created_by || '—'}</b></span>
                </div>
                ${items.length > 0 ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--outline); font-size: 12px; color: var(--text-muted);">
                    ${items.map(it => `<div>• ${it.product_name} x${it.quantity} — $${((it.quantity||0)*(it.cost_price||0)).toFixed(2)}</div>`).join('')}
                </div>` : ''}
            </div>`;
        });
        
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div class="empty" style="color: #ef4444;">
            <i class="fas fa-exclamation-triangle" style="font-size: 40px; margin-bottom: 16px; display: block;"></i>
            Error al cargar pedidos: ${e.message}
        </div>`;
    }
}

// ==========================================
// GESTIÓN DE SUCURSALES
// ==========================================
window.openAddStoreModal = function() {
    document.getElementById('new-store-name').value = '';
    document.getElementById('new-store-id').value = '';
    document.getElementById('new-store-type').value = 'kiosko';
    document.getElementById('add-store-modal').classList.add('active');
};
window.closeAddStoreModal = function() {
    document.getElementById('add-store-modal').classList.remove('active');
};
window.addStore = async function() {
    const name = document.getElementById('new-store-name').value.trim();
    const customId = document.getElementById('new-store-id').value.trim();
    const type = document.getElementById('new-store-type').value;
    if (!name) { showToast('Ingresa un nombre para la sucursal', 'error'); return; }
    const id = customId || 'store_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
    try {
        await sbFetch('stores', 'POST', {
            id,
            name,
            store_type: type,
            status: 'offline',
            brand_name: businessName || 'Punto Pila POS',
            last_seen: new Date().toISOString()
        });
        showToast('Sucursal creada: ' + name, 'success');
        closeAddStoreModal();
        loadDashboard();
    } catch (e) {
        showToast('Error al crear: ' + e.message, 'error');
    }
};

window._deleteStoreId = null;
window.openDeleteStoreModal = function(storeId, storeName) {
    window._deleteStoreId = storeId;
    document.getElementById('delete-store-name').textContent = storeName;
    document.getElementById('delete-store-modal').classList.add('active');
};
window.closeDeleteStoreModal = function() {
    document.getElementById('delete-store-modal').classList.remove('active');
    window._deleteStoreId = null;
};
window.confirmDeleteStore = async function() {
    const id = window._deleteStoreId;
    if (!id) return;
    try {
        await sbFetch('stores', 'DELETE', null, `?id=eq.${encodeURIComponent(id)}`);
        showToast('Sucursal eliminada', 'success');
        closeDeleteStoreModal();
        loadDashboard();
    } catch (e) {
        showToast('Error al eliminar: ' + e.message, 'error');
    }
};

// ==========================================
// MOVIMIENTOS (feed unificado)
// ==========================================
let _allMovements = [];
let _movementRenderTimer = null;

async function loadMovements() {
    const container = document.getElementById('movements-content');
    if (!container) return;
    container.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';
    try {
        const storeSelect = document.getElementById('mov-filter-store');
        if (storeSelect && allStores.length > 0) {
            storeSelect.innerHTML = '<option value="">Todas las sucursales</option>' +
                allStores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
        const today = new Date().toISOString().split('T')[0];
        const nextDay = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const [sales, expenses, orders] = await Promise.all([
            sbGet('store_sales', `?date=gte.${today}&date=lt.${nextDay}&order=timestamp.desc&limit=200`),
            sbGet('store_expenses', `?date=eq.${today}&order=created_at.desc&limit=200`),
            sbGet('store_purchase_orders', `?order=timestamp.desc&limit=200`)
        ]);
        const storeMap = {};
        allStores.forEach(s => storeMap[s.id] = s.name);
        const list = [];
        (Array.isArray(sales) ? sales : []).forEach(s => {
            list.push({
                id: s.id,
                type: 'sale',
                store_id: s.store_id,
                store_name: storeMap[s.store_id] || s.store_id || '—',
                label: 'Venta',
                description: (s.items_json ? (() => { try { const items = JSON.parse(s.items_json); return items.map(i => i.product_name || i.name).join(', '); } catch(e) { return ''; } })() : '') || 'Venta #' + (s.ticket || s.id.slice(-6)),
                amount: Number(s.total_usd) || 0,
                currency: 'USD',
                method: s.method || 'Efectivo',
                date: s.date || s.created_at,
                timestamp: s.timestamp || Date.parse(s.created_at) || Date.parse(s.date) || 0
            });
        });
        (Array.isArray(expenses) ? expenses : []).forEach(e => {
            list.push({
                id: e.id,
                type: 'expense',
                store_id: e.store_id,
                store_name: storeMap[e.store_id] || e.store_id || '—',
                label: 'Gasto',
                description: e.description || e.expense_type || 'Gasto',
                amount: -(Number(e.amount_usd) || 0),
                currency: 'USD',
                method: e.payment_method || '',
                date: e.date || e.created_at,
                timestamp: Date.parse(e.created_at) || Date.parse(e.date) || 0
            });
        });
        (Array.isArray(orders) ? orders : []).forEach(o => {
            const fromName = storeMap[o.from_store] || o.from_store || '—';
            const toName = storeMap[o.to_store] || o.to_store || '—';
            list.push({
                id: o.id,
                type: 'order',
                store_id: o.from_store || o.to_store,
                store_name: fromName + ' → ' + toName,
                label: o.status === 'PENDING' ? 'Pedido Pendiente' : o.status === 'APPROVED' ? 'Pedido Aprobado' : o.status === 'RECEIVED' ? 'Pedido Recibido' : 'Pedido',
                description: o.notes || (o.items_json ? (() => { try { const items = JSON.parse(o.items_json); return items.map(i => i.product_name).join(', '); } catch(e) { return ''; } })() : ''),
                amount: Number(o.total_cost) || 0,
                currency: 'USD',
                method: '',
                date: o.date || o.created_at,
                timestamp: o.timestamp || Date.parse(o.created_at) || Date.parse(o.date) || 0
            });
        });
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        _allMovements = list;
        renderMovements(list);
    } catch (e) {
        container.innerHTML = `<div class="empty" style="color:var(--error);">Error: ${e.message}</div>`;
    }
}

function renderMovements(list) {
    const container = document.getElementById('movements-content');
    if (!container) return;
    if (list.length === 0) {
        container.innerHTML = '<div class="empty"><i class="fas fa-exchange-alt" style="font-size:40px;color:var(--outline);margin-bottom:16px;display:block;"></i>No hay movimientos hoy.</div>';
        return;
    }
    const totalSales = list.filter(m => m.type === 'sale').reduce((s, m) => s + Math.abs(m.amount), 0);
    const totalExpenses = list.filter(m => m.type === 'expense').reduce((s, m) => s + Math.abs(m.amount), 0);
    const totalOrders = list.filter(m => m.type === 'order').reduce((s, m) => s + Math.abs(m.amount), 0);
    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
            <div class="card" style="margin-bottom:0;text-align:center;padding:12px;">
                <div style="font-size:18px;font-weight:900;color:var(--primary);">${fmtUSD(totalSales)}</div>
                <div style="font-size:9px;font-weight:700;color:var(--text-muted);">Ventas</div>
            </div>
            <div class="card" style="margin-bottom:0;text-align:center;padding:12px;">
                <div style="font-size:18px;font-weight:900;color:var(--error);">${fmtUSD(totalExpenses)}</div>
                <div style="font-size:9px;font-weight:700;color:var(--text-muted);">Gastos</div>
            </div>
            <div class="card" style="margin-bottom:0;text-align:center;padding:12px;">
                <div style="font-size:18px;font-weight:900;color:#7c3aed;">${fmtUSD(totalOrders)}</div>
                <div style="font-size:9px;font-weight:700;color:var(--text-muted);">Pedidos</div>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
        ${list.map(m => {
            let icon, color;
            if (m.type === 'sale') { icon = 'fa-cash-register'; color = 'var(--primary)'; }
            else if (m.type === 'expense') { icon = 'fa-receipt'; color = 'var(--error)'; }
            else { icon = 'fa-cart-shopping'; color = '#7c3aed'; }
            return `
            <div class="card" style="padding:12px;margin-bottom:0;display:flex;align-items:center;gap:12px;" onclick="openDetail('${m.store_id}')">
                <div style="width:36px;height:36px;border-radius:10px;background:${color}15;color:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas ${icon}"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;font-size:13px;">${m.label}</div>
                    <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.store_name} · ${m.description}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-weight:900;font-size:14px;color:${m.amount < 0 ? 'var(--error)' : 'var(--primary)'};">${m.amount < 0 ? '-' : '+'}${fmtUSD(Math.abs(m.amount))}</div>
                    <div style="font-size:9px;color:var(--text-muted);font-weight:600;">${m.method || m.type}</div>
                </div>
            </div>`;
        }).join('')}
        </div>`;
}

window.filterMovements = function() {
    const storeFilter = document.getElementById('mov-filter-store')?.value || '';
    const typeFilter = document.getElementById('mov-filter-type')?.value || '';
    let filtered = _allMovements;
    if (storeFilter) filtered = filtered.filter(m => m.store_id === storeFilter);
    if (typeFilter) filtered = filtered.filter(m => m.type === typeFilter);
    renderMovements(filtered);
};

init();
