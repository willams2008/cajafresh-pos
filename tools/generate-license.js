/**
 * ============================================================
 * GENERADOR DE LICENCIAS — PUNTO PILA POS (Multi-Cliente SaaS)
 * ============================================================
 * Uso:
 *   node tools/generate-license.js
 *   node tools/generate-license.js --store "bodega_catia" --name "Bodega La Catia" --months 12
 *   node tools/generate-license.js --qty 5   (genera 5 claves genéricas)
 *
 * La clave generada contiene:
 *  - store_id (8 chars únicos)
 *  - Mes de vencimiento (2 chars, desde fecha base)
 *  - HMAC de verificación (8 chars)
 *
 * Formato: PILA-XXXXXXXX-MM-YYYYYYYY
 *          PILA-[STORE 8]-[EXP 2]-[HMAC 8]
 * ============================================================
 */

const crypto = require('crypto');
const args = process.argv.slice(2);

// ── SECRETO COMPARTIDO ────────────────────────────────────────
// IMPORTANTE: Este secreto debe ser IDÉNTICO en license.js
// Cámbialo a algo único tuyo antes de distribuir el software.
const HMAC_SECRET = 'cajafresh_puntopila_vendor_2025_x9z';

// Fecha base para calcular meses de vencimiento (1 enero 2025)
const BASE_DATE = new Date('2025-01-01T00:00:00Z');

// Caracteres permitidos (sin 0,O,I,1 para evitar confusiones)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ── FUNCIONES ─────────────────────────────────────────────────

function randomChars(len) {
    let result = '';
    for (let i = 0; i < len; i++) {
        result += CHARS[crypto.randomInt(0, CHARS.length)];
    }
    return result;
}

/**
 * Genera la firma HMAC de 8 chars para un storePart + expCode.
 * El POS usa esta misma función para verificar sin internet.
 */
function computeHmac(storePart, expCode) {
    const payload = `${storePart}:${expCode}`;
    return crypto.createHmac('sha256', HMAC_SECRET)
        .update(payload)
        .digest('base64')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .substring(0, 8);
}

/**
 * Convierte un número (meses desde BASE_DATE) a 2 chars base-32.
 */
function monthsToCode(months) {
    const n = Math.max(0, Math.min(months, CHARS.length * CHARS.length - 1));
    const c1 = CHARS[Math.floor(n / CHARS.length)];
    const c2 = CHARS[n % CHARS.length];
    return c1 + c2;
}

/**
 * Decodifica 2 chars base-32 a número de meses desde BASE_DATE.
 */
function codeToMonths(code) {
    const c1 = CHARS.indexOf(code[0].toUpperCase());
    const c2 = CHARS.indexOf(code[1].toUpperCase());
    if (c1 < 0 || c2 < 0) return null;
    return c1 * CHARS.length + c2;
}

function generateLicense(storeSuffix, months) {
    // 8 chars únicos para el store
    const storePart = storeSuffix
        ? storeSuffix.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8).padEnd(8, randomChars(1))
        : randomChars(8);

    // Vencimiento: meses desde BASE_DATE
    const now = new Date();
    const monthsSinceBase = (now.getFullYear() - BASE_DATE.getFullYear()) * 12
        + (now.getMonth() - BASE_DATE.getMonth());
    const expireAt = monthsSinceBase + (months || 12);
    const expCode = monthsToCode(expireAt);

    // HMAC
    const hmac = computeHmac(storePart, expCode);

    // Store ID: derivado directamente del storePart (lowercase)
    const storeId = `store_${storePart.toLowerCase()}`;

    // Formato final: PILA-XXXXXXXX-MM-YYYYYYYY
    const key = `PILA-${storePart}-${expCode}-${hmac}`;

    return { key, storeId, expCode, hmac, storePart };
}

// ── CLI INTERFACE ─────────────────────────────────────────────

function parseArgs(args) {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            result[args[i].slice(2)] = args[i + 1] || true;
            i++;
        }
    }
    return result;
}

const opts = parseArgs(args);

const qty      = parseInt(opts.qty) || 1;
const months   = parseInt(opts.months) || 12;
const name     = opts.name || null;
const storeArg = opts.store ? opts.store.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : null;

console.log('\n══════════════════════════════════════════════════════');
console.log('   🔑 GENERADOR DE LICENCIAS — PUNTO PILA POS (SaaS)');
console.log('══════════════════════════════════════════════════════\n');

const expDate = new Date();
expDate.setMonth(expDate.getMonth() + months);
console.log(`   📅 Vencimiento: ${months} meses (hasta ${expDate.toLocaleDateString('es-VE')})\n`);

const generated = [];

for (let i = 0; i < qty; i++) {
    const suffix = storeArg ? (qty > 1 ? `${storeArg}${i+1}` : storeArg) : null;
    const lic = generateLicense(suffix, months);
    generated.push(lic);

    console.log(`  ${String(i + 1).padStart(2, '0')}. Clave:    ${lic.key}`);
    console.log(`      Store ID: ${lic.storeId}`);
    if (name) console.log(`      Cliente:  ${name}`);
    console.log('');
}

console.log('══════════════════════════════════════════════════════');
console.log('   📋 Guardar en tu registro:');
console.log('   Columnas: Clave | Store ID | Cliente | Vencimiento | Estado\n');
generated.forEach(lic => {
    const expDate2 = new Date();
    expDate2.setMonth(expDate2.getMonth() + months);
    console.log(`   ${lic.key} | ${lic.storeId} | ${name || 'SIN NOMBRE'} | ${expDate2.toISOString().split('T')[0]} | ACTIVE`);
});
console.log('\n   ⚠️  IMPORTANTE: Añade el store_id a tu Supabase (tabla stores)');
console.log('   antes de entregar la clave al cliente.\n');

// ── EXPORTAR para uso programático ────────────────────────────
module.exports = { generateLicense, computeHmac, monthsToCode, codeToMonths, HMAC_SECRET, CHARS, BASE_DATE };
