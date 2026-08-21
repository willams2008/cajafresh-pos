// ============================================================
// CAJA FRESH POS — SISTEMA DE LICENCIAMIENTO HÍBRIDO
// ✅ Validación LOCAL (sin internet) via HMAC
// ✅ Heartbeat online cada 72h para revocación remota
// ============================================================

const os     = require('os');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── SECRETO HMAC ─────────────────────────────────────────────
// DEBE ser idéntico al de tools/generate-license.js
const HMAC_SECRET = 'cajafresh_puntopila_vendor_2025_x9z';

// Fecha base para decodificar vencimiento
const BASE_DATE = new Date('2025-01-01T00:00:00Z');

// Chars permitidos (idéntico al generador)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ── CONFIGURACIÓN ─────────────────────────────────────────────
// Servidor de revocación remota (Google Apps Script)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxjVu8zEAB-mcfCYqsKbx7azj1c_RsdK3t0QJ-HnZlyJmVsZCtAuX19bV-BYPs0MRms4g/exec';

const HEARTBEAT_EVERY_MS = 72 * 60 * 60 * 1000; // 72 horas
const GRACE_PERIOD_MS    = 7 * 24 * 60 * 60 * 1000; // 7 días offline
// ─────────────────────────────────────────────────────────────

// ── CRYPTO LOCAL ──────────────────────────────────────────────

function computeHmac(storePart, expCode) {
    const payload = `${storePart}:${expCode}`;
    return crypto.createHmac('sha256', HMAC_SECRET)
        .update(payload)
        .digest('base64')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .substring(0, 8);
}

function codeToMonths(code) {
    if (!code || code.length < 2) return null;
    const c1 = CHARS.indexOf(code[0].toUpperCase());
    const c2 = CHARS.indexOf(code[1].toUpperCase());
    if (c1 < 0 || c2 < 0) return null;
    return c1 * CHARS.length + c2;
}

/**
 * Valida la clave localmente sin internet.
 * Formato esperado: PILA-XXXXXXXX-MM-YYYYYYYY
 * @returns {{ valid: boolean, storeId?: string, expiry?: Date, reason?: string }}
 */
function validateKeyLocally(key) {
    if (!key || typeof key !== 'string') return { valid: false, reason: 'EMPTY_KEY' };

    const clean = key.trim().toUpperCase().replace(/\s/g, '');

    // Aceptar formato antiguo FRESH-XXXX-XXXX-XXXX-XXXX (modo desarrollo)
    if (clean.startsWith('FRESH-') || clean === 'TRIAL-30-DAYS') {
        return { valid: true, storeId: null, expiry: null, isLegacy: true };
    }

    // Nuevo formato: PILA-XXXXXXXX-MM-YYYYYYYY
    const parts = clean.split('-');
    if (parts.length !== 4 || parts[0] !== 'PILA') {
        return { valid: false, reason: 'INVALID_FORMAT' };
    }

    const [, storePart, expCode, providedHmac] = parts;

    if (storePart.length !== 8 || expCode.length !== 2 || providedHmac.length !== 8) {
        return { valid: false, reason: 'INVALID_FORMAT' };
    }

    // Verificar HMAC
    const expectedHmac = computeHmac(storePart, expCode);
    if (providedHmac !== expectedHmac) {
        return { valid: false, reason: 'INVALID_HMAC' };
    }

    // Decodificar vencimiento
    const monthsFromBase = codeToMonths(expCode);
    if (monthsFromBase === null) {
        return { valid: false, reason: 'INVALID_EXPIRY' };
    }

    const expiry = new Date(BASE_DATE);
    expiry.setMonth(expiry.getMonth() + monthsFromBase);

    if (expiry <= new Date()) {
        return { valid: false, reason: 'EXPIRED', expiry };
    }

    // Store ID derivado del storePart
    const storeId = `store_${storePart.toLowerCase()}`;

    return { valid: true, storeId, expiry, storePart };
}

// ── STORAGE ───────────────────────────────────────────────────

function getMachineId() {
    try {
        const parts = [
            os.hostname(),
            os.cpus()?.[0]?.model || 'unknown_cpu',
            os.userInfo().username,
            os.platform(),
        ].join('|');
        return crypto.createHash('sha256').update(parts).digest('hex').substring(0, 32);
    } catch (e) {
        return crypto.createHash('sha256').update(os.hostname()).digest('hex').substring(0, 32);
    }
}

function getLicensePath() {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'cfjpos_license.json');
}

function loadStoredLicense() {
    try {
        const p = getLicensePath();
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
    } catch (e) {}

    // Instalación limpia → Trial de 30 días
    const trialStart = Date.now();
    const trialLicense = {
        key: 'TRIAL-30-DAYS',
        machineId: getMachineId(),
        clientName: 'Prueba Gratuita (Demo)',
        storeId: null,
        status: 'ACTIVE',
        activatedAt: trialStart,
        expiry: new Date(trialStart + 30 * 24 * 60 * 60 * 1000).toISOString(),
        lastCheck: trialStart,
        isTrial: true
    };
    saveLicense(trialLicense);
    return trialLicense;
}

function saveLicense(data) {
    try {
        fs.writeFileSync(getLicensePath(), JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}

// ── HEARTBEAT REMOTO (para revocación) ───────────────────────

function callServer(action, key, machineId, extraParams = {}) {
    return new Promise((resolve) => {
        if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'PENDING_DEPLOYMENT') {
            return resolve({ valid: true, clientName: 'MODO DESARROLLO', dev: true });
        }

        const params = new URLSearchParams({
            action,
            key: key || 'TRIAL-30-DAYS',
            machineId,
            hostname: os.hostname(),
            platform: os.platform(),
            username: os.userInfo()?.username || '',
            ...extraParams
        });
        const url = `${APPS_SCRIPT_URL}?${params.toString()}`;

        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.log('[LICENSE] Timeout alcanzado en llamada al servidor de licencias. Usando fallback offline.');
                resolve(null);
            }
        }, 5000); // 5 segundos max

        const { net } = require('electron');
        net.fetch(url, { redirect: 'follow' })
            .then(res => res.text())
            .then(text => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    try { resolve(JSON.parse(text)); }
                    catch (e) { resolve(null); }
                }
            })
            .catch(() => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(null);
                }
            });
    });
}

// ── API PÚBLICA ───────────────────────────────────────────────

/**
 * Verifica si el POS tiene una licencia válida.
 * 1. Validación LOCAL inmediata (HMAC + vencimiento)
 * 2. Si pasó más de 72h, hace heartbeat online para revisar revocación
 */
async function checkLicense(force = false) {
    const stored = loadStoredLicense();
    const machineId = getMachineId();

    if (!stored || !stored.key) {
        return { valid: false, reason: 'NO_LICENSE' };
    }

    if (stored.status === 'REVOKED') return { valid: false, reason: 'REVOKED' };
    if (stored.status === 'EXPIRED') return { valid: false, reason: 'EXPIRED' };

    // ── PASO 1: Validación local ──────────────────────────────
    const localCheck = validateKeyLocally(stored.key);

    if (!localCheck.valid && !stored.isTrial) {
        // La clave no pasa validación local (fue manipulada o expiró)
        if (localCheck.reason === 'EXPIRED') {
            saveLicense({ ...stored, status: 'EXPIRED' });
            return { valid: false, reason: 'EXPIRED' };
        }
        return { valid: false, reason: localCheck.reason || 'INVALID' };
    }

    // ── Calcular días restantes ───────────────────────────────
    const now = Date.now();
    let warningDaysLeft = null;
    let daysLeft = null;

    if (stored.expiry) {
        const expiryTime = new Date(stored.expiry).getTime();
        daysLeft = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));

        if (daysLeft <= 0) {
            saveLicense({ ...stored, status: 'EXPIRED' });
            return { valid: false, reason: 'EXPIRED' };
        }
        if (daysLeft <= 15) warningDaysLeft = daysLeft;
    }

    // ── Modo Prueba (Trial): Reportar máquina, días y estado a Google Sheets ──
    if (stored.isTrial || stored.key === 'TRIAL-30-DAYS') {
        const trialKey = `TRIAL-${machineId.substring(0, 8).toUpperCase()}`;
        console.log(`[LICENSE] Reportando sesión de prueba a Google Sheets (${daysLeft} días restantes)...`);
        
        callServer('trial_heartbeat', trialKey, machineId, {
            clientName: stored.clientName || 'Demo / Prueba',
            status: 'TRIAL',
            daysLeft: daysLeft !== null ? daysLeft : 30,
            expiry: stored.expiry || ''
        }).then(result => {
            if (result && (result.status === 'REVOKED' || result.status === 'SUSPENDED' || result.status === 'EXPIRED')) {
                console.log(`[LICENSE] Trial revocado o suspendido desde Google Sheets: ${result.status}`);
                saveLicense({ ...stored, status: result.status });
            }
        }).catch(() => {});

        return { valid: true, clientName: stored.clientName, warningDaysLeft, isTrial: true, storeId: stored.storeId, daysLeft };
    }

    // ── PASO 2: Verificación online en tiempo real ──────────
    // Intentamos validar con el servidor en cada arranque si hay internet.
    // Si no hay internet, permitimos el uso offline (período de gracia).
    console.log('[LICENSE] Verificando revocación/estado online con el servidor...');
    const result = await callServer('heartbeat', stored.key, machineId);

    if (result) {
        // Conexión exitosa con el servidor
        const isStatusInvalid = result.status && result.status !== 'ACTIVE';
        if (!result.valid || isStatusInvalid) {
            const blockReason = result.status || result.reason || 'REVOKED';
            console.log(`[LICENSE] Licencia inhabilitada por el servidor: ${blockReason}`);
            saveLicense({ ...stored, status: blockReason, lastCheck: now });
            return { valid: false, reason: blockReason };
        }
        // Licencia activa y válida en el servidor
        const clientName = result.clientName || stored.clientName;
        saveLicense({ ...stored, status: 'ACTIVE', lastCheck: now, clientName });
        return { valid: true, clientName, warningDaysLeft, daysLeft, storeId: stored.storeId };
    } else {
        // Error de conexión (offline) -> Usar caché local y validar período de gracia
        const timeSinceCheck = now - (stored.lastCheck || 0);
        console.log('[LICENSE] Servidor offline. Usando verificación local offline.');
        
        if (force) return { valid: false, reason: 'SIN_INTERNET' };
        if (timeSinceCheck > GRACE_PERIOD_MS) {
            console.log('[LICENSE] Período de gracia offline expirado.');
            return { valid: false, reason: 'GRACE_EXPIRED' };
        }
        
        const graceDaysLeft = Math.ceil((GRACE_PERIOD_MS - timeSinceCheck) / (24 * 60 * 60 * 1000));
        return { valid: true, grace: true, daysLeft: graceDaysLeft, clientName: stored.clientName, warningDaysLeft, storeId: stored.storeId };
    }
}

/**
 * Activa una nueva clave PILA-XXXXXXXX-MM-YYYYYYYY en este equipo.
 * 1. Valida localmente (HMAC + vencimiento) — sin internet
 * 2. Valida contra el servidor si hay internet (si está restringida/revocada, bloquea la activación)
 */
async function activateLicense(key, clientName) {
    const machineId = getMachineId();
    const trimmedKey = key.trim().toUpperCase();

    // ── Validación local (inmediata, sin internet) ────────────
    const localCheck = validateKeyLocally(trimmedKey);

    if (!localCheck.valid) {
        const errMap = {
            'INVALID_FORMAT': 'Formato de clave inválido. Debe ser PILA-XXXXXXXX-XX-XXXXXXXX.',
            'INVALID_HMAC':   'Clave inválida o falsificada. Contacta a tu proveedor.',
            'EXPIRED':        'Esta clave ya venció. Contacta a tu proveedor para renovar.',
        };
        throw new Error(errMap[localCheck.reason] || `INVALID:${localCheck.reason}`);
    }

    const expiryStr = localCheck.expiry ? localCheck.expiry.toISOString() : null;
    let finalClientName = clientName || 'Mi Tienda';

    // ── Intentar registrar/validar online ─────────────────────
    try {
        console.log('[LICENSE] Registrando activación en el servidor...');
        const result = await callServer('activate', trimmedKey, machineId);
        if (result) {
            const isStatusInvalid = result.status && result.status !== 'ACTIVE';
            if (!result.valid || isStatusInvalid) {
                throw new Error(result.status || result.reason || 'REVOKED');
            }
            if (result.clientName) {
                finalClientName = result.clientName;
            }
        }
    } catch (e) {
        // Si el error es explícitamente una revocación o expiración devuelta por el servidor, BLOQUEAR
        if (e.message === 'REVOKED' || e.message === 'SUSPENDED' || e.message === 'EXPIRED' || e.message === 'MACHINE_MISMATCH') {
            const motivos = {
                'REVOKED': 'Esta licencia ha sido suspendida por el proveedor.',
                'SUSPENDED': 'Esta licencia ha sido suspendida por el proveedor.',
                'EXPIRED': 'Esta licencia ha vencido en el servidor.',
                'MACHINE_MISMATCH': 'Esta clave ya está registrada en otro equipo.',
            };
            throw new Error(motivos[e.message] || `Licencia no válida: ${e.message}`);
        }
        // Si es un error de conexión a internet, permitimos la activación local offline
        console.log('[LICENSE] Servidor offline o error de red. Procediendo con activación local.', e.message);
    }

    // ── Guardar licencia localmente ───────────────────────────
    saveLicense({
        key: trimmedKey,
        machineId,
        clientName: finalClientName,
        storeId: localCheck.storeId,
        expiry: expiryStr,
        status: 'ACTIVE',
        lastCheck: Date.now(),
        activatedAt: Date.now(),
        isTrial: false,
    });

    return { clientName: finalClientName, storeId: localCheck.storeId, expiry: expiryStr };
}

/** Expone el Machine ID para mostrarlo en la pantalla de activación. */
function getPublicMachineId() {
    return getMachineId();
}

/** Retorna el store_id almacenado en la licencia activa. */
function getStoreId() {
    const stored = loadStoredLicense();
    return stored?.storeId || null;
}

module.exports = { checkLicense, activateLicense, getPublicMachineId, getStoreId, validateKeyLocally };
