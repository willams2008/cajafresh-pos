require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');

// ==========================================
// CONFIG
// ==========================================
const CONFIG = {
  geminiKey: process.env.GEMINI_API_KEY || '',
  bossPhone: process.env.BOSS_PHONE || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
  storeId: process.env.STORE_ID || 'store_default',
};

const SESSION_DIR = path.join(__dirname, 'wa_session');

// ==========================================
// GEMINI
// ==========================================
let geminiModel = null;

function initGemini() {
  if (!CONFIG.geminiKey) {
    console.log('⚠ Sin API key Gemini. Usando respuestas básicas.');
    return false;
  }
  try {
    const ai = new GoogleGenerativeAI(CONFIG.geminiKey);
    geminiModel = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    console.log('✅ Gemini conectado');
    return true;
  } catch (e) {
    console.error('❌ Gemini:', e.message);
    return false;
  }
}

async function preguntarGemini(mensaje, contexto = '') {
  if (!geminiModel) return respuestasBasicas(mensaje);

  const prompt = `Eres el asistente virtual de "Caja Fresh / Punto Pila POS" en Venezuela.
Responde corto, amable, máximo 3 párrafos. Siempre en español.
Si no sabes algo, di que consultarás con el equipo.

CONTEXTO:
${contexto || 'No hay información disponible.'}

CLIENTE: ${mensaje}`;

  try {
    const result = await geminiModel.generateContent(prompt);
    return result.response.text().trim() || 'Gracias, en breve te atenderemos.';
  } catch (e) {
    console.error('❌ Gemini error:', e.message);
    if (e.message?.includes('429')) return '⚠ Estamos llenos de mensajes. Espera un momento y vuelve a escribir.';
    return respuestasBasicas(mensaje);
  }
}

function respuestasBasicas(mensaje) {
  const m = mensaje.toLowerCase();
  if (m.includes('horario')) return '📍 Lun-Sáb 8:00-18:00, Dom 9:00-14:00. ¡Te esperamos!';
  if (m.includes('ubicaci') || m.includes('dirección')) return '📍 En Catia La Mar. Escríbenos y te enviamos la ubicación.';
  if (m.includes('pago')) return '💳 Aceptamos efectivo USD/VES, Pago Móvil, Zelle.';
  if (m.includes('hola') || m.includes('buen')) return '¡Hola! Bienvenido a Caja Fresh 🚀 ¿En qué podemos ayudarte?';
  if (m.includes('gracias')) return '¡A ti! Siempre activos 🔥';
  return 'Gracias por escribirnos. En breve un asesor te atenderá.';
}

// ==========================================
// DATOS POS
// ==========================================
let db = null;

function conectarDB() {
  const posibles = [
    path.join(process.env.APPDATA || '', 'puntopila-pos', 'database', 'freshpos.sqlite'),
    path.join(process.env.LOCALAPPDATA || '', 'puntopila-pos', 'database', 'freshpos.sqlite'),
    path.join(process.cwd(), 'database', 'freshpos.sqlite'),
  ];
  for (const p of posibles) {
    if (fs.existsSync(p)) {
      try {
        const sqlite3 = require('sqlite3');
        db = new sqlite3.Database(p, sqlite3.OPEN_READONLY);
        console.log('✅ DB conectada:', p);
        return true;
      } catch (e) { /* no sqlite3 */ }
    }
  }
  console.log('ℹ DB no encontrada, modo autónomo');
  return false;
}

function queryDB(sql) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('No DB'));
    db.all(sql, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

async function getContexto() {
  if (!db) return '';
  try {
    const prods = await queryDB(`SELECT name, priceUSD, priceVES FROM products WHERE store_id='${CONFIG.storeId}' LIMIT 20`);
    if (!prods.length) return '';
    return '📦 CATÁLOGO:\n' + prods.map(p => `- ${p.name}: $${p.priceUSD || '?'} / Bs.${p.priceVES || '?'}`).join('\n');
  } catch { return ''; }
}

// ==========================================
// WHATSAPP
// ==========================================
console.log(`
╔══════════════════════════════════════╗
║   🤖 CHATBOT CAJA FRESH v2.0        ║
║   whatsapp-web.js + Gemini AI        ║
╚══════════════════════════════════════╝
`);

initGemini();
conectarDB();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  },
  qrMaxRetries: 10,
  authTimeoutMs: 0,
});

client.on('qr', (qr) => {
  console.log('\n📱 ESCANEA ESTE QR EN WHATSAPP (solo la primera vez):\n');
  qrcode.generate(qr, { small: true });
  console.log('\n📱 Abre WhatsApp → Dispositivos vinculados → Escanea el QR');
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado!');
  if (CONFIG.bossPhone) {
    client.sendMessage(`${CONFIG.bossPhone}@c.us`, '🤖 *Chatbot Caja Fresh activado*\nYa estoy atendiendo clientes.');
  }
});

client.on('disconnected', async (reason) => {
  console.log(`🔄 Desconectado: ${reason}. Reconectando en 10s...`);
  setTimeout(() => client.initialize(), 10000);
});

client.on('message', async (msg) => {
  try {
    if (msg.fromMe) return;
    if (msg.isGroup) return;
    if (!msg.body?.trim()) return;
    // Ignorar estados
    if (msg.from === 'status@broadcast') return;

    const chatId = msg.from;
    console.log(`💬 ${chatId.split('@')[0]}: "${msg.body.substring(0, 80)}"`);

    const ctx = await getContexto();
    const respuesta = await preguntarGemini(msg.body, ctx);
    await client.sendMessage(chatId, respuesta);
    console.log(`✅ Respondido a ${chatId.split('@')[0]}`);
  } catch (e) {
    console.error('❌ Error msg:', e.message?.substring(0, 100));
  }
});

client.initialize().catch(e => {
  console.error('❌ Error al iniciar:', e.message);
  console.log('Reintentando en 15s...');
  setTimeout(() => client.initialize(), 15000);
});

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando...');
  client.destroy();
  if (db) db.close();
  process.exit(0);
});
