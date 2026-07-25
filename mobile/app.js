// Compatibility polyfill for older mobile browsers
if (typeof AbortSignal !== 'undefined' && !AbortSignal.timeout) {
    AbortSignal.timeout = function(ms) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    };
}

// Smart server URL management
const businessId = 'eb60443d3b66474b7c6c';
const permanentUrl = 'https://puntopila.emprende.ve';
let savedServerUrl = localStorage.getItem('pos_server_url') || permanentUrl;

let socket = null;
let isOffline = !navigator.onLine;

let products = [];
try {
    const cachedProducts = localStorage.getItem('pos_mobile_products');
    if (cachedProducts && cachedProducts !== 'undefined' && cachedProducts !== 'null') {
        products = JSON.parse(cachedProducts) || [];
    }
} catch (e) {
    console.error('Error parsing products cache:', e);
}

let cart = [];
try {
    const cachedCart = localStorage.getItem('pos_mobile_cart');
    if (cachedCart && cachedCart !== 'undefined' && cachedCart !== 'null') {
        cart = JSON.parse(cachedCart) || [];
    }
} catch (e) {
    console.error('Error parsing cart cache:', e);
}

let exchangeRate = 36.50;
try {
    const cachedRate = localStorage.getItem('pos_mobile_rate');
    if (cachedRate && cachedRate !== 'undefined' && cachedRate !== 'null') {
        exchangeRate = parseFloat(cachedRate) || 36.50;
    }
} catch (e) {
    console.error('Error parsing rate cache:', e);
}

let currentCategory = 'Todos';

// UI Elements for connection
const statusBanner = document.createElement('div');
statusBanner.id = 'connection-status';
statusBanner.className = 'bg-amber-500 text-white text-xs font-bold text-center py-1.5 transition-all duration-300 flex items-center justify-center gap-2';
statusBanner.innerHTML = '<div class="w-2 h-2 rounded-full bg-white animate-pulse"></div> Iniciando...';
document.body.insertBefore(statusBanner, document.body.firstChild);

function updateStatus(text, colorClass, hideAfter = 0) {
    statusBanner.style.display = '';
    statusBanner.className = `bg-${colorClass}-500 text-white text-[10px] font-black text-center py-2 transition-all duration-300 flex items-center justify-center gap-2 uppercase tracking-tighter`;
    statusBanner.innerHTML = `<i class="fas fa-signal animate-pulse"></i> ${text}`;
    if (hideAfter > 0) {
        setTimeout(() => { statusBanner.style.display = 'none'; }, hideAfter);
    }
}

async function initConnection() {
    // 1. Prioridad: Revisar si hay una URL o un Business ID (bid) en el hash
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const urlOverride = hashParams.get('url');
    const bidOverride = hashParams.get('bid');

    if (urlOverride && urlOverride.startsWith('http')) {
        console.log('🚀 Sobreescritura de URL detectada:', urlOverride);
        savedServerUrl = urlOverride;
        localStorage.setItem('pos_server_url', urlOverride);
    }

    // Persistir el Business ID único para futuras reconexiones
    if (bidOverride) {
        console.log('🆔 Nuevo Business ID detectado:', bidOverride);
        localStorage.setItem('pos_business_id', bidOverride);
    }

    // Usar el ID dinámico o el fallback histórico
    const activeBid = localStorage.getItem('pos_business_id') || 'cajafresh_pos_v2_778899_remote';

    // 2. Mostrar estado amigable
    updateStatus('CONECTANDO...', 'amber');

    // Múltiples vectores de ataque para encontrar la caja
    const candidates = [
        window.location.origin, // Bala de plata: conectar siempre al dominio actual
        savedServerUrl, 
        permanentUrl,
        `http://DESKTOP-DMAJ5AF.local:3000`, // DNS Directo (La más infalible en WiFi)
        `http://192.168.50.24:3000`, // IP Fuerte detectada
        `http://192.168.1.5:3000`,
        `http://192.168.0.5:3000`
    ].filter(u => u && u.length > 5);

    // 2. Descubrimiento silencioso en nube vía NTFY (usando el canal del cliente)
    fetch(`https://ntfy.sh/${activeBid}/json?poll=1&since=12h`, { signal: AbortSignal.timeout(3500) })
        .then(res => res.text())
        .then(text => {
            const lines = text.trim().split('\n');
            let foundUrl = null;
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (!line) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.message) {
                        const match = data.message.match(/(https?:\/\/[^\s,]+)/);
                        if (match) {
                            foundUrl = match[1];
                            break;
                        }
                    }
                } catch(e) {}
            }
            if (foundUrl && savedServerUrl !== foundUrl) {
                console.log('🚀 Forzando cambio a nueva URL remota encontrada vía NTFY:', foundUrl);
                tryConnect(foundUrl);
            }
        }).catch(() => {});

    // 3. Probar todos los candidatos como una escopeta
    candidates.forEach(url => tryConnect(url));
}

let connectionLock = false;

function tryConnect(url) {
    if (connectionLock) return;
    
    const isTunnel = url.includes('cloudflare') || url.includes('loca.lt');
    console.log(`⚡ Probando (${isTunnel ? 'TUNNEL' : 'LOCAL'}):`, url);
    
    const testSocket = io(url, {
        timeout: 8000,
        transports: ['polling', 'websocket'], // Fallback seguro para evitar CORS y WSS errors en iOS
        reconnection: true,
        reconnectionAttempts: 5
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
        
        updateStatus(`CONECTADO: ${url.replace('https://','').split('/')[0]}`, 'emerald', 4000);
        setupSocketEvents();
    });

    // Debug de errores
    testSocket.on('connect_error', (err) => {
        console.warn(`❌ Error en ${url}:`, err.message);
    });

    setTimeout(() => { if (!connectionLock) testSocket.close(); }, 12000); // Dar suficiente tiempo para túneles lentos
}

function setupSocketEvents() {
    socket.on('connect', () => {
        const shortUrl = savedServerUrl.replace('https://', '').replace('http://', '').split('/')[0];
        updateStatus(`CONECTADO: ${shortUrl}`, 'emerald', 5000);
        isOffline = false;
        saveToHistory(savedServerUrl);
        console.log('✅ Socket conectado:', savedServerUrl);
    });

    socket.on('disconnect', () => {
        updateStatus('Sin conexión - Reintentando...', 'rose');
        isOffline = true;
        
        // Mostrar pantalla de bloqueo para forzar recarga si el túnel cambió
        if (!document.getElementById('disconnect-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'disconnect-overlay';
            overlay.className = 'fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[1000] flex flex-col items-center justify-center p-8 text-center animate-fade-in';
            overlay.innerHTML = `
                <div class="w-20 h-20 bg-rose-500 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-rose-500/40">
                    <i class="fas fa-plug text-3xl text-white animate-pulse"></i>
                </div>
                <h2 class="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Conexión Perdida</h2>
                <p class="text-slate-300 font-medium mb-8">El servidor de la caja se desconectó o la dirección cambió.</p>
                <button onclick="window.location.reload()" class="w-full py-4 bg-white text-slate-900 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">
                    Refrescar Conexión
                </button>
                <p class="mt-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-loose">Si el problema persiste,<br>escanea el código QR de nuevo.</p>
            `;
            document.body.appendChild(overlay);
        }
    });

    // Solicitar menú completo al servidor (Pull Activo)
    socket.emit('request-sync');
    
    // Timeout para dar feedback si la caja no responde
    setTimeout(() => {
        if (products.length === 0) {
            const list = document.getElementById('product-list');
            if (list && list.innerHTML.includes('Conectando')) {
                list.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full text-center py-20 px-6">
                        <i class="fas fa-exclamation-triangle text-4xl text-amber-500 mb-4 animate-pulse"></i>
                        <h3 class="text-xl font-black text-slate-800 mb-2">Conexión Lenta</h3>
                        <p class="text-gray-500 font-medium mb-6">El servidor está conectado, pero no ha enviado los productos. Asegúrate de que el POS en la PC esté abierto.</p>
                        <button onclick="socket.emit('request-sync');" class="px-6 py-3 bg-amber-50 text-amber-600 rounded-xl font-bold uppercase tracking-wider active:scale-95 transition-all mb-3 w-full">Reintentar</button>
                        <button onclick="window.location.reload()" class="px-6 py-3 border-2 border-slate-200 text-slate-600 rounded-xl font-bold uppercase tracking-wider active:scale-95 transition-all w-full">Refrescar App</button>
                    </div>
                `;
            }
        }
    }, 8000);

    socket.on('reconnect_attempt', (attempt) => {
        const urlToTry = savedServerUrl.replace('https://', '').replace('http://', '').split('/')[0];
        statusBanner.innerHTML = `<i class="fas fa-sync fa-spin"></i> Reintentando (${attempt}) a ${urlToTry}... <button onclick="showServerConfig()" class="ml-2 underline text-[10px]">Cambiar</button>`;
    });

    socket.on('products-updated', (data) => {
        if (!data) return;
        products = data.products || [];
        exchangeRate = parseFloat(data.exchangeRate) || 36.50;
        
        // Dynamic Branding update
        const displayTitle = data.mobileTitle || data.companyName || 'PUNTO PILA';
        document.title = displayTitle;
        const headerTitle = document.getElementById('mobile-header-title');
        if (headerTitle) headerTitle.textContent = displayTitle.toUpperCase();
        
        // Color de Marca y Detalles
        if (data.mobileColor) {
            const themeColor = data.mobileColor;
            let styleTag = document.getElementById('dynamic-theme-style');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'dynamic-theme-style';
                document.head.appendChild(styleTag);
            }
            // Inyectar CSS que sobreescribe Tailwind para los elementos clave
            styleTag.innerHTML = `
                :root { --brand-color: ${themeColor}; }
                .text-blue-600 { color: ${themeColor} !important; }
                .bg-blue-600 { background-color: ${themeColor} !important; }
                .border-blue-600 { border-color: ${themeColor} !important; }
                .bg-blue-50 { background-color: ${themeColor}15 !important; } /* Opacidad 15 hex aprox */
                .cat-btn.active { background-color: ${themeColor} !important; box-shadow: 0 4px 12px ${themeColor}40; }
                #send-order { background-color: ${themeColor} !important; box-shadow: 0 10px 20px ${themeColor}30; }
                #mobile-header-title { text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
            `;
        }

        // Imagen de Fondo con controles dinámicos
        if (data.mobileBg) {
            const opacity = (data.mobileBgOpacity !== undefined) ? (1 - (data.mobileBgOpacity / 100)) : 0.1;
            const blur = (data.mobileBgBlur !== undefined) ? data.mobileBgBlur : 0;
            
            document.body.style.backgroundImage = `linear-gradient(rgba(0,0,0,${opacity}), rgba(0,0,0,${opacity})), url('${data.mobileBg}')`;
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundAttachment = 'fixed';
            
            // Ajuste de legibilidad Dinámico
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.className = mainContent.className.replace(/bg-white\/\d+/, ''); // Limpiar opacidades previas
                mainContent.classList.add('bg-white/50');
                mainContent.style.backdropFilter = `blur(${blur}px)`;
                mainContent.style.webkitBackdropFilter = `blur(${blur}px)`; // Soporte iOS
            }
        }

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
window.addEventListener('online', () => { if (socket && !socket.connected) socket.connect(); });
window.addEventListener('offline', () => { 
    isOffline = true; 
    updateStatus('SIN INTERNET EN EL MOVIL', 'rose');
});

// Manual server URL configuration
window.showServerConfig = () => {
    const currentUrl = localStorage.getItem('pos_server_url') || '';
    const newUrl = prompt('URL del servidor Punto Pila:', currentUrl);
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
        alert('❌ El código escaneado no es un link de Punto Pila válido.');
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

    if (isOffline || !socket || !socket.connected) {
        alert("⚠️ No tienes conexión con la caja. Por favor, verifica que la computadora esté encendida con la app abierta.");
        isSendingOrder = false;
        return;
    }

    try {
        socket.emit('new-order', orderData);
    } catch (err) {
        console.error('Error enviando pedido:', err);
        alert('❌ Error crítico al enviar: ' + err.message);
        isSendingOrder = false;
        return;
    }
    
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
