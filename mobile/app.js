// Smart server URL management
const businessId = 'eb60443d3b66474b7c6c';
const permanentUrl = 'https://zonafresh-pos-caja.loca.lt';
let savedServerUrl = localStorage.getItem('pos_server_url') || permanentUrl;

let socket = null;
let isOffline = !navigator.onLine;

let products = JSON.parse(localStorage.getItem('pos_mobile_products')) || [];
let cart = JSON.parse(localStorage.getItem('pos_mobile_cart')) || [];
let exchangeRate = parseFloat(localStorage.getItem('pos_mobile_rate')) || 36.50;
let currentCategory = 'Todos';

// UI Elements for connection
const statusBanner = document.createElement('div');
statusBanner.id = 'connection-status';
statusBanner.className = 'bg-amber-500 text-white text-xs font-bold text-center py-1.5 transition-all duration-300 flex items-center justify-center gap-2';
statusBanner.innerHTML = '<div class="w-2 h-2 rounded-full bg-white animate-pulse"></div> Iniciando...';
document.body.insertBefore(statusBanner, document.body.firstChild);

function updateStatus(text, colorClass, hideAfter = 0) {
    statusBanner.style.display = '';
    statusBanner.className = `bg-${colorClass}-500 text-white text-xs font-bold text-center py-1.5 transition-all duration-300 flex items-center justify-center gap-2`;
    statusBanner.innerHTML = `<div class="w-2 h-2 rounded-full bg-white animate-pulse"></div> ${text}`;
    if (hideAfter > 0) {
        setTimeout(() => { statusBanner.style.display = 'none'; }, hideAfter);
    }
}

async function initConnection() {
    // 1. Mostrar estado amigable
    updateStatus('CONECTANDO...', 'amber');

    // Múltiples vectores de ataque para encontrar la caja
    const candidates = [
        savedServerUrl, 
        permanentUrl,
        `http://DESKTOP-DMAJ5AF.local:3000`, // DNS Directo (La más infalible en WiFi)
        `http://192.168.50.24:3000`, // IP Fuerte detectada
        `http://192.168.1.5:3000`,
        `http://192.168.0.5:3000`
    ].filter(u => u && u.length > 5);

    // 2. Descubrimiento silencioso en nube vía NTFY
    fetch(`https://ntfy.sh/zonafresh_caja_pos_tunnel_url_secret_eb6044/json?poll=1`, { signal: AbortSignal.timeout(3500) })
        .then(res => res.text())
        .then(text => {
            const lines = text.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            if (lastLine) {
                const data = JSON.parse(lastLine);
                if (data.message) {
                    try {
                        const parsed = JSON.parse(data.message);
                        console.log('📡 NTFY reporta:', parsed);
                        if (parsed.tunnelUrl && !candidates.includes(parsed.tunnelUrl)) tryConnect(parsed.tunnelUrl);
                        if (parsed.localIP) {
                            const url = `http://${parsed.localIP}:3000`;
                            if (!candidates.includes(url)) tryConnect(url);
                        }
                    } catch(e) {}
                }
            }
        }).catch(() => {});

    // 3. Probar todos los candidatos como una escopeta
    candidates.forEach(url => tryConnect(url));
}

let connectionLock = false;

function tryConnect(url) {
    if (connectionLock) return;
    
    console.log('⚡ Probando:', url);
    const testSocket = io(url, {
        timeout: 4000,
        transports: ['websocket', 'polling'], // Priorizar websocket saltará el Preflight OPTIONS y hace todo ultra rápido
        reconnection: false
    });

    testSocket.on('connect', () => {
        if (connectionLock) {
            testSocket.close();
            return;
        }
        
        connectionLock = true;
        socket = testSocket;
        savedServerUrl = url;
        localStorage.setItem('pos_server_url', url);
        
        updateStatus('CAJA CONECTADA', 'emerald', 2000);
        setupSocketEvents();
    });

    setTimeout(() => { if (!connectionLock) testSocket.close(); }, 5000);
}

function setupSocketEvents() {
    socket.on('connect', () => {
        updateStatus('Conectado a Zona Fresh', 'emerald', 3000);
        isOffline = false;
        saveToHistory(savedServerUrl);
        console.log('✅ Socket conectado:', savedServerUrl);
    });

    socket.on('disconnect', () => {
        updateStatus('Sin conexión - Reintentando...', 'rose');
        isOffline = true;
    });

    // Solicitar menú completo al servidor (Pull Activo)
    socket.emit('request-sync');

    socket.on('reconnect_attempt', (attempt) => {
        statusBanner.innerHTML = `<div class="w-2 h-2 rounded-full bg-white animate-pulse"></div> Reintentando (${attempt})... <button onclick="showServerConfig()" class="ml-2 underline text-[10px]">Cambiar URL</button>`;
    });

    socket.on('products-updated', (data) => {
        products = data.products;
        exchangeRate = data.exchangeRate;
        localStorage.setItem('pos_mobile_products', JSON.stringify(products));
        localStorage.setItem('pos_mobile_rate', exchangeRate.toString());
        if (typeof renderFeaturedProducts === 'function') renderFeaturedProducts();
        if (typeof renderProducts === 'function') renderProducts();
    });
}

function saveToHistory(url) {
    if (!url) return;
    try {
        let history = JSON.parse(localStorage.getItem('pos_server_history')) || [];
        if (!history.includes(url)) {
            history.unshift(url);
            if (history.length > 5) history.pop();
            localStorage.setItem('pos_server_history', JSON.stringify(history));
        }
    } catch(e) {}
}

window.addEventListener('load', initConnection);
window.addEventListener('online', () => { if (socket) socket.connect(); });
window.addEventListener('offline', () => { isOffline = true; });

// Manual server URL configuration
window.showServerConfig = () => {
    const currentUrl = localStorage.getItem('pos_server_url') || '';
    const newUrl = prompt('URL del servidor Zona Fresh:', currentUrl);
    if (newUrl && newUrl.trim()) {
        localStorage.setItem('pos_server_url', newUrl.trim());
        window.location.reload();
    }
};

/* QR Scanner Logic for Linking */
const qrBtn = document.getElementById('sync-qr-btn');
const qrModal = document.getElementById('qr-modal');
const qrOverlay = document.getElementById('qr-overlay');
const qrContent = document.getElementById('qr-content');
const closeQr = document.getElementById('close-qr');
let html5QrCode = null;

if (qrBtn) {
    qrBtn.onclick = () => {
        qrModal.classList.remove('invisible');
        setTimeout(() => {
            qrOverlay.classList.remove('opacity-0');
            qrContent.classList.remove('opacity-0', 'scale-90');
        }, 10);
        
        html5QrCode = new Html5Qrcode("reader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        
        html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
            .catch(err => {
                console.error("No se pudo iniciar la cámara:", err);
                alert("No se pudo acceder a la cámara. Por favor permite los permisos.");
                stopScanner();
            });
    };
}

async function onScanSuccess(decodedText) {
    console.log(`Code scanned: ${decodedText}`);
    
    // Vibrate if possible to give tactile feedback
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(200);
    }

    await stopScanner();
    
    if (decodedText.startsWith('http')) {
        let cleanUrl = decodedText;
        if (cleanUrl.endsWith('/mobile')) {
            cleanUrl = cleanUrl.replace('/mobile', '');
        }
        
        localStorage.setItem('pos_server_url', cleanUrl);
        
        // Show a more professional overlay or alert
        const statusBanner = document.getElementById('status-banner');
        if (statusBanner) {
            statusBanner.innerHTML = '¡Conexión Exitosa! Recargando...';
            statusBanner.className = 'fixed top-0 left-0 right-0 bg-emerald-500 text-white text-[10px] font-black py-2 px-4 flex items-center justify-center gap-2 z-[100] animate-bounce';
        }

        setTimeout(() => {
            window.location.href = cleanUrl + '/mobile';
        }, 500);
    } else {
        alert('❌ El código escaneado no es un link de Zona Fresh válido.');
    }
}

async function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        try {
            await html5QrCode.stop();
            html5QrCode.clear();
        } catch (err) {
            console.error("Error al detener el scanner:", err);
        }
    }
    closeQrModal();
}

function closeQrModal() {
    qrOverlay.classList.add('opacity-0');
    qrContent.classList.add('opacity-0', 'scale-90');
    setTimeout(() => {
        qrModal.classList.add('invisible');
    }, 300);
}

if (closeQr) closeQr.onclick = stopScanner;

window.addEventListener('online', () => { socket.connect(); });
window.addEventListener('offline', () => { isOffline = true; });


// UI Elements
const productList = document.getElementById('product-list');
const cartCount = document.getElementById('cart-count');
const cartItems = document.getElementById('cart-items');
const cartTotal = document.getElementById('cart-total');
const cartTotalUSD = document.getElementById('cart-total-usd');
const cartModal = document.getElementById('cart-modal');
const cartContent = document.getElementById('cart-content');
const cartOverlay = document.getElementById('cart-overlay');

// The following global listeners were causing a crash because 'socket' was null.
// They have been consolidated into setupSocketEvents() above.

function getPriceVES(p) {
    return p.promoPriceVES > 0 ? p.promoPriceVES : p.priceVES;
}

function renderFeaturedProducts() {
    const featuredSection = document.getElementById('featured-section');
    const featuredList = document.getElementById('featured-list');
    
    const featured = products.filter(p => p.featured && p.stock > 0);
    
    if (featured.length === 0) {
        featuredSection.classList.add('hidden');
        return;
    }
    
    featuredSection.classList.remove('hidden');
    featuredList.innerHTML = '';
    
    featured.forEach(p => {
        const priceVES = getPriceVES(p);
        const hasPromo = p.promoPriceVES > 0;
        
        const div = document.createElement('div');
        div.className = 'min-w-[200px] w-[200px] bg-white rounded-3xl p-4 shadow-sm border border-amber-100 flex flex-col relative shrink-0 overflow-hidden';
        
        div.innerHTML = `
            ${hasPromo ? '<div class="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl z-10">OFERTA</div>' : ''}
            <div class="h-32 bg-gray-50 rounded-2xl mb-3 overflow-hidden relative">
                <img src="${p.img || 'https://via.placeholder.com/150'}" class="w-full h-full object-cover">
                <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/50 to-transparent"></div>
                <div class="absolute bottom-2 left-2 flex gap-1 flex-wrap">
                    ${(p.flavors || []).slice(0, 2).map(f => `<span class="bg-white/20 backdrop-blur-md text-white text-[8px] font-bold px-1.5 py-0.5 rounded-md border border-white/30">${f}</span>`).join('')}
                </div>
            </div>
            <h4 class="text-sm font-extrabold text-gray-800 line-clamp-1 mb-1">${p.name}</h4>
            <div class="mt-auto flex items-center justify-between">
                <div>
                    <p class="text-lg font-black text-amber-600 leading-none">Bs ${priceVES}</p>
                    <p class="text-[10px] text-gray-400 font-bold">$${p.priceUSD.toFixed(2)}</p>
                </div>
                <button onclick="addToCart('${p.id}')" class="w-10 h-10 bg-amber-50 hover:bg-amber-500 text-amber-600 hover:text-white rounded-xl flex items-center justify-center transition-colors shadow-sm">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        `;
        featuredList.appendChild(div);
    });
}

function renderProducts() {
    productList.innerHTML = '';
    const filtered = products.filter(p => currentCategory === 'Todos' || p.category === currentCategory);

    if (filtered.length === 0) {
        productList.innerHTML = `<div class="text-center py-20 text-gray-400 font-bold">No hay productos en esta categoría.</div>`;
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-4 pb-20';

    filtered.forEach(p => {
        const isOutOfStock = p.stock <= 0;
        const priceVES = getPriceVES(p);
        const hasPromo = p.promoPriceVES > 0;
        
        const div = document.createElement('div');
        div.className = `product-card bg-white rounded-[32px] p-4 shadow-sm border border-gray-100 flex flex-col relative ${isOutOfStock ? 'opacity-50 grayscale' : ''}`;
        
        div.innerHTML = `
            ${hasPromo ? '<div class="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl z-10">OFERTA</div>' : ''}
            <div class="h-32 bg-gray-50 rounded-2xl mb-3 overflow-hidden">
                <img src="${p.img || 'https://via.placeholder.com/150'}" class="w-full h-full object-cover">
            </div>
            <h4 class="text-sm font-extrabold text-gray-800 line-clamp-2 leading-tight h-10 mb-1">${p.name}</h4>
            <div class="mt-auto">
                <div class="flex items-end gap-1 mb-2">
                    <p class="text-lg font-black text-blue-600 leading-none">Bs ${priceVES}</p>
                    ${hasPromo ? `<p class="text-[10px] text-gray-400 line-through mb-0.5">Bs ${p.priceVES}</p>` : ''}
                </div>
                <p class="text-[10px] text-gray-400 font-bold mb-3">Ref: $${p.priceUSD.toFixed(2)}</p>
                <button onclick="addToCart('${p.id}')" class="w-full py-2.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-black uppercase tracking-wider active:bg-blue-600 active:text-white transition-colors" ${isOutOfStock ? 'disabled' : ''}>
                    ${isOutOfStock ? 'Agotado' : '<i class="fas fa-shopping-basket mr-1"></i> Añadir'}
                </button>
            </div>
        `;
        grid.appendChild(div);
    });
    productList.appendChild(grid);
}


window.addToCart = (id) => {
    const product = products.find(p => p.id === id);
    if (!product || product.stock <= 0) return;

    const existing = cart.find(item => item.id === id);
    if (existing) {
        if (existing.qty < product.stock) {
            existing.qty++;
        } else {
            alert('No hay más stock disponible');
            return;
        }
    } else {
        cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
};

function updateCartUI() {
    const totalQty = cart.reduce((acc, item) => acc + item.qty, 0);
    cartCount.textContent = totalQty;
    cartCount.classList.toggle('hidden', totalQty === 0);

    cartItems.innerHTML = '';
    let totalVES = 0;
    let totalUSD = 0;

    cart.forEach(item => {
        const unitPriceVES = getPriceVES(item);
        const itemTotalVES = unitPriceVES * item.qty;
        
        totalVES += itemTotalVES;
        totalUSD += (item.priceUSD * item.qty);

        const div = document.createElement('div');
        div.className = 'flex items-center gap-4 bg-gray-50 p-4 rounded-3xl';
        div.innerHTML = `
            <div class="w-16 h-16 bg-white rounded-2xl overflow-hidden shrink-0 relative">
                ${item.promoPriceVES > 0 ? '<div class="absolute top-0 right-0 bg-red-500 w-2 h-2 rounded-full m-1"></div>' : ''}
                <img src="${item.img}" class="w-full h-full object-cover">
            </div>
            <div class="flex-1">
                <h5 class="text-sm font-extrabold text-gray-800 line-clamp-1">${item.name}</h5>
                <p class="text-blue-600 font-black">Bs ${unitPriceVES} <span class="text-[10px] text-gray-400 font-bold ml-1">($${item.priceUSD})</span></p>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="changeQty('${item.id}', -1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-full text-gray-400 shadow-sm"><i class="fas fa-minus text-[10px]"></i></button>
                <span class="font-black text-gray-800">${item.qty}</span>
                <button onclick="changeQty('${item.id}', 1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-full text-gray-400 shadow-sm"><i class="fas fa-plus text-[10px]"></i></button>
            </div>
        `;
        cartItems.appendChild(div);
    });

    cartTotal.textContent = `Bs ${totalVES.toLocaleString()}`;
    cartTotalUSD.textContent = `$${totalUSD.toFixed(2)}`;
    document.getElementById('send-order').disabled = cart.length === 0;
    
    // Save cart to offline storage
    localStorage.setItem('pos_mobile_cart', JSON.stringify(cart));
}

window.changeQty = (id, delta) => {
    const index = cart.findIndex(item => item.id === id);
    if (index === -1) return;

    const product = products.find(p => p.id === id);
    const newQty = cart[index].qty + delta;

    if (newQty <= 0) {
        cart.splice(index, 1);
    } else if (newQty <= product.stock) {
        cart[index].qty = newQty;
    }
    updateCartUI();
};

// Modals
document.getElementById('cart-trigger').onclick = () => {
    cartModal.classList.remove('invisible');
    setTimeout(() => {
        cartOverlay.classList.replace('opacity-0', 'opacity-100');
        cartContent.classList.replace('translate-y-full', 'translate-y-0');
    }, 10);
};

const closeCart = () => {
    cartOverlay.classList.replace('opacity-100', 'opacity-0');
    cartContent.classList.replace('translate-y-0', 'translate-y-full');
    setTimeout(() => cartModal.classList.add('invisible'), 300);
};

document.getElementById('close-cart').onclick = closeCart;
cartOverlay.onclick = closeCart;

// Payment Modal
const paymentModal = document.getElementById('payment-modal');
const paymentContent = document.getElementById('payment-content');
const paymentOverlay = document.getElementById('payment-overlay');
let selectedMethod = 'pago_movil';

document.getElementById('checkout-trigger').onclick = () => {
    // Calcular total antes de abrir
    const totalVES = cart.reduce((acc, item) => {
        return acc + (getPriceVES(item) * item.qty);
    }, 0);
    document.getElementById('payment-amount').value = totalVES;

    paymentModal.classList.remove('invisible');
    setTimeout(() => {
        paymentOverlay.classList.replace('opacity-0', 'opacity-100');
        paymentContent.classList.replace('translate-y-full', 'translate-y-0');
    }, 10);
};

const closePayment = () => {
    paymentOverlay.classList.replace('opacity-100', 'opacity-0');
    paymentContent.classList.replace('translate-y-0', 'translate-y-full');
    setTimeout(() => paymentModal.classList.add('invisible'), 300);
};

document.getElementById('close-payment').onclick = closePayment;
paymentOverlay.onclick = closePayment;

// Payment Method Switcher
document.querySelectorAll('.pay-method-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.pay-method-btn').forEach(b => {
            b.classList.remove('active', 'border-blue-600', 'bg-blue-50');
            b.classList.add('border-gray-100', 'bg-gray-50');
            b.querySelector('i').classList.replace('text-blue-600', 'text-gray-400');
            b.querySelector('span').classList.replace('text-blue-600', 'text-gray-400');
        });

        btn.classList.add('active', 'border-blue-600', 'bg-blue-50');
        btn.classList.remove('border-gray-100', 'bg-gray-50');
        btn.querySelector('i').classList.replace('text-gray-400', 'text-blue-600');
        btn.querySelector('span').classList.replace('text-gray-400', 'text-blue-600');

        selectedMethod = btn.dataset.method;
        
        const isPagoMovil = selectedMethod === 'pago_movil';
        document.getElementById('pago-movil-details').classList.toggle('hidden', !isPagoMovil);
        document.getElementById('other-methods-details').classList.toggle('hidden', isPagoMovil);
    };
});

// Categories
document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.onclick = (e) => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active', 'bg-blue-600', 'text-white'));
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.add('bg-gray-100', 'text-gray-500'));
        
        btn.classList.add('active', 'bg-blue-600', 'text-white');
        btn.classList.remove('bg-gray-100', 'text-gray-500');
        
        currentCategory = btn.dataset.category;
        renderProducts();
    };
});

// Finalizar Pedido
let isSendingOrder = false;

document.getElementById('send-order').onclick = () => {
    if (isSendingOrder) return;
    isSendingOrder = true;

    const originName = document.getElementById('origin-name').value.trim();
    const originPhone = document.getElementById('origin-phone-global').value.trim();
    const pmPhone = document.getElementById('origin-phone').value.trim();
    const originCI = document.getElementById('origin-ci').value.trim();
    const originRef = document.getElementById('origin-ref').value.trim();
    const amount = document.getElementById('payment-amount').value;
    const observations = document.getElementById('origin-observations').value.trim();
    const pickupTime = document.getElementById('pickup-time').value;

    // Validación global
    if (!originName || !originPhone) {
        alert('⚠️ Por favor, ingresa tu Nombre y Teléfono para la factura.');
        isSendingOrder = false;
        return;
    }

    // Validación específica para Pago Móvil
    if (selectedMethod === 'pago_movil') {
        if (!pmPhone || !originCI || !originRef) {
            alert('⚠️ Para Pago Móvil, debes llenar Teléfono de Pago, Cédula y Referencia.');
            isSendingOrder = false;
            return;
        }
        if (originRef.length < 4) {
            alert('⚠️ La referencia de pago debe tener los últimos 4 dígitos.');
            isSendingOrder = false;
            return;
        }
    }

    const paymentDetails = {
        method: selectedMethod,
        originPhone: originPhone, // Global phone
        originCI: originCI,
        originName: originName,
        originRef: originRef,
        amount: amount,
        observations: observations,
        pickupTime: pickupTime
    };

    const orderData = {
        id: '10' + Date.now().toString().slice(-4), // Simplificado para que parezca número de orden ej: 104592
        items: cart,
        totalVES: cart.reduce((acc, item) => acc + (getPriceVES(item) * item.qty), 0),
        totalUSD: cart.reduce((acc, item) => acc + (item.priceUSD * item.qty), 0),
        payment: paymentDetails,
        timestamp: new Date().toISOString()
    };

    if (isOffline) {
        alert("⚠️ No tienes conexión. El pedido no se puede enviar en modo offline.");
        isSendingOrder = false;
        return;
    }

    socket.emit('new-order', orderData);
    
    // Alerta visual de éxito actualizada (a petición del usuario)
    alert(`✅ ¡Usted es la orden N° ${orderData.id}!\n\nSu pedido y pago han sido enviados a la caja con éxito.`);
    cart = [];
    updateCartUI();
    closePayment();
    closeCart();

    // Reset Form
    document.getElementById('origin-phone-global').value = '';
    document.getElementById('origin-phone').value = '';
    document.getElementById('origin-ci').value = '';
    document.getElementById('origin-name').value = '';
    document.getElementById('origin-ref').value = '';
    document.getElementById('origin-observations').value = '';
    document.getElementById('pickup-time').value = '';

    setTimeout(() => { isSendingOrder = false; }, 2000);
};

// Initial render from local cache if available 
// (Done after all functions are defined)
if(products.length > 0) {
    renderFeaturedProducts();
    renderProducts();
    updateCartUI(); 
}
