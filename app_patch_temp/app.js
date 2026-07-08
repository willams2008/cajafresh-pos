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

let products = [];
let sales = [];
let cart = [];
let clients = [];
let expenses = JSON.parse(localStorage.getItem('freshpos_expenses')) || [];

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

let mobileOrdersQueue = [];
let settings = {
    exchangeRate: 36.50,
    appName: 'FreshPOS',
    companyName: 'Zona Fresh',
    companyFooter: 'Zona Fresh 2025 | 0414-1006858',
    ticketFontSize: 10,
    autoPrint: false
};
const TAX_RATE = 0; // IVA Eliminado globalmente en v16
let currentTicketNumber = parseInt(localStorage.getItem('freshpos_ticket')) || 1;
let autoCloseTimer = null;
let currentRole = 'admin';
let searchTerm = '';
let inventorySearchTerm = '';
let currentCategory = 'Todos';

// Initial Seed Data (Precios internos en USD, UI muestra base VES)


const INITIAL_DATA_PRODUCTS = [
    { id: 'p_1', name: 'Coca-Cola Clásica Lata', category: 'Gaseosas', price: 1.50, costPrice: 0.80, stock: 45, img: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_2', name: 'Agua Mineral Evian', category: 'Aguas', price: 2.00, costPrice: 1.10, stock: 30, img: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4c?auto=format&fit=crop&q=80&w=400' },
    { id: 'p_3', name: 'Jugo de Naranja Natural', category: 'Jugos', price: 2.50, costPrice: 1.50, stock: 15, img: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&q=80&w=400' }
];
const INITIAL_DATA_CLIENTS = [
    { id: 'c_1', document: 'V-12345678', name: 'Cliente Frecuente', phone: '0414-1234567' }
];

// Formatting Utils
const formatUSD = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.round(amount));
const formatVES = (amount) => {
    const rounded = Math.round(amount / 10) * 10;
    return new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES', maximumFractionDigits: 0 }).format(rounded).replace(',00', '');
};
const padTicketNumber = (num) => num.toString().padStart(4, '0');
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);
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
window.suggestPrice = (target) => {
    const rate = settings.exchangeRate || 36.50;
    const vesInput = document.getElementById('product-price-ves');
    const usdInput = document.getElementById('product-price-usd');

    if (target === 'VES') {
        const usdVal = parseFloat(usdInput.value) || 0;
        if (usdVal > 0) {
            // Suggest VES based on USD * Rate, rounded to nearest 10
            vesInput.value = (Math.round((usdVal * rate) / 10) * 10).toFixed(2);
        }
    } else if (target === 'USD') {
        const vesVal = parseFloat(vesInput.value) || 0;
        if (vesVal > 0) {
            // Suggest USD based on VES / Rate
            usdInput.value = (vesVal / rate).toFixed(2);
        }
    }
};

let ocrDetectedItems = [];

// Initialize System
document.addEventListener('DOMContentLoaded', () => {
    console.log("Iniciando Sistema FreshPOS...");
    try {
        loadData();
        initTheme();
        initNavigation();
        initPOS();
        initInventory();
        initClients();
        initCheckout();
        initPurchases();
        initMobileServer();
        updateCartUI();
        renderReports();
        initSettingsAndAutoClose();
        initSettingsView();
        initClientSearch();
    } catch (e) {
        console.error("Error crítico durante la inicialización:", e);
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
        document.getElementById('theme-icon').className = nowDark ? 'fas fa-sun text-lg' : 'fas fa-moon text-lg';
    });

    // Set initial icon
    document.getElementById('theme-icon').className = isDark ? 'fas fa-sun text-lg' : 'fas fa-moon text-lg';
}

function loadData() {
    products = JSON.parse(localStorage.getItem('freshpos_products')) || [...INITIAL_DATA_PRODUCTS];
    sales = JSON.parse(localStorage.getItem('freshpos_sales')) || [];
    clients = JSON.parse(localStorage.getItem('freshpos_clients')) || [...INITIAL_DATA_CLIENTS];
    const defaultSettings = {
        exchangeRate: 36.50,
        appName: 'FreshPOS',
        companyName: 'Zona Fresh',
        companyFooter: 'Zona Fresh 2025 | 0414-1006858',
        ticketFontSize: 10,
        autoPrint: false,
        bossPhone: '',
        callmebotKey: ''
    };
    settings = { ...defaultSettings, ...(JSON.parse(localStorage.getItem('freshpos_settings')) || {}) };


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
        return p;
    });

    if (!localStorage.getItem('freshpos_products')) saveProducts();
    if (!localStorage.getItem('freshpos_clients')) saveClients();
    saveSettings();

    document.getElementById('exchange-rate-input').value = settings.exchangeRate;

    // Apply app name to header
    const h1 = document.querySelector('h1.hidden.lg\\:block');
    if (h1 && settings.appName) {
        h1.innerHTML = settings.appName.replace('POS', '<span class="text-brand-600">POS</span>');
    }

    // Update ticket template
    const ticketBrand = document.getElementById('print-ticket-brand');
    if (ticketBrand) ticketBrand.textContent = settings.companyName || 'Zona Fresh';

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
    if (!localStorage.getItem('migration_v38_2_done')) {
        migrateUserProducts();
        localStorage.setItem('migration_v38_2_done', 'true');
    }
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
    localStorage.setItem('freshpos_products', JSON.stringify(products)); 
    if (typeof syncProductsToMobile === 'function') syncProductsToMobile();
}
function saveSales() { localStorage.setItem('freshpos_sales', JSON.stringify(sales)); }
function saveClients() { localStorage.setItem('freshpos_clients', JSON.stringify(clients)); }
function saveExpenses() { localStorage.setItem('freshpos_expenses', JSON.stringify(expenses)); }
function saveSettings() {
    localStorage.setItem('freshpos_settings', JSON.stringify(settings)); 
    if (typeof syncProductsToMobile === 'function') syncProductsToMobile();
}
function incTicketNumber() { currentTicketNumber++; localStorage.setItem('freshpos_ticket', currentTicketNumber); }

// El sistema utiliza ahora initMobileServer() definido en la sección de automatización (al final del archivo).


// Navigation Logic
function initNavigation() {
    const navItems = {
        'nav-pos': 'view-pos',
        'nav-inventory': 'view-inventory',
        'nav-clients': 'view-clients',
        'nav-reports': 'view-reports',
        'nav-purchases': 'view-purchases',
        'nav-credits': 'view-credits',
        'nav-expenses': 'view-expenses',
        'nav-server': 'view-server',
        'nav-settings': 'view-settings'
    };

    for (let navId in navItems) {
        document.getElementById(navId).addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(el => {
                el.classList.remove('bg-brand-50', 'text-brand-600', 'active');
                el.classList.add('text-slate-500');
            });
            const clicked = e.currentTarget;
            clicked.classList.remove('text-slate-500');
            clicked.classList.add('bg-brand-50', 'text-brand-600', 'active');

            document.querySelectorAll('.view-section').forEach(view => {
                view.classList.add('hidden', 'opacity-0');
            });
            const viewId = navItems[navId];
            const activeView = document.getElementById(viewId);
            activeView.classList.remove('hidden');
            setTimeout(() => activeView.classList.remove('opacity-0'), 20);

            if (viewId === 'view-pos') renderProducts();
            if (viewId === 'view-inventory') renderInventory();
            if (viewId === 'view-clients') renderClients();
            if (viewId === 'view-reports') renderReports();
            if (viewId === 'view-purchases') initPurchases();
            if (viewId === 'view-credits') renderCredits();
            if (viewId === 'view-expenses') renderExpenses();
            if (viewId === 'view-server') initMobileServer();
        });
    }
}

// Settings & AutoClose Logic
function initSettingsAndAutoClose() {
    document.getElementById('exchange-rate-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (val > 0) {
            settings.exchangeRate = val;
            saveSettings();
            // Update all product prices based on new rate
            products = products.map(p => {
                if (p.priceUSD > 0) {
                    p.priceVES = Math.round((p.priceUSD * settings.exchangeRate) / 10) * 10;
                } else if (p.priceVES > 0) {
                    p.priceUSD = p.priceVES / settings.exchangeRate;
                }
                return p;
            });
            saveProducts();
            renderProducts();
            if (!document.getElementById('view-inventory').classList.contains('hidden')) renderInventory();
            updateCartUI();
            renderReports();
            Swal.fire({ title: 'Tasa Ajustada', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        }
    });

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
    updateAutoPrintUI();
    apBtn.addEventListener('click', () => {
        settings.autoPrint = !settings.autoPrint;
        saveSettings();
        updateAutoPrintUI();
    });

    // Auto close check every minute
    autoCloseTimer = setInterval(() => {
        const now = new Date();
        if (now.getHours() === 18 && now.getMinutes() === 15) {
            // Check if we haven't already closed today
            const lastCloseStr = localStorage.getItem('freshpos_last_close');
            const todayStr = now.toDateString();

            if (lastCloseStr !== todayStr && sales.length > 0) {
                console.log("Activando Cierre Automático 18:15");
                localStorage.setItem('freshpos_last_close', todayStr);
                generateZReport(true); // true = reset data
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

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category;
            renderProducts();
        });
    });

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
                <div class="flex items-center justify-between p-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100 hover:border-brand-200 transition-all group">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-black bg-brand-100 text-brand-700 px-2 py-0.5 rounded-lg">#${s.ticket}</span>
                            <span class="text-[10px] text-slate-400 font-bold uppercase">${new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div class="text-sm font-bold text-slate-700 truncate w-32 md:w-32">${s.client.name}</div>
                    </div>
                    <div class="text-right mr-3">
                        <div class="text-sm font-black text-slate-800">${formatVES(s.totalVES)}</div>
                        <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Ref: ${formatUSD(s.totalUSD)}</div>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="printTicketFromReport('${s.ticket}')" class="w-9 h-9 rounded-xl bg-white border border-slate-200 text-brand-600 hover:bg-brand-50 transition-all flex items-center justify-center shadow-sm">
                            <i class="fas fa-print"></i>
                        </button>
                        <button onclick="continueInvoice('${s.ticket}')" class="w-9 h-9 rounded-xl bg-white border border-slate-200 text-emerald-600 hover:bg-emerald-50 transition-all flex items-center justify-center shadow-sm" title="Cargar">
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

function renderProducts() {
    const grid = document.getElementById('products-grid');
    if (!grid) return;
    
    const filtered = products.filter(p => {
        const matchesCat = currentCategory === 'Todos' || p.category === currentCategory;
        const matchesSearch = p.name.toLowerCase().includes(searchTerm);
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


// ==========================================
// INVENTORY LOGIC
// ==========================================
function initInventory() {
    const modal = document.getElementById('product-modal');
    const content = document.getElementById('product-modal-content');

    document.getElementById('open-add-product').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('product-featured').checked = false;
        document.getElementById('modal-product-title').textContent = 'Añadir Producto';
        document.getElementById('product-img-preview').classList.add('hidden');
        document.getElementById('product-flavors-container').innerHTML = ''; // Clear flavors
        document.getElementById('product-flavors-input').value = '';

        modal.classList.add('modal-open');
        setTimeout(() => { modal.classList.add('modal-fade-in'); content.classList.add('modal-scale-in'); }, 10);
    });

    document.querySelectorAll('.close-product-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); content.classList.remove('modal-scale-in');
        setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));

    // Add event listeners for price suggestion
    document.getElementById('product-price-ves').addEventListener('input', () => suggestPrice('USD'));
    document.getElementById('product-price-usd').addEventListener('input', () => suggestPrice('VES'));

    document.getElementById('product-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (currentRole !== 'admin') {
            Swal.fire('Acceso Denegado', 'No tienes permiso para realizar esta acción.', 'error');
            return;
        }
        const id = document.getElementById('product-id').value;

        const name = document.getElementById('product-name').value;
        const category = document.getElementById('product-category').value;
        const subcategory = document.getElementById('product-subcategory').value;
        const priceVES = parseFloat(document.getElementById('product-price-ves').value) || 0;
        const priceUSD = parseFloat(document.getElementById('product-price-usd').value) || 0;
        const costPrice = parseFloat(document.getElementById('product-cost-price').value) || 0;
        const stock = parseInt(document.getElementById('product-stock').value) || 0;
        const img = document.getElementById('product-img').value;
        const featured = document.getElementById('product-featured').checked;
        const flavors = document.getElementById('product-flavors-input').value.split(',').map(f => f.trim()).filter(f => f !== '');

        if (!name || !category || (priceVES <= 0 && priceUSD <= 0)) {
            Swal.fire('Error', 'Nombre, categoría y al menos un precio son obligatorios.', 'error');
            return;
        }

        if (id) {
            const index = products.findIndex(p => p.id === id);
            if (index > -1) {
                products[index] = { ...products[index], name, category, subcategory, priceVES, priceUSD, costPrice, stock, img, featured, flavors };
            }
        } else {
            products.push({ id: generateId(), name, category, subcategory, priceVES, priceUSD, costPrice, stock, img, featured, flavors });
        }

        saveProducts();
        renderInventory();
        renderProducts(); // Update POS view
        document.querySelector('.close-product-modal').click();
        Swal.fire({ title: 'Guardado', icon: 'success', timer: 1500, showConfirmButton: false });
    });

    document.getElementById('product-img').addEventListener('input', (e) => {
        const preview = document.getElementById('product-img-preview');
        if (e.target.value) {
            preview.src = e.target.value;
            preview.classList.remove('hidden');
        } else {
            preview.src = 'https://via.placeholder.com/150?text=No+Image';
        }
    });

    document.getElementById('product-flavors-input').addEventListener('input', (e) => {
        const flavorsContainer = document.getElementById('product-flavors-container');
        flavorsContainer.innerHTML = '';
        e.target.value.split(',').map(f => f.trim()).filter(f => f !== '').forEach(flavor => {
            const span = document.createElement('span');
            span.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2 mb-2';
            span.textContent = flavor;
            flavorsContainer.appendChild(span);
        });
    });

    document.getElementById('inventory-search').addEventListener('input', debounce((e) => {
        inventorySearchTerm = e.target.value.toLowerCase();
        renderInventory();
    }, 300));


    renderInventory();
}

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    
    const filtered = products.filter(p => p.name.toLowerCase().includes(inventorySearchTerm));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-slate-400">No hay productos que coincidan con la búsqueda.</td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group border-b border-slate-100";
        tr.innerHTML = `
            <td class="py-3 px-4">
                <img src="${p.img || 'https://via.placeholder.com/50?text=No+Image'}" alt="${p.name}" class="w-10 h-10 object-cover rounded-md">
            </td>
            <td class="py-3 px-4 font-bold text-slate-800">${p.name}</td>
            <td class="py-3 px-4 text-slate-600">${p.category}</td>
            <td class="py-3 px-4 text-slate-600">${formatVES(p.priceVES)}</td>
            <td class="py-3 px-4 text-slate-600">${formatUSD(p.priceUSD || p.price)}</td>
            <td class="py-3 px-4 text-slate-600">${formatUSD(p.costPrice)}</td>
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
    document.getElementById('product-subcategory').value = p.subcategory;
    document.getElementById('product-price-ves').value = p.priceVES;
    document.getElementById('product-price-usd').value = p.priceUSD;
    document.getElementById('product-cost-price').value = p.costPrice;
    document.getElementById('product-stock').value = p.stock;
    document.getElementById('product-img').value = p.img;
    document.getElementById('product-featured').checked = !!p.featured;
    document.getElementById('product-img-preview').src = p.img || 'https://via.placeholder.com/150?text=No+Image';
    document.getElementById('product-img-preview').classList.remove('hidden');
    document.getElementById('modal-product-title').textContent = 'Editar Producto';

    // Handle flavors
    document.getElementById('product-flavors-input').value = p.flavors ? p.flavors.join(', ') : '';
    const flavorsContainer = document.getElementById('product-flavors-container');
    flavorsContainer.innerHTML = '';
    if (p.flavors) {
        p.flavors.forEach(flavor => {
            const span = document.createElement('span');
            span.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2 mb-2';
            span.textContent = flavor;
            flavorsContainer.appendChild(span);
        });
    }

    const modal = document.getElementById('product-modal');
    modal.classList.add('modal-open');
    setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('product-modal-content').classList.add('modal-scale-in'); }, 10);
};


window.deleteProduct = (id) => {
    if (currentRole !== 'admin') {
        Swal.fire('Acceso Denegado', 'No tienes permiso para realizar esta acción.', 'error');
        return;
    }
    Swal.fire({ title: '¿Eliminar?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' }).then((res) => {

        if (res.isConfirmed) {
            products = products.filter(p => p.id !== id);
            saveProducts(); renderInventory(); renderProducts();
        }
    });
};

// ==========================================
// CLIENTS LOGIC
// ==========================================
function initClients() {
    const modal = document.getElementById('client-modal');
    const content = document.getElementById('client-modal-content');

    document.getElementById('add-client-btn').addEventListener('click', () => {
        document.getElementById('client-form').reset();
        document.getElementById('client-id').value = '';
        document.getElementById('modal-client-title').textContent = 'Nuevo Cliente';

        modal.classList.add('modal-open');
        setTimeout(() => { modal.classList.add('modal-fade-in'); content.classList.add('modal-scale-in'); }, 10);
    });

    document.querySelectorAll('.close-client-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); content.classList.remove('modal-scale-in');
        setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));

    document.getElementById('client-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('client-id').value;
        const doc = document.getElementById('client-document').value;
        const name = document.getElementById('client-name').value;
        const phone = document.getElementById('client-phone').value;

        if (id) {
            const index = clients.findIndex(c => c.id === id);
            if (index > -1) clients[index] = { id, document: doc, name, phone };
        } else {
            clients.push({ id: generateId(), document: doc, name, phone });
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
        if (!searchTerm) return true;
        return (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.document || '').toLowerCase().includes(searchTerm) ||
            (c.phone || '').toLowerCase().includes(searchTerm);
    });

    if (filtered.length === 0 && searchTerm) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-slate-400 text-sm">No se encontraron clientes con "${searchTerm}"</td></tr>`;
        return;
    }

    filtered.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group";
        tr.innerHTML = `
            <td class="py-3 px-6 font-bold text-slate-800">${c.document}</td>
            <td class="py-3 px-6 text-slate-600">${c.name}</td>
            <td class="py-3 px-6 text-slate-600">${c.phone || '-'}</td>
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
    document.getElementById('client-phone').value = c.phone;
    document.getElementById('modal-client-title').textContent = 'Editar Cliente';

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
                    const cartItem = { ...product, id: cartId, parentId: product.id, name: `${product.name} - ${flavor}`, qty: 1 };
                    if (cartItem.promoPrice && cartItem.promoPrice > 0) {
                        cartItem.originalPriceVES = cartItem.priceVES;
                        cartItem.originalPriceUSD = cartItem.priceUSD;
                        cartItem.priceVES = cartItem.promoPriceVES;
                        cartItem.priceUSD = cartItem.promoPrice; // promoPrice is in USD
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
        const cartItem = { ...product, qty: 1 };
        if (cartItem.promoPrice && cartItem.promoPrice > 0) {
            cartItem.originalPriceVES = cartItem.priceVES;
            cartItem.originalPriceUSD = cartItem.priceUSD;
            cartItem.priceVES = cartItem.promoPriceVES;
            cartItem.priceUSD = cartItem.promoPrice; // promoPrice is in USD
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
        checkoutBtn.disabled = true;
        return;
    }

    list.innerHTML = '';
    let subtotalUSD = 0;
    let subtotalVES = 0;

    cart.forEach(item => {
        // Usar los nuevos precios duales si existen
        const itemPriceVES = item.promoPriceVES || item.priceVES;
        const itemPriceUSD = item.promoPrice || item.priceUSD; // promoPrice is in USD

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

    const totalUSD = subtotalUSD;
    const totalBs = subtotalVES;

    totUSD.textContent = formatUSD(totalUSD);
    totVES.textContent = formatVES(totalBs);

    checkoutBtn.disabled = false;
    checkoutBtn.dataset.totalUsd = totalUSD.toFixed(2);
    checkoutBtn.dataset.totalVes = totalBs.toFixed(2);
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

        document.getElementById('checkout-total-display').textContent = formatUSD(currentTotalUSD);
        document.getElementById('checkout-total-ves-display').textContent = formatVES(currentTotalVES);
        document.getElementById('checkout-observations').value = '';

        // Reset to default method
        document.querySelector('[data-method="cash-usd"]').click();

        modal.classList.add('modal-open');
        setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('checkout-modal-content').classList.add('modal-scale-in'); }, 10);
    });

    // Payment Tabs
    document.querySelectorAll('.payment-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.payment-tab').forEach(t => t.classList.remove('active', 'bg-white', 'shadow-sm', 'text-slate-800'));
            const btn = e.currentTarget;
            btn.classList.add('active', 'bg-white', 'shadow-sm', 'text-slate-800');
            checkoutMethod = btn.dataset.method;

            const cashSec = document.getElementById('cash-section');
            const cardSec = document.getElementById('card-section');
            const input = document.getElementById('amount-received');

            if (checkoutMethod === 'card-ves') {
                cashSec.classList.add('hidden'); cardSec.classList.remove('hidden');
                document.getElementById('tpv-amount-bs').textContent = formatVES(currentTotalVES);
            } else {
                cardSec.classList.add('hidden'); cashSec.classList.remove('hidden');
                input.value = '';
                document.getElementById('currency-input-symbol').textContent = checkoutMethod === 'cash-usd' ? '$' : 'Bs';
                document.getElementById('label-amount-received').textContent = checkoutMethod === 'cash-usd' ? 'Monto Recibido (USD)' : 'Monto Recibido (VES)';
                setTimeout(() => input.focus(), 100);
            }
            validatePayment();
        });
    });

    document.getElementById('amount-received').addEventListener('input', validatePayment);
    document.getElementById('confirm-payment-btn').addEventListener('click', processPayment);
    document.querySelectorAll('.close-checkout-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); document.getElementById('checkout-modal-content').classList.remove('modal-scale-in');
        setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));
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
        isValid = received >= currentTotalUSD;
        changeEl.textContent = formatUSD(Math.max(0, change));
        changeSecEl.textContent = isValid ? `Eq: ${formatVES(changeSec)}` : '';
    } else if (checkoutMethod === 'cash-ves') {
        change = received - currentTotalVES;
        changeSec = change / settings.exchangeRate;
        isValid = received >= currentTotalVES;
        changeEl.textContent = formatVES(Math.max(0, change));
        changeSecEl.textContent = isValid ? `Eq: ${formatUSD(changeSec)}` : '';
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
        
        // Intentar buscar por documento primero si existe
        if (docToFind && docToFind !== 'V-00000000') {
            client = clients.find(c => c.document === docToFind);
        }
        
        // Si no se encontró por documento, intentar por nombre
        if (!client && nameToFind) {
            client = clients.find(c => c.name.toLowerCase() === nameToFind.toLowerCase());
        }
        
        if (!client) {
            // Es un cliente nuevo.
            client = { 
                id: generateId(), 
                document: clientDocInput || 'V-NUEVO', 
                name: clientNameInput || searchVal || 'Cliente Nuevo', 
                phone: clientPhoneInput || '' 
            };
            clients.push(client);
            saveClients();
            if (typeof renderClients === 'function') renderClients();
            console.log('Cliente auto-registrado:', client);
        }
    }

    if (!client) client = { name: 'Cliente Genérico', document: 'V-000000' };

    // Reduce Stock
    cart.forEach(item => {
        const pIndex = products.findIndex(p => p.id === item.id);
        if (pIndex > -1) products[pIndex].stock -= item.qty;
    });

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
                costPrice: products.find(p => p.id === item.id)?.costPrice || 0
            };
        }),
        method: checkoutMethod,
        observations: document.getElementById('checkout-observations').value.trim(),
        totalUSD: currentTotalUSD,
        totalVES: currentTotalVES,
        exchangeRate: settings.exchangeRate,
        totalCostUSD: cart.reduce((acc, item) => {
            const prod = products.find(p => p.id === item.id);
            return acc + ((prod?.costPrice || 0) * item.qty);
        }, 0),
        timestamp: Date.now(),
        status: window.pendingStatus || 'paid'
    };
    sales.push(saleRecord);
    window.pendingStatus = 'paid'; // Reset

    saveProducts(); saveSales(); incTicketNumber();
    if (saleRecord.status === 'pending') {
        Swal.fire({ icon: 'info', title: 'Venta Registrada (Fiao)', text: `Deuda asignada a: ${client.name}`, timer: 2000, showConfirmButton: false });
    }
    if (saleRecord.status === 'pending') {
        Swal.fire({ icon: 'info', title: 'Venta Registrada (Fiao)', text: `Deuda asignada a: ${client.name}`, timer: 2000, showConfirmButton: false });
    }

    cart = []; updateCartUI(); renderProducts();
    if (!document.getElementById('view-inventory').classList.contains('hidden')) renderInventory();

    // Remove loading
    const checkoutModal = document.querySelector('.close-checkout-modal');
    if (checkoutModal) checkoutModal.click();

    if (settings.autoPrint) {
        printTicket(saleRecord);
        document.getElementById('order-number-display').textContent = `Ticket #${padTicketNumber(currentTicketNumber)}`;
        Swal.fire({ title: '¡Pago Exitoso!', text: `Ticket #${saleRecord.ticket} procesado e imprimiendo...`, outline: 'none', icon: 'success', timer: 2000, showConfirmButton: false });
    } else {
        Swal.fire({
            icon: 'success', title: '¡Pago Exitoso!',
            text: `Ticket #${saleRecord.ticket} procesado.`,
            showCancelButton: true,
            confirmButtonColor: '#3b82f6',
            confirmButtonText: '<i class="fas fa-print"></i> Imprimir Ticket',
            cancelButtonText: 'Siguiente Venta',
            reverseButtons: true
        }).then((res) => {
            if (res.isConfirmed) printTicket(saleRecord);
            document.getElementById('order-number-display').textContent = `Ticket #${padTicketNumber(currentTicketNumber)}`;
        });
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

function renderReports() {
    const totalVES = sales.reduce((acc, sale) => acc + sale.totalVES, 0);
    const totalUSD = totalVES / settings.exchangeRate;
    const totalCostUSD = sales.reduce((acc, sale) => acc + (sale.totalCostUSD || 0), 0);
    
    // Calcular ingresos netos: Ventas Pagadas - Costo de Productos - Gastos
    const paidSalesUSD = sales.filter(s => s.status !== 'pending').reduce((acc, s) => acc + s.totalUSD, 0);
    const totalExpensesUSD = expenses.reduce((acc, e) => acc + e.amountUSD, 0);
    const netProfitUSD = paidSalesUSD - totalCostUSD - totalExpensesUSD;

    document.getElementById('report-total-sales').textContent = formatVES(totalVES);
    document.getElementById('report-net-profit').textContent = formatVES(netProfitUSD * settings.exchangeRate);
    document.getElementById('report-total-tickets').textContent = sales.length;
    document.getElementById('report-total-items').textContent = sales.reduce((acc, s) => acc + s.items.reduce((a, i) => a + i.qty, 0), 0);

    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '';
    const sorted = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Map methods to friendly names
    const methodNames = {
        'cash-usd': '<span class="text-green-600 bg-green-50 px-2 rounded font-bold"><i class="fas fa-dollar-sign"></i> Efec $</span>',
        'cash-ves': '<span class="text-blue-600 bg-blue-50 px-2 rounded font-bold"><i class="fas fa-money-bill"></i> Efec BS</span>',
        'card-ves': '<span class="text-brand-600 bg-brand-50 px-2 rounded font-bold"><i class="fas fa-credit-card"></i> Punto BS</span>'
    };

    // Aggregate Data for Charts
    let catTotals = {};
    let methodTotals = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0 };

    sorted.forEach(sale => {
        methodTotals[sale.method] += sale.totalVES;
        sale.items.forEach(item => {
            catTotals[item.category] = (catTotals[item.category] || 0) + (item.unitPriceVES * item.qty);
        });

        const timeStr = new Date(sale.date).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 border-b border-slate-100";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-slate-800 dark:text-slate-100">#${sale.ticket}</td>
            <td class="py-4 px-6 text-slate-500 dark:text-slate-400">${timeStr}</td>
            <td class="py-4 px-6 font-semibold dark:text-slate-200">${sale.client.name}</td>
            <td class="py-4 px-6 text-xs">${methodNames[sale.method] || sale.method}</td>
            <td class="py-4 px-6 text-right font-black text-slate-800 dark:text-slate-100">
                ${formatVES(sale.totalVES)}<br>
                <span class="text-[10px] text-slate-400 font-normal">Ref: ${formatUSD(sale.totalUSD)}</span>
            </td>
            <td class="py-4 px-6 text-center whitespace-nowrap">
                <button onclick="continueInvoice('${sale.ticket}')" class="text-emerald-600 hover:bg-emerald-50 p-2 rounded-lg transition-colors mr-1" title="Continuar Factura">
                    <i class="fas fa-redo-alt"></i>
                </button>
                <button onclick="printTicketFromReport('${sale.ticket}')" class="text-brand-600 hover:bg-brand-50 p-2 rounded-lg transition-colors" title="Imprimir Ticket">
                    <i class="fas fa-print"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Render Charts
    renderInternalCharts(catTotals, methodTotals);

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
// INVENTORY LOGIC (CRUD reused)
// ==========================================
function initInventory() {
    const modal = document.getElementById('product-modal');
    document.getElementById('add-product-btn').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        modal.classList.add('modal-open'); setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('product-modal-content').classList.add('modal-scale-in'); document.getElementById('product-name').focus(); }, 10);
    });
    document.querySelectorAll('.close-product-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); document.getElementById('product-modal-content').classList.remove('modal-scale-in'); setTimeout(() => modal.classList.remove('modal-open'), 300);
    }));

    // NEW: Listener de búsqueda en inventario
    const searchInv = document.getElementById('search-inventory');
    if (searchInv) {
        searchInv.addEventListener('input', (e) => {
            inventorySearchTerm = e.target.value.toLowerCase();
            renderInventory();
        });
    }

    // Remove old fixed price setup logic as it's no longer in HTML
    const fixedSetup = document.getElementById('fixed-price-setup');
    if (fixedSetup) fixedSetup.remove();

    document.getElementById('product-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('product-id').value;
        const name = document.getElementById('product-name').value;
        const category = document.getElementById('product-category').value;
        const stock = parseInt(document.getElementById('product-stock').value) || 0;

        // New Dual Prices
        const priceVES = parseFloat(document.getElementById('product-price-ves').value) || 0;
        const priceUSD = parseFloat(document.getElementById('product-price-usd').value) || 0;
        const promoPriceVES = parseFloat(document.getElementById('product-promo-price-ves').value) || 0;

        // Mantener compatibilidad con lógica antigua (costPrice sique siendo USD)
        const costPrice = parseFloat(document.getElementById('product-cost-price').value) || 0;

        const flavorsRaw = document.getElementById('product-flavors').value;
        const flavors = flavorsRaw ? flavorsRaw.split(',').map(f => f.trim()).filter(Boolean) : [];
        const img = document.getElementById('product-img').value || 'https://via.placeholder.com/400?text=Bebida';
        const featured = document.getElementById('product-featured').checked || false;

        let savedId = id;
        const productData = {
            name, category, stock,
            priceVES, priceUSD, promoPriceVES,
            costPrice, img, featured, flavors
        };

        if (id) {
            const ix = products.findIndex(p => p.id === id);
            if (ix > -1) products[ix] = { ...products[ix], ...productData };
        } else {
            savedId = generateId();
            products.push({ id: savedId, ...productData });
        }
        saveProducts(); renderInventory(); renderProducts();
        document.querySelector('.close-product-modal').click();

        // Si venimos del OCR, vincular el nuevo producto
        if (window.pendingOCRIndex !== undefined && window.pendingOCRIndex !== null) {
            ocrDetectedItems[window.pendingOCRIndex].productId = savedId;
            window.pendingOCRIndex = null;
            setTimeout(renderOCRResults, 350);
        }
    });
}
function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = '';

    const filtered = products.filter(p => {
        return p.name.toLowerCase().includes(inventorySearchTerm) ||
            p.category.toLowerCase().includes(inventorySearchTerm);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-slate-400 font-medium italic">No se encontraron productos coincidentes.</td></tr>`;
        return;
    }

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group";
        const flavorBadges = (p.flavors && p.flavors.length > 0)
            ? `<div class="flex flex-wrap gap-1 mt-1">${p.flavors.map(f => `<span class="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[9px] font-bold">${f}</span>`).join('')}</div>`
            : '';
        tr.innerHTML = `
            <td class="py-3 px-6"><div class="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 relative"><img src="${p.img}" class="w-full h-full object-cover"></div></td>
            <td class="py-3 px-6 font-bold text-slate-800 dark:text-slate-100 select-none">
                ${p.name}
                ${p.promoPrice ? '<span class="ml-2 px-2 py-0.5 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 rounded-full text-[10px] uppercase font-black">Promo</span>' : ''}
                ${flavorBadges}
            </td>
            <td class="py-3 px-6"><span class="px-3 py-1 bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400 rounded-full text-xs font-bold">${p.category}</span></td>
            <td class="py-3 px-6 text-right font-black text-slate-800 dark:text-slate-100 leading-tight">
                <div class="text-brand-600">${formatVES(p.priceVES || p.price * settings.exchangeRate)}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter italic">Ref: ${formatUSD(p.priceUSD || p.price)}</div>
                ${p.promoPriceVES ? `<div class="text-[9px] text-rose-500 font-black mt-1">PROMO: ${formatVES(p.promoPriceVES)}</div>` : ''}
            </td>
            <td class="py-3 px-6 text-center"><span class="${p.stock <= 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'} px-3 py-1 rounded-full text-xs font-bold">${p.stock}</span></td>
            <td class="py-3 px-6 text-center"><div class="flex flex-center gap-2 opacity-0 group-hover:opacity-100 justify-center">
                <button onclick="editProduct('${p.id}')" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 focus:outline-none"><i class="fas fa-edit"></i></button>
                <button onclick="deleteProduct('${p.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-600"><i class="fas fa-trash-alt"></i></button>
            </div></td>`;
        tbody.appendChild(tr);
    });
}
window.editProduct = (id) => {
    const p = products.find(i => i.id === id);
    if (!p) return;
    ['id', 'name', 'category', 'stock', 'img', 'cost-price'].forEach(k => {
        const el = document.getElementById('product-' + k);
        if (el) el.value = p[k.replace('-price', 'Price')] || (k === 'cost-price' ? p.costPrice : '');
    });

    document.getElementById('product-price-ves').value = (p.priceVES || p.price * settings.exchangeRate).toFixed(2);
    document.getElementById('product-price-usd').value = (p.priceUSD || p.price).toFixed(2);
    document.getElementById('product-promo-price-ves').value = p.promoPriceVES || '';
    document.getElementById('product-flavors').value = (p.flavors && p.flavors.length > 0) ? p.flavors.join(', ') : '';

    const modal = document.getElementById('product-modal');
    modal.classList.add('modal-open'); setTimeout(() => { modal.classList.add('modal-fade-in'); document.getElementById('product-modal-content').classList.add('modal-scale-in'); }, 10);
};
window.deleteProduct = (id) => {
    Swal.fire({ title: '¿Eliminar producto?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' }).then((res) => {
        if (res.isConfirmed) { products = products.filter(p => p.id !== id); saveProducts(); renderInventory(); renderProducts(); }
    });
};
// ==========================================
// PURCHASES (OCR & MARGINS)
// ==========================================
function initPurchases() {
    const dropzone = document.getElementById('ocr-dropzone');
    const input = document.getElementById('ocr-file-input');
    const status = document.getElementById('ai-mode-status');

    if (!dropzone || !input) return;

    dropzone.onclick = () => input.click();

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
        document.getElementById('ocr-dropzone').closest('.bg-white').classList.remove('hidden'); // Show container
        if (status) {
            status.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Modo Local: Activo`;
            status.className = "bg-emerald-50 text-emerald-600 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-emerald-100";
        }
    };

    document.getElementById('confirm-ocr-btn').onclick = () => {
        let appItems = ocrDetectedItems.filter(i => i.productId);
        if (appItems.length === 0) {
            Swal.fire('Error', 'Debes asociar productos de tu inventario.', 'error');
            return;
        }

        appItems.forEach(item => {
            const p = products.find(p => p.id === item.productId);
            if (p) {
                p.stock += Math.round(item.qtyBoxes * item.unitsPerBox);
                const netBox = item.boxPriceGross * (1 - (item.discountPerc / 100));
                p.costPrice = netBox / item.unitsPerBox;
                p.price = item.newPriceVES / settings.exchangeRate;
            }
        });

        saveProducts();
        renderProducts();
        renderInventory();
        Swal.fire({
            title: '¡Stock Actualizado!',
            text: `Se procesaron ${appItems.length} líneas con éxito.`,
            icon: 'success',
            confirmButtonColor: '#10b981'
        });
        document.getElementById('cancel-ocr-btn').click();
    };
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

async function processWithGemini(file) {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        openGeminiSettings();
        return;
    }

    const statusEl = document.getElementById('ai-mode-status');
    statusEl.innerHTML = `<div class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div> Pensando con IA...`;
    statusEl.className = "bg-amber-50 text-amber-600 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-emerald-100";

    // Prompts específicos por empresa - ALTA PRECISION v37.1
    const prompts = {
        glup: `Eres un experto contable en Venezuela analizando una factura de Multinacional de Sabores (Glup, Justy, etc).
        ANALIZA TODA LA FACTURA incluyendo encabezado, cuerpo y pie de página.

        IMPORTANTE: En esta factura, la columna 'PVP ($)' es el PRECIO DE VENTA AL PÚBLICO sugerido por CAJA.
        El precio real que paga el distribuidor (costo de compra por caja) = PVP × (1 - %DCTO/100) × (1 - DescuentoGlobal%/100).

        PASO 1 - DETECTA EL PIE DE FACTURA:
        - Tasa BCV del día (texto como "Tasa del dia (BCV):").
        - Descuento Global % (en el bloque de totales bajo "Sub-Total", ej. "Descuento: 7.00 %").
        - IVA General aplicado (ej. "IVA % 16.00").

        PASO 2 - EXTRAE CADA LÍNEA: columnas ARTICULO, DENOMINACION, CANT, UNID, PVP($), %DCTO, SUBTOTAL($).
        - 'qty': número de CAJAS.
        - 'price': PVP ($) de esa línea por caja.
        - 'dcto': %DCTO de esa línea SOLAMENTE (NO incluyas el descuento global aquí).
        - 'globalDiscount': el Descuento Global % del PASO 1, igual para todos (ej. 7).
        - 'unitsPerBox': botellas por caja según denominación (CAJA x 6BOT = 6, CAJA x 12BOT = 12).
        - 'iva': IVA% del pie de factura (16).
        - 'cleanName': nombre comercial limpio con sabor y tamaño (ej. "Glup Cola Negra 2L").

        Devuelve JSON válido y nada más:
        {"bcvRate": 425.67, "items": [{"desc": "GLUP COLA NEGRA CAJA x 6BOT x 2.0LTS", "cleanName": "Glup Cola Negra 2L", "qty": 320, "price": 6.10, "dcto": 15.0, "globalDiscount": 7.0, "iva": 16, "unitsPerBox": 6}]}`,

        polar: `Eres un experto contable en Venezuela analizando una factura de Cervecería Polar.
        ANALIZA TODA LA FACTURA incluyendo encabezado, cuerpo y pie.

        PASO 1 - DETECTA EL CONTEXTO:
        - IVA aplicado (busca "IVA 16,00 %" o similar).
        - Descuento Global general si existe.

        PASO 2 - EXTRAE CADA LÍNEA DE PRODUCTO: Denominacion Comercial, Cant. (bultos), Precio Unidad, Dto%, IVA%.
        - IMPORTANTE: Ignora las filas de "GAVERA" y "BOTELLA", son envases retornables.
        - 'qty': cantidad de bultos.
        - 'price': precio por bulto (columna Precio Unidad).
        - 'dcto': porcentaje de descuento (Dto%).
        - 'unitsPerBox': infiere por el nombre (Retornable 24u = 24, PET 12u = 12, etc.).
        - 'iva': porcentaje IVA detectado.
        - 'cleanName': nombre comercial limpio.

        Devuelve JSON válido y nada más:
        {"bcvRate": 0, "items": [{"desc": "Polar Malta", "cleanName": "Polar Malta 1L", "qty": 50, "price": 12.0, "dcto": 0, "iva": 16, "unitsPerBox": 12}]}`,

        coca: `Eres un experto contable en Venezuela analizando una factura de Coca-Cola FEMSA / PepsiCo / Pepsi.
        ANALIZA TODA LA FACTURA incluyendo encabezado, cuerpo y pie.

        PASO 1 - DETECTA EL CONTEXTO:
        - Tasa BCV si figura ("Tipo de Cambio BCV Bs:" o similar).
        - IVA aplicado.
        - Descuento global si existe.

        PASO 2 - EXTRAE CADA LÍNEA DE PRODUCTO.
        En este tipo de facturas, las columnas son: Descripción, PMP+IVA USD (precio base por unidad), Dcto(%), Descuento USD, Alicu(%), Total Sin Impuestos, y al final la columna CANT (cantidad de cajas/bultos).
        - 'qty': cantidad (columna CANT al final de la fila).
        - 'price': el "Total Sin Impuestos USD" de esa fila dividido entre la cantidad (qty) para obtener el precio real por bulto. Si no puedes calcular, usa (PMP+IVA USD * unitsPerBox) como estimado.
        - 'dcto': Dcto(%) de esa línea.
        - 'unitsPerBox': infiere del nombre del producto (350MLX24 = 24, 1LX6 = 6, 1.5X8 = 8, 1LX8 = 8, P150mX12 = 12). Busca el patrón "X##" al final del nombre.
        - 'iva': porcentaje IVA.
        - 'cleanName': nombre limpio (ej. "7UP Retornable 350ML", "Gold Kola 1L").

        Devuelve JSON válido y nada más:
        {"bcvRate": 436.24, "items": [{"desc": "7UP RET 350MLX24U", "cleanName": "7UP Retornable 350ML", "qty": 5, "price": 45.03, "dcto": 5.0, "iva": 16, "unitsPerBox": 24}]}`
    };

    const supplier = document.querySelector('input[name="ocr-supplier"]:checked')?.value || 'glup';
    const mainPrompt = prompts[supplier];


    // Intentamos con varios modelos según los detectados en el diagnóstico del usuario
    const modelsToTry = ['gemini-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastError = null;

    for (const modelName of modelsToTry) {
        try {
            const base64Image = await fileToBase64(file);
            const base64Data = base64Image.split(',')[1];

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: mainPrompt },
                            { inline_data: { mime_type: file.type || 'image/jpeg', data: base64Data } }
                        ]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || `Error en ${modelName}`);
            }

            const data = await response.json();
            const textResponse = data.candidates[0].content.parts[0].text;
            const jsonStr = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const response_json = JSON.parse(jsonStr);
            const items = response_json.items || response_json;

            // Si la IA detectó una tasa BCV en la factura, ofrecemos usarla
            const detectedBcv = parseFloat(response_json.bcvRate);
            if (detectedBcv > 0 && Math.abs(detectedBcv - settings.exchangeRate) > 5) {
                Swal.fire({
                    title: '📊 Tasa BCV detectada en factura',
                    html: `La factura indica <b>Bs ${detectedBcv.toFixed(2)}</b> por USD.<br>Tu tasa actual es <b>Bs ${settings.exchangeRate.toFixed(2)}</b>.<br><br>¿Usar la tasa de la factura para calcular los precios?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Usar tasa de la factura',
                    cancelButtonText: 'Mantener la mía',
                    confirmButtonColor: '#6366f1'
                }).then(res => {
                    if (res.isConfirmed) {
                        settings.exchangeRate = detectedBcv;
                        localStorage.setItem('freshpos_settings', JSON.stringify(settings));
                        document.getElementById('exchange-rate-val')?.textContent && (document.getElementById('exchange-rate-val').textContent = detectedBcv.toFixed(2));
                    }
                });
            }

            const detected = items.map(item => {
                // Limpieza profunda de la descripción para mejor coincidencia
                const noise = ['CAJA', 'X', 'BOT', 'RET', 'PET', 'ML', '1.5L', '2.0L', '350CC', '500ML', 'LITROS', 'BOTELLA', 'GAVERA', 'BOTELLAS', 'RETORNABL', 'UNI', '350ML'];
                let cleanDesc = (item.desc || '').toUpperCase();
                noise.forEach(n => {
                    const reg = new RegExp(`\\b${n}\\b`, 'g');
                    cleanDesc = cleanDesc.replace(reg, '');
                });
                cleanDesc = cleanDesc.replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim();

                let mappedProduct = null;
                for (const p of products) {
                    const pNameClean = p.name.toUpperCase();
                    const pWords = pNameClean.split(' ').filter(w => w.length > 3 && !noise.includes(w));
                    let matches = pWords.filter(pw => cleanDesc.includes(pw)).length;
                    if (matches >= 2 || (pWords.length === 1 && cleanDesc.includes(pWords[0]))) {
                        mappedProduct = p;
                        break;
                    }
                    if (cleanDesc.includes(pNameClean.substring(0, 10))) {
                        mappedProduct = p;
                        break;
                    }
                }

                // Usar unitsPerBox que la IA extrajo directamente de la denominación
                const aiUnitsPerBox = parseInt(item.unitsPerBox) || 0;
                const nameBasedUnits = mappedProduct ? (mappedProduct.name.toLowerCase().includes('1.5') || mappedProduct.name.toLowerCase().includes('2') || mappedProduct.name.toLowerCase().includes('1l') ? 6 : 12) : 12;
                const finalUnitsPerBox = aiUnitsPerBox > 0 ? aiUnitsPerBox : nameBasedUnits;

                return {
                    rawText: item.desc || 'Desconocido',
                    cleanName: item.cleanName || item.desc || 'Nuevo Producto',
                    productId: mappedProduct ? mappedProduct.id : '',
                    qtyBoxes: parseFloat(item.qty) || 0,
                    boxPriceGross: parseFloat(item.price) || 0,
                    discountPerc: parseFloat(item.dcto) || 0,
                    globalDiscount: parseFloat(item.globalDiscount) || 0,
                    ivaPerc: parseFloat(item.iva) || 16,
                    unitsPerBox: finalUnitsPerBox,
                    margin: 25,
                    newPriceVES: 0
                };
            });

            ocrDetectedItems = detected;
            renderOCRResults();
            statusEl.innerHTML = `<div class="w-2 h-2 rounded-full bg-brand-500"></div> IA: Procesado con ${modelName}`;
            return; // Éxito, salimos de la función

        } catch (err) {
            lastError = err;
            console.warn(`Falló con ${modelName}:`, err.message);
            // Si el error es de cuota o región, seguimos intentando con el siguiente modelo
        }
    }

    // Si llegamos aquí, todos los modelos fallaron
    Swal.fire({
        title: 'Fallo Total de IA',
        html: `
            <div class="text-left space-y-3">
                <p class="text-sm text-red-600 font-bold">Ningún modelo de Google respondió:</p>
                <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[10px] font-mono whitespace-pre-wrap">${lastError.message}</div>
                <div class="bg-brand-50 p-3 rounded-xl border border-brand-100">
                    <p class="text-[11px] text-brand-700"><b>Causa probable:</b> Si estás en Venezuela, Google bloquea estas peticiones.</p>
                    <button onclick="checkAvailableModels()" class="mt-2 w-full py-2 bg-brand-600 text-white rounded-lg text-[10px] font-black uppercase">Ejecutar Diagnóstico de Modelos</button>
                </div>
            </div>
        `,
        icon: 'error'
    });
    statusEl.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-500"></div> Modo Local: Activo`;
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
                <select onchange="updateOCRItem(${index}, 'productId', this.value)" class="w-64 bg-slate-50 border-2 border-slate-200 rounded-xl py-2 px-3 text-sm font-black text-slate-700 outline-none focus:border-brand-500 transition-all">
                    ${productOptions}
                </select>
            </td>
            <td class="py-4 px-6 text-center">
                <input type="number" value="${item.qtyBoxes}" onchange="updateOCRItem(${index}, 'qtyBoxes', this.value)" class="w-16 border-2 border-slate-100 rounded-lg py-1 px-2 text-center font-bold">
            </td>
            <td class="py-4 px-6 text-center">
                <div class="relative inline-block">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">$</span>
                    <input type="number" step="0.01" value="${item.boxPriceGross}" onchange="updateOCRItem(${index}, 'boxPriceGross', this.value)" class="w-20 pl-4 border-2 border-slate-100 rounded-lg py-1 px-2 text-center font-bold text-slate-500">
                </div>
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
    document.getElementById('ocr-status').textContent = "v37 IA Activo";
    // Mostrar tasa BCV configurada
    const bcvDisp = document.getElementById('ocr-bcv-rate-display');
    if (bcvDisp) bcvDisp.textContent = settings.exchangeRate.toFixed(2);
    // Si no hay tasa mercado puesta, inicializarla igual a BCV como fallback
    const mktInput = document.getElementById('ocr-market-rate');
    if (mktInput && !mktInput.value) mktInput.placeholder = `ej. ${(settings.exchangeRate * 4).toFixed(0)}`;
    calculateOCRFacturaTotals();
}

window.deleteOCRRow = (index) => {
    ocrDetectedItems.splice(index, 1);
    renderOCRResults();
}

window.updateOCRItem = (index, field, value) => {
    const item = ocrDetectedItems[index];
    if (!item) return;
    if (field === 'productId') {
        if (value === 'NEW_PRODUCT') {
            // El usuario seleccionó crear nuevo, pero ahora la creación masiva la hará el botón final.
            // Solo lo marcamos para que el color cambie y sepa que será nuevo.
            item.productId = 'NEW_PRODUCT';
        } else if (value === 'IGNORE_VARIANT') {
            item.productId = 'IGNORE_VARIANT';
        } else {
            item.productId = value;
            const p = products.find(p => p.id === item.productId);
            if (p) {
                item.unitsPerBox = p.name.toLowerCase().includes('1.5') || p.name.toLowerCase().includes('2') || p.name.toLowerCase().includes('1l') ? 6 : 12;
            }
        }
    } else if (field === null && item.productId) {
        const p = products.find(p => p.id === item.productId);
        if (p) {
            item.unitsPerBox = p.name.toLowerCase().includes('1.5') || p.name.toLowerCase().includes('2') || p.name.toLowerCase().includes('1l') ? 6 : 12;
        }
    } else if (field && field !== 'productId') {
        item[field] = parseFloat(value) || 0;
    }

    // Cálculo Neto con descuentos MULTIPLICATIVOS:
    // Costo por caja = PrecioBase × (1 - DctoLinea%) × (1 - DctoGlobal%)
    const lineDcto = (item.discountPerc || 0) / 100;
    const globalDcto = (item.globalDiscount || 0) / 100;
    const baseNetUSD = item.boxPriceGross * (1 - lineDcto) * (1 - globalDcto);
    const netBoxCostWithIVA = baseNetUSD * (1 + (item.ivaPerc / 100));

    // En lugar de calcular el PVP por unidad aislada, 
    // calculamos el PVP sugerido para EL BULTO COMPLETO, 
    // ya que el inventario se vende mayoritariamente por caja/paquete.
    const unitCostUSD = netBoxCostWithIVA / (item.unitsPerBox || 1);

    if (field === 'newPriceVES') {
        // Usuario digitó PVP del BULTO en Bs, calculamos margen real
        const mktRate = parseFloat(document.getElementById('ocr-market-rate')?.value) || settings.exchangeRate;
        const targetBundleUSD = item.newPriceVES / mktRate;
        if (targetBundleUSD > 0 && targetBundleUSD > netBoxCostWithIVA) {
            item.margin = parseFloat(((1 - (netBoxCostWithIVA / targetBundleUSD)) * 100).toFixed(2));
        } else {
            item.margin = 0;
        }
    } else {
        // Usuario digitó el margen, calculamos PVP del BULTO sugerido
        const mktRate = parseFloat(document.getElementById('ocr-market-rate')?.value) || settings.exchangeRate;
        const marginDec = Math.min(item.margin / 100, 0.99);
        const targetBundleUSD = netBoxCostWithIVA / (1 - marginDec);
        const suggestedBundleVES = targetBundleUSD * mktRate;
        item.newPriceVES = Math.ceil(suggestedBundleVES);
    }

    // UI Updates
    const netCostEl = document.getElementById(`ocr-net-cost-${index}`);
    const netCostBsEl = document.getElementById(`ocr-net-cost-bs-${index}`);
    const priceInput = document.getElementById(`ocr-new-price-input-${index}`);
    const marginInput = document.getElementById(`ocr-margin-input-${index}`);
    const costEl = document.getElementById(`ocr-unit-cost-${index}`);
    const unitsEl = document.getElementById(`ocr-total-units-${index}`);

    if (netCostEl) netCostEl.textContent = `$ ${netBoxCostWithIVA.toFixed(2)}`;
    if (netCostBsEl) netCostBsEl.textContent = `Bs ${(netBoxCostWithIVA * settings.exchangeRate).toFixed(2)}`;
    if (priceInput && field !== 'newPriceVES') priceInput.value = item.newPriceVES;
    if (marginInput && field === 'newPriceVES') marginInput.value = item.margin;
    if (costEl) costEl.textContent = `Ref: $${unitCostUSD.toFixed(2)}/u`;
    if (unitsEl) unitsEl.textContent = Math.round(item.qtyBoxes * item.unitsPerBox);

    calculateOCRFacturaTotals();
}

// Recalcula todos los PVP al cambiar la tasa de mercado
window.recalcAllOCRPrices = () => {
    ocrDetectedItems.forEach((_, i) => updateOCRItem(i, null, null));
};

function calculateOCRFacturaTotals() {
    let totalBultos = 0;
    let totalExento = 0;
    let totalBase = 0;
    let totalIVA = 0;

    ocrDetectedItems.forEach(item => {
        totalBultos += item.qtyBoxes || 0;
        const lineDcto = (item.discountPerc || 0) / 100;
        const globalDcto = (item.globalDiscount || 0) / 100;
        const netBaseLine = (item.boxPriceGross * (1 - lineDcto) * (1 - globalDcto)) * item.qtyBoxes;

        if (item.ivaPerc === 0) {
            totalExento += netBaseLine;
        } else {
            totalBase += netBaseLine;
            totalIVA += (netBaseLine * (item.ivaPerc / 100));
        }
    });

    const totalFactura = totalExento + totalBase + totalIVA;

    const bultosEl = document.getElementById('ocr-total-bultos');
    const usdEl = document.getElementById('ocr-total-usd');
    if (bultosEl) bultosEl.textContent = totalBultos.toFixed(1);
    if (usdEl) {
        usdEl.innerHTML = `
            <div class="flex items-center justify-end gap-6 pr-4">
                <div class="text-right">
                    <div class="text-[10px] text-slate-400 uppercase font-black mb-1">Total Factura USD:</div>
                    <div class="text-emerald-400 font-black text-2xl">$${totalFactura.toFixed(2)}</div>
                </div>
                <div class="text-right border-l-2 border-slate-200 pl-6">
                    <div class="text-[10px] text-slate-400 uppercase font-black mb-1">Total Factura Bs:</div>
                    <div class="text-brand-600 font-black text-2xl">Bs ${(totalFactura * settings.exchangeRate).toFixed(2)}</div>
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

    processableItems.forEach(item => {
        // Costo neto real pagado por bulto (incluyendo IVA y Descuento)
        const netBoxBase = item.boxPriceGross * (1 - (item.discountPerc / 100)) * (1 - (item.globalDiscount / 100 || 0));
        const netBoxWithIVA = netBoxBase * (1 + (item.ivaPerc / 100));
        const costPrice = netBoxWithIVA / item.unitsPerBox;
        const newPriceUSD = item.newPriceVES / settings.exchangeRate; // En v37.4 newPriceVES es por BULTO

        if (item.productId === 'NEW_PRODUCT') {
            // Auto-crear producto nuevo
            const newProduct = {
                id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
                name: item.cleanName || item.rawText,
                costPrice: costPrice,
                price: newPriceUSD, // Ojo: Guardamos el precio unitario sugerido en sistema, no el del bulto
                stock: Math.round(item.qtyBoxes * item.unitsPerBox),
                category: 'Bebidas', // Default
                subcategory: '',
                flavors: [], // Vacío por defecto
                image: ''
            };
            // Como guardamos el precio por bulto en la UI, en bd el price siempre es de "unidad de venta sugerida".
            // Para mantener consistencia con como vende el usuario, lo guardaremos tal cual como el PVP del bulto 
            // SI y solo si es un bulto. 
            // PERO... es mejor dejar que el precio sea el del bulto completo porque así lo vende.
            newProduct.price = newPriceUSD;

            products.push(newProduct);
            createdCount++;
        } else {
            // Actualizar producto existente
            const p = products.find(p => p.id === item.productId);
            if (p) {
                p.stock += Math.round(item.qtyBoxes * item.unitsPerBox);
                p.costPrice = costPrice;
                p.price = newPriceUSD;
                updatedCount++;
            }
        }
    });

    saveProducts();
    renderProducts();
    renderInventory();

    Swal.fire({
        title: '¡Inventario Actualizado!',
        html: `Se actualizaron <b>${updatedCount}</b> productos y se crearon <b>${createdCount}</b> nuevos.<br>Se omitieron ${ignoredItems.length} variantes.`,
        icon: 'success',
        confirmButtonColor: '#10b981'
    });
    document.getElementById('cancel-ocr-btn').click();
};

// ==========================================
// MOBILE SERVER & ORDERS LOGIC
// ==========================================
let incomingOrders = [];
const notificationSound = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTdvT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT19vT1");

function initMobileServer() {
    if (window.electronAPI) {
        // Recibir información del servidor desde electron
        window.electronAPI.onServerInfo((info) => {
            const localMobileUrl = `http://${info.ip}:${info.port}/mobile`;
            const localDownloadUrl = `http://${info.ip}:${info.port}/download`;

            document.getElementById('server-ip-display').textContent = localMobileUrl;
            document.getElementById('server-qr-display').src = info.qr;
            document.getElementById('server-status-dot').classList.replace('bg-slate-300', 'bg-emerald-500');

            // Generar el QR de descarga local inmediatamente para que no aparezca "roto"
            window.electronAPI.generateDownloadQR(localDownloadUrl);

            // Sincronizar productos iniciales
            syncProductsToMobile();
        });

        // Temporizador de seguridad para el túnel
        let tunnelTimeout = setTimeout(() => {
            const remoteUrl = document.getElementById('remote-url-display');
            if (remoteUrl && remoteUrl.innerText.includes('INICIANDO')) {
                remoteUrl.innerText = "ERROR AL INICIAR TÚNEL (REINTENTANDO...)";
                remoteUrl.classList.add('text-rose-500');
            }
        }, 20000); // 20 segundos

        // Recibir info del túnel (URL Pública para acceso remoto)
        window.electronAPI.onTunnelInfo((info) => {
            clearTimeout(tunnelTimeout);
            const remoteUrl = document.getElementById('remote-url-display');
            const passContainer = document.getElementById('tunnel-password-container');
            const passDisplay = document.getElementById('tunnel-password-display');

            if (remoteUrl) {
                const urlClean = info.url.replace(/\/$/, ""); // Quitar slash final si existe
                remoteUrl.innerText = urlClean.toUpperCase();
                remoteUrl.href = urlClean + "/mobile";
                remoteUrl.classList.remove('text-rose-500');

                // Generar QRs basados en el túnel (prioritarios)
                window.electronAPI.generateQR(urlClean + '/mobile');
                window.electronAPI.generateDownloadQR(urlClean + '/download');
            }

            if (info.provider === 'cloudflare') {
                if (passContainer) passContainer.classList.add('hidden');
            } else if (info.publicIP && passContainer && passDisplay) {
                passContainer.classList.remove('hidden');
                passDisplay.innerText = info.publicIP;
                passContainer.classList.remove('animate-pulse');
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
        });

        // Escuchar solicitudes de sincronización (cuando un nuevo móvil se conecta)
        window.electronAPI.onRequestSync(() => {
            syncProductsToMobile();
        });
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

    // Update Bell Badge
    const badge = document.getElementById('bell-badge');
    const ordersPanel = document.getElementById('incoming-orders-panel');
    if (!ordersPanel.classList.contains('orders-panel-open')) {
        badge.classList.remove('hidden');
        badge.textContent = parseInt(badge.textContent) + 1;
    }

    // Show Toast
    const toast = document.getElementById('order-notification');
    toast.classList.replace('translate-y-20', 'translate-y-0');
    toast.classList.replace('opacity-0', 'opacity-100');
    toast.classList.remove('pointer-events-none');

    renderIncomingOrders();
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
                <div>
                    <span class="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest">${order.id}</span>
                    <p class="text-xs text-slate-400 font-bold mt-1">${new Date(order.timestamp).toLocaleTimeString()}</p>
                </div>
                <div class="text-right">
                    <p class="text-xl font-black text-slate-800">Bs ${order.totalVES.toLocaleString()}</p>
                    <p class="text-[10px] font-bold text-slate-400">$${order.totalUSD.toFixed(2)}</p>
                </div>
            </div>
            <div class="space-y-2 mb-4 border-t border-slate-50 pt-4">
                ${order.items.map(item => `
                    <div class="flex justify-between text-sm">
                        <span class="text-slate-600 font-medium">${item.qty}x ${item.name}</span>
                        <span class="font-bold text-slate-800">Bs ${Math.round(item.price * settings.exchangeRate) * item.qty}</span>
                    </div>
                `).join('')}
            </div>
            ${paymentInfoHtml}
            <div class="grid grid-cols-2 gap-3 mt-6">
                <button onclick="rejectOrder(${index})" class="py-3 px-4 rounded-2xl bg-slate-100 text-slate-500 font-bold text-xs hover:bg-slate-200 transition-colors">IGNORAR</button>
                <button onclick="approveOrder(${index})" class="py-3 px-4 rounded-2xl bg-emerald-600 text-white font-black text-xs shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-all">COBRAR</button>
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
            cart.push({
                id: p.id,
                name: p.name,
                price: p.price,
                promoPrice: p.promoPrice,
                qty: item.qty,
                img: p.img
            });
        }
    });

    // 3. Quitar de la lista y cerrar panel
    incomingOrders.splice(index, 1);
    document.getElementById('incoming-orders-panel').classList.remove('orders-panel-open');

    // 4. Ir al POS y actualizar UI
    document.getElementById('nav-pos').click();
    updateCartUI();
    renderIncomingOrders();

    // 5. Scroll al final (cart)
    setTimeout(() => {
        document.getElementById('checkout-btn').scrollIntoView({ behavior: 'smooth' });
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
    let msg = "¡Hola! 🥤 Entra al Punto de Venta de Zona Fresh desde aquí: \n\n";

    if (type === 'local') {
        url = document.getElementById('server-ip-display').textContent;
        msg = "¡Hola! 🥤 Entra al Punto de Venta de Zona Fresh (WiFiLocal) desde aquí: \n\n";
    } else if (type === 'download') {
        url = document.getElementById('remote-url-display').href.replace('/mobile', '/download');
        msg = "¡Instala la App de Zona Fresh! 📱📥\nEntra aquí para descargar e instalar en tu celular: \n\n";
    } else {
        url = document.getElementById('remote-url-display').href;
        msg = "¡Hola! 🥤 Entra al Punto de Venta de Zona Fresh (Remoto) desde aquí: \n\n";

        const passContainer = document.getElementById('tunnel-password-container');
        const pass = document.getElementById('tunnel-password-display').innerText;

        if (passContainer && !passContainer.classList.contains('hidden') && pass && pass !== '---') {
            msg += `🔑 Clave de acceso: ${pass}\n\n`;
        }
    }

    if (!url || url.includes('Iniciando') || url.includes('Detectando')) {
        Swal.fire('Espera un momento', 'El enlace aún no está listo. Intenta en 5 segundos.', 'warning');
        return;
    }

    const waLink = `https://wa.me/?text=${encodeURIComponent(msg + url)}`;
    window.open(waLink, '_blank');
};

window.rejectOrder = (index) => {
    incomingOrders.splice(index, 1);
    renderIncomingOrders();
};

function syncProductsToMobile() {
    if (window.electronAPI) {
        window.electronAPI.syncProducts({
            products: products.map(p => ({
                ...p,
                price: p.priceUSD || p.price || 0, // Fallback for mobile app compatibility
                priceVES: p.priceVES || (p.priceUSD * settings.exchangeRate) || 0
            })),
            exchangeRate: settings.exchangeRate
        });
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


        if (!appNameInput || !saveBtn) {
            console.warn('Config view elements not fully found:', { appNameInput: !!appNameInput, saveBtn: !!saveBtn });
            return;
        }

        // Load current values
        appNameInput.value = settings.appName || 'FreshPOS';
        companyNameInput.value = settings.companyName || 'Zona Fresh';
        companyFooterInput.value = settings.companyFooter || '';
        fontSizeRange.value = settings.ticketFontSize || 10;
        fontSizeVal.textContent = (settings.ticketFontSize || 10) + 'px';
        if (bossPhoneInput) bossPhoneInput.value = settings.bossPhone || '';
        if (callmebotKeyInput) callmebotKeyInput.value = settings.callmebotKey || '';


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

        saveBtn.onclick = () => {
            settings.appName = appNameInput.value;
            settings.companyName = companyNameInput.value;
            settings.companyFooter = companyFooterInput.value;
            settings.ticketFontSize = parseInt(fontSizeRange.value);
            if (bossPhoneInput) {
                const cleanedPhone = bossPhoneInput.value.trim().replace(/\D/g, '');
                settings.bossPhone = cleanedPhone;
                localStorage.setItem('boss_phone', cleanedPhone); // Sincronizar con motor tradicional
            }
            if (callmebotKeyInput) settings.callmebotKey = callmebotKeyInput.value.trim();


            saveSettings(); // uses helper


            // Apply changes
            const h1 = document.querySelector('h1.hidden.lg\\:block');
            if (h1) h1.innerHTML = settings.appName.replace('Fresh', '<span class="text-brand-600">Fresh</span>');

            const ticketBrand = document.getElementById('print-ticket-brand');
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

        const filtered = clients.filter(c =>
            c.name.toLowerCase().includes(query) ||
            (c.phone && c.phone.includes(query))
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
                searchInput.value = sale.client.name;
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
let secretBuffer = '';
document.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') {
        secretBuffer += e.key;
        if (secretBuffer.length > 20) secretBuffer = secretBuffer.slice(-20);
        if (secretBuffer.endsWith('32447974')) {
            const modal = document.getElementById('secret-admin-modal');
            if (modal) {
                document.getElementById('toggle-scanner').checked = localStorage.getItem('feat_scanner') === 'true';
                document.getElementById('toggle-mobile').checked = localStorage.getItem('feat_mobile') !== 'false';
                document.getElementById('toggle-ai').checked = localStorage.getItem('feat_ai') === 'true';
                document.getElementById('boss-phone-input').value = localStorage.getItem('boss_phone') || '';
                document.getElementById('business-name-input').value = localStorage.getItem('business_name') || 'Caja Fresh';
                document.getElementById('business-phone-footer-input').value = localStorage.getItem('business_phone_footer') || '0414-1006858';
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
            secretBuffer = '';
        }
    }
});

window.applySecretSettings = () => {
    const scanner = document.getElementById('toggle-scanner').checked;
    const mobile = document.getElementById('toggle-mobile').checked;
    const ai = document.getElementById('toggle-ai').checked;
    const bossPhone = document.getElementById('boss-phone-input').value.trim().replace(/\D/g, '');
    const bizName = document.getElementById('business-name-input').value.trim() || 'Caja Fresh';
    const bizPhone = document.getElementById('business-phone-footer-input').value.trim() || '0414-1006858';

    localStorage.setItem('feat_scanner', scanner);
    localStorage.setItem('feat_mobile', mobile);
    localStorage.setItem('feat_ai', ai);
    localStorage.setItem('boss_phone', bossPhone);
    localStorage.setItem('business_name', bizName);
    localStorage.setItem('business_phone_footer', bizPhone);
    localStorage.removeItem('callmebot_key');

    // Sincronizar con Ajustes estándar
    settings.bossPhone = bossPhone;
    saveSettings(); 


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
    const bossPhone = localStorage.getItem('boss_phone');
    if (!bossPhone) {
        if (manual) Swal.fire('Configuración Faltante', 'Configura el teléfono del jefe en el menú secreto.', 'warning');
        return;
    }

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
    const firstTicket = reportSales[0].ticket;
    const lastTicket = reportSales[reportSales.length - 1].ticket;

    // Intentar envío profesional (Background PDF) si está listo
    if (window.isWhatsappAutomatedReady) {
        if (manual) Swal.fire({ title: 'Generando Reporte PDF...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        
        createReportPDF(reportSales, totalUSD, totalVES).then(pdfBase64 => {
            const filename = `Reporte_Tickets_${firstTicket}_a_${lastTicket}.pdf`;
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
        const first = reportSales[0].ticket;
        const last = reportSales[reportSales.length - 1].ticket;
        document.getElementById('pdf-report-range').textContent = `Tickets: #${first} - #${last}`;
        document.getElementById('pdf-total-usd').textContent = formatUSD(totalUSD);
        document.getElementById('pdf-total-ves').textContent = formatVES(totalVES);

        const tableBody = document.getElementById('pdf-sales-table-body');
        tableBody.innerHTML = reportSales.map(s => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px; font-size: 11px; font-weight: 700;">#${s.ticket}</td>
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
    const firstTicket = reportSales[0].ticket;
    const lastTicket = reportSales[reportSales.length - 1].ticket;
    const head = manual ? "*REPORTE MANUAL*" : "*REPORTE AUTOMÁTICO (CADA 2 VENTAS)*";
    const waMsg = `${head} 🚨\n*Tickets*: #${firstTicket} al #${lastTicket}\n*Total USD*: ${formatUSD(totalUSD)}\n*Total VES*: ${formatVES(totalVES)}\n*Ventas*: ${reportSales.length}\n_Generado por FreshPOS_`;

    if (window.isWhatsappAutomatedReady) {
        window.electronAPI.sendWhatsAppBackground(bossPhone, waMsg);
        if (!manual) Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Reporte de texto enviado ✅', showConfirmButton: false, timer: 3000 });
        return;
    }

    const waUrl = `whatsapp://send?phone=${bossPhone}&text=${encodeURIComponent(waMsg)}`;
    if (manual) {
        Swal.fire({
            title: '¿Enviar Reporte?',
            text: 'Se enviará por el método manual (Texto).',
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

// ==========================================
// WHATSAPP AUTOMATION EVENT LISTENERS
// ==========================================
window.isWhatsappAutomatedReady = false;
if (window.electronAPI) {
    const handleStatus = ({ status, error, percent, message, qr }) => {

        const qrPlaceholder = document.getElementById('wa-qr-placeholder');
        const qrImg = document.getElementById('wa-qr-img');
        const connectedView = document.getElementById('wa-connected-view');
        const statusBadge = document.getElementById('wa-status-badge');
        const placeholderText = document.querySelector('#wa-qr-placeholder p');

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
        } else if (status === 'loading' || status === 'starting') {
            if (statusBadge) {
                statusBadge.textContent = percent ? `CARGANDO ${percent}%` : 'INICIANDO...';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 text-[8px] font-bold uppercase transition-all';
            }
            if (placeholderText) placeholderText.textContent = message || 'Preparando motor de WhatsApp...';
        } else if (status === 'error') {
            window.isWhatsappAutomatedReady = false;
            if (statusBadge) {
                statusBadge.textContent = 'ERROR';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-rose-600 text-white text-[8px] font-bold uppercase transition-all';
            }
            if (placeholderText) placeholderText.innerHTML = `<span class="text-rose-500 font-bold">${error || 'Fallo crítico'}</span>`;
        } else if (status === 'disconnected') {
            window.isWhatsappAutomatedReady = false;
            if (connectedView) connectedView.classList.add('hidden');
            if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');
            if (qrImg) qrImg.classList.add('hidden');
            if (statusBadge) {
                statusBadge.textContent = 'DESCONECTADO';
                statusBadge.className = 'px-2 py-0.5 rounded-full bg-slate-400 text-white text-[8px] font-bold uppercase transition-all';
            }
        }
    };

    window.electronAPI.onWhatsAppQR((qrBase64) => {
        handleStatus({ status: 'qr', qr: qrBase64 });
    });

    window.electronAPI.onWhatsAppStatus(handleStatus);

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

window.lockSession = () => {
    if (currentRole === 'admin') {
        currentRole = 'cashier';
        const restricted = ['view-inventory', 'view-reports', 'view-settings', 'view-purchases', 'view-expenses'];
        const navs = ['nav-inventory', 'nav-reports', 'nav-settings', 'nav-purchases', 'nav-expenses'];
        // Note: nav-cierre and nav-pos are NOT restricted.


        
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
    // PIN de administración (puedes cambiarlo aquí)
    if (pinVal === '3244') {
        currentRole = 'admin';
        document.getElementById('pin-modal').classList.add('hidden');
        document.getElementById('pin-modal').classList.remove('flex');
        document.getElementById('admin-pin-input').value = '';
        
        // Show administrative sidebar links
        const navs = ['nav-inventory', 'nav-reports', 'nav-settings', 'nav-purchases', 'nav-expenses'];

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
function renderCredits() {
    const tableBody = document.getElementById('credits-table-body');
    const totalDisplayUSD = document.getElementById('credits-summary-total');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    const pendingSales = sales.filter(s => s.status === 'pending');
    let totalUSD = 0;

    pendingSales.forEach(sale => {
        totalUSD += sale.totalUSD;
        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-50 transition-colors cursor-pointer';
        row.innerHTML = `
            <td class="px-6 py-4 font-mono font-bold text-slate-400 text-center">#${sale.ticket}</td>
            <td class="px-6 py-4 font-bold text-slate-700">${sale.client.name}</td>
            <td class="px-6 py-4 text-sm text-slate-500">${new Date(sale.date).toLocaleDateString()}</td>
            <td class="px-6 py-4 text-right font-black text-rose-600">${formatUSD(sale.totalUSD)}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="settleCredit('${sale.ticket}')" class="px-4 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg font-bold text-xs hover:bg-emerald-200 transition-all">
                    Marcar como Pagado
                </button>
            </td>

        `;
        tableBody.appendChild(row);
    });


    if (totalDisplayUSD) totalDisplayUSD.textContent = `Total Fiaos: ${formatUSD(totalUSD)}`;
}

function settleCredit(ticket) {
    Swal.fire({
        title: '¿Confirmar Pago?',
        text: `El ticket #${ticket} pasará a estar pagado.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'Sí, ya pagó'
    }).then((result) => {
        if (result.isConfirmed) {
            const saleIndex = sales.findIndex(s => s.ticket === ticket);
            if (saleIndex > -1) {
                sales[saleIndex].status = 'paid';
                sales[saleIndex].paymentDate = new Date().toISOString();
                saveSales();
                renderCredits();
                Swal.fire('¡Pagado!', 'La deuda ha sido saldada.', 'success');
            }
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
    expenses.forEach(exp => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-6 py-4 text-sm font-medium text-slate-500">${new Date(exp.date).toLocaleDateString()}</td>
            <td class="px-6 py-4 font-bold text-slate-700">${exp.description}</td>
            <td class="px-6 py-4 text-right font-black text-rose-500">${formatUSD(exp.amountUSD)}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="deleteExpense('${exp.id}')" class="text-rose-400 hover:text-rose-600 transition-colors">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

function openExpenseModal() {
    Swal.fire({
        title: 'Registrar Gasto',
        html: `
            <input id="exp-desc" class="swal2-input" placeholder="Descripción del gasto">
            <input id="exp-amount" type="number" step="0.01" class="swal2-input" placeholder="Monto en USD">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar Gasto',
        preConfirm: () => {
            return {
                description: document.getElementById('exp-desc').value,
                amountUSD: parseFloat(document.getElementById('exp-amount').value)
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const data = result.value;
            if (!data.description || isNaN(data.amountUSD)) return Swal.fire('Error', 'Ingresa datos válidos', 'error');
            expenses.push({ id: 'exp_' + Date.now(), date: new Date().toISOString(), ...data });
            saveExpenses();
            renderExpenses();
            Swal.fire('¡Guardado!', '', 'success');
        }
    });
}

function deleteExpense(id) {
    expenses = expenses.filter(e => e.id !== id);
    saveExpenses();
    renderExpenses();
}
// ==========================================
// CIERRE DE CAJA (CLOSEOUT)
// ==========================================
window.openCierreModal = () => {
    const modal = document.getElementById('cierre-modal');
    const dateDisplay = document.getElementById('cierre-date-display');
    const totalUSDDisplay = document.getElementById('cierre-total-usd');
    const totalVESDisplay = document.getElementById('cierre-total-ves');
    const totalCardDisplay = document.getElementById('cierre-total-card');

    if (!modal) return;

    // Calculate Totals
    let totalUSD = 0;
    let totalVES = 0;
    let totalCard = 0;

    sales.forEach(sale => {
        if (sale.status !== 'pending') {
            if (sale.method === 'cash-usd') totalUSD += sale.totalUSD;
            else if (sale.method === 'cash-ves') totalVES += sale.totalVES;
            else if (sale.method === 'card-ves') totalCard += sale.totalVES;
        }
    });

    if (dateDisplay) dateDisplay.textContent = new Date().toLocaleString();
    if (totalUSDDisplay) totalUSDDisplay.textContent = formatUSD(totalUSD);
    if (totalVESDisplay) totalVESDisplay.textContent = formatVES(totalVES);
    if (totalCardDisplay) totalCardDisplay.textContent = formatVES(totalCard);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        document.getElementById('cierre-modal-content').classList.remove('scale-95');
        document.getElementById('cierre-modal-content').classList.add('scale-100');
    }, 10);
};

window.printCierreZ = () => {
    // Simple Z-Report Print Logic (optional enhancement)
    Swal.fire('Imprimiendo...', 'Generando Corte Z en la ticketera.', 'info');
    // Implement print hidden iframe if needed, or just standard window.print() of a specific hidden div
};

window.confirmFinalCierre = () => {
    if (sales.length === 0) return Swal.fire('Caja Vacía', 'No hay ventas para cerrar hoy.', 'info');

    Swal.fire({
        title: '¿Confirmar Cierre de Caja?',
        text: 'Se enviará el reporte al jefe y se limpiará el historial de ventas del día.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'Sí, Finalizar y Enviar'
    }).then((result) => {
        if (result.isConfirmed) {
            sendCierreToBoss();
        }
    });
};

function sendCierreToBoss() {
    let totalUSD = 0; let totalVES = 0; let totalCard = 0;
    sales.forEach(sale => {
        if (sale.status !== 'pending') {
            if (sale.method === 'cash-usd') totalUSD += sale.totalUSD;
            else if (sale.method === 'cash-ves') totalVES += sale.totalVES;
            else if (sale.method === 'card-ves') totalCard += sale.totalVES;
        }
    });

    // Formatear mensaje para WhatsApp (Usar \n para el motor interno, %0A para enlaces)
    const rawMsg = `🧾 *CIERRE DE CAJA - ${settings.appName}*\n` +
                `📅 Fecha: ${new Date().toLocaleDateString()}\n` +
                `👤 Cajero: ${currentRole.toUpperCase()}\n` +
                `--------------------------\n` +
                `💵 *Efectivo USD:* ${formatUSD(totalUSD)}\n` +
                `🇻🇪 *Efectivo BS:* ${formatVES(totalVES)}\n` +
                `💳 *Punto de Venta:* ${formatVES(totalCard)}\n` +
                `--------------------------\n` +
                `✅ *Caja Cerrada con Éxito*`;

    const bossPhoneInput = (settings.bossPhone || localStorage.getItem('boss_phone') || "").replace(/\D/g, ''); // Unificado
    const bossPhone = bossPhoneInput;
    const apiKey = settings.callmebotKey || "";

    if (!bossPhone) {

        Swal.fire({
            title: 'Configuración Requerida',
            html: 'Para enviar el reporte, primero debes escribir el <b>Teléfono del Jefe</b> en la sección de <b>Configuración</b> y pulsar <b>Guardar</b>.',
            icon: 'warning',
            confirmButtonColor: '#3b82f6'
        });
        return;
    }

    // 1. Intentar usar el Motor Interno (WhatsApp-Web.js) si está disponible
    if (window.isWhatsappAutomatedReady && window.electronAPI && window.electronAPI.sendWhatsAppBackground) {
        Swal.fire({ title: 'Enviando Reporte...', text: 'Usando motor interno de WhatsApp...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        
        window.electronAPI.sendWhatsAppBackground(bossPhone, rawMsg)
            .then(res => {
                if (res && res.success) {
                    finalizeAndClear();
                } else {
                    // Si el motor interno falla (no está conectado), usar respaldo
                    const fbMsg = rawMsg.replace(/\n/g, '%0A');
                    window.open(`https://wa.me/${bossPhone}?text=${fbMsg}`, '_blank');
                    finalizeAndClear();
                }
            })
            .catch(() => {
                const fbMsg = rawMsg.replace(/\n/g, '%0A');
                window.open(`https://wa.me/${bossPhone}?text=${fbMsg}`, '_blank');
                finalizeAndClear();
            });
    } else {
        // 2. Respaldo: CallMeBot o Enlace Directo
        const urlMsg = rawMsg.replace(/\n/g, '%0A');
        if (apiKey) {
            fetch(`https://api.callmebot.com/whatsapp.php?phone=${bossPhone}&text=${urlMsg}&apikey=${apiKey}`)
                .then(() => finalizeAndClear())
                .catch(() => finalizeAndClear());
        } else {
            window.open(`https://wa.me/${bossPhone}?text=${urlMsg}`, '_blank');
            finalizeAndClear();
        }
    }
}


function finalizeAndClear() {
    sales = [];
    saveSales();
    renderReports();
    document.getElementById('cierre-modal').classList.add('hidden');
    Swal.fire('¡Cierre Exitoso!', 'El reporte ha sido enviado y la caja está limpia.', 'success');
}
