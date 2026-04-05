// Ensure Electron runs in browser mode, not Node mode
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, ipcMain } = require('electron');

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const cors = require('cors');
const QRCode = require('qrcode');
const { spawn } = require('child_process');
const https = require('https');

let { bin } = require('cloudflared');
if (bin.includes('app.asar')) {
    bin = bin.replace('app.asar', 'app.asar.unpacked');
}
const localtunnel = require('localtunnel');
const { Client, LocalAuth } = require('whatsapp-web.js');
const readline = require('readline');

let mainWindow;
let io;
let currentTunnelUrl = null;
const serverPort = 3000;

// These will be initialized in initWhatsApp() after app is ready
let logPath = null;
let whatsappClient = null;
let isWhatsappReady = false;
let lastWhatsappStatus = { status: 'starting', message: 'Iniciando motor...' };

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
function initWhatsApp() {
    logPath = path.join(app.getPath('userData'), 'whatsapp_debug.log');

    const chromePath = getChromePath();
    logWA(chromePath ? `🎯 Chrome detectado en: ${chromePath}` : '⚠️ Chrome no detectado en rutas estándar.');

    whatsappClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: path.join(app.getPath('userData'), 'wwebjs_session')
        }),
        puppeteer: {
            headless: true,
            executablePath: chromePath,
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
            const qrImage = await QRCode.toDataURL(qr);
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

ipcMain.handle('whatsapp-get-status', () => {
    return lastWhatsappStatus;
});



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

function updateDiscovery(localIP, tunnelUrl) {
    const businessId = 'zonafresh_caja_pos_tunnel_url_secret_eb6044'; 
    const payload = JSON.stringify({ localIP, tunnelUrl });

    const options = {
        hostname: 'ntfy.sh',
        path: `/${businessId}`,
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync-status', { ok: res.statusCode < 400 });
        }
    });

    req.on('error', (e) => {
        console.error('❌ Error NTFY:', e.message);
    });

    req.write(payload);
    req.end();
}

function startServer() {
    const serverApp = express();
    serverApp.use(cors());
    serverApp.use(express.json());
    
    // Servir la interfaz móvil de forma estática
    serverApp.use('/mobile', express.static(path.join(__dirname, 'mobile')));

    // Route for app installation landing page
    serverApp.get('/download', (req, res) => {
        res.sendFile(path.join(__dirname, 'download.html'));
    });

    const server = http.createServer(serverApp);
    io = new Server(server, {
        cors: { origin: "*" }
    });

    io.on('connection', (socket) => {
        console.log('Dispositivo móvil conectado:', socket.id);
        
        // Notificar a la PC que hay un nuevo cliente para que envíe los productos
        if (mainWindow) {
            mainWindow.webContents.send('request-sync');
        }
        
        socket.on('request-sync', () => {
            console.log('El móvil solicitó el menú de productos.');
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

    async function getPublicIP() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve('No detectada'), 5000);
            http.get('http://api.ipify.org', (res) => {
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

    server.listen(serverPort, '0.0.0.0', async () => {
        console.log(`Servidor POS escuchando en http://0.0.0.0:${serverPort}`);
        
        // Publicar IP local inicial en la nube
        updateDiscovery(getLocalIP(), null);

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
            
            // Actualizar descubrimiento en la nube
            updateDiscovery(getLocalIP(), url);

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('tunnel-info', { url, provider });
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
                }, 25000);

                const check = (data) => {
                    const text = data.toString();
                    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
                    if (match && !found) {
                        found = true;
                        clearTimeout(timeout);
                        notifyTunnel(match[0], 'cloudflare');
                        resolve(true);
                    }
                };

                cf.stderr.on('data', check);
                cf.stdout.on('data', check);
                cf.on('error', () => { clearTimeout(timeout); resolve(false); });
                cf.on('close', () => { if (!found) { clearTimeout(timeout); resolve(false); } });
            });
        }

        // ──── MÉTODO 2: SERVEO (ssh, sin contraseña) ────
        async function tryServeo() {
            return new Promise((resolve) => {
                console.log('🔗 Intentando Serveo.net...');
                const serveo = spawn('ssh', [
                    '-o', 'StrictHostKeyChecking=no',
                    '-o', 'ServerAliveInterval=30',
                    '-R', `80:localhost:${serverPort}`,
                    'serveo.net'
                ], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

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
                        notifyTunnel(match[0], 'cloudflare'); // 'cloudflare' para ocultar campo password en UI
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
                    console.log('🔒 Usando Localtunnel Permanente...');
                    const sub = 'zonafresh-pos-caja'; 
                    const tunnel = await localtunnel({ port: serverPort, subdomain: sub });
                    
                    const publicIP = await getPublicIP();
                    notifyTunnel(tunnel.url, 'localtunnel');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('tunnel-info', { 
                            url: tunnel.url, 
                            provider: 'localtunnel',
                            publicIP: publicIP 
                        });
                    }

                    tunnel.on('close', () => {
                        currentTunnelUrl = null;
                        setTimeout(startTunnelChain, 10000);
                    });
                    resolve(true);
                } catch (err) {
                    console.error('❌ Error en Localtunnel:', err.message);
                    resolve(false);
                }
            });
        }

        // ──── CADENA DE INTENTOS ────
        async function startTunnelChain() {
            if (currentTunnelUrl) return;
            console.log('--- 🚀 INICIANDO TÚNEL REMOTO ---');

            if (await tryCloudflare()) return;
            if (currentTunnelUrl) return;

            if (await tryServeo()) return;
            if (currentTunnelUrl) return;

            await tryLocaltunnel();
        }
        
        startTunnelChain();
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: "Caja Fresh POS Server",
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

app.whenReady().then(() => {
    initWhatsApp();
    startServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Enviar actualizaciones de stock/productos a los móviles conectados
ipcMain.on('sync-products', (event, products) => {
    if (io) {
        io.emit('products-updated', products);
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
        return { success: false, error: 'WhatsApp no está conectado' };
    }
    
    try {
        const { MessageMedia } = require('whatsapp-web.js');
        // El base64Data debe ser solo la parte después de 'data:application/pdf;base64,'
        const cleanBase64 = base64Data.split(',')[1] || base64Data;
        const media = new MessageMedia('application/pdf', cleanBase64, filename);
        
        const target = phone.includes('@') ? phone : `${phone}@c.us`;
        await whatsappClient.sendMessage(target, media);
        console.log(`📑 PDF enviado a ${phone}: ${filename}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error enviando PDF WhatsApp:', error);
        return { success: false, error: error.message };
    }
});

// IPC handler for WhatsApp background sending
ipcMain.handle('whatsapp-send-report', async (event, { phone, message }) => {
    if (!isWhatsappReady) {
        return { success: false, error: 'WhatsApp no está conectado' };
    }
    
    try {
        // Formatear el número de teléfono con @c.us
        const target = phone.includes('@') ? phone : `${phone}@c.us`;
        await whatsappClient.sendMessage(target, message);
        console.log(`📨 Reporte enviado a ${phone}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error enviando mensaje WhatsApp:', error);
        return { success: false, error: error.message };
    }
});

// IPC handler for silent printing
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
