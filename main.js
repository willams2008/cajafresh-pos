// Ensure Electron runs in browser mode, not Node mode
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, ipcMain, dialog } = require('electron');

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const cors = require('cors');
const QRCode = require('qrcode');
const { spawn, execSync } = require('child_process');
const https = require('https');
const { initDatabase, api: dbApi, migrateOrphanData } = require('./database');
const CloudSync = require('./cloud-sync');

// --- STARTUP DIAGNOSTIC LOG ---
const startupLogPath = path.join(app.getPath('userData'), 'startup_debug.log');
const origLog = console.log;
const origErr = console.error;
console.log = function(...args) {
    origLog.apply(console, args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    try { fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] [LOG] ${msg}\n`); } catch(e) {}
};
console.error = function(...args) {
    origErr.apply(console, args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    try { fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] [ERROR] ${msg}\n`); } catch(e) {}
};

// Event Loop & Renderer Lag Monitor
let _lastLagCheck = Date.now();
function checkEventLoopLag() {
    const now = Date.now();
    const lag = now - _lastLagCheck - 1000;
    if (lag > 300) {
        logStartup(`⚠️ MAIN EVENT LOOP LAG: ${lag}ms`);
    }
    _lastLagCheck = now;
}
setInterval(checkEventLoopLag, 1000);

// Renderer health check: ping every 10s, log if slow
setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const start = Date.now();
    try {
        await mainWindow.webContents.executeJavaScript('window.__rendererPong = Date.now()');
        const rtt = Date.now() - start;
        if (rtt > 1000) {
            logStartup(`⚠️ RENDERER SLOW: RTT ${rtt}ms`);
        }
    } catch(e) {
        logStartup(`❌ RENDERER UNRESPONSIVE: ${e.message}`);
    }
}, 10000);

function logStartup(msg) {
    console.log(msg);
}

logStartup('🚀 Iniciando aplicación...');
logStartup('📍 App Path: ' + app.getAppPath());
logStartup('📍 User Data: ' + app.getPath('userData'));

// Robust Cloudflared Path Resolution
let { bin } = require('cloudflared');
try {
    if (bin.includes('app.asar')) {
        const unpackedBin = bin.replace('app.asar', 'app.asar.unpacked');
        if (fs.existsSync(unpackedBin)) {
            bin = unpackedBin;
            logStartup('✅ Usando binario cloudflared desempaquetado: ' + bin);
        } else {
            logStartup('⚠️ Binario desempaquetado NO encontrado en: ' + unpackedBin);
            logStartup('🔍 Reintentando con binario dentro de ASAR: ' + bin);
        }
    }
    if (!fs.existsSync(bin)) {
        const npmBin = path.join(__dirname, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
        if (fs.existsSync(npmBin)) {
            bin = npmBin;
            logStartup('✅ Usando binario cloudflared desde node_modules: ' + bin);
        } else {
            logStartup('❌ Binario cloudflared no encontrado en: ' + npmBin);
        }
    }
} catch (err) {
    logStartup('❌ Error resolviendo binario cloudflared: ' + err.message);
}

const localtunnel = require('localtunnel');
const ngrok = require('ngrok');
const { Client, LocalAuth } = require('whatsapp-web.js');

const readline = require('readline');
const licenseSystem = require('./license');

// ══════════════════════════════════════════════════════════════
// CREDENCIALES DEL PROVEEDOR — Se cargan desde .env si existe,
// o usa valores por defecto. Nunca hardcodeados en el código.
// ══════════════════════════════════════════════════════════════
let VENDOR_SUPABASE_URL = 'https://effgvevvnfzcuvtulyvs.supabase.co';
let VENDOR_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmZmd2ZXZ2bmZ6Y3V2dHVseXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTg0MzgsImV4cCI6MjA5MjUzNDQzOH0.0WzyJcGCuGYfJAIE9g1Gxcm5G4thooHxDV0a4D5jMVk';
let config = null;
try {
    config = require('./src/config');
    VENDOR_SUPABASE_URL = config.supabase.url;
    VENDOR_SUPABASE_KEY = config.supabase.key;
} catch (e) {
    console.warn('[MAIN] ⚠️ No se pudo cargar config, usando valores por defecto:', e.message);
}

let mainWindow;
let io;
let currentTunnelUrl = null;
let lastDiscoveryUrl = null; // CACHE para evitar spam de señal
let isStartingTunnel = false; // Flag para evitar ejecuciones concurrentes
let lastSyncedProducts = null; // CACHE: Guardar última versión de productos para carga instantánea
const serverPort = (config && config.port) || 3000;

// --- CREATE DESKTOP SHORTCUT ---
function createDesktopShortcut() {
    try {
        const shortcutPath = path.join(app.getPath('desktop'), 'Caja Fresh POS.lnk');
        if (fs.existsSync(shortcutPath)) return;

        const exePath = process.execPath;
        const iconPath = path.join(path.dirname(exePath), 'icon.ico');
        const workingDir = path.dirname(exePath);

        const psScript = `
            $WshShell = New-Object -comObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/'/g, "''")}")
            $Shortcut.TargetPath = "${exePath.replace(/'/g, "''")}"
            $Shortcut.WorkingDirectory = "${workingDir.replace(/'/g, "''")}"
            $Shortcut.IconLocation = "${iconPath.replace(/'/g, "''")}"
            $Shortcut.Description = "Caja Fresh POS - Sistema de Punto de Venta"
            $Shortcut.Save()
        `;
        const result = require('child_process').execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
            { timeout: 10000, stdio: 'pipe' }
        );
        console.log(`✅ Acceso directo creado en: ${shortcutPath}`);
    } catch (e) {
        console.error('❌ Error creando acceso directo:', e.message);
    }
}

// --- CLOUD SYNC (Multi-Sucursal) ---
let cloudSync = null;

// These will be initialized in initWhatsApp() after app is ready
let logPath = null;
let whatsappClient = null;
let isWhatsappReady = false;
let lastWhatsappStatus = { status: 'starting', message: 'Iniciando motor...' };
// Contador de reinicios para evitar loop infinito
let _waRestartCount = 0;
let _waLastRestartTime = 0;
const WA_MAX_AUTO_RESTARTS = 3;
const WA_RESTART_COOLDOWN_MS = 10000;

function safeRestartWhatsApp(reason) {
    const now = Date.now();
    if (now - _waLastRestartTime < WA_RESTART_COOLDOWN_MS) {
        logWA(`⚠️ Reinicio bloqueado por cooldown (${reason})`);
        return;
    }
    if (_waRestartCount >= WA_MAX_AUTO_RESTARTS) {
        logWA(`🛑 Máximo de reinicios automáticos (${WA_MAX_AUTO_RESTARTS}) alcanzado. WhatsApp se detiene hasta que el usuario lo reinicie manualmente.`);
        updateWAStatus({ status: 'error', error: `WhatsApp detuvo su reinicio automático tras ${WA_MAX_AUTO_RESTARTS} intentos fallidos. Presiona el botón de reiniciar en Configuración.` });
        return;
    }
    _waRestartCount++;
    _waLastRestartTime = now;
    logWA(`🔄 Reinicio automático #${_waRestartCount}/${WA_MAX_AUTO_RESTARTS} (${reason})`);
    initWhatsApp();
}

// --- DATABASE IPC HANDLERS ---
function getStoreIdHelper(passedStoreId) {
    if (typeof passedStoreId === 'string' && passedStoreId.trim() !== '') {
        return passedStoreId;
    }
    try {
        const settings = getPersistentSettings();
        return settings.storeId || '';
    } catch(e) {
        return '';
    }
}

ipcMain.handle('db-get-settings', async () => {
    return getPersistentSettings();
});
ipcMain.handle('db-get-products', async (e, storeId) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getProducts(sid);
});

async function syncCatalogToCloud(storeId) {
    if (cloudSync && cloudSync.enabled) {
        try {
            const allProducts = await dbApi.getProducts(storeId);
            await cloudSync.pushCatalog(allProducts);
        } catch(e) { console.error('Error syncing catalog', e); }
    }
}

ipcMain.handle('db-save-product', async (e, storeId, p) => {
    let sid = storeId;
    let product = p;
    if (typeof storeId !== 'string') {
        product = storeId;
        sid = getStoreIdHelper();
    }
    const res = await dbApi.saveProduct(sid, product);
    syncCatalogToCloud(sid);
    return res;
});
ipcMain.handle('db-save-products-bulk', async (e, storeId, p) => {
    let sid = storeId;
    let productsList = p;
    if (typeof storeId !== 'string') {
        productsList = storeId;
        sid = getStoreIdHelper();
    }
    const res = await dbApi.saveProductsBulk(sid, productsList);
    syncCatalogToCloud(sid);
    return res;
});
ipcMain.handle('db-delete-product', async (e, storeId, id) => {
    let sid = storeId;
    let productId = id;
    if (typeof storeId !== 'string') {
        productId = storeId;
        sid = getStoreIdHelper();
    }
    const res = await dbApi.deleteProduct(sid, productId);
    syncCatalogToCloud(sid);
    return res;
});

ipcMain.handle('db-get-clients', async (e, storeId) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getClients(sid);
});
ipcMain.handle('db-save-client', async (e, storeId, c) => {
    let sid = storeId;
    let client = c;
    if (typeof storeId !== 'string') {
        client = storeId;
        sid = getStoreIdHelper();
    }
    return dbApi.saveClient(sid, client);
});

ipcMain.handle('db-get-sales', async (e, storeId, limit) => {
    let sid = storeId;
    let lim = limit;
    if (typeof storeId !== 'string') {
        lim = storeId;
        sid = getStoreIdHelper();
    }
    return dbApi.getSales(sid, lim);
});
ipcMain.handle('db-get-sales-by-date', async (e, storeId, start, end) => {
    let sid = storeId;
    let startDate = start;
    let endDate = end;
    if (typeof storeId !== 'string') {
        startDate = storeId;
        endDate = start;
        sid = getStoreIdHelper();
    }
    return dbApi.getSalesByDate(sid, startDate, endDate);
});
ipcMain.handle('db-save-sale', async (e, storeId, s) => {
    let sid = storeId;
    let sale = s;
    if (typeof storeId !== 'string') {
        sale = storeId;
        sid = getStoreIdHelper();
    }
    const result = await dbApi.saveSale(sid, sale);
    if (io) io.emit('new-sale', sale);
    return result;
});
ipcMain.handle('db-void-sale', async (e, storeId, saleId) => {
    let sid = storeId;
    let sId = saleId;
    if (typeof storeId !== 'string') {
        sId = storeId;
        sid = getStoreIdHelper();
    }
    return dbApi.voidSale(sid, sId);
});


ipcMain.handle('db-get-credits', async (e, storeId) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getCredits(sid);
});
ipcMain.handle('db-add-credit-payment', async (e, storeId, id, amount, method) => {
    let sid = storeId;
    let creditId = id;
    let amt = amount;
    let meth = method;
    if (typeof storeId !== 'string') {
        creditId = storeId;
        amt = id;
        meth = amount;
        sid = getStoreIdHelper();
    }
    return dbApi.addCreditPayment(sid, creditId, amt, meth);
});

ipcMain.handle('db-get-transfers', async (e, storeId, status) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getTransfers(sid, status);
});
ipcMain.handle('db-save-transfer', async (e, storeId, t) => {
    let sid = storeId, trans = t;
    if (typeof storeId !== 'string') { trans = storeId; sid = getStoreIdHelper(); }
    return dbApi.saveTransfer(sid, trans);
});
ipcMain.handle('db-update-transfer-status', async (e, storeId, id, status) => {
    let sid = storeId, tid = id, st = status;
    if (typeof storeId !== 'string') { tid = storeId; st = id; sid = getStoreIdHelper(); }
    return dbApi.updateTransferStatus(sid, tid, st);
});
ipcMain.handle('db-delete-transfer', async (e, storeId, id) => {
    let sid = storeId, tid = id;
    if (typeof storeId !== 'string') { tid = storeId; sid = getStoreIdHelper(); }
    return dbApi.deleteTransfer(sid, tid);
});
ipcMain.handle('db-get-purchase-orders', async (e, storeId, status) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getPurchaseOrders(sid, status);
});
ipcMain.handle('db-save-purchase-order', async (e, storeId, po) => {
    let sid = storeId, order = po;
    if (typeof storeId !== 'string') { order = storeId; sid = getStoreIdHelper(); }
    return dbApi.savePurchaseOrder(sid, order);
});
ipcMain.handle('db-update-po-status', async (e, storeId, id, status) => {
    let sid = storeId, pid = id, st = status;
    if (typeof storeId !== 'string') { pid = storeId; st = id; sid = getStoreIdHelper(); }
    return dbApi.updatePOStatus(sid, pid, st);
});
ipcMain.handle('db-receive-po', async (e, storeId, poId, items) => {
    let sid = storeId, pid = poId, its = items;
    if (typeof storeId !== 'string') { pid = storeId; its = poId; sid = getStoreIdHelper(); }
    return dbApi.receivePO(sid, pid, its);
});
ipcMain.handle('db-delete-po', async (e, storeId, id) => {
    let sid = storeId, pid = id;
    if (typeof storeId !== 'string') { pid = storeId; sid = getStoreIdHelper(); }
    return dbApi.deletePO(sid, pid);
});
ipcMain.handle('db-get-cashups', async (e, storeId) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getCashups(sid);
});
ipcMain.handle('db-get-cashup-by-date', async (e, storeId, date) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getCashupByDate(sid, date);
});
ipcMain.handle('db-save-cashup', async (e, storeId, cashup) => {
    let sid = storeId, c = cashup;
    if (typeof storeId !== 'string') { c = storeId; sid = getStoreIdHelper(); }
    return dbApi.saveCashup(sid, c);
});
ipcMain.handle('db-get-today-sales-summary', async (e, storeId) => {
    const sid = getStoreIdHelper(storeId);
    return dbApi.getTodaySalesSummary(sid);
});
ipcMain.handle('db-migrate', async (e, storeId, data) => {
    let sid = storeId;
    let migrateData = data;
    if (typeof storeId !== 'string') {
        migrateData = storeId;
        sid = getStoreIdHelper();
    }
    return dbApi.migrateData(sid, migrateData);
});

// ==========================================
// LICENCIA IPC HANDLERS
// ==========================================
ipcMain.handle('license-get-id', () => licenseSystem.getPublicMachineId());
ipcMain.handle('get-public-ip', () => getPublicIP());

// ==========================================
// WHATSAPP DEBUG LOGGING
// ==========================================
function logWA(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    if (logPath) {
        try { fs.appendFileSync(logPath, entry); } catch(e) {}
    }
}

// ------------------------------------------
// PAGO MÓVIL CACHE DEDUPLICATOR
// ------------------------------------------
const processedPaymentRefs = new Set();
// Mantener el cache pequeño para no consumir memoria infinita
function isDuplicatePayment(ref) {
    if (!ref || ref === "---") return false;
    if (processedPaymentRefs.has(ref)) return true;
    
    processedPaymentRefs.add(ref);
    if (processedPaymentRefs.size > 100) {
        const firstValue = processedPaymentRefs.values().next().value;
        processedPaymentRefs.delete(firstValue);
    }
    return false;
}

function updateWAStatus(newStatus) {
    lastWhatsappStatus = { ...lastWhatsappStatus, ...newStatus };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('whatsapp-status', lastWhatsappStatus);
    }
}

// ==========================================
// CHROME AUTO-DETECTION
// ==========================================
function getChromePath() {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.PUPPETEER_EXECUTABLE_PATH
    ];
    for (const p of paths) {
        if (p && fs.existsSync(p)) return p;
    }
    return undefined;
}

// ==========================================
// WHATSAPP INIT — called after app.whenReady()
// ==========================================
async function initWhatsApp() {
    logPath = path.join(app.getPath('userData'), 'whatsapp_debug.log');

    // Limpiar archivos de lock de sesiones previas (evita "browser already running")
    try {
        const sessionDir = path.join(app.getPath('userData'), 'wwebjs_session');
        const lockFile = path.join(sessionDir, 'session', 'SingletonLock');
        if (require('fs').existsSync(lockFile)) {
            require('fs').unlinkSync(lockFile);
            logWA('🧹 Lock de sesión WhatsApp eliminado');
        }
        // También limpiar archivos de caché del navegador que causan conflictos
        const singletonFiles = ['SingletonCookie', 'SingletonSocket'];
        singletonFiles.forEach(f => {
            const fp = path.join(sessionDir, 'session', f);
            try { if (require('fs').existsSync(fp)) require('fs').unlinkSync(fp); } catch(e) {}
        });
    } catch(e) {
        logWA('⚠️ No se pudo limpiar lock de sesión: ' + e.message);
    }

    // Destruir cliente anterior si existe para evitar zombies
    if (whatsappClient) {
        try {
            logWA('🧹 Destruyendo cliente WhatsApp anterior...');
            await whatsappClient.destroy();
        } catch (e) {
            logWA(`⚠️ Error destruyendo cliente: ${e.message}`);
        }
        whatsappClient = null;
    }
    isWhatsappReady = false;

    const chromePath = getChromePath();
    logWA(chromePath ? `🎯 Chrome detectado en: ${chromePath}` : '⚠️ Chrome no detectado en rutas estándar.');

    whatsappClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: path.join(app.getPath('userData'), 'wwebjs_session')
        }),
        authTimeoutMs: 0, 
        qrMaxRetries: 30,
        puppeteer: {
            headless: true,
            executablePath: chromePath,
            timeout: 0, 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-extensions',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-web-security',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                '--disable-accelerated-2d-canvas',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        }
    });

    whatsappClient.on('qr', async (qr) => {
        logWA('📱 WhatsApp QR Generado');
        try {
            // Generar QR de alta calidad (mejor contraste para el teléfono)
            const qrImage = await QRCode.toDataURL(qr, {
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            updateWAStatus({ status: 'qr', qr: qrImage });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('whatsapp-qr', qrImage);
            }
        } catch (err) {
            logWA('❌ Error enviando QR al UI: ' + err.message);
        }
    });

    whatsappClient.on('ready', () => {
        logWA('✅ WhatsApp Conectado y Listo!');
        isWhatsappReady = true;
        _waRestartCount = 0; // Conexión exitosa: resetear contador
        updateWAStatus({ status: 'ready' });
    });

    whatsappClient.on('loading_screen', (percent, message) => {
        logWA(`⏳ Cargando WhatsApp: ${percent}% - ${message}`);
        updateWAStatus({ status: 'loading', percent, message });
    });

    whatsappClient.on('authenticated', () => {
        logWA('🔓 WhatsApp Autenticado');
        updateWAStatus({ status: 'authenticated' });
    });

    whatsappClient.on('auth_failure', (msg) => {
        logWA('❌ Error de Autenticación WA: ' + msg);
        updateWAStatus({ status: 'error', error: 'Error de autenticación: ' + msg });
    });

    whatsappClient.on('disconnected', (reason) => {
        logWA('📴 WhatsApp Desconectado: ' + reason);
        isWhatsappReady = false;
        updateWAStatus({ status: 'disconnected' });
    });

    // LISTENER DE MENSAJES PARA PAGO MÓVIL
    whatsappClient.on('message', async (msg) => {
        const text = msg.body;
        const from = msg.from;

        // Solo procesar si parece un mensaje de banco o notificación (Análisis Universal)
        // Agregamos palabras clave comunes en notificaciones de correos y SMS
        const bankKeywordsRegex = /BS\.?|VES|PAGO|REF|REF\.?|REFERENCIA|MONTO|CANTIDAD|#|CONFIRMACION/i;
        
        if (text && bankKeywordsRegex.test(text)) {
            const payment = parseSMSPayment(text, from);
            if (payment && payment.amount > 0) {
                // Verificar duplicados para no alertar dos veces si llega por WA y App/SMS
                if (!isDuplicatePayment(payment.reference)) {
                    logWA(`💰 Pago Detectado vía WA: ${payment.amount} Bs [${payment.bank}] Ref: ${payment.reference}`);
                    if (io) io.emit('payment-detected', payment);
                    if (mainWindow) mainWindow.webContents.send('payment-detected', payment);
                }
            }
        }
    });

    // Iniciar motor con feedback inmediato
    logWA('🚀 Iniciando motor de WhatsApp...');
    updateWAStatus({ status: 'loading', percent: 0, message: 'Detectando navegador...' });

    const WA_INIT_TIMEOUT = 90000;
    const initTimeout = setTimeout(() => {
        if (!isWhatsappReady) {
            logWA('❌ Timeout alcanzado durante la inicialización');
            updateWAStatus({ 
                status: 'error', 
                error: 'El motor tardó demasiado. Por favor, verifica tu conexión o reinicia la aplicación.' 
            });
        }
    }, WA_INIT_TIMEOUT);

    whatsappClient.initialize().then(() => {
        clearTimeout(initTimeout);
        logWA('🎉 Browser de WhatsApp lanzado con éxito');
    }).catch(err => {
        clearTimeout(initTimeout);
        logWA('❌ Fallo crítico al lanzar Client.initialize(): ' + err.message);
        updateWAStatus({ 
            status: 'error', 
            error: 'Error de motor: ' + (err.message || 'Desconocido') 
        });
    });
}

ipcMain.handle('whatsapp-get-status', async () => {
    // Verificación REAL del estado de la conexión (no solo el cache)
    if (isWhatsappReady && whatsappClient) {
        try {
            const state = await whatsappClient.getState();
            if (state !== 'CONNECTED') {
                logWA(`⚠️ Estado real de WhatsApp: ${state} (UI decía CONECTADO)`);
                isWhatsappReady = false;
                updateWAStatus({ status: 'disconnected', error: `Sesión caída (Estado: ${state})` });
                return { status: 'disconnected', message: `Sesión perdida. Escanea el QR de nuevo.` };
            }
        } catch (e) {
            logWA(`❌ Error verificando estado WA: ${e.message}`);
            isWhatsappReady = false;
            updateWAStatus({ status: 'disconnected', error: 'No se puede contactar al motor' });
            return { status: 'disconnected', message: 'Motor caído. Reinicia la app.' };
        }
    }
    return lastWhatsappStatus;
});

ipcMain.handle('whatsapp-logout', async () => {
    logWA('🛑 Solicitud de desvinculación recibida.');
    
    // 1. Intentar logout de gracia
    if (whatsappClient) {
        try {
            await whatsappClient.logout();
            logWA('👋 Logout ejecutado.');
        } catch(e) {
            logWA(`⚠️ Error en logout (ignorando): ${e.message}`);
        }
        
        try {
            await whatsappClient.destroy();
        } catch(e) {}
        whatsappClient = null;
    }

    isWhatsappReady = false;
    updateWAStatus({ status: 'disconnected', message: 'Desvinculando cuenta...' });

    // 2. Limpiar carpeta de sesión para forzar código QR limpio
    const sessionDir = path.join(app.getPath('userData'), 'wwebjs_session');
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            logWA('🗑️ Carpeta de sesión eliminada con éxito.');
        }
    } catch(e) {
        logWA('⚠️ No se pudo eliminar la carpeta de sesión: ' + e.message);
    }

    // 3. Reiniciar motor
    initWhatsApp();
    return { success: true };
});

ipcMain.handle('whatsapp-init', async () => {
    logWA('🚀 Reinicio de motor solicitado por el usuario.');
    initWhatsApp();
    return { success: true };
});


// ==========================================
// WHATSAPP — Gestión de Alertas
// ==========================================

// Reporte automático de venta al jefe
ipcMain.handle('whatsapp-sale-alert', async (event, { phone, sale, dailyTotal }) => {
    if (!isWhatsappReady || !whatsappClient || !phone) return { success: false };
    try {
        const chatId = phone.replace(/[^0-9]/g, '') + '@c.us';
        const hora = new Date(sale.date).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const items = sale.items.map(i => `  • ${i.name} x${i.qty}`).join('\n');
        const msg = [
            `🧾 *VENTA #${sale.ticket || sale.id}* — ${hora}`,
            `💵 *$${parseFloat(sale.totalUSD).toFixed(2)} USD*`,
            `💰 *Bs ${parseFloat(sale.totalVES).toLocaleString('es-VE')}*`,
            `💳 Método: ${sale.method}`,
            `📦 Productos:\n${items}`,
            `─────────────────`,
            `📊 Acumulado hoy: *$${parseFloat(dailyTotal).toFixed(2)} USD*`
        ].join('\n');
        await whatsappClient.sendMessage(chatId, msg);
        logWA(`📤 Alerta de venta enviada a jefe`);
        return { success: true };
    } catch (e) {
        logWA(`❌ Error en alerta de venta: ${e.message}`);
        return { success: false, error: e.message };
    }
});

// HEARTBEAT: Verificar conexión real cada 2 minutos
setInterval(async () => {
    if (isWhatsappReady && whatsappClient) {
        try {
            const state = await whatsappClient.getState();
            if (state !== 'CONNECTED') {
                logWA(`💔 Heartbeat: WhatsApp ya no está conectado (Estado: ${state})`);
                isWhatsappReady = false;
                updateWAStatus({ status: 'disconnected', error: 'Sesión expirada' });
            }
        } catch (e) {
            logWA(`💔 Heartbeat fallido: ${e.message}`);
            
            // Si el heartbeat detecta el motor muerto, auto-reiniciar (con límite)
            if (e.message.includes('detached Frame') || e.message.includes('Session closed') || e.message.includes('Target closed')) {
                logWA('🚨 Heartbeat detectó CRASH FATAL.');
                isWhatsappReady = false;
                updateWAStatus({ status: 'error', error: 'Motor caído. Reiniciando en background...' });
                safeRestartWhatsApp('heartbeat-crash');
            } else {
                isWhatsappReady = false;
                updateWAStatus({ status: 'error', error: 'Motor no responde' });
            }
        }
    }
}, 120000); // Cada 2 minutos



// Obtener la IP local de la PC (Priorizando 192.168.x.x)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    let fallbackIP = 'localhost';
    
    for (let devName in interfaces) {
        let iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            let alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                // Si encontramos una IP que empieza por 192.168 (común en routers), la preferimos
                if (alias.address.startsWith('192.168.')) {
                    return alias.address;
                }
                fallbackIP = alias.address;
            }
        }
    }
    return fallbackIP;
}

async function getPublicIP() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('No detectada'), 5000);
        https.get('https://api.ipify.org', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                resolve(data.trim());
            });
        }).on('error', (e) => {
            clearTimeout(timeout);
            resolve('No detectada');
        });
    });
}


async function updateDiscovery(localIP, tunnelUrl) {
    const storeId = await licenseSystem.getStoreId();
    const businessId = storeId && storeId !== 'demo_store' ? `puntopila_pos_${storeId}` : 'cajafresh_pos_v2_778899_remote';
    
    const fullUrl = tunnelUrl ? (tunnelUrl.startsWith('http') ? tunnelUrl : `https://${tunnelUrl}`) : `http://${localIP}:3000`;
    
    const mobileUrl = `${fullUrl.replace(/\/$/, '')}/mobile#bid=${businessId}`;

    // Mensajes y diseño adaptativo (Local vs Remoto)
    const isLocal = !tunnelUrl;
    const titleText = isLocal ? 'CAJA POS (Solo Wi-Fi)' : 'CAJA POS (Remoto)';
    
    const options = {
        hostname: 'ntfy.sh',
        path: `/${businessId}`,
        method: 'POST',
        headers: {
            'Title': titleText,
            'Priority': 'high',
            'Tags': isLocal ? 'house' : 'globe_with_meridians',
            'Actions': `view, ABRIR SISTEMA, ${mobileUrl}`,
            'Content-Type': 'text/plain; charset=utf-8'
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode < 400) {
            lastDiscoveryUrl = fullUrl; // Guardar solo si se envió con éxito
            console.log(`📡 Señal de descubrimiento enviada [Topic: ${businessId}]: ${fullUrl}`);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync-status', { ok: res.statusCode < 400, bid: businessId });
        }
    });

    req.on('error', (e) => {
        console.error('❌ Error enviando señal discovery:', e.message);
    });

    req.write(fullUrl);
    req.end();
}

// ==========================================
// PAGO MÓVIL SMS PARSER (VENEZUELA)
// ==========================================
function parseSMSPayment(text, from) {
    if (!text) return null;

    // Normalización: Limpiar el texto para análisis universal
    // Quitar saltos de línea y excesos de espacios para que el regex /s funcione mejor
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const uppercaseText = cleanText.toUpperCase();

    let amount = 0;
    let reference = "---";
    let bank = "Desconocido";

    // 1. EXTRACTOR UNIVERSAL DE MONTOS (VEN)
    // Busca números como 1.250,00 o 46.000,00 o 100,00
    // Prefijos comunes: Bs, Bs., Monto de:, Cantidad:, por la suma de:
    const amountRegex = /(?:BS\.?|MONTO(?:\s?DE)?|CANTIDAD(?:\s?DE)?|SUMA(?:\s?DE)?)\s?:?\s*([\d.]+,\d{2})/i;
    const amountMatch = cleanText.match(amountRegex);

    if (amountMatch) {
        // Normalización venezolana: eliminar puntos de miles, cambiar coma decimal por punto
        amount = parseFloat(amountMatch[1].replace(/\./g, '').replace(',', '.'));
    } else {
        // Fallback: Buscar cualquier número con formato de decimales (,XX) que no sea una fecha
        const fallbackAmountRegex = /(?:^|\s)([\d.]+,\d{2})(?:\s|$)/;
        const fallbackMatch = cleanText.match(fallbackAmountRegex);
        if (fallbackMatch) {
            amount = parseFloat(fallbackMatch[1].replace(/\./g, '').replace(',', '.'));
        }
    }

    // 2. EXTRACTOR UNIVERSAL DE REFERENCIAS
    // Busca secuencias de 6 a 14 dígitos que no sean el monto
    // Prefijos: Ref, Referencia, #, Confirmacion, Nro
    const refRegex = /(?:REF\.?|REFERENCIA|CONFIRMACION|NRO|#)\s?:?\s*(\d{6,14})/i;
    const refMatch = cleanText.match(refRegex);

    if (refMatch) {
        reference = refMatch[1].trim();
    } else {
        // Fallback: Buscar cualquier número largo que no sea la fecha ni el monto
        const fallbackRefRegex = /(?:\s|^)(\d{6,14})(?:\s|$)/g;
        let m;
        while ((m = fallbackRefRegex.exec(cleanText)) !== null) {
            const potentialRef = m[1];
            if (potentialRef !== amountMatch?.[1]?.replace(/\D/g, '')) {
                reference = potentialRef;
                break;
            }
        }
    }

    // 3. DICCIONARIO UNIVERSAL DE BANCOS (VENEZUELA)
    const bankKeywords = {
        'BANESCO': 'Banesco',
        'VENEZUELA': 'BDV',
        'BDV': 'BDV',
        'MERCANTIL': 'Mercantil',
        'PROVINCIAL': 'Provincial',
        'BBVA': 'Provincial',
        'BANCARIBE': 'Bancaribe',
        'BNC': 'BNC',
        'BANCAMIGA': 'Bancamiga',
        'BANPLUS': 'Banplus',
        'TESORO': 'B. Tesoro',
        'BICENTENARIO': 'Bicentenario',
        'PLAZA': 'B. Plaza',
        'ACTIVO': 'B. Activo',
        'EXTERIOR': 'B. Exterior',
        'CARONI': 'B. Caroní',
        'AGRICOLA': 'B. Agrícola',
        'SOFITASA': 'Sofitasa',
        'VENEZOLANO DE CREDITO': 'VDC',
        'RESERVA': 'B. Reserva',
        'DEL SUR': 'Del Sur'
    };

    for (const key in bankKeywords) {
        if (uppercaseText.includes(key)) {
            bank = bankKeywords[key];
            break;
        }
    }

    // Si no se detectó banco pero tenemos remitente, usar remitente
    if (bank === "Desconocido" && from) bank = from;

    if (amount > 0 && reference !== "---") {
        console.log(`[ANALYZER] Pago detectado con éxito: ${amount} Bs | Ref: ${reference} | Banco: ${bank}`);
        return { bank, amount, reference, rawText: text };
    } else {
        console.log(`[ANALYZER] Análisis fallido o incompleto. Monto: ${amount}, Ref: ${reference}, Banks Found: ${bank !== "Desconocido"}`);
        return null;
    }
}

function killPortProcess(port) {
    try {
        const { execSync } = require('child_process');
        // Comando para encontrar y matar el proceso en ese puerto (Windows)
        const cmd = `cmd.exe /c "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :${port}') do taskkill /F /PID %a"`;
        execSync(cmd, { stdio: 'ignore' });
    } catch (e) {
        // Ignorar errores si no hay proceso o el comando falla
    }
}

function startServer() {
    // Autolimpieza de puerto al iniciar (Evita que procesos zombies bloqueen la app)
    killPortProcess(serverPort);

    const serverApp = express();
    serverApp.use(cors());
    serverApp.use(express.json());

    // ==========================================
    // BOSS APP — Panel de Control del Dueño
    // ==========================================
    serverApp.use('/boss', express.static(path.join(__dirname, 'boss')));

    // ==========================================
    // BOSS DASHBOARD — Panel del Jefe (Local)
    // ==========================================
    // Panel del Jefe — sirve boss/ sin redireccionamientos que rompan Cloudflare
    const bossMultiPath = path.join(__dirname, 'boss-multi');
    const bossMultiIndex = path.join(bossMultiPath, 'index.html');
    const bossMultiExists = (() => { try { return fs.existsSync(bossMultiIndex) && fs.statSync(bossMultiIndex).isFile(); } catch(e) { return false; } })();

    function serveJefeFile(req, res) {
        if (!bossMultiExists) {
            return res.redirect('/boss');
        }

        const fileName = req.params.file || 'index.html';
        const filePath = path.join(bossMultiPath, fileName);

        try {
            if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                return res.sendFile(bossMultiIndex);
            }
        } catch (e) {
            return res.sendFile(bossMultiIndex);
        }

        const noCacheHeaders = {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        };
        Object.entries(noCacheHeaders).forEach(([k, v]) => res.setHeader(k, v));

        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8'
        };
        res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.status(500).send('Error reading file');
            } else {
                res.send(data);
            }
        });
    }

    serverApp.get('/jefe', (req, res, next) => {
        const rawPath = req.originalUrl.split('?')[0];
        if (rawPath === '/jefe') {
            const query = req.originalUrl.substring(rawPath.length);
            return res.redirect('/jefe/' + query);
        }
        next();
    }, serveJefeFile);
    serverApp.get('/jefe/', serveJefeFile);
    serverApp.get('/jefe/:file', serveJefeFile);

    // Servir Landing Page, Interfaz móvil y Apps de Jefe
    logStartup('DEBUG: Configurando servidor [' + new Date().toLocaleTimeString() + '] con Landing Page en raíz (/).');
    serverApp.get('/', (req, res) => {
        logStartup('DEBUG: Petición recibida en raíz (/). Sirviendo landing/index.html');
        res.sendFile(path.join(__dirname, 'landing', 'index.html'));
    });
    
    serverApp.use('/', express.static(path.join(__dirname, 'landing')));
    serverApp.use('/mobile', express.static(path.join(__dirname, 'mobile')));
    serverApp.use('/assets', express.static(path.join(__dirname, 'assets')));
    serverApp.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));
    
    // Rutas para servir Imágenes Estáticas de la Landing
    serverApp.get('/pos-pantalla.png', (req, res) => {
        res.sendFile(path.join(__dirname, 'pos-pantalla.png'));
    });
    serverApp.get('/movil-pantalla.png', (req, res) => {
        res.sendFile(path.join(__dirname, 'movil-pantalla.png'));
    });
    serverApp.get('/pos-demo.mp4', (req, res) => {
        res.sendFile(path.join(__dirname, 'pos-demo.mp4'));
    });
    serverApp.get('/movil-demo.mp4', (req, res) => {
        res.sendFile(path.join(__dirname, 'movil-demo.mp4'));
    });

    // Ruta de Propuesta Comercial Pro (Landing de Ventas)
    serverApp.get('/propuesta', (req, res) => {
        res.sendFile(path.join(__dirname, 'propuesta_comercial.html'));
    });

    // Endpoint para descargar el archivo APK real
    serverApp.get('/get-apk', (req, res) => {
        // Buscamos el APK en la carpeta mobile
        const apkPath = path.join(__dirname, 'mobile', 'puntopila.apk');
        if (fs.existsSync(apkPath)) {
            res.download(apkPath, 'PuntoPila_POS.apk');
        } else {
            res.status(404).send(`
                <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2>¡Ups! El archivo APK aún no está listo.</h2>
                    <p>Asegúrate de haber copiado tu archivo .apk generado a la carpeta <b>mobile/</b> con el nombre <b>puntopila.apk</b></p>
                    <a href="/download">Volver Atrás</a>
                </div>
            `);
        }
    });

    // Endpoint Receptor de SMS / Email para Pago Móvil
    serverApp.post('/api/sms-payment', (req, res) => {
        const data = req.body;
        console.log('📩 Recepción de notificación de pago:', data);

        let payment = null;

        // Caso 1: Envío directo desde Script (ya procesado)
        if (data.amount && data.reference) {
            payment = {
                amount: parseFloat(data.amount),
                reference: data.reference,
                bank: data.bank || 'Banesco/Gmail',
                rawText: data.text || 'Pago desde iPhone/Gmail'
            };
        } 
        // Caso 2: Envío de SMS crudo para procesar localmente
        else if (data.text) {
            payment = parseSMSPayment(data.text, data.from);
        }

        if (payment && payment.amount > 0) {
            // Verificar duplicados
            if (isDuplicatePayment(payment.reference)) {
                console.log(`⚠️ Pago duplicado ignorado. Ref: ${payment.reference}`);
                return res.json({ success: true, message: 'Pago duplicado detectado anteriormente', duplicate: true });
            }

            console.log(`💰 Pago Detectado: ${payment.amount} Bs [${payment.bank}] Ref: ${payment.reference}`);
            
            // 1. Notificar a los dispositivos móviles conectados
            if (io) io.emit('payment-detected', payment);
            
            // 2. Notificar a la ventana principal de la PC
            if (mainWindow) mainWindow.webContents.send('payment-detected', payment);

            // 3. (OPCIONAL) Notificar al iPhone del dueño vía Hook/Push
            // NOTA: El usuario puede poner su URL de Hook en la configuración
            res.json({ success: true, payment });
        } else {
            res.status(400).json({ success: false, message: 'No se detectó pago válido' });
        }
    });

    // Route for app installation landing page
    serverApp.get('/download', (req, res) => {
        res.sendFile(path.join(__dirname, 'download.html'));
    });

    // Serve Windows installer files from dist_FINAL
    serverApp.use('/dist', express.static(path.join(__dirname, 'dist_FINAL')));

    // DASHBOARD REMOTO: Página web para el dueño del negocio
    serverApp.get('/dashboard', (req, res) => {
        res.sendFile(path.join(__dirname, 'dashboard.html'));
    });

    // DASHBOARD API: Datos en tiempo real
    let lastDashboardData = null;
    serverApp.get('/api/dashboard-data', (req, res) => {
        res.json(lastDashboardData || { today: { totalVES: 0, totalUSD: 0, tickets: 0, items: 0 }, recentSales: [], alerts: { lowStock: [], outOfStock: [] }, inventory: { total: 0 } });
    });

    serverApp.get('/api/boss/config', (req, res) => {
        const userSettings = getPersistentSettings();
        res.json({
            supabaseUrl: userSettings.supabaseUrl || '',
            supabaseKey: userSettings.supabaseKey || ''
        });
    });

    // BOSS API: Summary (usa datos del renderer)
    serverApp.get('/api/boss/summary', (req, res) => {
        res.json(lastDashboardData || { today: { totalVES: 0, totalUSD: 0, tickets: 0, items: 0 }, recentSales: [], alerts: { lowStock: [], outOfStock: [] }, inventory: { total: 0 } });
    });

    // BOSS API: Auth (PIN verificación)
    const bossPinPath = path.join(app.getPath('userData'), 'boss_pin.json');
    serverApp.post('/api/boss/auth', (req, res) => {
        const { pin } = req.body;
        let storedPin = '0000';
        try {
            const data = JSON.parse(fs.readFileSync(bossPinPath, 'utf8'));
            storedPin = data.pin;
        } catch(e) {}
        if (pin === storedPin) {
            res.json({ success: true, token: Date.now().toString(36) });
        } else {
            res.json({ success: false });
        }
    });

    // BOSS API: Sales (directo de SQLite)
    serverApp.get('/api/boss/sales', async (req, res) => {
        try {
            const settings = getPersistentSettings();
            const sales = await dbApi.getSales(settings.storeId || '', 300);
            const parsed = sales.map(s => {
                if (typeof s.items === 'string') {
                    try { s.items = JSON.parse(s.items); } catch(e) { s.items = []; }
                }
                return s;
            });
            res.json(parsed);
        } catch(e) {
            console.error('Boss API sales error:', e.message);
            res.json([]);
        }
    });

    // BOSS API: Inventory (directo de SQLite)
    serverApp.get('/api/boss/inventory', async (req, res) => {
        try {
            const settings = getPersistentSettings();
            const products = await dbApi.getProducts(settings.storeId || '');
            res.json(products);
        } catch(e) {
            console.error('Boss API inventory error:', e.message);
            res.json([]);
        }
    });

    // BOSS API: Credits (directo de SQLite)
    serverApp.get('/api/boss/credits', async (req, res) => {
        try {
            const settings = getPersistentSettings();
            const credits = await dbApi.getCredits(settings.storeId || '');
            res.json(credits);
        } catch(e) {
            console.error('Boss API credits error:', e.message);
            res.json([]);
        }
    });

    // BOSS API: Update product remotely
    serverApp.post('/api/boss/update-product', async (req, res) => {
        try {
            const settings = getPersistentSettings();
            const product = req.body;
            await dbApi.saveProduct(settings.storeId || '', product);
            // Notificar al POS para que recargue
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('product-updated-remote', product);
            }
            res.json({ success: true });
        } catch(e) {
            console.error('Boss API update-product error:', e.message);
            res.json({ success: false, error: e.message });
        }
    });

    // Recibir datos del renderer
    ipcMain.on('dashboard-data', (event, data) => {
        lastDashboardData = data;
        if (io) io.emit('dashboard-update', data);

        // CLOUD SYNC: Enviar snapshot a Supabase
        if (cloudSync && cloudSync.enabled && data.today) {
            cloudSync.pushSnapshot({
                totalVES: data.today.totalVES || 0,
                totalUSD: data.today.totalUSD || 0,
                tickets: data.today.tickets || 0,
                itemsSold: data.today.items || 0,
                totalCostUSD: data.today.totalCostUSD || 0,
                exchangeRate: data.exchangeRate || 0,
                productsCount: data.inventory?.total || 0,
                lowStockCount: (data.alerts?.lowStock || []).length,
                outOfStockCount: (data.alerts?.outOfStock || []).length,
                pendingCredits: data.credits?.pending || 0,
                recentSales: data.recentSales || []
            }).catch(e => console.error('[CLOUD-SYNC] Snapshot error:', e.message));
        }
    });

    // ==========================================
    // Endpoints para prueba de pago tarjeta + impresora
    // ==========================================
    serverApp.get('/api/usb-devices', (req, res) => {
        const { execSync } = require('child_process');
        try {
            const raw = execSync('powershell "Get-PnpDevice | Where-Object {$_.InstanceId -like \'*0E8D*\'} | Select-Object FriendlyName, InstanceId | ConvertTo-Json -Compress"', { timeout: 5000, encoding: 'utf8', shell: 'powershell.exe' });
            const parsed = JSON.parse(raw.trim());
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            res.json(arr.map(function(d) { return { name: d.FriendlyName || 'Sunmi P3', vid: '0E8D', pid: '201C', driver: 'WinUSB' }; }));
        } catch(e) {
            res.json([{ name: 'Sunmi P3', vid: '0E8D', pid: '201C', driver: 'WinUSB', note: 'deteccion estatica' }]);
        }
    });

    serverApp.get('/api/default-printer', (req, res) => {
        const { execSync } = require('child_process');
        try {
            const raw = execSync('powershell "(Get-CimInstance Win32_Printer -Filter \'Default=$true\').Name"', { timeout: 5000, encoding: 'utf8', shell: 'powershell.exe' });
            res.json({ name: raw.trim() || 'Impresora termica (por defecto)' });
        } catch(e) {
            res.json({ name: 'Impresora termica (por defecto del sistema)' });
        }
    });

    // Servir pagina de prueba de pago con tarjeta
    serverApp.use('/prueba', express.static(path.join(__dirname)));

    const server = http.createServer(serverApp);
    io = new Server(server, {
        maxHttpBufferSize: 1e8, // Allow up to 100MB payloads for images
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        allowEIO3: true,
        pingTimeout: 60000,
        pingInterval: 25000
    });

    io.on('connection', (socket) => {
        console.log('📱 Dispositivo móvil conectado:', socket.id);
        
        // ENVÍO INSTANTÁNEO: Si tenemos productos en cache, enviarlos de inmediato
        if (lastSyncedProducts) {
            console.log('⚡ Enviando menú instantáneo desde cache...');
            socket.emit('products-updated', lastSyncedProducts);
        }

        // Notificar a la PC que hay un nuevo cliente para que envíe los productos (por si acaso hay cambios)
        if (mainWindow) {
            mainWindow.webContents.send('request-sync');
        }
        
        socket.on('request-sync', () => {
            console.log('🔄 El móvil solicitó actualización del menú.');
            if (lastSyncedProducts) {
                socket.emit('products-updated', lastSyncedProducts);
            }
            if (mainWindow) {
                mainWindow.webContents.send('request-sync');
            }
        });
        
        socket.on('new-order', (orderData) => {
            console.log('Pedido recibido del móvil:', orderData);
            // Reenviar el pedido al proceso de renderizado de la PC
            if (mainWindow) {
                mainWindow.webContents.send('incoming-order', orderData);
            }
        });

        socket.on('disconnect', () => {
            console.log('Dispositivo móvil desconectado');
        });
    });



    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`❌ Puerto ${serverPort} ocupado. Reintentando limpieza...`);
            killPortProcess(serverPort);
            setTimeout(() => server.listen(serverPort, '0.0.0.0'), 1000);
        } else {
            console.error('❌ Error en el servidor POS:', e.message);
        }
    });

    server.listen(serverPort, '0.0.0.0', async () => {
        console.log(`🚀 Servidor POS escuchando en puerto ${serverPort} (All Interfaces)`);
        
        // Publicar IP local inicial en la nube
        updateDiscovery(getLocalIP(), null);

        startTunnelChain();
    });
}

let tunnelProcess = null;

// Crear un entorno limpio SIN ELECTRON_RUN_AS_NODE para procesos hijos
function cleanEnv() {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}

function notifyTunnel(url, provider) {
    currentTunnelUrl = url;
    console.log(`✅ Túnel ${provider} establecido: ${url}`);
    
    // Obtener settings para saber si es un dominio estático
    const settings = getPersistentSettings();
    const isStatic = settings.ngrokDomain && url.includes(settings.ngrokDomain);

    // Actualizar descubrimiento en la nube
    updateDiscovery(getLocalIP(), url);

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tunnel-info', { 
            url, 
            provider,
            isStatic: !!isStatic 
        });
    }
}


// ──── MÉTODO 1: CLOUDFLARE (Auth Tunnel o Quick Tunnel) ────
async function tryCloudflare() {
    return new Promise((resolve) => {
        const userSettings = getPersistentSettings();
        let cfToken = userSettings.cloudflareToken;

        if (cfToken) {
            // Limpieza automática y robusta del token de Cloudflare
            const match = cfToken.match(/(eyJh[A-Za-z0-9_-]+)/);
            if (match) {
                cfToken = match[1];
            } else {
                cfToken = cfToken.trim();
            }

            console.log('☁️  Iniciando Cloudflare Tunnel Autenticado (Dominio Propio)...');
            const cf = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${serverPort}`, 'run', '--token', cfToken], {
                env: cleanEnv(),
                stdio: ['ignore', 'pipe', 'pipe']
            });
            tunnelProcess = cf;

            // Al ser autenticado, asumimos que el dominio configurado por el usuario es el target
            const domain = userSettings.cloudflareDomain || 'puntopila.emprende.ve';
            const url = `https://${domain}`;
            
            cf.stdout.on('data', (data) => {
                console.log(`[CLOUDFLARE-AUTH] ${data.toString().trim()}`);
            });
            cf.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                console.error(`[CLOUDFLARE-AUTH-ERR] ${msg}`);
                if (msg.includes('Registered tunnel connector')) {
                    console.log('✅ [CLOUDFLARE-AUTH] Túnel autenticado registrado y activo');
                }
            });

            // Damos unos segundos para que conecte y notificamos
            setTimeout(() => {
                notifyTunnel(url, 'cloudflare-auth');
                resolve(true);
            }, 6000);

            cf.on('close', (code) => {
                console.log(`🔌 Túnel Cloudflare Autenticado cerrado (Código: ${code}).`);
                currentTunnelUrl = null;
                setTimeout(startTunnelChain, 5000);
            });
        } else {
            console.log('☁️  Intentando Cloudflare Quick Tunnel (URL Aleatoria)...');
            console.log('🔍 Bin path:', bin, '| exists:', fs.existsSync(bin));
            const cf = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${serverPort}`], {
                env: cleanEnv(),
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: false
            });
            tunnelProcess = cf;

            let found = false;
            const timeout = setTimeout(() => {
                if (!found) {
                    console.log('⏳ Cloudflare Quick Tunnel no respondió a tiempo.');
                    cf.kill();
                    resolve(false);
                }
            }, 35000);

        const check = (data) => {
            const text = data.toString();
            const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
            if (match && !found) {
                found = true;
                clearTimeout(timeout);
                
                // Esperar 5 segundos para asegurar que los servidores Edge de Cloudflare se enruten antes de publicar (evita error 1033)
                setTimeout(() => {
                    notifyTunnel(match[0], 'cloudflare');
                    resolve(true);
                }, 5000);
            }
        };

        cf.stderr.on('data', check);
        cf.stdout.on('data', check);
        cf.on('error', () => { clearTimeout(timeout); resolve(false); });
        
        cf.on('close', (code) => { 
            if (!found) { 
                clearTimeout(timeout); 
                resolve(false); 
            } else {
                // Si ya estaba funcionando y se cierra, reiniciar la cadena
                console.log(`🔌 Túnel Cloudflare cerrado (Código: ${code}). Reintentando...`);
                currentTunnelUrl = null;
                setTimeout(startTunnelChain, 5000); // Esperar 5s antes de reintentar
            }
        });
        }
    });
}

// ──── MÉTODO 2: SERVEO (ssh, sin contraseña) ────
async function tryServeo() {
    return new Promise((resolve) => {
        console.log('🔗 Intentando Serveo (Link Permanente)...');
        const serveo = spawn('ssh', [
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'ServerAliveInterval=30',
            '-R', `puntopila-cajafresh:80:127.0.0.1:${serverPort}`,
            'serveo.net'
        ], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

        tunnelProcess = serveo;

        let found = false;
        const timeout = setTimeout(() => {
            if (!found) {
                console.log('⏳ Serveo no respondió a tiempo.');
                serveo.kill();
                resolve(false);
            }
        }, 15000);

        const check = (data) => {
            const text = data.toString();
            const match = text.match(/https:\/\/[a-z0-9-]+\.serveousercontent\.com/i);
            if (match && !found) {
                found = true;
                clearTimeout(timeout);
                notifyTunnel(match[0], 'serveo'); 
                resolve(true);
            }
        };

        serveo.stderr.on('data', check);
        serveo.stdout.on('data', check);
        serveo.on('error', () => { clearTimeout(timeout); resolve(false); });
        serveo.on('close', () => { if (!found) { clearTimeout(timeout); resolve(false); } });
    });
}

// ──── MÉTODO 3: LOCALTUNNEL (con subdominio fijo para APK) ────
async function tryLocaltunnel() {
    return new Promise(async (resolve) => {
        try {
            console.log('🔗 Intentando Localtunnel (Link Permanente)...');
            const tunnel = await localtunnel({ 
                port: serverPort, 
                subdomain: 'puntopila-pos' 
            });

            tunnel.on('error', (err) => {
                console.error('❌ Error de conexión en Localtunnel:', err.message);
            });

            tunnel.on('close', () => {
                console.log('🔌 Localtunnel cerrado.');
                currentTunnelUrl = null;
                startTunnelChain(); 
            });

            // Obtener IP pública para el bypass
            const publicIP = await getPublicIP();
            console.log(`✅ Túnel alternativo establecido: ${tunnel.url}`);
            console.log(`🔑 Contraseña de bypass: ${publicIP}`);

            notifyTunnel(tunnel.url, 'localtunnel');
            // Enviar IP por websocket para auto-clicker
            if (io) io.emit('tunnel-bypass', publicIP);

            resolve(true);
        } catch (err) {
            console.error('❌ Error en Localtunnel:', err.message);
            resolve(false);
        }
    });
}
// ──── MÉTODO 4: NGROK (Respaldo Máximo) ────
function getPersistentSettings() {
    try {
        const filePath = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading settings for tunnel:', e);
    }
    return {};
}

async function tryNgrok() {
    return new Promise(async (resolve) => {
        try {
            const userSettings = getPersistentSettings();
            const token = userSettings.ngrokAuthToken;
            const domain = userSettings.ngrokDomain || 'puntopila.emprende.ve';

            if (!token) {
                console.log('⚠️ Ngrok no configurado (falta token).');
                return resolve(false);
            }

            console.log('🔗 Intentando Ngrok...');
            // Matar cualquier sesión previa del wrapper para evitar "tunnel already exists"
            try { await ngrok.kill(); } catch(e) {}

            const connectOptions = {
                addr: serverPort,
                proto: 'http',
                authtoken: token
            };

            if (domain) {
                console.log(`🌐 Usando dominio estático: ${domain}`);
                connectOptions.domain = domain;
                // También agregamos hostname por si el wrapper es más antiguo
                connectOptions.hostname = domain;
            }

            const url = await ngrok.connect(connectOptions);
            console.log(`✅ Túnel Ngrok establecido: ${url}`);
            notifyTunnel(url, 'ngrok');
            resolve(true);
        } catch (err) {
            console.error('❌ Error en Ngrok:', err.message);
            resolve(false);
        }
    });
}


// ──── CADENA DE INTENTOS ────

async function startTunnelChain() {
    if (isStartingTunnel) {
        console.log('⏳ Ya hay un intento de túnel en curso, ignorando...');
        return;
    }
    isStartingTunnel = true;

    console.log('--- 🚀 INICIANDO TÚNEL REMOTO ---');

    try {
        // 1. Matar procesos huérfanos de forma SÍNCRONA para evitar errores 3200 de Ngrok
        try {
            const { execSync } = require('child_process');
            if (/^win/.test(process.platform)) {
                try { execSync('taskkill /F /IM cloudflared.exe /T', { stdio: 'ignore' }); } catch(e) {}
                try { execSync('taskkill /F /IM ssh.exe /T', { stdio: 'ignore' }); } catch(e) {}
                try { execSync('taskkill /F /IM ngrok.exe /T', { stdio: 'ignore' }); } catch(e) {}
                try { execSync('taskkill /F /IM lt.exe /T', { stdio: 'ignore' }); } catch(e) {}
            } else {
                try { execSync('killall -9 cloudflared ssh ngrok lt', { stdio: 'ignore' }); } catch(e) {}
            }
        } catch (e) {}

        // Pausa garantizada para que el SO libere los recursos
        await new Promise(r => setTimeout(r, 2000));

        const userSettings = getPersistentSettings();
        
        // 1. Ngrok (Si hay token)
        if (userSettings.ngrokAuthToken) {
            if (await tryNgrok()) { isStartingTunnel = false; return; }
        }

        // 2. Cloudflare (Muy estable, sin bypass)
        if (await tryCloudflare()) { isStartingTunnel = false; return; }
        if (currentTunnelUrl) { isStartingTunnel = false; return; }

        // 3. Serveo
        if (await tryServeo()) { isStartingTunnel = false; return; }
        if (currentTunnelUrl) { isStartingTunnel = false; return; }

        // 4. Localtunnel (Último recurso)
        if (await tryLocaltunnel()) { isStartingTunnel = false; return; }
        if (currentTunnelUrl) { isStartingTunnel = false; return; }

        // Fallback final: Intentar Ngrok básico
        if (!userSettings.ngrokAuthToken) {
            await tryNgrok();
        }
    } finally {
        isStartingTunnel = false;
    }
}

let _createWindowCount = 0;
function createWindow() {
    _createWindowCount++;
    logStartup(`🏗️ createWindow() called (#${_createWindowCount})`);
    if (_createWindowCount > 1) {
        logStartup(`⚠️ WARNING: createWindow called ${_createWindowCount} times! Stack: ${new Error().stack?.split('\n').slice(2,6).join(' | ')}`);
    }
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: "Caja Fresh POS Server",
        icon: path.join(__dirname, 'icon.ico'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[RENDERER] [lvl:${level}] [${sourceId}:${line}] ${message}`);
    });

    mainWindow.webContents.on('did-navigate', (event, url, httpResponseCode, httpStatusText) => {
        logStartup(`🌐 NAVIGATION: window navigated to "${url}" (${httpResponseCode} ${httpStatusText})`);
    });
    mainWindow.webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
        if (isMainFrame) logStartup(`🌐 IN-PAGE NAV: window navigated to "${url}"`);
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.maximize();

    mainWindow.webContents.on('did-finish-load', async () => {
        const ip = getLocalIP();
        const storeId = await licenseSystem.getStoreId();
        const businessId = storeId && storeId !== 'demo_store' ? `puntopila_pos_${storeId}` : 'cajafresh_pos_v2_778899_remote';
        
        const mobileUrl = `http://${ip}:${serverPort}/mobile#bid=${businessId}`;
        const qrData = await QRCode.toDataURL(mobileUrl);
        
        mainWindow.webContents.send('server-info', { ip, port: serverPort, url: mobileUrl, qr: qrData, bid: businessId });
        
        // Si el túnel ya estaba listo, enviarlo también
        if (currentTunnelUrl) {
            const isCloudflare = currentTunnelUrl.includes('cloudflare');
            if (isCloudflare) {
                mainWindow.webContents.send('tunnel-info', { url: currentTunnelUrl, provider: 'cloudflare', bid: businessId });
            } else {
                getPublicIP().then(ip => {
                    mainWindow.webContents.send('tunnel-info', { 
                        url: currentTunnelUrl, 
                        provider: 'localtunnel',
                        publicIP: ip,
                        bid: businessId
                    });
                });
            }
        }
    });
}

// ==========================================
// SISTEMA DE LICENCIAMIENTO REMOTO
// Google Sheets + Google Apps Script (Gratis)
// ==========================================

let activationWindow = null;

function createActivationWindow() {
    activationWindow = new BrowserWindow({
        width: 680,
        height: 720,
        resizable: true,
        frame: true,
        title: 'Punto Pila POS — Activación',
        icon: path.join(__dirname, 'icon.ico'),
        autoHideMenuBar: true,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    activationWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[ACTIVATION-RENDERER] [lvl:${level}] [${sourceId}:${line}] ${message}`);
    });
    activationWindow.loadFile(path.join(__dirname, 'activation.html'));
}

// (Duplicate license-get-id handler removed)
// IPC: el frontend envía la clave para activar
ipcMain.handle('license-activate', async (event, key, storeName) => {
    // Valida la clave (local HMAC + heartbeat remoto opcional)
    const result = await licenseSystem.activateLicense(key, storeName);
    // Auto-configurar el Supabase del proveedor para este cliente
    autoConfigVendorCloud(result.storeId, storeName || result.clientName);
    return result;
});

// IPC: obtener estado actual (para el cuadro de trial)
ipcMain.handle('license-get-status', async () => {
    return await licenseSystem.checkLicense();
});

// IPC: abrir pantalla de activación manualmente
ipcMain.on('open-activation', () => {
    if (!activationWindow || activationWindow.isDestroyed()) {
        createActivationWindow();
    } else {
        activationWindow.focus();
    }
});

// IPC: Sincronización manual/forzada de licencia
ipcMain.handle('license-force-check', async () => {
    const check = await licenseSystem.checkLicense(true);
    if (!check.valid && (check.reason === 'REVOKED' || check.reason === 'EXPIRED')) {
        // Bloqueo detectado -> Reiniciar app para que el middleware de arranque lo atrape
        app.relaunch();
        app.exit();
    }
    return check;
});

// IPC: Activación exitosa — cerrar pantalla y abrir POS
ipcMain.on('license-activated', () => {
    if (activationWindow && !activationWindow.isDestroyed()) {
        activationWindow.close();
        activationWindow = null;
    }
    initWhatsApp();
    startServer();
    createWindow();
    setTimeout(initCloudSync, 3000);
});

// ==========================================
// AUTO UPDATER (GitHub Releases)
// ==========================================
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'available', info: info });
    }
});
autoUpdater.on('update-not-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'not-available' });
    }
});
autoUpdater.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'error', error: err.message });
    }
});
autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'downloading', progress: progressObj });
    }
});
autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'downloaded', info: info });
    }
});

ipcMain.on('check-for-updates', () => {
    try {
        autoUpdater.checkForUpdates();
    } catch(err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-status', { status: 'error', error: err.message });
        }
    }
});
ipcMain.on('download-update', () => {
    try {
        autoUpdater.downloadUpdate();
    } catch(err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-status', { status: 'error', error: err.message });
        }
    }
});
ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

app.whenReady().then(async () => {
    // Inicializar Base de Datos
    try {
        await initDatabase(app.getPath('userData'));
    } catch (err) {
        dialog.showErrorBox('Error Fatal', 'No se pudo inicializar la base de datos: ' + err.message);
        app.quit();
        return;
    }

    // ── Migrar datos huérfanos (NULL/empty store_id) al store actual ──
    try {
        const storeSettings = getPersistentSettings();
        if (storeSettings && storeSettings.storeId) {
            await migrateOrphanData(storeSettings.storeId);
        }
    } catch (e) {
        console.error('[MIGRATE] Error migrando datos huérfanos:', e.message);
    }

    // ── Verificar licencia antes de abrir el POS ────────────
    const licCheck = await licenseSystem.checkLicense();
    
    if (!licCheck.valid) {
        // Sin licencia válida → mostrar pantalla de activación
        console.log(`[LICENSE] Acceso denegado: ${licCheck.reason}`);
        createActivationWindow();

        // Si fue revocada o expirada, mostrar el motivo visualmente
        if (licCheck.reason !== 'NO_LICENSE') {
            const motivos = {
                'REVOKED': 'Tu licencia ha sido suspendida. Contacta a tu proveedor de Caja Fresh.',
                'EXPIRED': 'Tu licencia ha vencido. Contacta a tu proveedor para renovarla.',
                'GRACE_EXPIRED': 'El período de gracia sin internet ha expirado (7 días). Conecta este equipo a internet para validar tu licencia.',
                'MACHINE_MISMATCH': 'Error de identidad de equipo. Contacta soporte técnico.',
            };
            dialog.showErrorBox(
                'Licencia Requerida',
                motivos[licCheck.reason] || `Código de error: ${licCheck.reason}`
            );
        }
        return; // POS no arrancará hasta que se active
    }

    // Aviso si está en modo offline con período de gracia
    if (licCheck.grace) {
        dialog.showMessageBox(null, {
            type: 'warning',
            title: 'Modo Sin Conexión',
            message: `Tu licencia no pudo verificarse en línea.\nTienes ${licCheck.daysLeft} días restantes para conectarte a internet y validarla.`,
            buttons: ['Entendido']
        });
    }

    // AVISO DE COBRO: Últimos 15 Días
    if (licCheck.warningDaysLeft !== undefined && licCheck.warningDaysLeft !== null) {
        dialog.showMessageBox(null, {
            type: 'warning',
            title: 'Suscripción por Vencer',
            message: `Aviso Importante:\n\nTu período de prueba o licencia expirará definitivamente en ${licCheck.warningDaysLeft} días.\n\nPara evitar que se bloquee el sistema y pierdas el acceso de venta, contacta inmediatamente a tu proveedor de Caja Fresh para realizar el pago e ingresar tu nueva subscripción de $100 USD anuales.`,
            buttons: ['Aceptar y Continuar']
        });
    }

    // Licencia válida → arrancar todo normalmente
    console.log(`[LICENSE] Acceso concedido. Cliente: ${licCheck.clientName || 'Desconocido'}`);
    createDesktopShortcut();
    initWhatsApp();
    startServer();
    createWindow();
    setTimeout(initCloudSync, 3000);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Enviar actualizaciones de stock/productos a los móviles conectados
ipcMain.on('sync-products', (event, data) => {
    try {
        if (!io) {
            console.warn("⚠️ Intento de sincronización pero Socket.io no está listo.");
            return;
        }

        if (!data) {
            console.error("❌ Recibido data null en sync-products.");
            return;
        }

        // SI CAMBIÓ LA SUCURSAL, DESCARTAR EL CACHE ANTERIOR COMPLETAMENTE
        if (lastSyncedProducts && lastSyncedProducts.storeId !== data.storeId) {
            console.log(`🔄 Cambio de sucursal detectado (${lastSyncedProducts.storeId} -> ${data.storeId}). Descartando cache anterior.`);
            lastSyncedProducts = null;
        }

        // Si la carga inicial del renderer terminó (isLoaded === true), confiamos plenamente
        // en lo que mande el cliente, incluso si es una lista vacía de productos.
        if (data.isLoaded) {
            console.log(`📦 Sincronización autorizada tras carga inicial: ${data.products ? data.products.length : 0} productos.`);
            lastSyncedProducts = data;
        } else if (data.products && data.products.length > 0) {
            console.log(`📦 Cache actualizado: ${data.products.length} productos listos para móviles.`);
            lastSyncedProducts = data;
        } else {
            console.warn("⚠️ Sincronización recibida sin productos antes de terminar la carga.");
            if (lastSyncedProducts) {
                // Conservar productos del cache anterior
                data.products = lastSyncedProducts.products;
            } else {
                data.products = [];
                lastSyncedProducts = data;
            }
        }
        
        io.emit('products-updated', data);
    } catch (error) {
        console.error("❌ Error CRÍTICO en sync-products listener:", error);
    }
});

// Generar QR remoto bajo demanda
ipcMain.on('generate-remote-qr', async (event, url) => {
    try {
        const qrData = await QRCode.toDataURL(url);
        event.sender.send('remote-qr', qrData);
    } catch (err) {
        console.error('Error generando QR remoto:', err);
    }
});

// Generar QR de descarga bajo demanda
ipcMain.on('generate-download-qr', async (event, url) => {
    try {
        const qrData = await QRCode.toDataURL(url);
        event.sender.send('download-qr', qrData);
    } catch (err) {
        console.error('Error generando QR de descarga:', err);
    }
});

// IPC handler for WhatsApp PDF sending (Professional)
ipcMain.handle('whatsapp-send-pdf', async (event, { phone, base64Data, filename }) => {
    if (!isWhatsappReady) {
        return { success: false, error: 'WhatsApp no está conectado. Escanea el QR.' };
    }
    
    try {
        // Verificar estado real antes de enviar
        const state = await whatsappClient.getState();
        if (state !== 'CONNECTED') {
            logWA(`❌ Intento de envío PDF pero estado real = ${state}`);
            isWhatsappReady = false;
            updateWAStatus({ status: 'disconnected', error: 'Sesión expirada' });
            return { success: false, error: `WhatsApp desconectado. Escanea el QR.` };
        }

        const { MessageMedia } = require('whatsapp-web.js');
        const cleanBase64 = base64Data.split(',')[1] || base64Data;
        const media = new MessageMedia('application/pdf', cleanBase64, filename);
        
        const target = phone.includes('@') ? phone : `${phone}@c.us`;
        logWA(`📄 Enviando PDF a ${target}: ${filename}`);
        await whatsappClient.sendMessage(target, media, { sendMediaAsDocument: true });
        logWA(`✅ PDF enviado a ${phone}: ${filename}`);
        return { success: true };
    } catch (error) {
        logWA(`❌ Error enviando PDF: ${error.message}`);
        
        // AUTO-RESTART si ocurre el error fatal de Chromium (Detached Frame o Target Closed)
        if (error.message.includes('detached Frame') || error.message.includes('Session closed') || error.message.includes('Target closed')) {
            logWA('🚨 CRASH FATAL DETECTADO (Puppeteer). Reiniciando motor automáticamente...');
            isWhatsappReady = false;
            updateWAStatus({ status: 'error', error: 'El navegador interno colapsó. Reiniciando...' });
            setTimeout(() => { initWhatsApp(); }, 2000);
            return { success: false, error: 'Motor colapsado. Se está reiniciando espere.' };
        }

        if (error.message.includes('not ready') || error.message.includes('UNPAIRED')) {
            isWhatsappReady = false;
            updateWAStatus({ status: 'disconnected', error: 'Sesión perdida al enviar PDF' });
        }
        return { success: false, error: error.message };
    }
});

// IPC handler for WhatsApp background sending
ipcMain.handle('whatsapp-send-report', async (event, { phone, message }) => {
    if (!isWhatsappReady) {
        return { success: false, error: 'WhatsApp no está conectado. Escanea el QR.' };
    }
    
    try {
        // Verificar estado real antes de enviar
        const state = await whatsappClient.getState();
        if (state !== 'CONNECTED') {
            logWA(`❌ Intento de envío pero estado real = ${state}`);
            isWhatsappReady = false;
            updateWAStatus({ status: 'disconnected', error: 'Sesión expirada' });
            return { success: false, error: `WhatsApp desconectado (${state}). Escanea el QR de nuevo.` };
        }

        const target = phone.includes('@') ? phone : `${phone}@c.us`;
        logWA(`📨 Enviando mensaje a ${target}...`);
        await whatsappClient.sendMessage(target, message);
        logWA(`✅ Mensaje enviado exitosamente a ${phone}`);
        return { success: true };
    } catch (error) {
        logWA(`❌ Error enviando mensaje: ${error.message}`);
        
        // AUTO-RESTART si ocurre el error fatal de Chromium (Detached Frame o Target Closed)
        if (error.message.includes('detached Frame') || error.message.includes('Session closed') || error.message.includes('Target closed')) {
            logWA('🚨 CRASH FATAL DETECTADO (Puppeteer). Reiniciando motor automáticamente...');
            isWhatsappReady = false;
            updateWAStatus({ status: 'error', error: 'El navegador interno colapsó. Reiniciando...' });
            
            // Ejecutar reinicio en background sin bloquear
            setTimeout(() => {
                initWhatsApp(); // Esto destruirá el roto y creará uno nuevo
            }, 2000);
            
            return { success: false, error: 'Motor colapsado. Se está reiniciando, vuelve a intentarlo en 10 segundos.' };
        }
        
        // Si el error indica desconexión normal
        if (error.message.includes('not ready') || error.message.includes('UNPAIRED') || error.message.includes('not logged')) {
            isWhatsappReady = false;
            updateWAStatus({ status: 'disconnected', error: 'Sesión perdida al enviar' });
        }
        return { success: false, error: error.message };
    }
});

// IPC Handlers for Persistence
ipcMain.handle('save-data', async (event, { filename, data }) => {
    try {
        const filePath = path.join(app.getPath('userData'), filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return { success: true };
    } catch (err) {
        console.error(`Error guardando ${filename}:`, err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('load-data', async (event, { filename }) => {
    try {
        const filePath = path.join(app.getPath('userData'), filename);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return { success: true, data: JSON.parse(data) };
        }
        return { success: true, data: null };
    } catch (err) {
        console.error(`Error cargando ${filename}:`, err);
        return { success: false, error: err.message };
    }
});

ipcMain.on('request-discovery-update', () => {
    updateDiscovery(getLocalIP(), currentTunnelUrl);
});

ipcMain.on('request-tunnel-info', (event) => {
    event.reply('tunnel-info', { url: currentTunnelUrl, localIP: getLocalIP() });
});

async function restartTunnelsHelper() {
    console.log('🔄 Reiniciando túneles...');
    try {
        if (tunnelProcess) {
            tunnelProcess.kill();
            tunnelProcess = null;
        }
        // Para Ngrok específicamente
        await ngrok.kill();
        currentTunnelUrl = null;
        isStartingTunnel = false; // Reset flags to allow starting
        startTunnelChain();
    } catch (e) {
        console.error('Error reiniciando túneles:', e);
    }
}

ipcMain.on('restart-tunnels', restartTunnelsHelper);

// IPC handler for silent printing
// IPC Handler: Selección de imagen de fondo para el móvil
ipcMain.handle('select-mobile-bg', async (event) => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Imágenes', extensions: ['jpg', 'png', 'jpeg', 'webp'] }
            ]
        });

        if (result.canceled || result.filePaths.length === 0) return null;

        const sourcePath = result.filePaths[0];
        const ext = path.extname(sourcePath);
        const destPath = path.join(__dirname, 'mobile', `custom_bg${ext}`);
        
        // Copiar archivo de forma sincrónica para seguridad
        fs.copyFileSync(sourcePath, destPath);
        
        console.log(`🖼️ Imagen de fondo móvil actualizada: ${destPath}`);
        return `custom_bg${ext}?v=${Date.now()}`; // Retornar con cache-buster
    } catch (err) {
        console.error('❌ Error seleccionando imagen de fondo:', err);
        return null;
    }
});

ipcMain.handle('print-ticket', async (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        win.webContents.print({
            silent: true,
            printBackground: false,
            color: false,
            margins: { marginType: 'none' }
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Fiscal Printer: Write file to IntiPOS spooler folder
ipcMain.handle('write-fiscal-file', async (event, spoolerPath, filename, content) => {
    try {
        if (!fs.existsSync(spoolerPath)) {
            fs.mkdirSync(spoolerPath, { recursive: true });
        }
        const fullPath = path.join(spoolerPath, filename);
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`[FISCAL] Archivo escrito: ${fullPath}`);
        return { success: true, path: fullPath };
    } catch (error) {
        console.error('[FISCAL] Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('cloud-sync-configure', async (event, cfg) => {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        let settings = {};
        try {
            if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch(e) {}
        
        settings.supabaseUrl = cfg.supabaseUrl;
        settings.supabaseKey = cfg.supabaseKey;
        settings.storeId = cfg.storeId;
        settings.storeName = cfg.storeName;
        settings.brandName = cfg.brandName;
        settings.cloudflareToken = cfg.cloudflareToken;
        settings.cloudflareDomain = cfg.cloudflareDomain;
        
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        if (cloudSync) {
            cloudSync.configure(cfg);
            await cloudSync.registerStore();
            syncCatalogToCloud(cfg.storeId);
        }

        if (cfg.cloudflareToken) {
            restartTunnelsHelper();
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('cloud-sync-status', async () => {
    if (!cloudSync) return { enabled: false, storeId: null, url: null, supabaseKey: null };
    const base = cloudSync.getStatus ? cloudSync.getStatus() : {};
    return {
        ...base,
        enabled: cloudSync.enabled,
        storeId: cloudSync.storeId,
        url: cloudSync.supabaseUrl,
        supabaseKey: cloudSync.supabaseKey
    };
});

ipcMain.handle('cloud-sync-push-sale', async (event, saleData) => {
    const logFile = path.join(app.getPath('userData'), 'startup_debug.log');
    try {
        if (!cloudSync) {
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] [IPC] push-sale: cloudSync es NULL\n`);
            return { success: false, error: 'cloudSync no inicializado' };
        }
        if (!cloudSync.enabled) {
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] [IPC] push-sale: cloudSync DESHABILITADO (url=${!!cloudSync.supabaseUrl} key=${!!cloudSync.supabaseKey} storeId=${cloudSync.storeId})\n`);
            return { success: false, error: 'cloudSync deshabilitado' };
        }
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] [IPC] push-sale: Recibido ticket=${saleData.ticket || saleData.id} total=$${saleData.totalUSD || saleData.total || 0}\n`);
        await cloudSync.pushSale(saleData);
        return { success: true };
    } catch (e) {
        try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] [IPC] push-sale ERROR: ${e.message}\n`); } catch(_){}
        return { success: false, error: e.message };
    }
});

ipcMain.handle('cloud-sync-push-alerts', async (event, products) => {
    if (cloudSync && cloudSync.enabled) {
        await cloudSync.pushAlerts(products);
    }
});

ipcMain.handle('cloud-sync-push-expense', async (event, expenseData) => {
    if (cloudSync && cloudSync.enabled) {
        try {
            await cloudSync.pushExpense(expenseData);
            return { success: true };
        } catch (e) {
            console.error('[CLOUD-SYNC] Error pushing expense:', e.message);
            return { success: false, error: e.message };
        }
    }
    return { success: false, error: 'cloudSync no disponible' };
});

ipcMain.handle('cloud-sync-log', async (event, message) => {
    const logFile = path.join(app.getPath('userData'), 'startup_debug.log');
    try {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] [FRONTEND] ${message}\n`);
    } catch(e){}
});

ipcMain.handle('cloud-sync-push-live', async (event, cart, totals, view) => {
    if (cloudSync && cloudSync.enabled) {
        await cloudSync.pushLiveState(cart, totals, view);
    }
});

ipcMain.handle('cloud-sync-push-catalog', async (event, products) => {
    if (cloudSync && cloudSync.enabled) {
        await cloudSync.pushCatalog(products);
    }
});
ipcMain.handle('cloud-sync-push-transfer', async (event, t) => {
    if (cloudSync && cloudSync.enabled) await cloudSync.pushTransfer(t);
});
ipcMain.handle('cloud-sync-push-purchase-order', async (event, po) => {
    if (cloudSync && cloudSync.enabled) await cloudSync.pushPurchaseOrder(po);
});
ipcMain.handle('cloud-sync-get-warehouse-store-id', async () => {
    if (cloudSync && cloudSync.enabled) {
        return await cloudSync.getWarehouseStoreId();
    }
    return null;
});
ipcMain.handle('cloud-sync-approve-po', async (event, poId, items, fromStoreId) => {
    if (cloudSync && cloudSync.enabled) {
        const dbApi = require('./database.js');
        await cloudSync.approvePurchaseOrder(poId, items, fromStoreId, dbApi);
    }
});
ipcMain.handle('cloud-sync-receive-po', async (event, poId, items, toStoreId) => {
    if (cloudSync && cloudSync.enabled) {
        const dbApi = require('./database.js');
        await cloudSync.receivePurchaseOrder(poId, items, toStoreId, dbApi);
    }
});
ipcMain.handle('cloud-sync-get-warehouse-products', async () => {
    try {
        const settings = getPersistentSettings();
        if (!cloudSync || !cloudSync.enabled || !cloudSync.supabaseUrl || !cloudSync.supabaseKey) {
            return [];
        }
        const supabaseUrl = cloudSync.supabaseUrl;
        const supabaseKey = cloudSync.supabaseKey;
        const https = require('https');

        const fetchJson = (urlStr) => new Promise((resolve) => {
            const url = new URL(urlStr);
            const opts = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + supabaseKey,
                    'Accept': 'application/json'
                }
            };
            const req = https.request(opts, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve([]); } });
            });
            req.on('error', () => resolve([]));
            req.end();
        });

        const stores = await fetchJson(`${supabaseUrl}/rest/v1/stores?select=id&store_type=eq.warehouse`);
        if (!stores || stores.length === 0) return [];

        const allProducts = [];
        for (const s of stores) {
            const prods = await fetchJson(`${supabaseUrl}/rest/v1/store_products?store_id=eq.${s.id}&select=product_id,name,price,stock,category&order=name.asc`);
            if (prods && prods.length > 0) allProducts.push(...prods);
        }
        return allProducts;
    } catch(e) {
        return [];
    }
});

// ==========================================
// Sunmi P3 Integration
// ==========================================
const sunmiP3 = require('./integracion-sunmi.js');

ipcMain.handle('sunmi-get-status', async () => {
    const encontrado = await sunmiP3.detectar();
    return {
        conectado: encontrado,
        producto: encontrado ? sunmiP3.device.productName : null,
        fabricante: encontrado ? sunmiP3.device.manufacturerName : null,
        serial: encontrado ? sunmiP3.device.serialNumber : null
    };
});

ipcMain.handle('sunmi-start-monitoring', async () => {
    sunmiP3.iniciarMonitoreo(3000);
    sunmiP3.removeAllListeners('conectado');
    sunmiP3.removeAllListeners('desconectado');
    sunmiP3.on('conectado', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sunmi-status', { conectado: true, ...data });
        }
    });
    sunmiP3.on('desconectado', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sunmi-status', { conectado: false });
        }
    });
    const status = await sunmiP3.detectar();
    return { ok: true, conectado: status };
});

ipcMain.handle('sunmi-stop-monitoring', () => {
    sunmiP3.detenerMonitoreo();
    return { ok: true };
});

ipcMain.handle('test-print', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.print({ silent: true, printBackground: false, color: false, margins: { marginType: 'none' } });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: false, error: 'No window' };
});

// ── Auto-configurar Supabase del proveedor para un cliente nuevo ──
function autoConfigVendorCloud(storeId, storeName) {
    if (!storeId) return;
    if (!VENDOR_SUPABASE_URL || VENDOR_SUPABASE_URL.includes('TU_SUPABASE')) {
        console.log('[VENDOR] ⚠️ Credenciales del proveedor no configuradas en main.js');
        return;
    }

    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    let settings = {};
    try {
        if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch(e) {}

    // Solo sobreescribir si no tiene URL propia ya configurada
    if (!settings.supabaseUrl || settings.supabaseUrl.includes('TU_SUPABASE')) {
        settings.supabaseUrl = VENDOR_SUPABASE_URL;
        settings.supabaseKey = VENDOR_SUPABASE_KEY;
        settings.storeId    = storeId;
        if (storeName && !settings.storeName) settings.storeName = storeName;
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            console.log(`[VENDOR] ✅ Cloud configurado automáticamente para store: ${storeId}`);
        } catch(e) { console.error('[VENDOR] Error guardando settings:', e.message); }

        // Re-inicializar cloud sync con la nueva configuración
        if (cloudSync) {
            cloudSync.configure({
                supabaseUrl: VENDOR_SUPABASE_URL,
                supabaseKey: VENDOR_SUPABASE_KEY,
                storeId,
                storeName: storeName || 'Mi Tienda'
            });
            cloudSync.registerStore().catch(() => {});
            syncCatalogToCloud(storeId);
        }
    }
}

// Initialize cloud sync on startup
async function initCloudSync() {
    if (cloudSync) return;
    const settings = getPersistentSettings();

    // Si no hay URL configurada pero SÍ hay credenciales de proveedor,
    // usar el store_id de la licencia activa automáticamente.
    let supaUrl = settings.supabaseUrl || '';
    let supaKey = settings.supabaseKey || '';
    let storeId = settings.storeId || '';

    if ((!supaUrl || supaUrl.includes('TU_SUPABASE')) &&
        VENDOR_SUPABASE_URL && !VENDOR_SUPABASE_URL.includes('TU_SUPABASE')) {
        const licStoreId = licenseSystem.getStoreId();
        if (licStoreId) {
            supaUrl  = VENDOR_SUPABASE_URL;
            supaKey  = VENDOR_SUPABASE_KEY;
            storeId  = licStoreId;
            console.log(`[VENDOR] 🔗 Usando Supabase del proveedor para store: ${storeId}`);
        }
    }

    cloudSync = new CloudSync({
        supabaseUrl: supaUrl,
        supabaseKey: supaKey,
        storeId:     storeId,
        storeName:   settings.storeName || 'Mi Tienda',
        brandName:   settings.brandName || 'Caja Fresh',
        queuePath:   app.getPath('userData'),
        onStatusChange: (status) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('cloud-sync-status', status);
            }
        }
    });

    if (cloudSync.enabled) {
        cloudSync.registerStore();
        
        // Sincronización inicial: PULL (metadata) → PUSH (stock)
        try {
            logStartup('[CLOUD-SYNC] 🔄 Sincronizando catálogo inicial...');
            
            // 1. Siempre intentar traer lo último del Jefe (Precios, Imágenes, Nombres)
            // Esto evita que el POS sobreescriba cambios remotos al iniciar.
            await cloudSync.pullCatalogFromCloud();
            
            // 2. Luego subir nuestro estado actual (principalmente Stock)
            await syncCatalogToCloud(storeId);

            logStartup('[CLOUD-SYNC] ✅ Sincronización inicial completada');
        } catch(e) {
            logStartup('[CLOUD-SYNC] ⚠️ Error en sincronización inicial: ' + e.message);
            // Si el pull falla, al menos intentamos el push
            syncCatalogToCloud(storeId);
        }

        console.log('[CLOUD-SYNC] 🚀 Iniciado correctamente');
        logStartup('[CLOUD-SYNC] 🚀 Iniciado correctamente para storeId: ' + storeId);
    } else {
        console.log('[CLOUD-SYNC] ⏸️ No configurado — el POS funciona en modo local');
        logStartup('[CLOUD-SYNC] ⏸️ No configurado — faltan credenciales o storeId. supaUrl: ' + !!supaUrl + ' supaKey: ' + !!supaKey + ' storeId: ' + !!storeId);
    }
}

// initCloudSync is called after app is ready and license is verified

ipcMain.handle('export-to-pdf', async (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { filePath } = await dialog.showSaveDialog(win, {
            title: 'Exportar Expediente Financiero a PDF',
            defaultPath: 'CajaFresh_Expediente.pdf',
            filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
        });
        
        if (!filePath) return { success: false, cancelled: true };
        
        // Hide UI elements not meant for printing via CSS injection or by letting CSS print media handle it.
        // We'll rely on the default printToPDF which uses @media print if defined.
        const pdfData = await win.webContents.printToPDF({
            printBackground: true,
            landscape: true,
            pageSize: 'A4',
            margins: { marginType: 'default' }
        });
        
        fs.writeFileSync(filePath, pdfData);
        return { success: true, filePath };
    } catch (e) {
        console.error('Error exporting PDF:', e);
        return { success: false, error: e.message };
    }
});
