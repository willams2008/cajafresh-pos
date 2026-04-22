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
const { initDatabase, api: dbApi } = require('./database');

// --- STARTUP DIAGNOSTIC LOG ---
const startupLogPath = path.join(app.getPath('userData'), 'startup_debug.log');
function logStartup(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(startupLogPath, entry); } catch(e) {}
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
            // Intentar usar el del ASAR (podría fallar por permisos, pero es mejor que nada)
            logStartup('🔍 Reintentando con binario dentro de ASAR: ' + bin);
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

let mainWindow;
let io;
let currentTunnelUrl = null;
let lastDiscoveryUrl = null; // CACHE para evitar spam de señal
let isStartingTunnel = false; // Flag para evitar ejecuciones concurrentes
let lastSyncedProducts = null; // CACHE: Guardar última versión de productos para carga instantánea
const serverPort = 3000;

// These will be initialized in initWhatsApp() after app is ready
let logPath = null;
let whatsappClient = null;
let isWhatsappReady = false;
let lastWhatsappStatus = { status: 'starting', message: 'Iniciando motor...' };

// --- DATABASE IPC HANDLERS ---
ipcMain.handle('db-get-products', async () => dbApi.getProducts());
ipcMain.handle('db-save-product', async (e, p) => dbApi.saveProduct(p));
ipcMain.handle('db-delete-product', async (e, id) => dbApi.deleteProduct(id));

ipcMain.handle('db-get-clients', async () => dbApi.getClients());
ipcMain.handle('db-save-client', async (e, c) => dbApi.saveClient(c));

ipcMain.handle('db-get-sales', async (e, limit) => dbApi.getSales(limit));
ipcMain.handle('db-get-sales-by-date', async (e, start, end) => dbApi.getSalesByDate(start, end));
ipcMain.handle('db-save-sale', async (e, s) => {
    const result = await dbApi.saveSale(s);
    if (io) io.emit('new-sale', s);
    return result;
});

ipcMain.handle('db-get-credits', async () => dbApi.getCredits());
ipcMain.handle('db-add-credit-payment', async (e, id, amount, method) => dbApi.addCreditPayment(id, amount, method));

ipcMain.handle('db-migrate', async (e, data) => dbApi.migrateData(data));

// ==========================================
// LICENCIA IPC HANDLERS
// ==========================================
ipcMain.handle('license-get-id', () => licenseSystem.getPublicMachineId());

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
        authTimeoutMs: 0, // Inhabilitar timeout de autenticación para cuentas grandes
        qrMaxRetries: 5,
        puppeteer: {
            headless: true,
            executablePath: chromePath,
            timeout: 0, // Desactivar timeout de navegación de Puppeteer
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-extensions',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-web-security'
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
            
            // Si el heartbeat detecta el motor muerto, auto-reiniciar
            if (e.message.includes('detached Frame') || e.message.includes('Session closed') || e.message.includes('Target closed')) {
                logWA('🚨 Heartbeat detectó CRASH FATAL. Reiniciando...');
                isWhatsappReady = false;
                updateWAStatus({ status: 'error', error: 'Motor caído. Reiniciando en background...' });
                initWhatsApp();
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


function updateDiscovery(localIP, tunnelUrl) {
    const businessId = 'cajafresh_pos_v2_778899_remote'; 
    const fullUrl = tunnelUrl ? (tunnelUrl.startsWith('http') ? tunnelUrl : `https://${tunnelUrl}`) : `http://${localIP}:3000`;
    
    const mobileUrl = `${fullUrl.replace(/\/$/, '')}/mobile`;

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
            console.log(`📡 Señal de descubrimiento enviada: ${fullUrl}`);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync-status', { ok: res.statusCode < 400 });
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
    
    // Servir la interfaz móvil de forma estática y redirección de raíz
    serverApp.use('/mobile', express.static(path.join(__dirname, 'mobile')));
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

    // Ruta de Página de Descarga de APK
    serverApp.get('/download', (req, res) => {
        res.sendFile(path.join(__dirname, 'download.html'));
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

    serverApp.get('/', (req, res) => res.redirect('/mobile'));

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

    // DASHBOARD REMOTO: Página web para el dueño del negocio
    serverApp.get('/dashboard', (req, res) => {
        res.sendFile(path.join(__dirname, 'dashboard.html'));
    });

    // ==========================================
    // BOSS APP — Panel de Control del Dueño
    // ==========================================
    serverApp.use('/boss', express.static(path.join(__dirname, 'boss')));

    // DASHBOARD API: Datos en tiempo real
    let lastDashboardData = null;
    serverApp.get('/api/dashboard-data', (req, res) => {
        res.json(lastDashboardData || { today: { totalVES: 0, totalUSD: 0, tickets: 0, items: 0 }, recentSales: [], alerts: { lowStock: [], outOfStock: [] }, inventory: { total: 0 } });
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
            const sales = await dbApi.getSales(300);
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
            const products = await dbApi.getProducts();
            res.json(products);
        } catch(e) {
            console.error('Boss API inventory error:', e.message);
            res.json([]);
        }
    });

    // BOSS API: Credits (directo de SQLite)
    serverApp.get('/api/boss/credits', async (req, res) => {
        try {
            const credits = await dbApi.getCredits();
            res.json(credits);
        } catch(e) {
            console.error('Boss API credits error:', e.message);
            res.json([]);
        }
    });

    // BOSS API: Update product remotely
    serverApp.post('/api/boss/update-product', async (req, res) => {
        try {
            const product = req.body;
            await dbApi.saveProduct(product);
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
    });

    const server = http.createServer(serverApp);
    io = new Server(server, {
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


// ──── MÉTODO 1: CLOUDFLARE (sin contraseña, preferido) ────
async function tryCloudflare() {
    return new Promise((resolve) => {
        console.log('☁️  Intentando Cloudflare...');
        const cf = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${serverPort}`], {
            env: cleanEnv(),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        tunnelProcess = cf;

        let found = false;
        const timeout = setTimeout(() => {
            if (!found) {
                console.log('⏳ Cloudflare no respondió a tiempo.');
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
            const domain = userSettings.ngrokDomain;

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

    // 1. Matar procesos huérfanos de forma SÍNCRONA para evitar errores 3200 de Ngrok
    try {
        const { execSync } = require('child_process');
        if (/^win/.test(process.platform)) {
            // Usamos quiet mode para no llenar la consola si no hay procesos
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
        if (await tryNgrok()) return;
    }

    // 2. Cloudflare (Muy estable, sin bypass)
    if (await tryCloudflare()) return;
    if (currentTunnelUrl) return;

    // 3. Serveo
    if (await tryServeo()) return;
    if (currentTunnelUrl) return;

    // 4. Localtunnel (Último recurso)
    if (await tryLocaltunnel()) return;
    if (currentTunnelUrl) return;

    // Fallback final: Intentar Ngrok básico
    if (!userSettings.ngrokAuthToken) {
        await tryNgrok();
    }
    
    isStartingTunnel = false;
}

function createWindow() {
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

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.maximize();

    // Al cargar, enviar la info de red al frontend de la PC
    mainWindow.webContents.on('did-finish-load', async () => {
        const ip = getLocalIP();
        const mobileUrl = `http://${ip}:${serverPort}/mobile`;
        const qrData = await QRCode.toDataURL(mobileUrl);
        
        mainWindow.webContents.send('server-info', { ip, port: serverPort, url: mobileUrl, qr: qrData });
        
        // Si el túnel ya estaba listo, enviarlo también
        if (currentTunnelUrl) {
            const isCloudflare = currentTunnelUrl.includes('cloudflare');
            if (isCloudflare) {
                mainWindow.webContents.send('tunnel-info', { url: currentTunnelUrl, provider: 'cloudflare' });
            } else {
                getPublicIP().then(ip => {
                    mainWindow.webContents.send('tunnel-info', { 
                        url: currentTunnelUrl, 
                        provider: 'localtunnel',
                        publicIP: ip 
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
        width: 640,
        height: 600,
        resizable: false,
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
    activationWindow.loadFile(path.join(__dirname, 'activation.html'));
}

// (Duplicate license-get-id handler removed)
// IPC: el frontend envía la clave para activar
ipcMain.handle('license-activate', async (event, key) => {
    // Puede lanzar excepciones — el renderer las captura
    return await licenseSystem.activateLicense(key);
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
    initWhatsApp();
    startServer();
    createWindow();
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

        // SEGURIDAD: No sobreescribir cache con una lista vacía si ya tenemos datos
        if (data.products && data.products.length > 0) {
            console.log(`📦 Cache actualizado: ${data.products.length} productos listos para móviles.`);
            lastSyncedProducts = data;
        } else {
            console.warn("⚠️ Sincronización recibida sin productos o lista vacía.");
            if (!lastSyncedProducts) lastSyncedProducts = data;
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
        await whatsappClient.sendMessage(target, media);
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

ipcMain.on('restart-tunnels', async () => {
    console.log('🔄 Reinicio de túneles solicitado...');
    try {
        if (tunnelProcess) {
            tunnelProcess.kill();
            tunnelProcess = null;
        }
        // Para Ngrok específicamente
        await ngrok.kill();
        currentTunnelUrl = null;
        startTunnelChain();
    } catch (e) {
        console.error('Error reiniciando túneles:', e);
    }
});

ipcMain.on('restart-tunnels', async () => {
    console.log('🔄 Reinicio de túneles solicitado...');
    try {
        if (tunnelProcess) {
            tunnelProcess.kill();
            tunnelProcess = null;
        }
        // Para Ngrok específicamente
        await ngrok.kill();
        currentTunnelUrl = null;
        startTunnelChain();
    } catch (e) {
        console.error('Error reiniciando túneles:', e);
    }
});

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
