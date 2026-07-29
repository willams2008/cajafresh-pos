// ==========================================
// BOSS DASHBOARD — Panel de Control Remoto
// ==========================================

let pinCode = '';
let authToken = null;
let socket = null;
let allSales = [];
let allProducts = [];
let allCredits = [];
let dashboardData = null;
let currentPeriod = 'today';

// ===== FORMATTERS =====
const fmtVES = n => 'Bs ' + Math.round(n || 0).toLocaleString('es-VE');
const fmtUSD = n => '$' + Number(n || 0).toFixed(2);

const methodInfo = {
    'cash-usd': ['Efec $', 'm-cash-usd'],
    'cash-ves': ['Efec Bs', 'm-cash-ves'],
    'card-ves': ['Punto', 'm-card'],
    'pago-movil': ['P. Móvil', 'm-pm'],
    'cash-eur': ['Euro €', 'm-eur'],
    'Crédito': ['Fiado', 'm-credit'],
    'Fiado': ['Fiado', 'm-credit']
};

// ===== LOGIN =====
document.getElementById('keypad').addEventListener('click', e => {
    const key = e.target.closest('.key');
    if (!key) return;
    const val = key.dataset.val;
    if (!val) return;

    if (val === 'del') {
        pinCode = pinCode.slice(0, -1);
    } else if (pinCode.length < 4) {
        pinCode += val;
    }
    updateDots();

    if (pinCode.length === 4) {
        setTimeout(() => tryAuth(), 200);
    }
});

function updateDots() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => {
        d.classList.toggle('filled', i < pinCode.length);
        d.classList.remove('error');
    });
}

async function tryAuth() {
    try {
        const res = await fetch('/api/boss/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pinCode })
        });
        const data = await res.json();
        if (data.success) {
            authToken = data.token;
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app').classList.add('active');
            initApp();
        } else {
            showPinError();
        }
    } catch (e) {
        // Offline or server error — allow default PIN
        if (pinCode === '0000') {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app').classList.add('active');
            initApp();
        } else {
            showPinError();
        }
    }
}

function showPinError() {
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));
    setTimeout(() => {
        pinCode = '';
        updateDots();
    }, 500);
}

// ===== APP INIT =====
function initApp() {
    initSocket();
    fetchAll();
    setInterval(fetchAll, 30000);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

function initSocket() {
    try {
        socket = io();
        socket.on('connect', () => console.log('Boss conectado'));
        socket.on('dashboard-update', data => {
            dashboardData = data;
            renderDashboard();
        });
        // Listen for real-time sale events
        socket.on('new-sale', sale => {
            allSales.unshift(sale);
            renderDashboard();
            renderSales();
        });
    } catch (e) {
        console.log('Socket no disponible');
    }
}

async function fetchAll() {
    await Promise.all([fetchSummary(), fetchSales(), fetchInventory(), fetchCredits()]);
    renderDashboard();
    renderSales();
    renderInventory();
    renderCredits();
    renderReports();
}

async function fetchSummary() {
    try {
        const res = await fetch('/api/boss/summary');
        dashboardData = await res.json();
    } catch (e) {}
}

async function fetchSales() {
    try {
        const res = await fetch('/api/boss/sales');
        allSales = await res.json();
    } catch (e) {}
}

async function fetchInventory() {
    try {
        const res = await fetch('/api/boss/inventory');
        allProducts = await res.json();
    } catch (e) {}
}

async function fetchCredits() {
    try {
        const res = await fetch('/api/boss/credits');
        allCredits = await res.json();
    } catch (e) {}
}

// ===== NAVIGATION =====
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('view-' + view).classList.add('active');
    });
});

// Period tabs for sales
document.querySelectorAll('.period-tabs .period-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        this.parentElement.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentPeriod = this.dataset.period;
        renderSales();
        renderReports();
    });
});

// ===== RENDER: DASHBOARD =====
function renderDashboard() {
    const d = dashboardData;
    if (!d) return;

    // Company name
    const hdr = document.getElementById('hdr-company');
    if (d.companyName) {
        const w = d.companyName.split(' ');
        hdr.innerHTML = w.length > 1 ? `${w[0]} <span>${w.slice(1).join(' ')}</span>` : `<span>${d.companyName}</span>`;
    }

    document.getElementById('k-ves').textContent = fmtVES(d.today?.totalVES);
    document.getElementById('k-usd').textContent = fmtUSD(d.today?.totalUSD);
    document.getElementById('k-tickets').textContent = d.today?.tickets || 0;
    document.getElementById('k-items').textContent = (d.today?.items || 0) + ' artículos';
    document.getElementById('k-rate').textContent = (d.exchangeRate || 0).toFixed(2);

    // Profit estimate
    const profit = (d.today?.totalUSD || 0) - (d.today?.totalCostUSD || 0);
    document.getElementById('k-profit').textContent = fmtUSD(profit);

    // Recent sales (top 8)
    const salesEl = document.getElementById('dash-sales');
    const recent = (d.recentSales || []).slice(0, 8);
    if (recent.length > 0) {
        salesEl.innerHTML = recent.map(s => {
            const [label, cls] = methodInfo[s.method] || ['Otro', ''];
            return `<div class="sale-row">
                <div class="sale-info">
                    <div class="sale-ticket">#${s.ticket} — ${s.client}</div>
                    <div class="sale-meta">${s.time} · <span class="method-tag ${cls}">${label}</span></div>
                </div>
                <div class="sale-amount">${fmtVES(s.totalVES)}</div>
            </div>`;
        }).join('');
    } else {
        salesEl.innerHTML = '<div class="empty"><i class="fas fa-moon"></i>No hay ventas hoy</div>';
    }

    // Alerts
    const alertsEl = document.getElementById('dash-alerts');
    let alertHTML = '';
    let alertCount = 0;

    if (d.alerts?.outOfStock?.length) {
        d.alerts.outOfStock.forEach(p => {
            alertHTML += `<div class="sale-row"><div class="sale-info"><div class="sale-ticket" style="color:#fca5a5;">${p.name}</div><div class="sale-meta">AGOTADO</div></div><div style="color:#ef4444;font-weight:900;font-size:11px;">⚠️</div></div>`;
        });
        alertCount += d.alerts.outOfStock.length;
    }
    if (d.alerts?.lowStock?.length) {
        d.alerts.lowStock.forEach(p => {
            alertHTML += `<div class="sale-row"><div class="sale-info"><div class="sale-ticket" style="color:#fbbf24;">${p.name}</div><div class="sale-meta">${p.stock} unidades</div></div><div style="color:#f59e0b;font-weight:900;font-size:11px;">⚡</div></div>`;
        });
        alertCount += d.alerts.lowStock.length;
    }

    alertsEl.innerHTML = alertHTML || '<div class="empty">Todo en orden ✅</div>';
    document.getElementById('alert-count').textContent = alertCount;

    // Nav badge
    const invTab = document.querySelector('.nav-tab[data-view="inventory"]');
    const existingBadge = invTab.querySelector('.alert-badge');
    if (alertCount > 0 && !existingBadge) {
        invTab.insertAdjacentHTML('beforeend', '<div class="alert-badge"></div>');
    } else if (alertCount === 0 && existingBadge) {
        existingBadge.remove();
    }
}

// ===== RENDER: SALES =====
function renderSales() {
    const el = document.getElementById('sales-list');
    const filtered = filterByPeriod(allSales);

    if (filtered.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-receipt"></i>No hay ventas en este período</div>';
        return;
    }

    el.innerHTML = filtered.slice(0, 50).map(s => {
        const items = (typeof s.items === 'string') ? JSON.parse(s.items || '[]') : (s.items || []);
        const totalVES = s.totalVES || s.total || 0;
        const totalUSD = s.totalUSD || (s.total / (s.exchangeRate || 36.5)) || 0;
        const method = s.method || 'cash-usd';
        const [label, cls] = methodInfo[method] || ['Otro', ''];
        const clientName = s.client_name || (typeof s.client === 'object' ? s.client?.name : s.client) || 'Cliente';
        const date = new Date(s.date || s.timestamp);
        const time = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
        const ticket = s.ticket || s.id || '---';
        const itemCount = items.reduce((a, i) => a + (i.qty || 1), 0);

        return `<div class="sale-row">
            <div class="sale-info">
                <div class="sale-ticket">#${ticket} — ${clientName}</div>
                <div class="sale-meta">${dateStr} ${time} · ${itemCount} arts · <span class="method-tag ${cls}">${label}</span></div>
            </div>
            <div class="sale-amount">${fmtUSD(totalUSD)}<br><span style="font-size:10px;color:#64748b;">${fmtVES(totalVES)}</span></div>
        </div>`;
    }).join('');
}

// ===== RENDER: INVENTORY =====
function renderInventory() {
    const el = document.getElementById('inv-list');
    const query = (document.getElementById('inv-search')?.value || '').toLowerCase();
    let filtered = allProducts;
    if (query) filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(query));

    // Sort: out of stock first, then low stock, then by name
    filtered = [...filtered].sort((a, b) => {
        if (a.stock <= 0 && b.stock > 0) return -1;
        if (b.stock <= 0 && a.stock > 0) return 1;
        if (a.stock <= 5 && b.stock > 5) return -1;
        if (b.stock <= 5 && a.stock > 5) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    if (filtered.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-box-open"></i>Sin productos</div>';
        return;
    }

    el.innerHTML = filtered.map(p => {
        const stock = p.stock || 0;
        const min = p.minStock || 5;
        let stockClass = 'stock-ok';
        if (stock <= 0) stockClass = 'stock-out';
        else if (stock <= min) stockClass = 'stock-low';

        const price = p.priceUSD || p.price || 0;
        const cat = p.category || '';

        return `<div class="prod-row">
            <div class="prod-info">
                <div class="prod-name">${p.name}</div>
                <div class="prod-cat">${cat} · Costo: ${fmtUSD(p.costPrice || 0)}</div>
            </div>
            <div class="prod-price">${fmtUSD(price)}</div>
            <div class="stock-pill ${stockClass}">${stock}</div>
            <div class="prod-edit" onclick="openEdit('${p.id}')"><i class="fas fa-pen"></i></div>
        </div>`;
    }).join('');
}

// Search handler
document.getElementById('inv-search')?.addEventListener('input', () => renderInventory());

// ===== RENDER: CREDITS =====
function renderCredits() {
    const el = document.getElementById('credits-list');
    if (allCredits.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-check-circle"></i>No hay deudas pendientes 🎉</div>';
        document.getElementById('k-total-debt').textContent = '$0.00';
        document.getElementById('credit-count').textContent = '0';
        return;
    }

    let totalDebt = 0;
    el.innerHTML = allCredits.map(c => {
        const owed = c.amount_owed || c.sale_total || 0;
        const paid = c.amount_paid || 0;
        const pending = owed - paid;
        totalDebt += pending;
        const pct = owed > 0 ? Math.min((paid / owed) * 100, 100) : 0;
        const client = c.client_name || 'Desconocido';
        const ticket = c.sale_ticket || c.sale_id || '---';
        const date = new Date(c.date).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });

        return `<div class="credit-row">
            <div class="credit-top">
                <div class="credit-client">${client}</div>
                <div class="credit-amount">${fmtUSD(pending)}</div>
            </div>
            <div class="credit-meta">Ticket #${ticket} · ${date} · Abonado: ${fmtUSD(paid)} de ${fmtUSD(owed)}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');

    document.getElementById('k-total-debt').textContent = fmtUSD(totalDebt);
    document.getElementById('credit-count').textContent = allCredits.length;
}

// ===== RENDER: REPORTS =====
function renderReports() {
    const filtered = filterByPeriod(allSales);
    let totalUSD = 0, totalVES = 0;
    const productCount = {};
    const methodCount = {};

    filtered.forEach(s => {
        const sUSD = s.totalUSD || (s.total / (s.exchangeRate || 36.5)) || 0;
        const sVES = s.totalVES || s.total || 0;
        totalUSD += sUSD;
        totalVES += sVES;

        const method = s.method || 'cash-usd';
        methodCount[method] = (methodCount[method] || 0) + 1;

        const items = (typeof s.items === 'string') ? JSON.parse(s.items || '[]') : (s.items || []);
        items.forEach(item => {
            const name = item.name || 'Producto';
            productCount[name] = (productCount[name] || 0) + (item.qty || 1);
        });
    });

    document.getElementById('r-total').textContent = fmtUSD(totalUSD);
    document.getElementById('r-total-ves').textContent = fmtVES(totalVES);

    // Top products
    const topEl = document.getElementById('r-top-products');
    const sorted = Object.entries(productCount).sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (sorted.length > 0) {
        topEl.innerHTML = sorted.map(([name, qty], i) =>
            `<div class="top-item"><div class="top-rank">${i + 1}</div><div class="top-name">${name}</div><div class="top-qty">${qty} uds</div></div>`
        ).join('');
    } else {
        topEl.innerHTML = '<div class="empty">Sin datos</div>';
    }

    // Methods
    const methodsEl = document.getElementById('r-methods');
    const totalTx = Object.values(methodCount).reduce((a, b) => a + b, 0) || 1;
    const methodSorted = Object.entries(methodCount).sort((a, b) => b[1] - a[1]);
    if (methodSorted.length > 0) {
        methodsEl.innerHTML = methodSorted.map(([method, count]) => {
            const [label] = methodInfo[method] || [method];
            const pct = ((count / totalTx) * 100).toFixed(0);
            return `<div class="method-bar"><div class="name">${label}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="pct">${pct}%</div></div>`;
        }).join('');
    } else {
        methodsEl.innerHTML = '<div class="empty">Sin datos</div>';
    }
}

// ===== PERIOD FILTER =====
function filterByPeriod(sales) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfDay - (now.getDay() * 86400000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return sales.filter(s => {
        const ts = s.timestamp || new Date(s.date).getTime() || 0;
        if (currentPeriod === 'today') return ts >= startOfDay;
        if (currentPeriod === 'week') return ts >= startOfWeek;
        if (currentPeriod === 'month') return ts >= startOfMonth;
        return true;
    });
}

// ===== PRODUCT EDIT =====
function openEdit(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = p.name || '';
    document.getElementById('edit-price').value = p.priceUSD || p.price || 0;
    document.getElementById('edit-priceVES').value = p.priceVES || 0;
    document.getElementById('edit-stock').value = p.stock || 0;
    document.getElementById('edit-cost').value = p.costPrice || 0;
    document.getElementById('edit-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

async function saveProduct() {
    const id = document.getElementById('edit-id').value;
    const p = allProducts.find(x => x.id === id);
    if (!p) return;

    p.priceUSD = parseFloat(document.getElementById('edit-price').value) || p.priceUSD;
    p.price = p.priceUSD;
    p.priceVES = parseFloat(document.getElementById('edit-priceVES').value) || p.priceVES;
    p.stock = parseInt(document.getElementById('edit-stock').value) || 0;
    p.costPrice = parseFloat(document.getElementById('edit-cost').value) || p.costPrice;

    try {
        await fetch('/api/boss/update-product', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p)
        });
    } catch (e) {
        console.error('Error guardando:', e);
    }

    closeModal();
    renderInventory();
}

// Close modal on overlay click
document.getElementById('edit-modal').addEventListener('click', e => {
    if (e.target.id === 'edit-modal') closeModal();
});
