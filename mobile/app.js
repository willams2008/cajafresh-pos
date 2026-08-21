// mobile/app.js — Clean, Minimalist & Complete POS Mobile Client

// Compatibility polyfill
if (typeof AbortSignal !== 'undefined' && !AbortSignal.timeout) {
    AbortSignal.timeout = function(ms) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    };
}

// State
let products = [];
let cart = [];
let exchangeRate = 42.50;
let currentCategory = 'Todos';
let searchTerm = '';
let selectedDeliveryType = 'pickup'; // 'pickup' | 'delivery' | 'dinein'
let selectedPaymentMethod = 'pago_movil'; // 'pago_movil' | 'efectivo_usd' | 'zelle' | 'transferencia' | 'punto'
let socket = null;
let connectionLock = false;
let isOffline = !navigator.onLine;

let paymentData = {
    pmBank: 'Banesco (0134)',
    pmPhone: '04142497920',
    pmCi: '32447974',
    zelleEmail: 'pagos@tienda.com',
    zelleName: 'Inversiones Tienda',
    bankDetails: '0134-0000-00-0000000000',
    orderWhatsApp: '584142497920'
};

// Cargar caché previo
try {
    const cached = localStorage.getItem('pos_mobile_products');
    if (cached && cached !== 'undefined' && cached !== 'null') {
        products = JSON.parse(cached) || [];
    }
} catch(e) {}

try {
    const cachedCart = localStorage.getItem('pos_mobile_cart');
    if (cachedCart) cart = JSON.parse(cachedCart) || [];
} catch(e) {}

try {
    const cachedRate = localStorage.getItem('pos_mobile_rate');
    if (cachedRate) exchangeRate = parseFloat(cachedRate) || 42.50;
} catch(e) {}

try {
    const cachedPay = localStorage.getItem('pos_mobile_payment_data');
    if (cachedPay) paymentData = Object.assign(paymentData, JSON.parse(cachedPay));
} catch(e) {}

// Banner de Estado
const statusBanner = document.createElement('div');
statusBanner.id = 'connection-status';
statusBanner.className = 'bg-amber-100 text-amber-900 text-[10px] font-bold text-center py-1 transition-all duration-200 flex items-center justify-center gap-1.5 shrink-0 border-b border-amber-200/50';
statusBanner.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse"></span> Conectando...';
document.body.insertBefore(statusBanner, document.body.firstChild);

function updateStatus(text, colorClass, hideAfter = 0) {
    statusBanner.style.display = 'flex';
    const colorStyles = {
        amber: 'bg-amber-100 text-amber-900 border-amber-200/60',
        emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200/60',
        rose: 'bg-rose-50 text-rose-800 border-rose-200/60'
    };
    statusBanner.className = `${colorStyles[colorClass] || 'bg-slate-100 text-slate-800'} text-[10px] font-bold text-center py-1 transition-all duration-200 flex items-center justify-center gap-1.5 shrink-0 border-b`;
    statusBanner.innerHTML = `<i class="fas fa-circle text-[7px]"></i> ${text}`;
    if (hideAfter > 0) {
        setTimeout(() => { statusBanner.style.display = 'none'; }, hideAfter);
    }
}

// ─────────────────────────────────────────────────────────────
// CONEXIÓN SOCKET.IO
// ─────────────────────────────────────────────────────────────
async function initConnection() {
    setupDeliveryEvents();
    setupPaymentEvents();
    updateRateDisplay();
    updatePaymentUI();
    renderCategories();
    renderProducts();
    updateCartUI();

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const urlOverride = hashParams.get('url');
    const bidOverride = hashParams.get('bid');

    let savedServerUrl = localStorage.getItem('pos_server_url') || window.location.origin;
    if (urlOverride && urlOverride.startsWith('http')) {
        savedServerUrl = urlOverride;
        localStorage.setItem('pos_server_url', urlOverride);
    }
    if (bidOverride) {
        localStorage.setItem('pos_business_id', bidOverride);
    }

    const activeBid = localStorage.getItem('pos_business_id') || 'cajafresh_pos_v2_778899_remote';

    const candidates = [
        window.location.origin,
        savedServerUrl,
        `http://${window.location.hostname}:3000`,
        'http://192.168.1.37:3000',
        'http://localhost:3000'
    ].filter((u, i, self) => u && u.startsWith('http') && self.indexOf(u) === i);

    fetch(`https://ntfy.sh/${activeBid}/json?poll=1&since=12h`, { signal: AbortSignal.timeout(3500) })
        .then(res => res.text())
        .then(text => {
            const lines = text.trim().split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (!line) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.message) {
                        const match = data.message.match(/(https?:\/\/[^\s,]+)/);
                        if (match && !candidates.includes(match[1])) {
                            tryConnect(match[1]);
                            break;
                        }
                    }
                } catch(e) {}
            }
        }).catch(() => {});

    candidates.forEach(url => tryConnect(url));
}

function tryConnect(url) {
    if (connectionLock) return;
    
    const testSocket = io(url, {
        timeout: 6000,
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 4
    });

    testSocket.on('connect', () => {
        if (connectionLock) {
            testSocket.close();
            return;
        }
        connectionLock = true;
        socket = testSocket;
        localStorage.setItem('pos_server_url', url);
        updateStatus(`En línea con la Caja`, 'emerald', 3000);
        setupSocketEvents();
    });

    setTimeout(() => { if (!connectionLock) testSocket.close(); }, 8000);
}

function setupSocketEvents() {
    socket.on('connect', () => {
        updateStatus('En línea con la Caja', 'emerald', 3000);
        isOffline = false;
        socket.emit('request-sync');
    });

    socket.on('disconnect', () => {
        updateStatus('Sin conexión', 'rose');
        isOffline = true;
    });

    socket.on('products-updated', (data) => {
        if (!data) return;
        products = data.products || [];
        if (data.exchangeRate) exchangeRate = parseFloat(data.exchangeRate);

        const brand = data.mobileTitle || data.companyName || 'PUNTO PILA';
        const titleEl = document.getElementById('mobile-header-title');
        if (titleEl) titleEl.textContent = brand;
        document.title = brand;

        if (data.paymentData) {
            paymentData = Object.assign(paymentData, data.paymentData);
            localStorage.setItem('pos_mobile_payment_data', JSON.stringify(paymentData));
            updatePaymentUI();
        }

        localStorage.setItem('pos_mobile_products', JSON.stringify(products));
        localStorage.setItem('pos_mobile_rate', exchangeRate.toString());

        updateRateDisplay();
        renderCategories();
        renderProducts();
    });
}

function updateRateDisplay() {
    const rateEl = document.getElementById('rate-display');
    if (rateEl) rateEl.textContent = exchangeRate.toFixed(2);
}

function updatePaymentUI() {
    const pmBankName = document.getElementById('pm-bank-name');
    const pmPhone = document.getElementById('pm-phone-display');
    const pmCi = document.getElementById('pm-ci-display');

    if (pmBankName && paymentData.pmBank) pmBankName.textContent = paymentData.pmBank;
    if (pmPhone && paymentData.pmPhone) pmPhone.textContent = paymentData.pmPhone;
    if (pmCi && paymentData.pmCi) pmCi.textContent = paymentData.pmCi;

    const zelleEmail = document.getElementById('zelle-email-display');
    const zelleName = document.getElementById('zelle-name-display');
    if (zelleEmail && paymentData.zelleEmail) zelleEmail.textContent = paymentData.zelleEmail;
    if (zelleName && paymentData.zelleName) zelleName.textContent = paymentData.zelleName;

    const bankAccount = document.getElementById('bank-account-display');
    if (bankAccount && paymentData.bankDetails) bankAccount.textContent = paymentData.bankDetails;
}

// ─────────────────────────────────────────────────────────────
// CATEGORÍAS & DESTACADOS
// ─────────────────────────────────────────────────────────────
function renderCategories() {
    const container = document.getElementById('categories-container');
    if (!container) return;

    const rawCategories = products.map(p => (p.category || '').trim()).filter(Boolean);
    const uniqueCats = ['Todos', ...new Set(rawCategories)];

    // Si hay productos destacados, agregar pestaña de destacados
    const hasFeatured = products.some(p => p.featured);
    if (hasFeatured) {
        uniqueCats.splice(1, 0, '⭐ Destacados');
    }

    container.innerHTML = uniqueCats.map(cat => {
        const isActive = cat === currentCategory;
        return `
            <button onclick="selectCategory('${cat}')" 
                class="cat-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${isActive ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" 
                data-category="${cat}">
                ${cat}
            </button>
        `;
    }).join('');
}

window.selectCategory = function(cat) {
    currentCategory = cat;
    const catTitle = document.getElementById('category-title');
    if (catTitle) catTitle.textContent = cat === 'Todos' ? 'Todos los Productos' : cat;
    renderCategories();
    renderProducts();
};

// ─────────────────────────────────────────────────────────────
// BUSCADOR
// ─────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        if (clearSearchBtn) {
            clearSearchBtn.style.display = searchTerm ? 'flex' : 'none';
        }
        renderProducts();
    });
}

if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchTerm = '';
        clearSearchBtn.style.display = 'none';
        searchInput.focus();
        renderProducts();
    });
}

// ─────────────────────────────────────────────────────────────
// PRODUCTOS (Control de Stock, Variantes y Destacados)
// ─────────────────────────────────────────────────────────────
function renderProducts() {
    const list = document.getElementById('product-list');
    const countEl = document.getElementById('results-count');
    if (!list) return;

    const term = searchTerm.toLowerCase().trim();
    const filtered = products.filter(p => {
        let matchCategory = true;
        if (currentCategory === '⭐ Destacados') {
            matchCategory = !!p.featured;
        } else if (currentCategory !== 'Todos') {
            matchCategory = (p.category || '').toLowerCase() === currentCategory.toLowerCase();
        }

        const matchSearch = !term || 
            (p.name && p.name.toLowerCase().includes(term)) ||
            (p.category && p.category.toLowerCase().includes(term)) ||
            (p.barcode && p.barcode.toLowerCase().includes(term)) ||
            (p.flavors && Array.isArray(p.flavors) && p.flavors.some(f => f.toLowerCase().includes(term)));
        return matchCategory && matchSearch;
    });

    if (countEl) {
        countEl.textContent = `${filtered.length} producto${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div class="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 text-xl mb-3">
                    <i class="fas fa-box-open"></i>
                </div>
                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                    ${products.length === 0 ? 'Catálogo Vacío' : 'Sin resultados'}
                </h4>
                <p class="text-xs text-slate-400 max-w-xs mb-3">
                    ${products.length === 0 
                        ? 'Crea tus productos en la caja y se mostrarán aquí de inmediato.' 
                        : (searchTerm ? `No hay coincidencias para "${searchTerm}".` : 'No hay productos en esta sección.')}
                </p>
                ${searchTerm ? `
                    <button onclick="document.getElementById('clear-search-btn').click()" class="px-3.5 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-semibold">
                        Limpiar filtro
                    </button>
                ` : ''}
            </div>
        `;
        return;
    }

    list.innerHTML = `
        <div class="grid grid-cols-2 gap-3 pb-8">
            ${filtered.map(p => renderProductCard(p)).join('')}
        </div>
    `;
}

function renderProductCard(p) {
    const priceUSD = parseFloat(p.priceUSD || p.price || 0);
    const priceVES = (p.priceVES && parseFloat(p.priceVES) > 0) ? parseFloat(p.priceVES) : (priceUSD * exchangeRate);
    
    const hasStockField = p.stock !== undefined && p.stock !== null;
    const stock = hasStockField ? parseFloat(p.stock) : 999;
    const isOutOfStock = hasStockField && stock <= 0;
    const isLowStock = hasStockField && stock > 0 && stock <= 5;
    const hasFlavors = p.flavors && Array.isArray(p.flavors) && p.flavors.length > 0;

    // Conteo en carrito (incluyendo variantes)
    const inCartQty = cart.filter(c => c.productId === p.id || c.id === p.id).reduce((s, i) => s + i.qty, 0);

    const imgFallback = `
        <div class="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-400">
            <i class="fas fa-tag text-xl mb-1 text-slate-300"></i>
            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">${(p.category || 'General').substring(0, 12)}</span>
        </div>
    `;

    return `
        <div class="product-card bg-white rounded-2xl p-3 border border-slate-200/80 shadow-sm flex flex-col justify-between ${isOutOfStock ? 'opacity-50' : ''}">
            
            <!-- Badges de Stock / Destacado -->
            <div class="h-28 rounded-xl overflow-hidden mb-2.5 bg-slate-50 relative border border-slate-100">
                <div class="absolute top-2 left-2 z-10 flex flex-col gap-1">
                    ${p.featured ? `
                        <span class="bg-amber-500 text-slate-950 text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase shadow-sm">
                            ⭐ TOP
                        </span>
                    ` : ''}
                    ${isOutOfStock ? `
                        <span class="bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded-md uppercase">
                            Agotado
                        </span>
                    ` : isLowStock ? `
                        <span class="bg-amber-500 text-slate-950 text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                            Últimos ${stock}
                        </span>
                    ` : ''}
                </div>

                ${p.img && p.img.startsWith('http') ? `
                    <img src="${p.img}" alt="${p.name}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML = '${imgFallback.replace(/'/g, "\\'")}'">
                ` : imgFallback}
            </div>

            <!-- Datos -->
            <div class="flex-1 flex flex-col mb-2.5">
                <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">${p.category || 'General'}</span>
                    ${hasStockField && !isOutOfStock ? `<span class="text-[9px] text-slate-400 font-mono">Stock: ${stock}</span>` : ''}
                </div>
                <h4 class="text-xs font-bold text-slate-800 line-clamp-2 leading-tight min-h-[28px] mb-1">${p.name}</h4>
                
                <!-- Opciones / Sabores / Sub-productos -->
                ${hasFlavors ? `
                    <div class="flex flex-wrap gap-1 mb-2">
                        ${p.flavors.slice(0, 3).map(f => `
                            <span class="text-[8px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded">${f}</span>
                        `).join('')}
                        ${p.flavors.length > 3 ? `<span class="text-[8px] text-slate-400 font-bold">+${p.flavors.length - 3}</span>` : ''}
                    </div>
                ` : ''}

                <!-- Precios -->
                <div class="mt-auto">
                    <p class="text-sm font-extrabold text-slate-900 font-mono leading-none">$${priceUSD.toFixed(2)}</p>
                    <p class="text-[10px] font-medium text-slate-400 font-mono mt-0.5">
                        Bs ${priceVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
            </div>

            <!-- Botón / Stepper -->
            <div>
                ${isOutOfStock ? `
                    <button disabled class="w-full py-1.5 bg-slate-100 text-slate-400 rounded-lg text-[10px] font-bold">
                        Agotado
                    </button>
                ` : hasFlavors ? `
                    <button onclick="openFlavorModal('${p.id}')" class="w-full py-1.5 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white rounded-xl text-xs font-bold transition-all border border-blue-200 active:scale-95 flex items-center justify-center gap-1">
                        <i class="fas fa-list-ul text-[9px]"></i> Opciones ${inCartQty > 0 ? `(${inCartQty})` : ''}
                    </button>
                ` : inCartQty > 0 ? `
                    <div class="flex items-center justify-between bg-slate-900 rounded-xl p-0.5">
                        <button onclick="changeQty('${p.id}', -1)" class="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg text-white font-bold flex items-center justify-center active:scale-90">
                            <i class="fas fa-minus text-[9px]"></i>
                        </button>
                        <span class="text-xs font-bold text-white font-mono px-2">${inCartQty}</span>
                        <button onclick="changeQty('${p.id}', 1)" class="w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg text-white font-bold flex items-center justify-center active:scale-90">
                            <i class="fas fa-plus text-[9px]"></i>
                        </button>
                    </div>
                ` : `
                    <button onclick="addToCart('${p.id}')" class="w-full py-1.5 bg-slate-100 hover:bg-slate-900 text-slate-800 hover:text-white rounded-xl text-xs font-bold transition-all border border-slate-200 active:scale-95">
                        + Añadir
                    </button>
                `}
            </div>

        </div>
    `;
}

// ─────────────────────────────────────────────────────────────
// MODAL DE SABORES / SUB-PRODUCTOS
// ─────────────────────────────────────────────────────────────
window.openFlavorModal = function(id) {
    const product = products.find(p => String(p.id) === String(id));
    if (!product || !product.flavors || product.flavors.length === 0) {
        addToCart(id);
        return;
    }

    const modal = document.getElementById('flavor-modal');
    const overlay = document.getElementById('flavor-overlay');
    const content = document.getElementById('flavor-content');
    const titleEl = document.getElementById('flavor-product-name');
    const listEl = document.getElementById('flavor-options-list');

    if (titleEl) titleEl.textContent = product.name;
    if (listEl) {
        listEl.innerHTML = product.flavors.map(flavor => `
            <button onclick="selectProductFlavor('${product.id}', '${flavor.replace(/'/g, "\\'")}')" 
                class="w-full bg-slate-50 hover:bg-slate-900 text-slate-800 hover:text-white border border-slate-200 p-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all active:scale-98">
                <span><i class="fas fa-circle-dot mr-2 text-blue-500 text-[10px]"></i> ${flavor}</span>
                <i class="fas fa-plus text-xs"></i>
            </button>
        `).join('');
    }

    modal.classList.remove('invisible');
    setTimeout(() => {
        overlay.classList.remove('opacity-0');
        content.classList.remove('translate-y-full');
    }, 10);
};

window.closeFlavorModal = function() {
    const modal = document.getElementById('flavor-modal');
    const overlay = document.getElementById('flavor-overlay');
    const content = document.getElementById('flavor-content');
    if (!modal) return;

    overlay.classList.add('opacity-0');
    content.classList.add('translate-y-full');
    setTimeout(() => { modal.classList.add('invisible'); }, 200);
};

window.selectProductFlavor = function(id, flavor) {
    closeFlavorModal();
    addToCart(id, flavor);
};

// ─────────────────────────────────────────────────────────────
// CARRITO & CONTROL DE STOCK
// ─────────────────────────────────────────────────────────────
window.addToCart = function(id, flavor = null) {
    const product = products.find(p => String(p.id) === String(id));
    if (!product) return;

    const maxStock = (product.stock !== undefined && product.stock !== null) ? parseFloat(product.stock) : 999;
    if (maxStock <= 0) {
        alert('Este producto se encuentra agotado.');
        return;
    }

    // Identificador único por variante
    const cartId = flavor ? `${product.id}-${flavor}` : product.id;
    const displayName = flavor ? `${product.name} (${flavor})` : product.name;

    // Calcular cuántas unidades en total del mismo producto padre ya están en el carrito
    const totalParentQty = cart.filter(c => c.productId === product.id || c.id === product.id).reduce((s, i) => s + i.qty, 0);
    if (totalParentQty + 1 > maxStock) {
        alert(`Stock máximo alcanzado (${maxStock} unidades disponibles en total).`);
        return;
    }

    const existing = cart.find(c => String(c.id) === String(cartId));
    if (existing) {
        existing.qty++;
    } else {
        const priceUSD = parseFloat(product.priceUSD || product.price || 0);
        const priceVES = (product.priceVES && parseFloat(product.priceVES) > 0) ? parseFloat(product.priceVES) : (priceUSD * exchangeRate);
        cart.push({
            id: cartId,
            productId: product.id,
            name: displayName,
            flavor: flavor,
            priceUSD: priceUSD,
            priceVES: priceVES,
            qty: 1,
            maxStock: maxStock
        });
    }

    saveCart();
    renderProducts();
    updateCartUI();
};

window.changeQty = function(id, delta) {
    const idx = cart.findIndex(c => String(c.id) === String(id));
    if (idx === -1) return;

    const item = cart[idx];
    const product = products.find(p => String(p.id) === String(item.productId || item.id));
    const maxStock = product ? ((product.stock !== undefined && product.stock !== null) ? parseFloat(product.stock) : 999) : (item.maxStock || 999);

    if (delta > 0) {
        const totalParentQty = cart.filter(c => c.productId === (item.productId || item.id) || c.id === (item.productId || item.id)).reduce((s, i) => s + i.qty, 0);
        if (totalParentQty + delta > maxStock) {
            alert(`Stock máximo alcanzado (${maxStock} unidades disponibles).`);
            return;
        }
    }

    item.qty += delta;
    if (item.qty <= 0) {
        cart.splice(idx, 1);
    }

    saveCart();
    renderProducts();
    updateCartUI();
    renderCartItems();
    calculateCashChange();
};

function saveCart() {
    localStorage.setItem('pos_mobile_cart', JSON.stringify(cart));
}

function updateCartUI() {
    const totalCount = cart.reduce((sum, item) => sum + item.qty, 0);
    const totalUSD = cart.reduce((sum, item) => sum + (item.priceUSD * item.qty), 0);
    const totalVES = cart.reduce((sum, item) => sum + (item.priceVES * item.qty), 0);

    const headerCount = document.getElementById('cart-count');
    if (headerCount) {
        headerCount.textContent = totalCount;
        headerCount.style.display = totalCount > 0 ? 'flex' : 'none';
    }

    const floatBar = document.getElementById('floating-cart-bar');
    const floatCount = document.getElementById('float-cart-count');
    const floatUSD = document.getElementById('float-cart-total-usd');
    const floatVES = document.getElementById('float-cart-total-ves');

    if (floatBar) {
        if (totalCount > 0) {
            floatBar.classList.remove('hidden');
            if (floatCount) floatCount.textContent = totalCount;
            if (floatUSD) floatUSD.textContent = `$${totalUSD.toFixed(2)}`;
            if (floatVES) floatVES.textContent = `(Bs ${totalVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
        } else {
            floatBar.classList.add('hidden');
        }
    }

    const modalUSD = document.getElementById('cart-total-usd-display');
    const modalVES = document.getElementById('cart-total');
    if (modalUSD) modalUSD.textContent = `$${totalUSD.toFixed(2)}`;
    if (modalVES) modalVES.textContent = `Bs ${totalVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const cashTotal = document.getElementById('cash-total-display');
    if (cashTotal) cashTotal.textContent = `$${totalUSD.toFixed(2)} (Bs ${totalVES.toFixed(2)})`;
}

// ─────────────────────────────────────────────────────────────
// MODAL DE CESTA
// ─────────────────────────────────────────────────────────────
window.openCartModal = function() {
    renderCartItems();
    const modal = document.getElementById('cart-modal');
    const overlay = document.getElementById('cart-overlay');
    const content = document.getElementById('cart-content');
    if (!modal) return;

    modal.classList.remove('invisible');
    setTimeout(() => {
        overlay.classList.remove('opacity-0');
        content.classList.remove('translate-y-full');
    }, 10);
};

window.closeCartModal = function() {
    const modal = document.getElementById('cart-modal');
    const overlay = document.getElementById('cart-overlay');
    const content = document.getElementById('cart-content');
    if (!modal) return;

    overlay.classList.add('opacity-0');
    content.classList.add('translate-y-full');
    setTimeout(() => { modal.classList.add('invisible'); }, 200);
};

const cartTrigger = document.getElementById('cart-trigger');
if (cartTrigger) cartTrigger.addEventListener('click', openCartModal);

function renderCartItems() {
    const container = document.getElementById('cart-items');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-slate-400">
                <i class="fas fa-shopping-basket text-3xl mb-2 text-slate-300"></i>
                <p class="text-xs font-semibold">Tu cesta está vacía</p>
            </div>
        `;
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="bg-slate-50 border border-slate-200/60 rounded-xl p-3 flex items-center justify-between gap-3">
            <div class="flex-1 min-w-0">
                <h4 class="text-xs font-bold text-slate-900 truncate">${item.name}</h4>
                <p class="text-[11px] font-mono text-slate-500">
                    $${item.priceUSD.toFixed(2)} • <span class="text-slate-700">Bs ${item.priceVES.toFixed(2)}</span>
                </p>
            </div>
            <div class="flex items-center gap-2">
                <div class="flex items-center bg-white rounded-lg border border-slate-200 p-0.5">
                    <button onclick="changeQty('${item.id}', -1)" class="w-5 h-5 rounded text-slate-600 hover:bg-slate-100 flex items-center justify-center">
                        <i class="fas fa-minus text-[8px]"></i>
                    </button>
                    <span class="text-xs font-bold text-slate-900 font-mono px-2">${item.qty}</span>
                    <button onclick="changeQty('${item.id}', 1)" class="w-5 h-5 rounded text-slate-600 hover:bg-slate-100 flex items-center justify-center">
                        <i class="fas fa-plus text-[8px]"></i>
                    </button>
                </div>
                <button onclick="changeQty('${item.id}', -${item.qty})" class="text-slate-400 hover:text-rose-500 p-1 text-xs">
                    <i class="fas fa-trash-alt text-[10px]"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// ─────────────────────────────────────────────────────────────
// MODAL DE CHECKOUT & FACTORES DE ENTREGA
// ─────────────────────────────────────────────────────────────
function setupDeliveryEvents() {
    document.querySelectorAll('.delivery-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.delivery-type-btn').forEach(b => {
                b.classList.remove('active', 'border-slate-900', 'bg-slate-900', 'text-white');
                b.classList.add('border-slate-200', 'bg-slate-50', 'text-slate-600');
            });
            btn.classList.add('active', 'border-slate-900', 'bg-slate-900', 'text-white');
            btn.classList.remove('border-slate-200', 'bg-slate-50', 'text-slate-600');

            selectedDeliveryType = btn.dataset.type;
            const addressBox = document.getElementById('delivery-address-box');
            const dineinBox = document.getElementById('dinein-table-box');

            if (addressBox) addressBox.classList.toggle('hidden', selectedDeliveryType !== 'delivery');
            if (dineinBox) dineinBox.classList.toggle('hidden', selectedDeliveryType !== 'dinein');
        });
    });
}

function setupPaymentEvents() {
    document.querySelectorAll('.pay-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pay-method-btn').forEach(b => {
                b.classList.remove('active', 'bg-white', 'shadow-sm', 'text-slate-900');
                b.classList.add('text-slate-500');
            });
            btn.classList.add('active', 'bg-white', 'shadow-sm', 'text-slate-900');
            btn.classList.remove('text-slate-500');

            selectedPaymentMethod = btn.dataset.method;
            const pmDetails = document.getElementById('pago-movil-details');
            const efectivoDetails = document.getElementById('efectivo-usd-details');
            const zelleDetails = document.getElementById('zelle-details');
            const transfDetails = document.getElementById('transferencia-details');
            const otherDetails = document.getElementById('other-methods-details');

            if (pmDetails) pmDetails.classList.toggle('hidden', selectedPaymentMethod !== 'pago_movil');
            if (efectivoDetails) efectivoDetails.classList.toggle('hidden', selectedPaymentMethod !== 'efectivo_usd');
            if (zelleDetails) zelleDetails.classList.toggle('hidden', selectedPaymentMethod !== 'zelle');
            if (transfDetails) transfDetails.classList.toggle('hidden', selectedPaymentMethod !== 'transferencia');
            if (otherDetails) otherDetails.classList.toggle('hidden', selectedPaymentMethod !== 'punto');
        });
    });
}

window.calculateCashChange = function() {
    const givenInput = document.getElementById('cash-given-amount');
    const resultBox = document.getElementById('cash-change-result');
    const changeDisplay = document.getElementById('cash-change-amount');
    const changeVesDisplay = document.getElementById('cash-change-ves');
    if (!givenInput || !resultBox) return;

    const totalUSD = cart.reduce((sum, item) => sum + (item.priceUSD * item.qty), 0);
    const given = parseFloat(givenInput.value || 0);

    if (given > totalUSD) {
        const changeUSD = given - totalUSD;
        const changeVES = changeUSD * exchangeRate;
        resultBox.classList.remove('hidden');
        if (changeDisplay) changeDisplay.textContent = `$${changeUSD.toFixed(2)}`;
        if (changeVesDisplay) changeVesDisplay.textContent = `(Bs ${changeVES.toFixed(2)})`;
    } else {
        resultBox.classList.add('hidden');
    }
};

window.openPaymentModal = function() {
    if (cart.length === 0) return;
    closeCartModal();

    const modal = document.getElementById('payment-modal');
    const overlay = document.getElementById('payment-overlay');
    const content = document.getElementById('payment-content');
    if (!modal) return;

    updateCartUI();
    modal.classList.remove('invisible');
    setTimeout(() => {
        overlay.classList.remove('opacity-0');
        content.classList.remove('translate-y-full');
    }, 10);
};

window.closePaymentModal = function() {
    const modal = document.getElementById('payment-modal');
    const overlay = document.getElementById('payment-overlay');
    const content = document.getElementById('payment-content');
    if (!modal) return;

    overlay.classList.add('opacity-0');
    content.classList.add('translate-y-full');
    setTimeout(() => { modal.classList.add('invisible'); }, 200);
};

window.copyToClipboard = function(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        alert('Copiado: ' + text);
    });
};

// ─────────────────────────────────────────────────────────────
// ENVIAR PEDIDO
// ─────────────────────────────────────────────────────────────
window.submitOrder = function() {
    const clientName = (document.getElementById('origin-name')?.value || '').trim();
    if (!clientName) {
        alert('Por favor escribe tu Nombre para registrar la orden.');
        document.getElementById('origin-name')?.focus();
        return;
    }

    const clientPhone = (document.getElementById('origin-phone-global')?.value || '').trim();
    if (!clientPhone) {
        alert('Por favor indica tu número de Teléfono / WhatsApp para confirmar el pedido.');
        document.getElementById('origin-phone-global')?.focus();
        return;
    }

    // Validar entrega
    let deliveryInfo = { type: selectedDeliveryType };
    if (selectedDeliveryType === 'delivery') {
        const address = (document.getElementById('order-delivery-address')?.value || '').trim();
        if (!address) {
            alert('Por favor indica la dirección exacta de entrega.');
            document.getElementById('order-delivery-address')?.focus();
            return;
        }
        deliveryInfo.address = address;
        deliveryInfo.reference = (document.getElementById('order-delivery-ref')?.value || '').trim();
    } else if (selectedDeliveryType === 'dinein') {
        const table = (document.getElementById('order-table-num')?.value || '').trim();
        if (!table) {
            alert('Por favor indica el número de mesa.');
            document.getElementById('order-table-num')?.focus();
            return;
        }
        deliveryInfo.table = table;
    }

    const notes = (document.getElementById('origin-observations')?.value || '').trim();
    
    let ref = '';
    let cashGiven = 0;
    if (selectedPaymentMethod === 'pago_movil') {
        ref = (document.getElementById('origin-ref')?.value || '').trim();
        if (!ref) {
            alert('Por favor ingresa los 4 dígitos de referencia del Pago Móvil.');
            document.getElementById('origin-ref')?.focus();
            return;
        }
    } else if (selectedPaymentMethod === 'zelle') {
        ref = (document.getElementById('zelle-ref')?.value || '').trim();
    } else if (selectedPaymentMethod === 'transferencia') {
        ref = (document.getElementById('transfer-ref')?.value || '').trim();
    } else if (selectedPaymentMethod === 'efectivo_usd') {
        cashGiven = parseFloat(document.getElementById('cash-given-amount')?.value || 0);
    }

    const totalUSD = cart.reduce((sum, item) => sum + (item.priceUSD * item.qty), 0);
    const totalVES = cart.reduce((sum, item) => sum + (item.priceVES * item.qty), 0);

    const orderData = {
        id: 'order_' + Date.now().toString(36),
        clientName: clientName,
        clientPhone: clientPhone,
        delivery: deliveryInfo,
        notes: notes,
        paymentMethod: selectedPaymentMethod,
        reference: ref,
        cashGiven: cashGiven,
        items: cart,
        totalUSD: totalUSD,
        totalVES: totalVES,
        exchangeRate: exchangeRate,
        timestamp: new Date().toISOString()
    };

    if (socket && socket.connected) {
        socket.emit('new-order', orderData);
        alert('✅ ¡Pedido recibido con éxito por el comercio!');
    } else {
        alert('⚠️ Pedido guardado. Te sugerimos enviarlo por WhatsApp para confirmación inmediata.');
    }

    cart = [];
    saveCart();
    updateCartUI();
    renderProducts();
    closePaymentModal();
};

window.sendOrderViaWhatsApp = function() {
    const clientName = (document.getElementById('origin-name')?.value || '').trim() || 'Cliente';
    const clientPhone = (document.getElementById('origin-phone-global')?.value || '').trim();
    const notes = (document.getElementById('origin-observations')?.value || '').trim();
    
    let ref = '';
    let cashGiven = 0;
    if (selectedPaymentMethod === 'pago_movil') ref = (document.getElementById('origin-ref')?.value || '').trim();
    if (selectedPaymentMethod === 'zelle') ref = (document.getElementById('zelle-ref')?.value || '').trim();
    if (selectedPaymentMethod === 'transferencia') ref = (document.getElementById('transfer-ref')?.value || '').trim();
    if (selectedPaymentMethod === 'efectivo_usd') cashGiven = parseFloat(document.getElementById('cash-given-amount')?.value || 0);

    const totalUSD = cart.reduce((sum, item) => sum + (item.priceUSD * item.qty), 0);
    const totalVES = cart.reduce((sum, item) => sum + (item.priceVES * item.qty), 0);

    let deliveryText = 'Retiro en Tienda';
    if (selectedDeliveryType === 'delivery') {
        const addr = (document.getElementById('order-delivery-address')?.value || '').trim();
        const dref = (document.getElementById('order-delivery-ref')?.value || '').trim();
        deliveryText = `🛵 Delivery a: ${addr} ${dref ? `(Ref: ${dref})` : ''}`;
    } else if (selectedDeliveryType === 'dinein') {
        const table = (document.getElementById('order-table-num')?.value || '').trim();
        deliveryText = `🍽️ Comer en Local: Mesa ${table || '-'}`;
    }

    let msg = `🛍️ *NUEVO PEDIDO - ${document.title}*\n`;
    msg += `👤 *Cliente:* ${clientName} (${clientPhone || 'Sin telf'})\n`;
    msg += `📍 *Entrega:* ${deliveryText}\n`;
    if (notes) msg += `📝 *Nota:* ${notes}\n`;
    msg += `💳 *Pago:* ${selectedPaymentMethod.toUpperCase()}${ref ? ` (Ref: ${ref})` : ''}\n`;
    if (cashGiven > totalUSD) {
        msg += `💵 *Paga con:* $${cashGiven.toFixed(2)} (Vuelto: $${(cashGiven - totalUSD).toFixed(2)})\n`;
    }
    msg += `\n📦 *Artículos:*\n`;

    cart.forEach(item => {
        msg += `• ${item.qty}x ${item.name} ($${(item.priceUSD * item.qty).toFixed(2)})\n`;
    });

    msg += `\n💵 *Total USD:* $${totalUSD.toFixed(2)}\n`;
    msg += `🇻🇪 *Total Bs:* Bs ${totalVES.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;

    const targetPhone = (paymentData.orderWhatsApp || '584142497920').replace(/[^0-9]/g, '');
    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
};

// ─────────────────────────────────────────────────────────────
// QR SCANNER
// ─────────────────────────────────────────────────────────────
const qrBtn = document.getElementById('sync-qr-btn');
let html5QrCode = null;

if (qrBtn) {
    qrBtn.onclick = () => {
        const modal = document.getElementById('qr-modal');
        const overlay = document.getElementById('qr-overlay');
        const content = document.getElementById('qr-content');
        modal.classList.remove('invisible');
        setTimeout(() => {
            overlay.classList.remove('opacity-0');
            content.classList.remove('opacity-0', 'scale-95');
        }, 10);

        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, onScanSuccess)
            .catch(err => {
                alert('Por favor permite el acceso a la cámara.');
                stopScanner();
            });
    };
}

async function onScanSuccess(decodedText) {
    if (decodedText.startsWith('http')) {
        let cleanUrl = decodedText.split('/mobile')[0];
        localStorage.setItem('pos_server_url', cleanUrl);
        await stopScanner();
        window.location.href = cleanUrl + '/mobile';
    }
}

window.stopScanner = async function() {
    if (html5QrCode && html5QrCode.isScanning) {
        try { await html5QrCode.stop(); html5QrCode.clear(); } catch(e) {}
    }
    const modal = document.getElementById('qr-modal');
    const overlay = document.getElementById('qr-overlay');
    const content = document.getElementById('qr-content');
    overlay.classList.add('opacity-0');
    content.classList.add('opacity-0', 'scale-95');
    setTimeout(() => { modal.classList.add('invisible'); }, 200);
};

// Auto-start
window.addEventListener('load', initConnection);
