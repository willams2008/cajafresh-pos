// ==========================================
// CLOUD SYNC — Sincronización Multi-Sucursal
// ==========================================
// Envía snapshots periódicos del POS local a Supabase
// para que el dueño pueda supervisar todas sus tiendas.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Lazy accessor — database may not be open at module load time
function getDbApi() {
    return require('./database').api;
}

class CloudSync {
    constructor(options = {}) {
        this.supabaseUrl = options.supabaseUrl || '';
        this.supabaseKey = options.supabaseKey || '';
        this.storeId = options.storeId || '';
        this.tenantId = options.tenantId || 'tenant_default';
        this.storeName = options.storeName || 'Mi Tienda';
        this.brandName = options.brandName || 'Caja Fresh';
        this.licenseExpiry = options.licenseExpiry || null;
        this.storeType = options.storeType || 'kiosko'; // 'kiosko' | 'warehouse'
        this.enabled = false;
        this.lastSyncTime = 0;
        this.syncInterval = null;
        this.pendingQueue = []; // Cola de datos pendientes si hay fallo de red
        this.queuePath = options.queuePath || '';
        this.deletedProductIds = new Set();
        this._loadDeletedIds();
        this.onStatusChange = options.onStatusChange || (() => {});
        this.lastStatus = { synced: false, lastSync: null, error: null };

        console.log(`[CLOUD-SYNC] 🏗️ Constructor invocado. URL: ${this.supabaseUrl ? 'OK' : 'Falta'}, ID: ${this.storeId || 'Falta'}, Tenant: ${this.tenantId}, Tipo: ${this.storeType}`);

        // Auto-inicializar si ya vienen datos
        if (this.supabaseUrl && this.supabaseKey && this.storeId) {
            this.configure(options);
        }
    }

    configure(config) {
        if (config.supabaseUrl) this.supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
        if (config.supabaseKey) this.supabaseKey = config.supabaseKey;
        if (config.storeId) this.storeId = config.storeId;
        if (config.tenantId) this.tenantId = config.tenantId;
        if (config.storeName) this.storeName = config.storeName;
        if (config.brandName) this.brandName = config.brandName;
        if (config.licenseExpiry !== undefined) this.licenseExpiry = config.licenseExpiry;
        if (config.queuePath) this.queuePath = config.queuePath;
        if (config.storeType) this.storeType = config.storeType;

        this.enabled = !!(this.supabaseUrl && this.supabaseKey && this.storeId);

        if (this.enabled) {
            this._loadPendingQueue();
            this._startPeriodicSync();
            console.log(`[CLOUD-SYNC] ✅ Configurado para: ${this.storeName} (${this.storeId})`);
        } else {
            console.log('[CLOUD-SYNC] ⚠️ No configurado — faltan credenciales de Supabase.');
        }
    }

    _startPeriodicSync() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        
        // Backoff exponencial: cuando hay errores de red, aumentar el intervalo
        // Base: 10s, Máximo: 5 minutos. Se resetea cuando la conexión vuelve.
        this._syncFailCount = this._syncFailCount || 0;
        
        const scheduleNext = () => {
            if (this.syncInterval) clearTimeout(this.syncInterval);
            
            // Calcular delay con backoff: 10s, 20s, 40s, 80s, ..., hasta 300s
            const baseDelay = 10000;
            const maxDelay = 300000; // 5 minutos
            const delay = Math.min(baseDelay * Math.pow(2, this._syncFailCount), maxDelay);
            
            this.syncInterval = setTimeout(async () => {
                try {
                    await this._flushQueue();
                    await this._fetchRemotePOs(getDbApi());
                    await this._fetchCommands();
                    
                    // Si llegó aquí sin error, resetear el contador
                    if (this._syncFailCount > 0) {
                        console.log('[CLOUD-SYNC] ✅ Conexión restablecida, volviendo a sync rápido.');
                        this._syncFailCount = 0;
                    }
                } catch(e) {
                    // Solo loguear el primer error y cada vez que escale
                    if (this._syncFailCount === 0 || this._syncFailCount % 3 === 0) {
                        console.log(`[CLOUD-SYNC] ⏸️ Sin conexión (intento ${this._syncFailCount + 1}), próximo intento en ${Math.round(Math.min(baseDelay * Math.pow(2, this._syncFailCount + 1), maxDelay) / 1000)}s`);
                    }
                    this._syncFailCount = Math.min(this._syncFailCount + 1, 5);
                }
                scheduleNext();
            }, delay);
        };
        
        scheduleNext();
    }

    // ==========================================
    // SUPABASE REST API (sin dependencias)
    // ==========================================
    async _supabaseRequest(table, method, data, queryParams = '') {
        if (!this.enabled) return null;

        const url = new URL(`${this.supabaseUrl}/rest/v1/${table}${queryParams}`);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`,
                    'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(body ? JSON.parse(body) : { success: true });
                        } catch (e) {
                            resolve({ success: true });
                        }
                    } else {
                        const errMsg = `[CLOUD-SYNC] ❌ ${method} ${table} → HTTP ${res.statusCode}: ${body.substring(0, 300)}`;
                        console.error(errMsg);
                        try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] ${errMsg}\n`); } catch(_){}
                        reject(new Error(`Supabase ${res.statusCode}: ${body}`));
                    }
                });
            });

            req.on('error', (e) => {
                const errMsg = `[CLOUD-SYNC] ERROR FETCH: ${e.message}`;
                console.error(errMsg);
                try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] ${errMsg}\n`); } catch(_){}
                reject(e);
            });

            req.setTimeout(15000, () => {
                req.destroy();
                try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] ERROR FETCH: Timeout (${method} ${table})\n`); } catch(_){}
                reject(new Error('Timeout'));
            });

            if (data && (method === 'POST' || method === 'PATCH')) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    async _supabaseGet(table, queryParams = '') {
        if (!this.enabled) return [];

        const url = new URL(`${this.supabaseUrl}/rest/v1/${table}${queryParams}`);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`,
                    'Accept': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(body));
                        } catch (e) {
                            resolve([]);
                        }
                    } else {
                        reject(new Error(`Supabase GET ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    // ==========================================
    // REGISTRO / HEARTBEAT DE TIENDA
    // ==========================================
    async registerStore() {
        if (!this.enabled) return;
        try {
            const payload = {
                id: this.storeId,
                tenant_id: this.tenantId,
                name: this.storeName,
                brand_name: this.brandName,
                store_type: this.storeType,
                last_seen: new Date().toISOString(),
                status: 'online'
            };
            if (this.licenseExpiry) {
                payload.license_expiry = this.licenseExpiry;
            }

            await this._supabaseRequest('stores', 'POST', payload);
            console.log(`[CLOUD-SYNC] 🏪 Tienda registrada: ${this.storeName}`);
            this._updateStatus(true);
        } catch (e) {
            console.error('[CLOUD-SYNC] Error registrando tienda:', e.message);
            this._updateStatus(false, e.message);
        }
    }

    async heartbeat() {
        if (!this.enabled) return;
        try {
            await this._supabaseRequest('stores', 'PATCH', {
                last_seen: new Date().toISOString(),
                status: 'online'
            }, `?id=eq.${this.storeId}`);
        } catch (e) {
            // Silenciar errores de heartbeat
        }
    }

    // ==========================================
    // IMPORTAR CATÁLOGO DESDE SUPABASE → SQLite
    // ==========================================
    async pullCatalogFromCloud() {
        if (!this.enabled) return;
        try {
            console.log('[CLOUD-SYNC] ⬇️ Importando catálogo desde Supabase...');
            let remoteProducts = await this._supabaseGet('store_products', `?store_id=eq.${this.storeId}&tenant_id=eq.${this.tenantId}`);
            // Si es kiosko y no tiene productos propios, intentar traer de almacenes del mismo tenant
            if ((!remoteProducts || remoteProducts.length === 0) && this.storeType === 'kiosko') {
                console.log('[CLOUD-SYNC] 🔄 Kiosko sin productos propios — buscando de almacenes...');
                const stores = await this._supabaseGet('stores', `?store_type=eq.warehouse&tenant_id=eq.${this.tenantId}&select=id`);
                if (stores && stores.length > 0) {
                    for (const s of stores) {
                        const whProducts = await this._supabaseGet('store_products', `?store_id=eq.${s.id}&tenant_id=eq.${this.tenantId}`);
                        if (whProducts && whProducts.length > 0) {
                            remoteProducts = whProducts;
                            console.log(`[CLOUD-SYNC] ✅ ${whProducts.length} productos del almacén ${s.id}`);
                            break;
                        }
                    }
                }
            }
            if (!remoteProducts || remoteProducts.length === 0) {
                console.log('[CLOUD-SYNC] ⚠️ No hay productos disponibles en la nube.');
                return;
            }

            const localDbApi = getDbApi();
            const currentLocalProducts = await localDbApi.getProducts(this.storeId);
            const localMap = new Map((currentLocalProducts || []).map(p => [String(p.id), p]));

            let imported = 0;
            let skipped = 0;
            for (const rp of remoteProducts) {
                const pid = String(rp.product_id);
                if (this.deletedProductIds.has(pid)) {
                    skipped++;
                    continue;
                }
                const existing = localMap.get(pid);
                
                const localProduct = existing ? { ...existing } : {
                    id: rp.product_id,
                    name: rp.name || 'Sin nombre',
                    category: rp.category || 'Otros',
                    priceUSD: parseFloat(rp.price) || 0,
                    priceVES: parseFloat(rp.price_ves) || 0,
                    priceEUR: parseFloat(rp.price_eur) || 0,
                    promoPrice: parseFloat(rp.promo_price) || 0,
                    costPrice: parseFloat(rp.cost) || 0,
                    stock: parseInt(rp.stock) || 0,
                    minStock: parseInt(rp.min_stock) || 5,
                    img: rp.img_url || '',
                    flavors: [],
                    expiryDate: rp.expiry_date || '',
                    description: ''
                };
                // Actualizar campos de la nube - solo si el producto es NUEVO (no existía local)
                if (!existing) {
                    if (rp.name) localProduct.name = rp.name;
                    if (rp.category) localProduct.category = rp.category;
                } else {
                    // Si el producto ya existe, solo actualizar nombre si la nube tiene un nombre válido
                    if (rp.name && rp.name !== 'Sin nombre') localProduct.name = rp.name;
                }
                if (rp.img_url) localProduct.img = rp.img_url;
                if (rp.expiry_date) localProduct.expiryDate = rp.expiry_date;
                await localDbApi.saveProduct(this.storeId, localProduct);
                imported++;
            }

            console.log(`[CLOUD-SYNC] ✅ ${imported} productos importados a la BD local.`);

            // Limpiar productos previamente eliminados que la nube re-importó
            if (this.deletedProductIds.size > 0) {
                let cleaned = 0;
                for (const pid of this.deletedProductIds) {
                    try {
                        await localDbApi.deleteProductPermanent(this.storeId, pid);
                        cleaned++;
                    } catch(e) {}
                }
                if (cleaned > 0) console.log(`[CLOUD-SYNC] 🗑️ ${cleaned} productos eliminados permanentemente (deletedProductIds).`);
            }

            // Notificar al renderer para que recargue la lista
            try {
                const { BrowserWindow } = require('electron');
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send('catalog-pulled-from-cloud', { count: imported });
                });
            } catch(e) {}

        } catch (e) {
            console.error('[CLOUD-SYNC] Error importando catálogo:', e.message);
        }
    }

    // ==========================================
    // ENVÍO DE SNAPSHOT (Resumen del día)
    // ==========================================
    async pushSnapshot(snapshotData) {
        if (!this.enabled) return;

        const snapshot = {
            store_id: this.storeId,
            tenant_id: this.tenantId,
            date: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString(),
            total_ves: snapshotData.totalVES || 0,
            total_usd: snapshotData.totalUSD || 0,
            tickets: snapshotData.tickets || 0,
            items_sold: snapshotData.itemsSold || 0,
            total_cost_usd: snapshotData.totalCostUSD || 0,
            profit_usd: (snapshotData.totalUSD || 0) - (snapshotData.totalCostUSD || 0),
            exchange_rate: snapshotData.exchangeRate || 0,
            products_count: snapshotData.productsCount || 0,
            low_stock_count: snapshotData.lowStockCount || 0,
            out_of_stock_count: snapshotData.outOfStockCount || 0,
            pending_credits: snapshotData.pendingCredits || 0,
            methods: {
                ...(snapshotData.methods || {}),
                recent_sales: snapshotData.recentSales || []
            }
        };

        try {
            await this._supabaseRequest('store_snapshots', 'POST', snapshot);
            this.lastSyncTime = Date.now();
            this._updateStatus(true);
            console.log(`[CLOUD-SYNC] 📊 Snapshot enviado: ${this.storeName} — $${snapshot.total_usd.toFixed(2)}`);

            // También actualizar heartbeat
            await this.heartbeat();
        } catch (e) {
            console.error('[CLOUD-SYNC] Error enviando snapshot:', e.message);
            this.pendingQueue.push({ type: 'snapshot', data: snapshot, timestamp: Date.now() });
            this._savePendingQueue();
            this._updateStatus(false, e.message);
        }
    }

    // ==========================================
    // ENVÍO DE VENTA INDIVIDUAL
    // ==========================================
    async pushSale(saleData) {
        if (!this.enabled) {
            console.warn('[CLOUD-SYNC] ⚠️ pushSale llamado pero sync NO está habilitado.');
            try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] pushSale IGNORADO: sync deshabilitado. enabled=${this.enabled} url=${!!this.supabaseUrl} key=${!!this.supabaseKey} storeId=${this.storeId}\n`); } catch(_){}
            return;
        }

        const saleDate = saleData.date || new Date().toISOString();
        const datePart = saleDate.split('T')[0].replace(/-/g, '');
        const sale = {
            id: `${this.storeId}_S${datePart}_${Date.now()}_${saleData.ticket || '0'}`,
            store_id: this.storeId,
            tenant_id: this.tenantId,
            ticket: saleData.ticket || saleData.id || '---',
            date: saleDate,
            timestamp: saleData.timestamp || Date.now(),
            total_usd: saleData.totalUSD || saleData.total_usd || saleData.total || 0,
            total_ves: saleData.totalVES || 0,
            total_cost_usd: saleData.totalCostUSD || 0,
            method: saleData.method || 'cash-usd',
            items_count: (saleData.items || []).reduce((a, i) => a + (i.qty || 1), 0),
            items_json: JSON.stringify(saleData.items || []),
            exchange_rate: saleData.exchangeRate || 0,
            client_name: saleData.client?.name || 'Venta Local',
            status: saleData.status || 'paid',
            cashier_name: saleData.cashier_name || saleData.cashier || (window.currentUser ? (window.currentUser.name || window.currentUser.username) : 'Cajero Principal'),
            cashier_id: saleData.cashier_id || saleData.cashierId || (window.currentUser ? window.currentUser.id : null)
        };

        console.log(`[CLOUD-SYNC] 🛒 Enviando venta ${sale.id} ($${sale.total_usd}) a Supabase...`);
        try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] PUSH_SALE: ${sale.id} total=$${sale.total_usd} method=${sale.method} date=${sale.date}\n`); } catch(_){}

        try {
            await this._supabaseRequest('store_sales', 'POST', sale);
            console.log(`[CLOUD-SYNC] ✅ Venta ${sale.id} enviada con éxito.`);
            try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] ✅ PUSH_SALE OK: ${sale.id}\n`); } catch(_){}
        } catch (e) {
            console.error('[CLOUD-SYNC] ❌ Error enviando venta:', e.message);
            try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] ❌ PUSH_SALE FAIL: ${sale.id} → ${e.message}\n`); } catch(_){}
            this.pendingQueue.push({ type: 'sale', data: sale, timestamp: Date.now() });
            this._savePendingQueue();
        }
    }

    // ==========================================
    // ENVÍO DE GASTO INDIVIDUAL
    // ==========================================
    async pushExpense(expenseData) {
        if (!this.enabled) return;

        const expense = {
            id: `${this.storeId}_${expenseData.id || Date.now()}`,
            store_id: this.storeId,
            tenant_id: this.tenantId,
            date: (expenseData.date || new Date().toISOString()).split('T')[0],
            description: expenseData.description || 'Gasto General',
            amount_usd: expenseData.amountUSD || 0,
            payment_method: expenseData.paymentMethod || 'efectivo',
            reference_number: expenseData.referenceNumber || '',
            responsible_name: expenseData.responsibleName || ''
        };

        try {
            await this._supabaseRequest('store_expenses', 'POST', expense);
            console.log(`[CLOUD-SYNC] 💸 Gasto sincronizado: ${expense.description} ($${expense.amount_usd})`);
        } catch (e) {
            console.error('[CLOUD-SYNC] Error enviando gasto:', e.message);
            this.pendingQueue.push({ type: 'expense', data: expense, timestamp: Date.now() });
            this._savePendingQueue();
        }
    }

    // ==========================================
    // ENVÍO DE ALERTAS DE STOCK
    // ==========================================
    async pushAlerts(products) {
        if (!this.enabled) return;

        const alerts = [];

        products.forEach(p => {
            if (p.stock <= 0) {
                alerts.push({
                    id: `${this.storeId}_${p.id}_out`,
                    store_id: this.storeId,
                    product_id: p.id,
                    product_name: p.name,
                    alert_type: 'out_of_stock',
                    stock: 0,
                    timestamp: new Date().toISOString()
                });
            } else if (p.stock <= (p.minStock || 5)) {
                alerts.push({
                    id: `${this.storeId}_${p.id}_low`,
                    store_id: this.storeId,
                    product_id: p.id,
                    product_name: p.name,
                    alert_type: 'low_stock',
                    stock: p.stock,
                    timestamp: new Date().toISOString()
                });
            }
        });

        if (alerts.length > 0) {
            try {
                // Limpiar alertas previas de esta tienda y reenviar
                await this._supabaseRequest('store_alerts', 'DELETE', null, `?store_id=eq.${this.storeId}`);
                // Enviar nuevas alertas una por una para evitar errores de bulk
                for (const alert of alerts) {
                    await this._supabaseRequest('store_alerts', 'POST', alert);
                }
            } catch (e) {
                console.error('[CLOUD-SYNC] Error enviando alertas:', e.message);
            }
        }
    }

    // ==========================================
    // ENVÍO DE CATÁLOGO (Inventario Completo)
    // ==========================================
    async pushCatalog(products) {
        if (!this.enabled || !products || products.length === 0) return;
        
        try {
            console.log(`[CLOUD-SYNC] 📦 Sincronizando catálogo (${products.length} productos)...`);
            
            // Usamos UPSERT en lugar de DELETE+INSERT para no dejar la tabla vacía si falla
            const chunkSize = 20;
            for (let i = 0; i < products.length; i += chunkSize) {
                const chunk = products.slice(i, i + chunkSize);
                const supabaseProducts = chunk.map(p => {
                    const item = {
                        id: `${this.storeId}_${p.id}`,
                        store_id: this.storeId,
                        tenant_id: this.tenantId,
                        product_id: p.id,
                        name: p.name,
                        price: p.priceUSD || p.price || 0,
                        price_ves: p.priceVES || 0,
                        cost: p.costPrice || p.cost || 0,
                        stock: p.stock || 0,
                        category: p.category || 'General',
                        updated_at: new Date().toISOString(),
                        img_url: p.img || ''
                    };
                    return item;
                });
                
                // UPSERT: si el id ya existe lo actualiza, si no lo crea
                const res = await fetch(`${this.supabaseUrl}/rest/v1/store_products`, {
                    method: 'POST',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${this.supabaseKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    signal: AbortSignal.timeout(15000),
                    body: JSON.stringify(supabaseProducts)
                });
                
                if (!res.ok) {
                    const errText = await res.text();
                    console.error(`[CLOUD-SYNC] ❌ Error UPSERT catálogo (chunk ${i}):`, errText);
                    // Si falla por columnas faltantes, intentar sin price_ves e img_url
                    if (errText.includes('price_ves') || errText.includes('img_url')) {
                        console.warn('[CLOUD-SYNC] ⚠️ Columnas price_ves/img_url no existen en Supabase. Ejecuta el SQL de migración.');
                        const reduced = supabaseProducts.map(p => {
                            const { price_ves, img_url, ...rest } = p;
                            return rest;
                        });
                        await fetch(`${this.supabaseUrl}/rest/v1/store_products`, {
                            method: 'POST',
                            headers: {
                                'apikey': this.supabaseKey,
                                'Authorization': `Bearer ${this.supabaseKey}`,
                                'Content-Type': 'application/json',
                                'Prefer': 'resolution=merge-duplicates'
                            },
                            body: JSON.stringify(reduced)
                        });
                    }
                }
            }
            console.log('[CLOUD-SYNC] ✅ Catálogo sincronizado correctamente');
        } catch (e) {
            console.error('[CLOUD-SYNC] Error enviando catálogo:', e.message);
        }
    }

    // --- VISTA EN VIVO (Live View) ---
    async pushLiveState(cart, totals, currentView = 'POS') {
        if (!this.enabled) return;
        
        const state = {
            store_id: this.storeId,
            tenant_id: this.tenantId,
            cart_data: cart.map(item => ({
                id: item.id,
                name: item.name,
                qty: item.qty,
                price_usd: item.priceUSD || item.price || 0,
                price_ves: item.priceVES || 0,
                img: item.img || ''
            })),
            total_usd: totals.usd || 0,
            total_ves: totals.ves || 0,
            active_items: cart.length,
            current_view: currentView,
            cashier_name: (window.currentUser ? (window.currentUser.name || window.currentUser.username) : 'Cajero Activo'),
            last_activity: new Date().toISOString()
        };

        try {
            // Usamos post para UPSERT (resolution=merge-duplicates)
            const url = new URL(`${this.supabaseUrl}/rest/v1/store_live_state`);
            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`,
                    'Prefer': 'resolution=merge-duplicates'
                }
            };

            const req = https.request(options, (res) => {
                res.on('data', () => {});
                res.on('end', () => { });
            });

            req.on('error', () => {});
            req.write(JSON.stringify(state));
            req.end();
        } catch (e) {
            // Silencioso
        }
    }

    async pushTransfer(transferData) {
        if (!this.enabled) return;
        const transfer = {
            id: transferData.id,
            store_id: this.storeId,
            from_store: transferData.from_store,
            to_store: transferData.to_store,
            product_id: transferData.product_id,
            product_name: transferData.product_name,
            quantity: transferData.quantity || 0,
            status: transferData.status || 'PENDING',
            date: transferData.date || new Date().toISOString(),
            timestamp: transferData.timestamp || Date.now(),
            cashier_name: transferData.cashier_name || '',
            notes: transferData.notes || ''
        };
        try {
            await this._supabaseRequest('store_transfers', 'POST', transfer);
        } catch (e) {
            this.pendingQueue.push({ type: 'transfer', data: transfer, timestamp: Date.now() });
            this._savePendingQueue();
        }
    }

    async getWarehouseStoreId() {
        if (!this.enabled) return null;
        try {
            const stores = await this._supabaseGet('stores', `?store_type=eq.warehouse&tenant_id=eq.${this.tenantId}&select=id&limit=1`);
            if (stores && stores.length > 0) return stores[0].id;
        } catch (e) {}
        return null;
    }

    async pushPurchaseOrder(poData) {
        if (!this.enabled) return;
        const po = {
            id: poData.id,
            store_id: this.storeId,
            tenant_id: this.tenantId,
            from_store: poData.from_store || this.storeId,
            to_store: poData.to_store || '',
            status: poData.status || 'PENDING',
            items_json: JSON.stringify(poData.items || []),
            total_cost: poData.total_cost || 0,
            notes: poData.notes || '',
            date: poData.date || new Date().toISOString(),
            timestamp: poData.timestamp || Date.now(),
            created_by: poData.created_by || ''
        };
        try {
            await this._supabaseRequest('store_purchase_orders', 'POST', po);
        } catch (e) {
            this.pendingQueue.push({ type: 'purchase_order', data: po, timestamp: Date.now() });
            this._savePendingQueue();
        }
    }

    // ==========================================
    // LECTURA DE COMANDOS REMOTOS (App del Jefe)
    // ==========================================
    async patchPurchaseOrder(poId, updates) {
        if (!this.enabled) return;
        try {
            await this._supabaseRequest('store_purchase_orders', 'PATCH', updates, `?id=eq.${poId}`);
        } catch (e) {
            console.warn('[CLOUD-SYNC] Error patching PO:', e.message);
            this.pendingQueue.push({ type: 'purchase_order_patch', data: { id: poId, updates }, timestamp: Date.now() });
            this._savePendingQueue();
        }
    }

    async approvePurchaseOrder(poId, items, fromStoreId, localDbApi) {
        if (!this.enabled) return;
        try {
            for (const item of items) {
                const spId = `${fromStoreId}_${item.product_id}`;
                try {
                    const existing = await this._supabaseGet('store_products', `?id=eq.${spId}&select=stock`);
                    const currentStock = (existing && existing.length > 0) ? (existing[0].stock || 0) : 0;
                    const needed = item.quantity || 0;
                    if (currentStock < needed) {
                        throw new Error(`Stock insuficiente para "${item.product_name || item.product_id}": hay ${currentStock}, necesita ${needed}`);
                    }
                } catch (e2) {
                    if (e2.message && e2.message.includes('Stock insuficiente')) throw e2;
                    console.warn('[CLOUD-SYNC] Error checking stock:', e2.message);
                }
            }
            await this.patchPurchaseOrder(poId, { status: 'APPROVED', approved_by: this.storeId });
            for (const item of items) {
                const spId = `${fromStoreId}_${item.product_id}`;
                try {
                    const existing = await this._supabaseGet('store_products', `?id=eq.${spId}&select=stock`);
                    if (existing && existing.length > 0) {
                        const newStock = Math.max(0, (existing[0].stock || 0) - (item.quantity || 0));
                        await this._supabaseRequest('store_products', 'PATCH', { stock: newStock }, `?id=eq.${spId}`);
                    }
                } catch (e2) {
                    console.warn('[CLOUD-SYNC] Error updating warehouse stock:', e2.message);
                }
            }
            if (localDbApi) {
                try {
                    await localDbApi.updatePOStatus(this.storeId, poId, 'APPROVED');
                } catch (e3) {
                    console.warn('[CLOUD-SYNC] Error updating local PO status:', e3.message);
                }
            }
        } catch (e) {
            console.error('[CLOUD-SYNC] Error in approvePurchaseOrder:', e.message);
            throw e;
        }
    }

    async receivePurchaseOrder(poId, items, toStoreId, localDbApi) {
        if (!this.enabled) return;
        try {
            await this.patchPurchaseOrder(poId, { status: 'RECEIVED', received_date: new Date().toISOString() });
            for (const item of items) {
                const spId = `${toStoreId}_${item.product_id}`;
                try {
                    const existing = await this._supabaseGet('store_products', `?id=eq.${spId}&select=stock`);
                    const qty = item.received_qty || item.quantity || 0;
                    if (existing && existing.length > 0) {
                        const newStock = (existing[0].stock || 0) + qty;
                        await this._supabaseRequest('store_products', 'PATCH', { stock: newStock }, `?id=eq.${spId}`);
                    } else {
                        await this._supabaseRequest('store_products', 'POST', {
                            id: spId,
                            store_id: toStoreId,
                            product_id: item.product_id,
                            name: item.product_name || 'Producto',
                            stock: qty,
                            price: item.cost_price || 0
                        });
                    }
                } catch (e2) {
                    console.warn('[CLOUD-SYNC] Error updating kiosko stock:', e2.message);
                }
            }
            if (localDbApi) {
                try {
                    await localDbApi.receivePO(toStoreId, poId, items);
                } catch (e3) {
                    console.warn('[CLOUD-SYNC] Error updating local receive:', e3.message);
                }
            }
        } catch (e) {
            console.error('[CLOUD-SYNC] Error in receivePurchaseOrder:', e.message);
            throw e;
        }
    }

    async fetchRemotePOs(localDbApi) {
        if (!this.enabled || !localDbApi) return;
        try {
            const remotePOs = await this._supabaseGet('store_purchase_orders', `?tenant_id=eq.${this.tenantId}&or=(from_store.eq.${this.storeId},to_store.eq.${this.storeId})&order=timestamp.desc&limit=100`);
            if (!remotePOs || remotePOs.length === 0) return;
            const localPOs = await localDbApi.getPurchaseOrders(this.storeId, 'all') || [];
            const localMap = {};
            localPOs.forEach(p => localMap[p.id] = p);
            for (const rpo of remotePOs) {
                const local = localMap[rpo.id];
                const items = (() => { try { return JSON.parse(rpo.items_json || '[]'); } catch(e) { return []; } })();
                if (!local) {
                    await localDbApi.savePurchaseOrder(this.storeId, {
                        id: rpo.id,
                        store_id: rpo.store_id || this.storeId,
                        order_type: 'purchase',
                        from_store: rpo.from_store || '',
                        to_store: rpo.to_store || '',
                        status: rpo.status || 'PENDING',
                        items: items,
                        notes: rpo.notes || '',
                        total_cost: rpo.total_cost || 0,
                        date: rpo.date || new Date().toISOString(),
                        timestamp: rpo.timestamp || Date.now(),
                        created_by: rpo.created_by || '',
                        approved_by: rpo.approved_by || '',
                        received_date: rpo.received_date || ''
                    });
                } else if (local.status !== rpo.status) {
                    await localDbApi.updatePOStatus(this.storeId, rpo.id, rpo.status);
                }
            }
        } catch (e) {
            console.warn('[CLOUD-SYNC] Error fetching remote POs:', e.message);
        }
    }

    async _fetchCommands() {
        if (!this.enabled) {
            console.log('[CLOUD-SYNC] ⏸️ Sincronización desactivada. Saltando fetchCommands.');
            return;
        }
        
        try {
            const msg1 = `[CLOUD-SYNC] 🔍 Buscando comandos para store: ${this.storeId}...`;
            console.log(msg1);
            try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] ${msg1}\n`); } catch(e){}

            const commands = await this._supabaseGet('store_commands', `?store_id=eq.${this.storeId}&tenant_id=eq.${this.tenantId}&status=eq.pending`);
            
            const msg2 = `[CLOUD-SYNC] 🔍 Resultado supabaseGet: ${commands ? commands.length : 'null'}`;
            console.log(msg2, commands);
            try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] ${msg2}\n`); } catch(e){}

            if (commands && commands.length > 0) {
                console.log(`[CLOUD-SYNC] 📥 Recibidos ${commands.length} comandos remotos pendientes`);
                
                const dbApi = getDbApi();
                
                for (const cmd of commands) {
                    if (cmd.command_type === 'UPDATE_PRICE') {
                        const { product_id, new_price } = cmd.payload;
                        console.log(`[CLOUD-SYNC] Ejecutando UPDATE_PRICE para ${product_id} a ${new_price}`);
                        
                        try {
                            const productsList = await dbApi.getProducts(this.storeId);
                            const prod = productsList.find(p => p.id === product_id);
                            
                            if (prod) {
                                prod.priceUSD = parseFloat(new_price);
                                await dbApi.saveProduct(this.storeId, prod);
                                
                                await this._supabaseRequest('store_commands', 'PATCH', { 
                                    status: 'done',
                                    executed_at: new Date().toISOString()
                                }, `?id=eq.${cmd.id}`);
                                
                                const { BrowserWindow } = require('electron');
                                BrowserWindow.getAllWindows().forEach(win => {
                                    win.webContents.send('product-updated-remote', { 
                                        id: product_id, 
                                        name: prod.name,
                                        priceUSD: prod.priceUSD
                                    });
                                });
                            } else {
                                console.warn(`[CLOUD-SYNC] ⚠️ Producto ${product_id} NO encontrado en BD local`);
                                try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] ERROR PRODUCT NOT FOUND: ${product_id} en tienda ${this.storeId}\n`); } catch(e){}
                                await this._supabaseRequest('store_commands', 'PATCH', { status: 'error', executed_at: new Date().toISOString(), error_log: 'Producto no encontrado' }, `?id=eq.${cmd.id}`);
                            }
                        } catch (err) {
                            console.error('[CLOUD-SYNC] Error ejecutando comando:', err.message);
                            await this._supabaseRequest('store_commands', 'PATCH', { status: 'error', executed_at: new Date().toISOString(), error_log: err ? err.message : 'Error interno' }, `?id=eq.${cmd.id}`);
                        }
                    } else if (cmd.command_type === 'UPDATE_PRODUCT_FULL') {
                        const { 
                            product_id, 
                            new_name,
                            new_category,
                            new_price_usd, 
                            new_price_ves, 
                            new_price_eur, 
                            new_promo_price,
                            new_stock, 
                            new_img,
                            new_variants,
                            new_expiry
                        } = cmd.payload;
                        console.log(`[CLOUD-SYNC] ▶ UPDATE_PRODUCT_FULL para: ${product_id}`);
                        
                        try {
                            const localDbApi = getDbApi();
                            const productsList = await localDbApi.getProducts(this.storeId);
                            const prod = productsList.find(p => p.id === product_id);
                            console.log(`[CLOUD-SYNC] 🔎 Buscando producto ${product_id} en ${productsList.length} productos locales...`);
                            
                            if (prod) {
                                if (new_price_usd !== undefined && new_price_usd !== null) prod.priceUSD = parseFloat(new_price_usd);
                                if (new_price_ves !== undefined && new_price_ves !== null && parseFloat(new_price_ves) > 0) prod.priceVES = parseFloat(new_price_ves);
                                if (new_price_eur !== undefined && new_price_eur !== null) prod.priceEUR = parseFloat(new_price_eur);
                                if (new_promo_price !== undefined && new_promo_price !== null) prod.promoPrice = parseFloat(new_promo_price);
                                if (new_stock !== undefined && new_stock !== null) prod.stock = parseInt(new_stock);
                                if (new_img !== undefined && new_img !== null) prod.img = new_img.trim();
                                if (new_variants !== undefined && new_variants !== null) {
                                    prod.flavors = typeof new_variants === 'string' ? new_variants.split(',').map(v => v.trim()) : new_variants;
                                }
                                if (new_expiry !== undefined && new_expiry !== null) prod.expiryDate = new_expiry;
                                
                                await localDbApi.saveProduct(this.storeId, prod);
                                
                                await this._supabaseRequest('store_commands', 'PATCH', { 
                                    status: 'done',
                                    executed_at: new Date().toISOString()
                                }, `?id=eq.${cmd.id}`);
                                
                                const { BrowserWindow } = require('electron');
                                BrowserWindow.getAllWindows().forEach(win => {
                                    win.webContents.send('product-updated-remote-full', prod);
                                });
                            } else {
                                // 🆕 CREAR producto si no existe en la sede local
                                console.log(`[CLOUD-SYNC] 🆕 Producto ${product_id} no existe localmente. Creando...`);
                                const newProd = {
                                    id: product_id,
                                    name: cmd.payload.new_name || 'Producto Nuevo (Remoto)',
                                    category: cmd.payload.new_category || 'General',
                                    priceUSD: parseFloat(new_price_usd) || 0,
                                    priceVES: parseFloat(new_price_ves) || 0,
                                    priceEUR: parseFloat(new_price_eur) || 0,
                                    promoPrice: parseFloat(new_promo_price) || 0,
                                    stock: parseInt(new_stock) || 0,
                                    img: new_img || '',
                                    flavors: typeof new_variants === 'string' ? new_variants.split(',').map(v => v.trim()) : (new_variants || []),
                                    expiryDate: new_expiry || '',
                                    description: ''
                                };
                                await localDbApi.saveProduct(this.storeId, newProd);
                                
                                await this._supabaseRequest('store_commands', 'PATCH', { 
                                    status: 'done',
                                    executed_at: new Date().toISOString()
                                }, `?id=eq.${cmd.id}`);
                                
                                const { BrowserWindow } = require('electron');
                                BrowserWindow.getAllWindows().forEach(win => {
                                    win.webContents.send('product-updated-remote-full', newProd);
                                });
                            }
                        } catch (err) {
                            console.error('[CLOUD-SYNC] Error ejecutando UPDATE_PRODUCT_FULL:', err.message);
                            try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'startup_debug.log'), `[${new Date().toISOString()}] [CLOUD-SYNC] ERROR UPDATE_PRODUCT_FULL: ${err.message} - stack: ${err.stack}\n`); } catch(e){}
                            await this._supabaseRequest('store_commands', 'PATCH', { status: 'error', executed_at: new Date().toISOString(), error_log: err ? err.message : 'Error interno' }, `?id=eq.${cmd.id}`);
                        }
                    } else if (cmd.command_type === 'PUSH_FULL_CATALOG') {
                        console.log('[CLOUD-SYNC] ▶ PUSH_FULL_CATALOG solicitado por Jefe');
                        try {
                            const allProducts = await getDbApi().getProducts(this.storeId);
                            await this.pushCatalog(allProducts);
                            await this._supabaseRequest('store_commands', 'PATCH', { 
                                status: 'done',
                                executed_at: new Date().toISOString()
                            }, `?id=eq.${cmd.id}`);
                        } catch (err) {
                            console.error('[CLOUD-SYNC] Error ejecutando PUSH_FULL_CATALOG:', err.message);
                            await this._supabaseRequest('store_commands', 'PATCH', { status: 'error', executed_at: new Date().toISOString(), error_log: err ? err.message : 'Error interno' }, `?id=eq.${cmd.id}`);
                        }
                    } else if (cmd.command_type === 'UPDATE_EXCHANGE_RATE') {
                        const { new_rate } = cmd.payload;
                        console.log(`[CLOUD-SYNC] 💵 Ejecutando UPDATE_EXCHANGE_RATE a ${new_rate}`);
                        
                        try {
                            const { BrowserWindow } = require('electron');
                            BrowserWindow.getAllWindows().forEach(win => {
                                win.webContents.send('exchange-rate-updated-remote', parseFloat(new_rate));
                            });
                            
                            await this._supabaseRequest('store_commands', 'PATCH', { 
                                status: 'done',
                                executed_at: new Date().toISOString()
                            }, `?id=eq.${cmd.id}`);
                        } catch (err) {
                            await this._supabaseRequest('store_commands', 'PATCH', { status: 'error', executed_at: new Date().toISOString(), error_log: err ? err.message : 'Error interno' }, `?id=eq.${cmd.id}`);
                        }
                    }
                }
                
                // Sincronizar catálogo de vuelta
                try {
                    const dbApi2 = getDbApi();
                    const allProducts = await dbApi2.getProducts(this.storeId);
                    await this.pushCatalog(allProducts);
                } catch(catalogErr) {
                    console.error('[CLOUD-SYNC] Error sincronizando catálogo post-comando:', catalogErr.message);
                }
            }
        } catch (e) {
            console.error('[CLOUD-SYNC] ❌ Error en polling de comandos:', e.message, e.stack);
            try {
                const { app } = require('electron');
                fs.appendFileSync(path.join(app.getPath('userData'), 'startup_debug.log'),
                    `[${new Date().toISOString()}] [CLOUD-SYNC] ERROR FETCH: ${e.message}\n`);
            } catch(_){}
        }
    }

    // ==========================================
    // COLA DE REINTENTOS
    // ==========================================
    async _flushQueue() {
        if (this.pendingQueue.length === 0) return;

        console.log(`[CLOUD-SYNC] 🔄 Procesando ${this.pendingQueue.length} items pendientes...`);
        const failed = [];

        for (const item of this.pendingQueue) {
            try {
                if (item.type === 'snapshot') {
                    await this._supabaseRequest('store_snapshots', 'POST', item.data);
                } else if (item.type === 'sale') {
                    await this._supabaseRequest('store_sales', 'POST', item.data);
                } else if (item.type === 'transfer') {
                    await this._supabaseRequest('store_transfers', 'POST', item.data);
                } else if (item.type === 'purchase_order') {
                    await this._supabaseRequest('store_purchase_orders', 'POST', item.data);
                } else if (item.type === 'purchase_order_patch') {
                    await this._supabaseRequest('store_purchase_orders', 'PATCH', item.data.updates, `?id=eq.${item.data.id}`);
                } else if (item.type === 'stock_update') {
                    await this._supabaseRequest('store_products', 'PATCH', item.data.updates, `?id=eq.${item.data.productId}`);
                }
            } catch (e) {
                // Si lleva más de 24 horas, descartarlo
                if (Date.now() - item.timestamp < 86400000) {
                    failed.push(item);
                }
            }
        }

        this.pendingQueue = failed;
        this._savePendingQueue();

        if (failed.length === 0) {
            this._updateStatus(true);
        }
    }

    _loadPendingQueue() {
        if (!this.queuePath) return;
        try {
            const filePath = path.join(this.queuePath, 'cloud_sync_queue.json');
            if (fs.existsSync(filePath)) {
                this.pendingQueue = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) {}
    }

    _savePendingQueue() {
        if (!this.queuePath) return;
        try {
            const filePath = path.join(this.queuePath, 'cloud_sync_queue.json');
            fs.writeFileSync(filePath, JSON.stringify(this.pendingQueue));
        } catch (e) {}
    }

    _loadDeletedIds() {
        if (!this.queuePath) return;
        try {
            const filePath = path.join(this.queuePath, 'deleted_product_ids.json');
            if (fs.existsSync(filePath)) {
                const arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(arr)) this.deletedProductIds = new Set(arr);
            }
        } catch (e) {}
    }

    _saveDeletedIds() {
        if (!this.queuePath) return;
        try {
            const filePath = path.join(this.queuePath, 'deleted_product_ids.json');
            fs.writeFileSync(filePath, JSON.stringify([...this.deletedProductIds]));
        } catch (e) {}
    }

    addDeletedProductId(id) {
        this.deletedProductIds.add(String(id));
        this._saveDeletedIds();
    }

    removeDeletedProductId(id) {
        this.deletedProductIds.delete(String(id));
        this._saveDeletedIds();
    }

    _updateStatus(synced, error = null) {
        this.lastStatus = {
            synced,
            lastSync: synced ? new Date().toISOString() : this.lastStatus.lastSync,
            error,
            pendingCount: this.pendingQueue.length,
            enabled: this.enabled,
            storeName: this.storeName,
            storeId: this.storeId
        };
        this.onStatusChange(this.lastStatus);
    }

    getStatus() {
        return this.lastStatus;
    }

    // ==========================================
    // BACKUP SEMANAL AUTOMÁTICO
    // ==========================================
    async pushBackup(dbApi) {
        if (!this.enabled) return;
        
        console.log('[CLOUD-SYNC] 🔄 Iniciando backup automático en la nube...');
        try {
            const products = await dbApi.getProducts(this.storeId) || [];
            const clients = await dbApi.getClients(this.storeId) || [];
            // Resumen básico de ventas de los últimos 7 días
            const sales = await dbApi.getSales(this.storeId) || [];
            const recentSales = sales
                .filter(s => (Date.now() - new Date(s.date).getTime()) < 7 * 24 * 60 * 60 * 1000)
                .map(s => ({
                    id: s.id, totalUSD: s.totalUSD, method: s.method, date: s.date
                }));

            const backupData = {
                store_id: this.storeId,
                backup_date: new Date().toISOString(),
                products_json: products,
                clients_json: clients,
                sales_summary_json: recentSales
            };

            await this._supabaseRequest('store_backups', 'POST', backupData);
            console.log(`[CLOUD-SYNC] ✅ Backup automático guardado en la nube para tienda: ${this.storeId}`);
        } catch (e) {
            console.error('[CLOUD-SYNC] ❌ Error subiendo backup automático:', e.message);
        }
    }

    // ==========================================
    // LICENSE MANAGEMENT (Activación por Máquina)
    // ==========================================
    async _licenseRequest(table, method, data, queryParams = '') {
        const url = new URL(`${this.supabaseUrl}/rest/v1/${table}${queryParams}`);
        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`,
                    'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
                }
            };
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(body ? JSON.parse(body) : { success: true }); }
                        catch (e) { resolve({ success: true }); }
                    } else {
                        reject(new Error(`License ${method} ${table} → HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
            if (data && (method === 'POST' || method === 'PATCH')) req.write(JSON.stringify(data));
            req.end();
        });
    }

    async _licenseGet(table, queryParams = '') {
        const url = new URL(`${this.supabaseUrl}/rest/v1/${table}${queryParams}`);
        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`,
                    'Accept': 'application/json'
                }
            };
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(body)); } catch (e) { resolve([]); }
                    } else {
                        reject(new Error(`License GET ${res.statusCode}: ${body.substring(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    async registerMachine(machineId, appId, deviceName, userType, userInfo) {
        const data = {
            machine_id: machineId,
            app_id: appId,
            device_name: deviceName || '',
            user_type: userType || 'negocio',
            user_info: userInfo || {},
            status: 'trial',
            trial_start: new Date().toISOString(),
            trial_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            version: '',
            last_seen: new Date().toISOString()
        };
        try {
            await this._licenseRequest('licenses', 'POST', data);
            await this._licenseRequest('license_audit', 'POST', {
                machine_id: machineId,
                action: 'registered',
                ip_address: ''
            });
            await this._licenseRequest('license_audit', 'POST', {
                machine_id: machineId,
                action: 'trial_started',
                ip_address: ''
            });
            return { ok: true, trial_end: data.trial_end };
        } catch (e) {
            console.error('[LICENSE] Error registering machine:', e.message);
            return { ok: false, error: e.message };
        }
    }

    async checkMachineStatus(machineId) {
        if (!this.supabaseUrl) return { status: 'unknown', error: 'No cloud config' };
        try {
            const rows = await this._licenseGet('licenses', `?machine_id=eq.${encodeURIComponent(machineId)}&limit=1`);
            if (!rows || rows.length === 0) return { status: 'not_found' };
            const lic = rows[0];
            const now = new Date();
            // Auto-expire trials
            if (lic.status === 'trial' && lic.trial_end && new Date(lic.trial_end) < now) {
                lic.status = 'trial_expired';
                try {
                    await this._licenseRequest('licenses', 'PATCH', { status: 'trial_expired' }, `?machine_id=eq.${encodeURIComponent(machineId)}`);
                } catch (_) {}
            }
            return {
                status: lic.status,
                device_name: lic.device_name,
                user_type: lic.user_type,
                user_info: lic.user_info,
                trial_end: lic.trial_end,
                expiration_date: lic.expiration_date,
                deactivation_reason: lic.deactivation_reason
            };
        } catch (e) {
            console.error('[LICENSE] Error checking machine status:', e.message);
            return { status: 'error', error: e.message };
        }
    }

    async licenseHeartbeat(machineId, version) {
        try {
            await this._licenseRequest('licenses', 'PATCH', {
                last_seen: new Date().toISOString(),
                version: version || ''
            }, `?machine_id=eq.${encodeURIComponent(machineId)}`);
            try {
                await this._licenseRequest('license_audit', 'POST', {
                    machine_id: machineId,
                    action: 'heartbeat',
                    ip_address: ''
                });
            } catch (_) {}
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    async getAllLicenses() {
        try {
            return await this._licenseGet('licenses', '?order=created_at.desc');
        } catch (e) {
            console.error('[LICENSE] Error getting all licenses:', e.message);
            return [];
        }
    }

    async updateLicenseStatus(machineId, newStatus, reason) {
        if (!['active','deactivated'].includes(newStatus)) return { ok: false, error: 'Invalid status' };
        try {
            const patch = { status: newStatus, updated_at: new Date().toISOString() };
            if (newStatus === 'deactivated' && reason) patch.deactivation_reason = reason;
            await this._licenseRequest('licenses', 'PATCH', patch, `?machine_id=eq.${encodeURIComponent(machineId)}`);
            await this._licenseRequest('license_audit', 'POST', {
                machine_id: machineId,
                action: newStatus === 'active' ? 'activated' : 'deactivated',
                reason: reason || ''
            });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    destroy() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        this._savePendingQueue();
    }
}

module.exports = CloudSync;
