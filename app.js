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
let auditLogs = JSON.parse(localStorage.getItem('freshpos_audit_logs')) || [];
let dailyHistory = JSON.parse(localStorage.getItem('freshpos_history')) || [];
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
let categories = JSON.parse(localStorage.getItem('freshpos_categories')) || ['Gaseosas', 'Aguas', 'Jugos', 'Energizantes'];
const saveCategories = () => localStorage.setItem('freshpos_categories', JSON.stringify(categories));

// --- SISTEMA DE ONBOARDING (TUTORIAL) ---
let onboardingState = JSON.parse(localStorage.getItem('puntopila_onboarding')) || {
    welcome: false,
    sidebar: false,
    pos: false,
    scanner: false,
    analytics: false,
    server: false
};

const saveOnboarding = () => localStorage.setItem('puntopila_onboarding', JSON.stringify(onboardingState));


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

// --- Top-level IPC handler for server-info (registered early, before window.onload) ---
if (window.electronAPI) {
    window.electronAPI.onServerInfo(function(info) {
        var u = 'http://' + info.ip + ':' + info.port + '/mobile';
        window._provisionarLocalUrl = u;
        window._provisionarServerQr = info.qr;
        var ipEl = document.getElementById('server-ip-display');
        if (ipEl) ipEl.textContent = u;
        var sqr = document.getElementById('server-qr-display');
        if (sqr) sqr.src = info.qr;
        var dot = document.getElementById('server-status-dot');
        if (dot) dot.classList.replace('bg-slate-300', 'bg-emerald-500');
        if (typeof window._generarQRLocal === 'function') {
            window._generarQRLocal();
        }
        var downloadUrl = 'http://' + info.ip + ':' + info.port + '/download';
        window.electronAPI.generateDownloadQR(downloadUrl);
    });
}

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
    localStorage.setItem('freshpos_audit_logs', JSON.stringify(auditLogs));
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
    euroRate: 510.00, // Tasa sincronizada con VES
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
    launcherUrl: ''
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
    { id: 'p_1', name: 'Coca-Cola Clásica Lata', category: 'Gaseosas', price: 1.50, costPrice: 0.80, stock: 45 },
    { id: 'p_2', name: 'Agua Mineral Evian', category: 'Aguas', price: 2.00, costPrice: 1.10, stock: 30 },
    { id: 'p_3', name: 'Jugo de Naranja Natural', category: 'Jugos', price: 2.50, costPrice: 1.50, stock: 15 },
    { id: 'p_4', name: 'Papas Fritas Lays 150g', category: 'Snacks', price: 1.80, costPrice: 0.90, stock: 50 },
    { id: 'p_5', name: 'Galletas Oreo Original', category: 'Snacks', price: 1.20, costPrice: 0.60, stock: 80 },
    { id: 'p_6', name: 'Cerveza Corona Extra', category: 'Licores', price: 2.50, costPrice: 1.20, stock: 60 },
    { id: 'p_7', name: 'Café Expreso Doble', category: 'Cafetería', price: 2.00, costPrice: 0.50, stock: 99 },
    { id: 'p_8', name: 'Croissant de Mantequilla', category: 'Panadería', price: 1.50, costPrice: 0.40, stock: 25 },
    { id: 'p_9', name: 'Helado de Vainilla y Fresa', category: 'Postres', price: 3.00, costPrice: 1.20, stock: 20 },
    { id: 'p_10', name: 'Sándwich de Jamón y Queso', category: 'Comida Rápida', price: 4.50, costPrice: 2.00, stock: 12 }
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
    // Global image error handler: replace any broken image with local placeholder
    document.addEventListener('error', (e) => {
        if (e.target && e.target.tagName === 'IMG' && !e.target.src.startsWith('data:')) {
            e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNlMmU4ZjAiLz48dGV4dCB4PSIyMDAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiIGZpbGw9IiM5NGEzYjgiIGZvbnQtc2l6ZT0iMzIiIGZvbnQtZmFtaWx5PSJBcmlhbCxzYW5zLXNlcmlmIj5TaW4gSW1hZ2VuPC90ZXh0Pjwvc3ZnPg==';
            e.target.onerror = null;
        }
    }, true);

    console.log("🚀 Iniciando Sistema Caja Fresh POS...");
    
    const splash = document.getElementById('splash-screen');
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');

    // 1. SECUENCIA DE SALIDA (FALLBACK DE EMERGENCIA)
    // Forzar desaparición si algo falla catastróficamente
    const forceExitTimeout = setTimeout(() => {
        if (splash && splash.style.display !== 'none') {
            console.warn("⚠️ Aplicando salida de emergencia del Splash Screen...");
            splash.classList.add('splash-exit');
            if (aside) aside.classList.remove('initial-hidden');
            if (main) main.classList.remove('initial-hidden');
            setTimeout(() => { splash.style.display = 'none'; }, 1000);
        }
    }, 5000);

    // 2. FUNCIÓN DE REVELACIÓN (ÉXITO)
    const revealInterface = () => {
        console.log("✨ Revelando interfaz de usuario...");
        if (splash) splash.classList.add('splash-exit');
        
        // Entrada escalonada
        setTimeout(() => { if (aside) { aside.classList.remove('initial-hidden'); aside.classList.add('animate-entrance'); } }, 300);
        setTimeout(() => { if (main) { main.classList.remove('initial-hidden'); main.classList.add('animate-entrance'); } }, 500);
        setTimeout(() => { if (splash) splash.style.display = 'none'; }, 1500);
    };

    // 3. CARGA DE MÓDULOS (AISLADA)
    try {
        // Bloque 1: Datos Base (Crítico)
        try {
            await loadData();
            initTheme();
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
            
            // FETCH DAILY RATE
            if (typeof fetchDailyRate === 'function') fetchDailyRate();
            
            // MASTER TOUR: Si el wizard terminó pero el tour pro no se ha hecho
            if (localStorage.getItem('freshpos_wizard_done') && !localStorage.getItem('puntopila_master_tour_done')) {
                setTimeout(() => window.startMasterTour(), 2500);
            }
            
            // DASHBOARD SYNC: Enviar datos cada 60s
            syncDashboardData();
            setInterval(syncDashboardData, 60000);

            // === INICIALIZACIÓN DE MÓDULOS STRANGLER ===
            try {
                if (window.POS && POS.init) POS.init();
                if (window.Notifications && Notifications.init) Notifications.init();
                if (window.Reports && Reports.initDateFilter) Reports.initDateFilter();
                if (window.UpdateManager && UpdateManager.init) UpdateManager.init();
                if (window.MultiOrder && MultiOrder.init) MultiOrder.init();
                if (window.POSCalculator && POSCalculator.init) POSCalculator.init('calculadora-container');
                // Renderizar Dashboard si es la vista activa por defecto
                if (window.Dashboard && Dashboard.render) Dashboard.render();
            } catch(modErr) { console.error('Error inicializando módulos strangler:', modErr); }

            // 5. EVENTOS REMOTOS (Boss App)
            if (window.electronAPI && window.electronAPI.onProductUpdatedRemote) {
                window.electronAPI.onProductUpdatedRemote((updatedProduct) => {
                    console.log("📥 Actualización remota recibida:", updatedProduct);
                    const index = products.findIndex(p => p.id === updatedProduct.id);
                    if (index !== -1) {
                        products[index] = { ...products[index], ...updatedProduct };
                        if (typeof settings !== 'undefined' && settings.exchangeRate) {
                            products[index].priceVES = parseFloat(products[index].priceUSD) * settings.exchangeRate;
                        }
                        saveProducts();
                        renderInventory();
                        if (typeof renderProducts === 'function') renderProducts();
                        syncDashboardData();
                        syncProductsToMobile();
                        if (typeof Toast !== 'undefined') {
                            Toast.fire({
                                icon: 'info',
                                title: `Sync Remoto: ${updatedProduct.name}`
                            });
                        }
                    }
                });
            }

            if (window.electronAPI && window.electronAPI.onProductUpdatedRemoteFull) {
                window.electronAPI.onProductUpdatedRemoteFull((updatedProduct) => {
                    console.log("📥 Actualización remota completa recibida:", updatedProduct);
                    const index = products.findIndex(p => p.id === updatedProduct.id);
                    if (index !== -1) {
                        products[index] = { ...products[index], ...updatedProduct };
                        saveProducts();
                        renderInventory();
                        if (typeof renderProducts === 'function') renderProducts();
                        syncDashboardData();
                        syncProductsToMobile();
                        if (typeof Toast !== 'undefined') {
                            Toast.fire({
                                icon: 'success',
                                title: `Producto Actualizado: ${updatedProduct.name}`
                            });
                        }
                    }
                });
            }
        }, 800);



        // 5. ONBOARDING (Opcional)
        if (!onboardingState.welcome) {
            setTimeout(() => {
                if (window.TutorialEngine) {
                    window.TutorialEngine.showStep('view-pos', 
                        '¡Bienvenido a Punto Pila!', 
                        'Tu nuevo sistema inteligente de gestión comercial ha sido activado. Hemos preparado una breve guía para que domines todas nuestras funciones premium.',
                        () => {
                            window.TutorialEngine.showStep('nav-pos', 
                                'Navegación Inteligente', 
                                'Desde este menú lateral podrás saltar entre el Punto de Venta, tu Inventario y nuestras herramientas de Inteligencia Artificial.',
                                () => {
                                    onboardingState.welcome = true;
                                    onboardingState.sidebar = true;
                                    saveOnboarding();
                                    window.handleViewTutorial('view-pos');
                                }
                            );
                        }
                    );
                }
            }, 2500);
        }
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
    if (window.db) {
        if (!localStorage.getItem('freshpos_db_migrated')) {
            console.log("Migrando de localStorage a SQLite...");
            const legacyData = {
                products: JSON.parse(localStorage.getItem('freshpos_products')) || [],
                clients: JSON.parse(localStorage.getItem('freshpos_clients')) || []
            };
            await window.db.migrateData(legacyData);
            localStorage.setItem('freshpos_db_migrated', 'true');
        }
        
        try {
            let dbProducts = await window.db.getProducts();
            if (dbProducts && dbProducts.length > 0) {
                products = dbProducts.map(p => {
                    // Parse category if it's a JSON string
                    if (typeof p.category === 'string' && (p.category.startsWith('{') || p.category.startsWith('['))) {
                        try { p.category = JSON.parse(p.category); } catch(e){}
                    }
                    // Parse flavors if it's a JSON string
                    if (typeof p.flavors === 'string') {
                        try { p.flavors = JSON.parse(p.flavors); } catch(e){ p.flavors = []; }
                    }
                    // Ensure priceUSD is the master price
                    if (!p.priceUSD && p.price) p.priceUSD = p.price;
                    
                    // Boolean featured
                    p.featured = !!p.featured;

                    // Strip external image URLs that would 404
                    if (p.img && (p.img.includes('unsplash.com') || p.img.includes('placeholder.com'))) {
                        p.img = '';
                    }
                    
                    return p;
                });
            } else {
                products = [...INITIAL_DATA_PRODUCTS];
                // Save initial products to DB
                for (const p of products) await window.db.saveProduct(p);
            }
            
            let dbSales = await window.db.getSales(500) || [];
            sales = dbSales.map(s => {
                if (typeof s.items === 'string') {
                    try { s.items = JSON.parse(s.items); } catch(e) { s.items = []; }
                }
                if (typeof s.client === 'string') {
                    try { s.client = JSON.parse(s.client); } catch(e) { s.client = { name: 'Cliente', document: 'V-000000' }; }
                }
                // Compatibility: SQLite uses 'total' column, app uses 'totalVES'
                if (s.total && !s.totalVES) s.totalVES = s.total;
                if (s.total && !s.totalUSD) s.totalUSD = s.total / (s.exchangeRate || settings.exchangeRate || 36.5);
                return s;
            });
            
            let dbClients = await window.db.getClients();
            clients = (dbClients && dbClients.length > 0) ? dbClients : [...INITIAL_DATA_CLIENTS];
            if (clients === INITIAL_DATA_CLIENTS) {
                for (const c of clients) await window.db.saveClient(c);
            }
        } catch (err) {
            console.error("Error cargando DB, fallback:", err);
            products = JSON.parse(localStorage.getItem('freshpos_products')) || [...INITIAL_DATA_PRODUCTS];
            sales = JSON.parse(localStorage.getItem('freshpos_sales')) || [];
            clients = JSON.parse(localStorage.getItem('freshpos_clients')) || [...INITIAL_DATA_CLIENTS];
        }
    } else {
        products = JSON.parse(localStorage.getItem('freshpos_products')) || [...INITIAL_DATA_PRODUCTS];
        sales = JSON.parse(localStorage.getItem('freshpos_sales')) || [];
        clients = JSON.parse(localStorage.getItem('freshpos_clients')) || [...INITIAL_DATA_CLIENTS];
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
        launcherUrl: ''
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

        // NEW: Initialize minStock if missing
        if (p.minStock === undefined) p.minStock = 5;
        
        return p;
    });

    if (!localStorage.getItem('freshpos_products')) saveProducts();
    if (!localStorage.getItem('freshpos_clients')) saveClients();
    saveSettings();

    document.getElementById('exchange-rate-input').value = settings.exchangeRate;
    const eurRateInput = document.getElementById('euro-rate-input');
    if (eurRateInput) eurRateInput.value = settings.euroRate || 40.00;

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
    if (window.db && window.db.saveProductsBulk) {
        window.db.saveProductsBulk(products).catch(e => console.error(e));
    }
}
function saveSales() { 
    localStorage.setItem('freshpos_sales', JSON.stringify(sales)); 
}
function saveClients() { 
    localStorage.setItem('freshpos_clients', JSON.stringify(clients)); 
    if (window.db) {
        clients.forEach(c => window.db.saveClient(c).catch(e => {}));
    }
}
function saveExpenses() { localStorage.setItem('freshpos_expenses', JSON.stringify(expenses)); }
function saveHistory() { localStorage.setItem('freshpos_history', JSON.stringify(dailyHistory)); }
function saveSettings(forceTunnelRestart = false) {
    // Capturar tasas actualizadas antes de guardar
    const rateVal = parseFloat(document.getElementById('exchange-rate-input')?.value);
    const euroVal = parseFloat(document.getElementById('euro-rate-input')?.value);
    if (rateVal > 0) settings.exchangeRate = rateVal;
    if (euroVal > 0) settings.euroRate = euroVal;

    localStorage.setItem('freshpos_settings', JSON.stringify(settings)); 
    if (window.electronAPI && window.electronAPI.saveData) {
        window.electronAPI.saveData({ filename: 'settings.json', data: settings });
    }
    
    // Reiniciar túneles SOLO si se solicita explícitamente (ej. cambio de Token de Ngrok)
    if (forceTunnelRestart && window.electronAPI && window.electronAPI.restartTunnels) {
        window.electronAPI.restartTunnels();
    }
}
function incTicketNumber() { currentTicketNumber++; localStorage.setItem('freshpos_ticket', currentTicketNumber); }

// El sistema utiliza ahora initMobileServer() definido en la sección de automatización (al final del archivo).


// Navigation Logic
function initNavigation() {
    const navItems = {
        'nav-dashboard': 'view-dashboard',
        'nav-pos': 'view-pos',
        'nav-inventory': 'view-inventory',
        'nav-provisionar': 'view-provisionar',
        'nav-clients': 'view-clients',
        'nav-reports': 'view-reports',
        'nav-analytics': 'view-analytics',
        'nav-purchases': 'view-purchases',
        'nav-proveedores': 'view-proveedores',
        'nav-payables': 'view-payables',
        'nav-credits': 'view-credits',
        'nav-expenses': 'view-expenses',
        'nav-client-history': 'view-client-history',
        'nav-movements': 'view-movements',
        'nav-excel-export': 'view-excel-export',
        'nav-cashup': 'view-cashup',
        'nav-server': 'view-server',
        'nav-settings': 'view-settings',
        'nav-mobile-payments': 'view-mobile-payments',
        'nav-mobile-deliveries': 'view-mobile-deliveries',
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
        if (viewId === 'view-dashboard' && window.Dashboard) Dashboard.render();
        if (viewId === 'view-pos') renderProducts();
        if (viewId === 'view-inventory') renderInventory();
        if (viewId === 'view-provisionar') { if (window.Provisionar && window.Provisionar.init) window.Provisionar.init(); }
        if (viewId === 'view-clients') renderClients();
        if (viewId === 'view-reports') renderReports();
        if (viewId === 'view-analytics') renderAnalytics();
        if (viewId === 'view-purchases') initPurchases();
        if (viewId === 'view-proveedores') {
            if (typeof renderProveedores === 'function') renderProveedores();
        }
        if (viewId === 'view-payables') {
            if (typeof renderPayables === 'function') renderPayables();
        }
        if (viewId === 'view-credits') renderCredits();
        if (viewId === 'view-expenses') renderExpenses();
        if (viewId === 'view-client-history') {
            if (typeof renderClientHistory === 'function') renderClientHistory();
        }
        if (viewId === 'view-movements') {
            if (typeof renderMovements === 'function') renderMovements();
        }
        if (viewId === 'view-excel-export') {
            if (typeof renderExcelExport === 'function') renderExcelExport();
        }
        if (viewId === 'view-cashup') {
            if (typeof renderCashup === 'function') renderCashup();
        }
        if (viewId === 'view-server') initMobileServer();
        if (viewId === 'view-mobile-payments') renderMobilePaymentsRegistry();
        if (viewId === 'view-mobile-deliveries') renderMobileDeliveries();
        if (viewId === 'view-audit') renderAuditLogs();

        // --- DISPARADORES DE TUTORIAL ---
        window.handleViewTutorial(viewId);
    };

    for (let navId in navItems) {
        document.getElementById(navId).addEventListener('click', (e) => {
            e.preventDefault();
            window.switchView(navItems[navId]);
        });
    }
}

// --- AUTO FETCH DAILY RATE ---
async function fetchDailyRate() {
    try {
        const btn = document.getElementById('sync-rate-btn');
        if(btn) {
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

        if (bcvDolar && bcvDolar.promedio > 0) {
            const input = document.getElementById('exchange-rate-input');
            if (input) {
                input.value = bcvDolar.promedio.toFixed(2);
                input.dispatchEvent(new Event('input'));
                input.dispatchEvent(new Event('blur'));
                successCount++;
            }
        }
        
        if (bcvEuro && bcvEuro.promedio > 0) {
            const euroInput = document.getElementById('euro-rate-input');
            if (euroInput) {
                euroInput.value = bcvEuro.promedio.toFixed(2);
                euroInput.dispatchEvent(new Event('input'));
                euroInput.dispatchEvent(new Event('blur'));
                successCount++;
            }
        }

        if (successCount === 0) {
            Swal.fire('Error', 'No se pudo obtener las tasas del BCV', 'error');
        }
    } catch (e) {
        console.error("Error fetching rate:", e);
        Swal.fire('Error de Conexión', 'No se pudo conectar con el servidor de tasas.', 'error');
    } finally {
        const btn = document.getElementById('sync-rate-btn');
        if(btn) {
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
                        // Actualizar productos y carrito con nueva tasa USD
                        products = products.map(p => {
                            const baseUSD = parseFloat(p.priceUSD || p.price || 0);
                            const baseVES = parseFloat(p.priceVES || 0);
                            
                            if (baseUSD > 0) {
                                // Master is USD
                                p.priceVES = Math.round((baseUSD * val) / 10) * 10;
                            } else if (baseVES > 0 && baseUSD === 0) {
                                // Master is VES
                                p.priceUSD = baseVES / val;
                            }
                            return p;
                        });
                        cart = cart.map(item => {
                            const itemUSD = parseFloat(item.priceUSD || item.price || 0);
                            const itemVES = parseFloat(item.priceVES || 0);
                            
                            if (itemUSD > 0) {
                                item.priceVES = Math.round((itemUSD * val) / 10) * 10;
                            } else if (itemVES > 0 && itemUSD === 0) {
                                item.priceUSD = itemVES / val;
                            }
                            return item;
                        });
                        saveProducts();
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
                if (typeof generateZReport === 'function') generateZReport(true);
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
                <div class="flex items-center justify-between p-3 mb-2 bg-slate-50 rounded-2xl border border-slate-100 hover:border-brand-200 transition-all group">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-black bg-brand-100 text-brand-700 px-2 py-0.5 rounded-lg">#${s.ticket}</span>
                            <span class="text-[10px] text-slate-400 font-bold uppercase">${new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div class="text-sm font-bold text-slate-700 truncate w-32 md:w-32">${s.client?.name || 'Cliente Final'}</div>
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
        const s = searchTerm.toLowerCase();
        const matchesSearch = 
            p.name.toLowerCase().includes(s) || 
            (p.category && p.category.toLowerCase().includes(s)) ||
            (p.id && p.id.toLowerCase().includes(s)) ||
            (p.description && p.description.toLowerCase().includes(s));
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
                <img src="${product.img || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNlMmU4ZjAiLz48dGV4dCB4PSIyMDAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiIGZpbGw9IiM5NGEzYjgiIGZvbnQtc2l6ZT0iMzIiIGZvbnQtZmFtaWx5PSJBcmlhbCxzYW5zLXNlcmlmIj5TaW4gSW1hZ2VuPC90ZXh0Pjwvc3ZnPg=='}" alt="${product.name}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
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

    document.getElementById('add-product-btn').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('product-featured').checked = false;
        document.getElementById('modal-product-title').textContent = 'Añadir Producto';
        
        const preview = document.getElementById('product-img-preview');
        if (preview) preview.classList.add('hidden');
        
        const flavCont = document.getElementById('product-flavors-container');
        if (flavCont) flavCont.innerHTML = ''; 
        
        const flavInput = document.getElementById('product-flavors');
        if (flavInput) flavInput.value = '';

        modal.classList.add('modal-open');
        setTimeout(() => { modal.classList.add('modal-fade-in'); }, 10);
    });

    document.querySelectorAll('.close-product-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-fade-in'); content.classList.remove('modal-scale-in');
        modal.classList.remove('modal-open');
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

        if (!name || !category || (priceVES <= 0 && priceUSD <= 0)) {
            Swal.fire('Error', 'Nombre, categoría y al menos un precio son obligatorios.', 'error');
            return;
        }

        if (id) {
            const index = products.findIndex(p => p.id === id);
            if (index > -1) {
                const oldProduct = { ...products[index] };
                products[index] = { ...products[index], name, category, priceVES, priceUSD, priceEUR, costPrice, stock, minStock, img, featured, flavors, expiryDate, description };
                
                // AUDIT: Solo loggear si hubo cambios significativos
                if (oldProduct.priceVES !== priceVES || oldProduct.priceUSD !== priceUSD || oldProduct.stock !== stock) {
                    logAction('PRODUCT_UPDATE', `Editado producto: ${name} (Stock: ${stock}, Min: ${minStock})`, { old: oldProduct, new: products[index] });
                }
            }
        } else {
            const newProd = { id: generateId(), name, category, priceVES, priceUSD, priceEUR, costPrice, stock, minStock, img, featured, flavors, expiryDate, description };
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
            preview.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTUwIDE1MCI+PHJlY3Qgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxNTAiIGZpbGw9IiNlMmU4ZjAiLz48dGV4dCB4PSI3NSIgeT0iNzUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIiBmaWxsPSIjOTRhM2I4IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwsc2Fucy1zZXJpZiI+U2luIEltYWdlbjwvdGV4dD48L3N2Zz4=';
        }
    });

    document.getElementById('product-flavors').addEventListener('input', (e) => {
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

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    
    const filtered = products.filter(p => {
        const s = inventorySearchTerm.toLowerCase();
        return p.name.toLowerCase().includes(s) || 
               (p.category && p.category.toLowerCase().includes(s)) ||
               (p.id && p.id.toLowerCase().includes(s)) ||
               (p.description && p.description.toLowerCase().includes(s));
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
                <img src="${p.img || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cmVjdCB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNlMmU4ZjAiLz48dGV4dCB4PSIyNSIgeT0iMjUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIiBmaWxsPSIjOTRhM2I4IiBmb250LXNpemU9IjgiIGZvbnQtZmFtaWx5PSJBcmlhbCxzYW5zLXNlcmlmIj4tPC90ZXh0Pjwvc3ZnPg=='}" alt="${p.name}" class="w-10 h-10 object-cover rounded-md">
            </td>
            <td class="py-3 px-4">
                <div class="font-bold text-slate-800">${p.name}</div>
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
    document.getElementById('product-featured').checked = !!p.featured;
    document.getElementById('product-flavors').value = (p.flavors || []).join(', ');
    document.getElementById('product-expiry').value = p.expiryDate || '';
    document.getElementById('product-description').value = p.description || '';
    
    // Preview image with safeguard
    const preview = document.getElementById('product-img-preview');
    if (preview) {
        preview.src = p.img || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTUwIDE1MCI+PHJlY3Qgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxNTAiIGZpbGw9IiNlMmU4ZjAiLz48dGV4dCB4PSI3NSIgeT0iNzUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIiBmaWxsPSIjOTRhM2I4IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwsc2Fucy1zZXJpZiI+U2luIEltYWdlbjwvdGV4dD48L3N2Zz4=';
        preview.classList.remove('hidden');
    }
    
    document.getElementById('modal-product-title').textContent = 'Editar Producto';

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
    setTimeout(() => { modal.classList.add('modal-fade-in'); }, 10);
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
        setTimeout(() => { modal.classList.add('modal-fade-in'); }, 10);
    });

    document.querySelectorAll('.close-client-modal').forEach(btn => btn.addEventListener('click', () => {
        modal.classList.remove('modal-open');
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
    setTimeout(() => { modal.classList.add('modal-fade-in'); }, 10);
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
    if (checkoutMethod === 'pago-movil') {
        const ref = document.getElementById('pm-ref')?.value.trim() || '';
        if (ref.length < 4) isValid = false;
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
        
        // Trigger dashboard update immediately
        if (window.Dashboard && typeof Dashboard.render === 'function') Dashboard.render();
        if (typeof syncDashboardData === 'function') syncDashboardData();

    } catch (err) {
        console.error('❌ Error crítico en processPayment:', err);
        Swal.fire('Error de Sistema', 'No se pudo completar el cobro: ' + err.message, 'error');
    }
}

// ==========================================
// REPORTS
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

function renderAnalytics() {
    // 1. Inversión en Stock (Stock * Costo)
    const inventoryValue = products.reduce((acc, p) => acc + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0)), 0);
    const valEl = document.getElementById('ana-inventory-value');
    if (valEl) valEl.textContent = formatUSD(inventoryValue);

    // 2. Utilidad Acumulada Histórica
    const totalProfitHistory = dailyHistory.reduce((acc, d) => acc + (Number(d.profitUSD) || 0), 0);
    
    // Calcular ganancia del día, retro-aplicando costos si la venta se guardó sin ellos
    let recalculatedDayProfit = 0;
    sales.forEach(s => {
        let saleCost = Number(s.totalCostUSD) || 0;
        if (saleCost === 0 && Array.isArray(s.items)) {
            // Retro-calcular costo basado en el inventario actual
            saleCost = s.items.reduce((accItem, item) => {
                const prod = products.find(p => p.id === item.id || p.id === item.parentId);
                return accItem + ((Number(prod?.costPrice) || 0) * (Number(item.qty) || 0));
            }, 0);
        }
        recalculatedDayProfit += ((Number(s.totalUSD) || 0) - saleCost);
    });
    const currDayProfit = recalculatedDayProfit;

    const profEl = document.getElementById('ana-total-profit');
    if (profEl) profEl.textContent = formatUSD(totalProfitHistory + currDayProfit);

    // 3. Margen Promedio Real
    const totalSalesHistory = dailyHistory.reduce((acc, d) => acc + (Number(d.salesUSD) || 0), 0);
    const daySales = sales.reduce((acc, s) => acc + (Number(s.totalUSD) || 0), 0);
    const totalSalesAll = totalSalesHistory + daySales;
    const avgMargin = totalSalesAll > 0 ? ((totalProfitHistory + currDayProfit) / totalSalesAll) * 100 : 0;
    const margEl = document.getElementById('ana-average-margin');
    if (margEl) margEl.textContent = (isNaN(avgMargin) ? 0 : avgMargin).toFixed(1) + '%';

    // 4. Ranking de Productos más Rentables
    const prodStats = {};
    sales.forEach(s => {
        if (!Array.isArray(s.items)) return;
        s.items.forEach(i => {
            if (!prodStats[i.id]) prodStats[i.id] = { name: i.name, qty: 0, profit: 0, cost: 0 };
            const prod = products.find(p => p.id === i.id);
            const cost = Number(prod?.costPrice) || 0;
            const itemPrice = Number(i.unitPriceUSD || i.price) || 0;
            const itemQty = Number(i.qty) || 0;
            prodStats[i.id].qty += itemQty;
            prodStats[i.id].profit += (itemPrice - cost) * itemQty;
            prodStats[i.id].cost = cost;
        });
    });

    const ranking = Object.values(prodStats).sort((a,b) => b.profit - a.profit).slice(0, 5);
    const rankingBody = document.getElementById('ana-top-products-body');
    if (rankingBody) {
        rankingBody.innerHTML = ranking.length ? ranking.map(p => {
            const unitProfit = p.qty > 0 ? p.profit / p.qty : 0;
            const unitCost = p.cost;
            const margin = (unitProfit + unitCost) > 0 ? (unitProfit / (unitProfit + unitCost)) * 100 : 0;
            const safeMargin = isNaN(margin) ? 0 : margin.toFixed(0);

            return `
                <tr>
                    <td class="py-4 px-8 font-bold text-slate-700">${p.name}</td>
                    <td class="py-4 px-8 text-center font-medium text-slate-500">${p.qty}</td>
                    <td class="py-4 px-8 text-center"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-bold">${safeMargin}%</span></td>
                    <td class="py-4 px-8 text-right font-black text-slate-800">${formatUSD(p.profit || 0)}</td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="4" class="py-10 text-center text-slate-400 italic">No hay ventas registradas aún hoy</td></tr>';
    }

    // 5. Gráficos de Tendencia y Eficiencia
    renderAnalyticsCharts(currDayProfit);

    // 5b. Gráficos de Categoría y Métodos de Pago (movidos desde Reporte de Caja)
    if (window._lastCatTotals && window._lastMethodTotals) {
        renderInternalCharts(window._lastCatTotals, window._lastMethodTotals);
    } else {
        // Recalcular si no hay cache (primera vez que se abre Rendimientos sin pasar por Reportes)
        let catTotals = {};
        let methodTotals = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0 };
        sales.forEach(sale => {
            methodTotals[sale.method] = (methodTotals[sale.method] || 0) + (Number(sale.totalVES) || 0);
            if (!Array.isArray(sale.items)) return;
            sale.items.forEach(item => {
                catTotals[item.category] = (catTotals[item.category] || 0) + ((Number(item.unitPriceVES) || 0) * (Number(item.qty) || 0));
            });
        });
        renderInternalCharts(catTotals, methodTotals);
    }

    // 6. NUEVO: Punto de Equilibrio y Proyecciones (Analytics 2.0)
    // Asegurar que expenses esté definido
    const expensesList = typeof expenses !== 'undefined' && Array.isArray(expenses) ? expenses : [];
    const totalExpensesUSD = expensesList.reduce((acc, e) => acc + (Number(e.amountUSD) || 0), 0);
    const avgMarginRate = (isNaN(avgMargin) || avgMargin <= 0) ? 0.3 : (avgMargin / 100);
    
    // Punto de Equilibrio: Cuánto necesito vender para cubrir gastos
    const breakEvenSales = totalExpensesUSD / (avgMarginRate > 0 ? avgMarginRate : 0.01);
    const bePercent = breakEvenSales > 0 ? Math.min(100, (daySales / breakEvenSales) * 100) : 100;
    
    const beStatusEl = document.getElementById('ana-be-status');
    const bePercentEl = document.getElementById('ana-be-percent');
    const beBarEl = document.getElementById('ana-be-bar');
    
    if (beStatusEl) {
        if (totalExpensesUSD === 0) {
            beStatusEl.textContent = "Registra gastos para calcular el punto de equilibrio";
            beStatusEl.classList.remove('text-emerald-600');
        } else if (daySales >= breakEvenSales) {
            beStatusEl.textContent = "¡Meta Alcanzada! (Ganancia neta)";
            beStatusEl.classList.add('text-emerald-600');
        } else {
            beStatusEl.textContent = `Faltan ${formatUSD(breakEvenSales - daySales)} para ser rentable hoy`;
            beStatusEl.classList.remove('text-emerald-600');
        }
    }
    
    const displayPercent = totalExpensesUSD === 0 ? 0 : bePercent;
    if (bePercentEl) bePercentEl.textContent = (isNaN(displayPercent) ? 0 : displayPercent).toFixed(0) + '%';
    if (beBarEl) beBarEl.style.width = (isNaN(displayPercent) ? 0 : displayPercent) + '%';

    // TRIGGER: Notificación WhatsApp Punto de Equilibrio (NUEVO)
    const alertKey = `be_alert_${new Date().toLocaleDateString()}`;
    if (totalExpensesUSD > 0 && daySales >= breakEvenSales && !localStorage.getItem(alertKey)) {
        if (typeof sendBusinessAlert === 'function') {
            sendBusinessAlert(`💰 *META ALCANZADA*: Hoy has superado el punto de equilibrio administrativo.\n*Ventas*: ${formatUSD(daySales)}\n*Status*: Operando en ganancia neta.`);
            localStorage.setItem(alertKey, 'sent');
        }
    }

    // 7. Cierre Proyectado (Mes)
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const currentDay = new Date().getDate();
    const history7 = dailyHistory.slice(-7);
    
    // Incluir las ventas de hoy en el promedio para que la proyección no sea 0 si el historial está vacío
    const totalRecentSales = history7.reduce((acc, d) => acc + (Number(d.salesUSD) || 0), 0) + daySales;
    const daysCount = history7.length + (daySales > 0 ? 1 : 0) || 1; // Evitar división por cero
    const avgDailySales = totalRecentSales / daysCount;
    
    const projectedSales = ((isNaN(avgDailySales) ? 0 : avgDailySales) * daysInMonth);
    const projEl = document.getElementById('ana-projection-value');
    if (projEl) projEl.textContent = formatUSD(projectedSales);

    // 8. Inteligencia de Negocio: Capital Muerto e Insights
    const insightsContainer = document.getElementById('ana-insights-container');
    if (insightsContainer) {
        let insightsHTML = '';
        
        // Detección de Capital Muerto (Productos con stock que no se han vendido en los últimos 7 días)
        const soldInHistoryIds = new Set();
        history7.forEach(d => {
            // Nota: dailyHistory no tiene items detallados, usaremos una lógica de 'baja rotación' basada en ventas actuales
        });
        
        // Simulación lógica de insight: Productos con stock significativo que no se han vendido hoy
        const slowMovers = products.filter(p => p.stock > 0 && !prodStats[p.id]).sort((a,b) => (b.stock * b.costPrice) - (a.stock * a.costPrice)).slice(0, 2);
        const totalDeadValue = slowMovers.reduce((acc, p) => acc + (p.stock * p.costPrice), 0);
        
        if (slowMovers.length > 0 && totalDeadValue > 0) {
            insightsHTML += `
                <div class="flex gap-4 animate-fadeIn">
                    <div class="w-10 h-10 shrink-0 bg-rose-500/20 rounded-xl flex items-center justify-center text-rose-400">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-rose-300 mb-1">Capital Muerto Detectado</p>
                        <p class="text-[10px] text-slate-400 leading-relaxed">
                            Tienes <b>${formatUSD(totalDeadValue)}</b> atrapados en stock que no se mueve hoy. 
                            Específicamente: ${slowMovers.map(p => `<b>${p.name}</b> (x${p.stock})`).join(' y ')}.
                        </p>
                    </div>
                </div>
            `;
        }

        // Rendimiento de Gastos
        if (totalExpensesUSD > 0 && currDayProfit > 0) {
            const expenseRatio = (totalExpensesUSD / currDayProfit) * 100;
            if (expenseRatio > 50) {
                insightsHTML += `
                    <div class="flex gap-4 animate-fadeIn">
                        <div class="w-10 h-10 shrink-0 bg-amber-500/20 rounded-xl flex items-center justify-center text-amber-400">
                            <i class="fas fa-wallet"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-amber-300 mb-1">Alerta de Gastos</p>
                            <p class="text-[10px] text-slate-400 leading-relaxed">
                                Los gastos de hoy (<b>${formatUSD(totalExpensesUSD)}</b>) consumen el <b>${expenseRatio.toFixed(0)}%</b> de tu utilidad. 
                                Considera optimizar costos operativos.
                            </p>
                        </div>
                    </div>
                `;
            }
        }

        // Success Insight
        if (daySales > avgDailySales * 1.05) {
            const growthDiff = daySales - avgDailySales;
            insightsHTML += `
                <div class="flex gap-4 animate-fadeIn">
                    <div class="w-10 h-10 shrink-0 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400">
                        <i class="fas fa-rocket"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-emerald-300 mb-1">Crecimiento Detectado</p>
                        <p class="text-[10px] text-slate-400 leading-relaxed">
                            ¡Gran jornada! Estás vendiendo <b>${formatUSD(growthDiff)}</b> más que tu promedio diario habitual.
                        </p>
                    </div>
                </div>
            `;
        }

        insightsContainer.innerHTML = insightsHTML || '<p class="text-xs text-slate-500 italic text-center">Analizando datos... No hay alertas críticas hoy.</p>';
    }

    // 9. Capacidad de Reposición (Sugerencia)
    const replenishEl = document.getElementById('ana-replenish-advice');
    if (replenishEl) {
        const safeReinvest = currDayProfit * 0.7; // Deja el 30% como ganancia neta segura
        replenishEl.textContent = `Puedes reinvertir hasta ${formatUSD(safeReinvest)} en mercancía manteniendo el flujo de caja estable.`;
    }

    // 10. NUEVO: Hiper-Realismo (Fase 3)
    
    // A. Días de Cobertura (Inventory Runway)
    const avgDailyItemsCost = history7.length ? history7.reduce((acc, d) => acc + (d.salesUSD - (d.profitUSD || 0)), 0) / history7.length : (daySales * 0.7);
    const runwayDays = inventoryValue / (avgDailyItemsCost || 1);
    const runwayEl = document.getElementById('ana-inventory-runway');
    if (runwayEl) {
        runwayEl.textContent = `${runwayDays.toFixed(0)} días de stock`;
        if (runwayDays < 5) {
            runwayEl.className = "px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-black rounded-lg border border-rose-100 animate-pulse";
        } else {
            runwayEl.className = "px-2 py-0.5 bg-brand-50 text-brand-700 text-[10px] font-black rounded-lg border border-brand-100";
        }
    }

    // B. Resiliencia de Tasa (Ajuste por Inflación en USD/VES)
    const lastSnapshot = dailyHistory[dailyHistory.length - 1];
    const resEl = document.getElementById('ana-rate-resilience');
    if (resEl && lastSnapshot) {
        const rateDiff = settings.exchangeRate - (lastSnapshot.exchangeRate || settings.exchangeRate);
        resEl.classList.remove('hidden');
        if (rateDiff > 0.5) { // Si la tasa subió más de 0.50 VES
            resEl.textContent = "ALERTA TASA ??";
            resEl.className = "text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md border bg-rose-500 text-white border-rose-600 animate-bounce";
            
            // Insight de ajuste
            if (insightsContainer) {
                const lossPercent = (rateDiff / settings.exchangeRate) * 100;
                insightsContainer.innerHTML += `
                    <div class="flex gap-4 animate-fadeIn">
                        <div class="w-10 h-10 shrink-0 bg-rose-500/10 rounded-xl flex items-center justify-center text-rose-500">
                            <i class="fas fa-chart-line"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-rose-300 mb-1">Riesgo de Reposición</p>
                            <p class="text-[10px] text-slate-400 leading-relaxed">La tasa subió un ${lossPercent.toFixed(1)}%. Tu utilidad real es menor a la nominal. Revisa precios de costo.</p>
                        </div>
                    </div>
                `;
            }
        } else {
            resEl.textContent = "TASA ESTABLE ??";
            resEl.className = "text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md border bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
        }
    }

    // Insight de Reabastecimiento Crítico
    if (runwayDays < 3 && insightsContainer) {
        insightsContainer.innerHTML += `
            <div class="flex gap-4 animate-fadeIn">
                <div class="w-10 h-10 shrink-0 bg-brand-500/20 rounded-xl flex items-center justify-center text-brand-400">
                    <i class="fas fa-truck-loading"></i>
                </div>
                <div>
                    <p class="text-xs font-bold text-brand-300 mb-1">Reabastecimiento Crítico</p>
                    <p class="text-[10px] text-slate-400 leading-relaxed">Tu inventario se agotará en menos de 3 días al ritmo actual de ventas.</p>
                </div>
            </div>
        `;
    }
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
            dropdown.classList.remove('hidden');
        } else {
            dropdown.classList.add('hidden');
        }
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

function addManualCargaItem() {
    if (!manualSelectedProduct) {
        alert("Por favor, busca y selecciona un producto del catálogo primero.");
        return;
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
        rawText: "[INGRESO MANUAL] " + manualSelectedProduct.name,
        cleanName: manualSelectedProduct.name + " (Manual)",
        productId: manualSelectedProduct.id,
        qtyBoxes: qty,
        unitsPerBox: 1, // Por defecto asumimos unidades sueltas en modo manual
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
        document.getElementById('ocr-dropzone').closest('.bg-white').classList.remove('hidden'); // Show container
        if (status) {
            status.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Modo Local: Activo`;
            status.className = "bg-emerald-50 text-emerald-600 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border border-emerald-100";
        }
    };

    document.getElementById('confirm-ocr-btn').onclick = () => {
        // Filtramos items que tengan un productId (existente) O un cleanName (nuevo)
        let appItems = ocrDetectedItems.filter(i => i.productId || i.cleanName);
        if (appItems.length === 0) {
            Swal.fire('Error', 'Debes asociar productos o definir nombres para los nuevos.', 'error');
            return;
        }

        let newProductsAdded = 0;
        appItems.forEach(item => {
            let p;
            
            // Si el item es marcado como nuevo o no tiene ID pero sí nombre
            if (item.productId === 'NEW_PRODUCT' || (!item.productId && item.cleanName)) {
                const newId = generateId();
                p = {
                    id: newId,
                    name: item.cleanName,
                    category: 'General',
                    priceUSD: item.newPriceVES / (parseFloat(document.getElementById('ocr-market-rate')?.value) || settings.exchangeRate),
                    priceVES: item.newPriceVES,
                    costPrice: (item.boxPriceGross * (1 - (item.discountPerc / 100)) * (1 + (item.ivaPerc / 100))) / (item.unitsPerBox || 1),
                    stock: 0, // Se inicializa en 0 y se suma abajo
                    img: ''
                };
                products.push(p);
                item.productId = newId;
                newProductsAdded++;
            } else {
                p = products.find(p => p.id === item.productId);
            }

            if (p) {
                p.stock += Math.round(item.qtyBoxes * item.unitsPerBox);
                const netBox = item.boxPriceGross * (1 - (item.discountPerc / 100)) * (1 + (item.ivaPerc / 100));
                p.costPrice = netBox / (item.unitsPerBox || 1);
                
                // Actualizar precios basados en la tasa de mercado del OCR
                const mktRate = parseFloat(document.getElementById('ocr-market-rate')?.value) || settings.exchangeRate;
                p.priceVES = item.newPriceVES;
                p.priceUSD = item.newPriceVES / mktRate;
            }
        });

        saveProducts();
        renderProducts();
        renderInventory();
        
        Swal.fire({
            title: '¡Proceso Completado!',
            text: `Se procesaron ${appItems.length} artículos. (${newProductsAdded} nuevos creados)`,
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

        // Esperar a que llegue la IP real para generar QR
        var generarQRenCanvas = function(canvasId, url, labelId) {
            var c = document.getElementById(canvasId);
            if (!c || typeof QRCode === 'undefined') return;
            try {
                QRCode.toCanvas(c, url, { margin: 2, scale: 4, width: 200, color: { dark: '#000000', light: '#ffffff' } }, function(err) {
                    if (!err) {
                        var lbl = document.getElementById(labelId);
                        if (lbl) lbl.textContent = url;
                    }
                });
            } catch(e) { console.error('[QR] Error:', e); }
        };
        window._generarQRLocal = function() {
            var u = window._provisionarLocalUrl;
            if (!u || !u.includes('http')) return;
            var b = u.replace(/\/mobile$/, '').replace(/\/$/, '');
            generarQRenCanvas('qr-mobile', b + '/mobile', 'link-mobile-display');
            generarQRenCanvas('qr-jefe', b + '/mobile', 'link-jefe-display');
            generarQRenCanvas('qr-download', b + '/download', 'link-download-display');
        };

        window.electronAPI.requestDiscoveryUpdate();

        if (window._provisionarLocalUrl) {
            var pu = window._provisionarLocalUrl;
            var pipEl = document.getElementById('server-ip-display');
            if (pipEl) pipEl.textContent = pu;
            var psqr = document.getElementById('server-qr-display');
            if (psqr && window._provisionarServerQr) psqr.src = window._provisionarServerQr;
            var pdot = document.getElementById('server-status-dot');
            if (pdot) pdot.classList.replace('bg-slate-300', 'bg-emerald-500');
            window._generarQRLocal();
        }

        // Mostrar estado "Conectando..." hasta que el túnel real se establezca.
        const remoteUrlEl = document.getElementById('remote-url-display');
        if(remoteUrlEl) {
            remoteUrlEl.innerText = "CONECTANDO TÚNEL REMOTO...";
            remoteUrlEl.href = "#";
        }

        // Temporizador de seguridad para el túnel status
        let tunnelTimeout = setTimeout(() => {
            const statusUrl = document.getElementById('remote-url-display');
            if (statusUrl && (statusUrl.innerText.includes('CONECTANDO') || statusUrl.innerText.includes('Iniciando'))) {
                statusUrl.innerText = "ERROR - TÚNEL CAÍDO (REINTENTANDO...)";
                statusUrl.classList.add('text-rose-500');
            }
        }, 30000); // 30 segundos

        // Recibir info del túnel (URL Pública para acceso remoto)
        window.electronAPI.onTunnelInfo((info) => {
            clearTimeout(tunnelTimeout);
            const remoteUrl = document.getElementById('remote-url-display');
            const passContainer = document.getElementById('tunnel-password-container');
            const passDisplay = document.getElementById('tunnel-password-display');
            const canvasMobile = document.getElementById('qr-mobile');
            const canvasJefe = document.getElementById('qr-jefe');
            const canvasDownload = document.getElementById('qr-download');

            if (remoteUrl) {
                const urlClean = info.url.replace(/\/$/, ""); 
                activeTunnelUrl = urlClean;
                window.lastRemoteUrl = urlClean; // Sincronizar con shareLink
                
                remoteUrl.innerText = urlClean.toUpperCase();
                remoteUrl.href = urlClean + "/mobile";
                remoteUrl.classList.remove('text-rose-500');

                // ACTUALIZACIÓN DE TODOS LOS QRS SMART
                if (typeof QRCode !== 'undefined') {
                    // 1. QR Definitivo (Punto Móvil / Launcher)
                    if (canvasMobile) {
                        const targetUrl = settings.launcherUrl 
                            ? (settings.launcherUrl.startsWith('http') ? settings.launcherUrl : `https://${settings.launcherUrl}`) 
                            : (urlClean + "/mobile");

                        QRCode.toCanvas(canvasMobile, targetUrl, { margin: 2, scale: 4, color: { dark: '#000000', light: '#ffffff' } }, function(err) {
                            if (err) { console.error('[QR] mobile:', err); return; }
                            var displayEl = document.getElementById('link-mobile-display');
                            if (displayEl) displayEl.textContent = settings.launcherUrl ? "LANZADOR PERMANENTE: " + targetUrl : urlClean + "/mobile";
                        });
                    }
                    // 2. QR Remoto (Panel del Jefe)
                    if (canvasJefe) {
                        var jefeUrl = urlClean + "/mobile";
                        QRCode.toCanvas(canvasJefe, jefeUrl, { margin: 2, scale: 4, color: { dark: '#4f46e5', light: '#ffffff' } }, function(err) {
                            if (err) { console.error('[QR] jefe:', err); return; }
                            var displayEl = document.getElementById('link-jefe-display');
                            if (displayEl) displayEl.textContent = jefeUrl;
                        });
                    }
                    // 3. QR de Descarga
                    if (canvasDownload) {
                        var downloadUrl = urlClean + '/download';
                        QRCode.toCanvas(canvasDownload, downloadUrl, { margin: 2, scale: 4, color: { dark: '#4f46e5', light: '#ffffff' } }, function(err) {
                            if (err) { console.error('[QR] download:', err); return; }
                            var displayEl = document.getElementById('link-download-display');
                            if (displayEl) displayEl.textContent = downloadUrl;
                        });
                    }
                }

                // Notificar a electron para backups (opcional)
                window.electronAPI.generateQR(urlClean + '/mobile');
                window.electronAPI.generateDownloadQR(urlClean + '/download');
            }

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
                
                // Forzar refresco de precios en el carrito y lista
                if (typeof renderProducts === 'function') renderProducts();
                if (typeof updateCartTotals === 'function') updateCartTotals();
            }
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
        'card-ves': 'pago_movil'
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
    let msg = "¡Hola! 🥤 Entra al Punto de Venta de Punto Pila desde aquí: \n\n";

    // Detectar si tenemos un túnel activo para priorizar links directos
    const remoteUrlDisplay = document.getElementById('remote-url-display');
    const currentRemoteUrl = (remoteUrlDisplay && remoteUrlDisplay.href && !remoteUrlDisplay.href.includes('#')) ? remoteUrlDisplay.href : "";

    if (type === 'local') {
        url = document.getElementById('server-ip-display').textContent;
        msg = "¡Hola! 🥤 Entra al Punto de Venta de Punto Pila (WiFi Local) desde aquí: \n\n";
    } else if (type === 'download') {
        // Priorizar link directo si el túnel está activo
        const base = currentRemoteUrl ? currentRemoteUrl.replace(/\/$/, '') : "https://ntfy.sh/puntopila_caja_pos_tunnel_url_secret_eb6044";
        url = currentRemoteUrl ? `${base}/download` : base;
        msg = "¡Instala la App de Punto Pila! 📱📥\nEntra aquí para descargar e instalar en tu celular: \n\n";
    } else if (type === 'permanent') {
        // SMART LINK: Si el túnel está activo, usarlo directamente. 
        // Solo usar ntfy.sh como backup si no hay túnel detectado.
        if (currentRemoteUrl) {
            url = `${currentRemoteUrl.replace(/\/$/, '')}/mobile`;
        } else {
            const TOPIC = 'puntopila_caja_pos_tunnel_url_secret_eb6044';
            url = `https://ntfy.sh/${TOPIC}`;
        }
        msg = "⭐ *ACCESO PUNTO DE VENTA* ⭐\nEntra aquí para gestionar pedidos desde tu móvil:\n\n";
    } else {
        url = currentRemoteUrl || "Túnel aún no iniciado...";
        msg = "¡Hola! 🥤 Entra al Punto de Venta de Punto Pila (Remoto) desde aquí: \n\n";

        const passContainer = document.getElementById('tunnel-password-container');
        const pass = document.getElementById('tunnel-password-display').innerText;

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


window.rejectOrder = (index) => {
    incomingOrders.splice(index, 1);
    renderIncomingOrders();
};

let _syncMobileTimer = null;
function syncProductsToMobile() {
    if (_syncMobileTimer) return;
    _syncMobileTimer = setTimeout(() => { _syncMobileTimer = null; }, 3000);
    console.log("Iniciando syncProductsToMobile...");
    if (!products || products.length === 0) {
        console.warn("Intento de sincronización con lista de productos vacía. Abortando.");
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
                mobileBgBlur: settings.mobileBgBlur
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
                document.getElementById('business-name-input').value = localStorage.getItem('business_name') || 'Punto Pila';
                document.getElementById('business-phone-footer-input').value = localStorage.getItem('business_phone_footer') || '0414-1006858';
                document.getElementById('admin-pin-config').value = settings.adminPin || '3244';
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
    const bossPhone = normalizeVEPhone(document.getElementById('boss-phone-input').value.trim());
    const bizName = document.getElementById('business-name-input').value.trim() || 'Punto Pila';
    const bizPhone = document.getElementById('business-phone-footer-input').value.trim() || '0414-1006858';
    
    const adminPinEl = document.getElementById('admin-pin-config');
    const adminPin = adminPinEl && adminPinEl.value.trim() ? adminPinEl.value.trim() : '3244';

    const launcherUrlEl = document.getElementById('settings-launcher-url');
    const launcherUrl = launcherUrlEl ? launcherUrlEl.value.trim() : '';

    localStorage.setItem('feat_scanner', scanner);
    localStorage.setItem('feat_mobile', mobile);
    localStorage.setItem('feat_ai', ai);
    localStorage.setItem('boss_phone', bossPhone);
    localStorage.setItem('business_name', bizName);
    localStorage.setItem('business_phone_footer', bizPhone);
    localStorage.setItem('launcher_url', launcherUrl);
    localStorage.removeItem('callmebot_key');

    // Sincronizar con Ajustes estándar
    settings.bossPhone = bossPhone;
    settings.adminPin = adminPin;
    settings.launcherUrl = launcherUrl;
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

    window.electronAPI.onRequestSync(() => {
        console.log('🔄 Mobile requested sync, sending products...');
        if (window.electronAPI && window.electronAPI.syncProducts) {
            window.electronAPI.syncProducts(products);
        }
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
    if (window.POSExtensions && POSExtensions.renderExpensesAdvanced) {
        POSExtensions.renderExpensesAdvanced(window.expenses, 'expenses-table-body');
    } else {
        var tableBody = document.getElementById('expenses-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        (window.expenses || []).forEach(function(exp) {
            var row = document.createElement('tr');
            row.innerHTML = [
                '<td class="px-6 py-4 text-sm font-medium text-slate-500">', new Date(exp.date).toLocaleDateString(), '</td>',
                '<td class="px-6 py-4 font-bold text-slate-700">', exp.description, '</td>',
                '<td class="px-6 py-4 text-right font-black text-rose-500">', formatUSD(exp.amountUSD), '</td>',
                '<td class="px-6 py-4 text-center">',
                    '<button onclick="deleteExpense(\'', exp.id, '\')" class="text-rose-400 hover:text-rose-600 transition-colors">',
                        '<i class="fas fa-trash-alt"></i>',
                    '</button>',
                '</td>'
            ].join('');
            tableBody.appendChild(row);
        });
    }
}

function openExpenseModal() {
    if (window.POSExtensions && POSExtensions.openExpenseModalAdvanced) {
        POSExtensions.openExpenseModalAdvanced();
    } else {
        Swal.fire({
            title: 'Registrar Gasto',
            html: [
                '<input id="exp-desc" class="swal2-input" placeholder="Descripción del gasto">',
                '<input id="exp-amount" type="number" step="0.01" class="swal2-input" placeholder="Monto en USD">'
            ].join(''),
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Guardar Gasto',
            preConfirm: function() {
                return {
                    description: document.getElementById('exp-desc').value,
                    amountUSD: parseFloat(document.getElementById('exp-amount').value)
                };
            }
        }).then(function(result) {
            if (result.isConfirmed) {
                var data = result.value;
                if (!data.description || isNaN(data.amountUSD)) return Swal.fire('Error', 'Ingresa datos válidos', 'error');
                expenses.push({ id: 'exp_' + Date.now(), date: new Date().toISOString(), description: data.description, amountUSD: data.amountUSD });
                saveExpenses();
                renderExpenses();
                Swal.fire('¡Guardado!', '', 'success');
            }
        });
    }
}

function deleteExpense(id) {
    expenses = expenses.filter(function(e) { return e.id !== id; });
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

    // 1. Intentar usar el Motor Interno (WhatsApp-Web.js) si está disponible
    if (window.isWhatsappAutomatedReady && window.electronAPI && window.electronAPI.sendWhatsAppBackground) {
        Swal.fire({ title: 'Enviando Reporte...', text: 'Usando motor interno de WhatsApp...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        window.electronAPI.sendWhatsAppBackground(bossPhone, rawMsg)
            .then(res => {
                if (res && res.success) {
                    finalizeAndClear();
                } else {
                    // Mostrar error explícito
                    console.error('[CIERRE-Z] Fallo de motor interno:', res?.error);
                    Swal.fire({
                        title: 'Error de Conexión',
                        text: `El motor de WhatsApp falló: ${res?.error || 'Desconocido'}. ¿Deseas abrir WhatsApp manualmente?`,
                        icon: 'error',
                        showCancelButton: true,
                        confirmButtonText: 'Abrir WhatsApp'
                    }).then((r) => {
                        if (r.isConfirmed) {
                            const fbMsg = rawMsg.replace(/\n/g, '%0A');
                            window.open(`https://wa.me/${bossPhone}?text=${fbMsg}`, '_blank');
                        }
                        finalizeAndClear(); // Limpiamos la caja de todas formas si ya hicieron cierre
                    });
                }
            })
            .catch((err) => {
                console.error('[CIERRE-Z] Excepción del motor:', err);
                Swal.fire({
                    title: 'Error Crítico',
                    text: `Error de comunicación con el motor: ${err.message}. ¿Abrir manual?`,
                    icon: 'error',
                    showCancelButton: true,
                    confirmButtonText: 'Abrir WhatsApp'
                }).then((r) => {
                    if (r.isConfirmed) {
                        const fbMsg = rawMsg.replace(/\n/g, '%0A');
                        window.open(`https://wa.me/${bossPhone}?text=${fbMsg}`, '_blank');
                    }
                    finalizeAndClear();
                });
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
    // NUEVO: Guardar Snapshot antes de borrar
    const today = new Date().toISOString();
    const daySalesUSD = sales.reduce((acc, s) => acc + (Number(s.totalUSD) || 0), 0);
    const dayProfitUSD = sales.reduce((acc, s) => acc + ((Number(s.totalUSD) || 0) - (Number(s.totalCostUSD) || 0)), 0);
    const dayExpensesUSD = typeof expenses !== 'undefined' && Array.isArray(expenses) ? expenses.reduce((acc, e) => acc + (Number(e.amountUSD) || 0), 0) : 0;

    dailyHistory.push({
        date: today,
        salesUSD: daySalesUSD,
        profitUSD: dayProfitUSD,
        expensesUSD: dayExpensesUSD
    });
    
    // Mantener 90 días de historia
    if (dailyHistory.length > 90) dailyHistory.shift();

    saveHistory();

    sales = [];
    saveSales();
    renderReports();
    document.getElementById('cierre-modal').classList.add('hidden');
    Swal.fire('¡Cierre Exitoso!', 'El reporte ha sido enviado y la caja está limpia.', 'success');
}

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
        window.cloudSync.pushSale(saleRecord).catch(e => console.error('[CloudSync] Sale push error:', e));
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
                indicator.innerHTML = '<i class="fas fa-cloud text-emerald-500"></i>';
                indicator.title = `Sincronizado: ${status.storeName || 'Cloud'}`;
            } else if (status.enabled) {
                indicator.innerHTML = '<i class="fas fa-cloud text-amber-500 animate-pulse"></i>';
                indicator.title = 'Sincronizando...';
            }
        }
    });
    
    // Initial status check
    window.cloudSync.getStatus().then(status => {
        if (status.enabled) {
            console.log('[CloudSync] Conectado como:', status.storeName);
        }
    });
}


// UI Helper Functions (Restored)
window.switchAnalyticsTab = function(tabName) {
    const tabs = ['resumen', 'graficos', 'productos', 'empleados'];
    tabs.forEach(t => {
        const btn = document.getElementById('tab-btn-' + t);
        const content = document.getElementById('tab-content-' + t);
        if(btn) { btn.classList.remove('border-brand-600', 'text-brand-600'); btn.classList.add('border-transparent', 'text-slate-400'); }
        if(content) { content.classList.add('hidden'); }
    });
    const selectedBtn = document.getElementById('tab-btn-' + tabName);
    const selectedContent = document.getElementById('tab-content-' + tabName);
    if(selectedBtn) { selectedBtn.classList.add('border-brand-600', 'text-brand-600'); selectedBtn.classList.remove('border-transparent', 'text-slate-400'); }
    if(selectedContent) { selectedContent.classList.remove('hidden'); }
};

window.toggleProductType = function(type) {
    const types = ['simple', 'complex', 'recipe'];
    types.forEach(t => {
        const btn = document.getElementById('btn-prod-' + t);
        if(btn) {
            if(t === type) { btn.classList.add('bg-white', 'shadow-sm', 'text-brand-600'); btn.classList.remove('text-slate-500'); }
            else { btn.classList.remove('bg-white', 'shadow-sm', 'text-brand-600'); btn.classList.add('text-slate-500'); }
        }
    });
    const valInput = document.getElementById('product-type-value');
    if(valInput) valInput.value = type;
    
    const advancedFields = document.querySelectorAll('.advanced-field');
    const recipeFields = document.querySelectorAll('.recipe-field');
    
    if (type === 'simple') {
        advancedFields.forEach(el => el.style.display = 'none');
        recipeFields.forEach(el => el.style.display = 'none');
    } else if (type === 'complex') {
        advancedFields.forEach(el => el.style.display = 'block');
        recipeFields.forEach(el => el.style.display = 'none');
    } else if (type === 'recipe') {
        advancedFields.forEach(el => el.style.display = 'block');
        recipeFields.forEach(el => el.style.display = 'block');
    }
};

window.openIngredientsModal = function() {
    const modal = document.getElementById('ingredients-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (typeof renderIngredients === 'function') renderIngredients();
    }
};

