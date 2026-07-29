require('dotenv').config();
const path = require('path');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const AUTH_DIR = path.join(__dirname, 'auth_info');
const PHONE = process.env.BOSS_PHONE || '584123633283';

(async () => {
  console.log('🔗 INICIANDO VINCULACIÓN DE WHATSAPP...\n');
  console.log(`📱 Número configurado: ${PHONE}`);
  console.log('');

  if (fs.existsSync(AUTH_DIR)) {
    console.log('📁 auth_info existe. Verificando si ya está vinculado...');
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds?.registered) {
    console.log('✅ Ya estás vinculado. Ejecuta: node index.js');
    process.exit(0);
  }

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Caja Fresh Bot', 'Chrome', '1.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingGenerated = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Mostrar QR si llega (como respaldo)
    if (qr && !pairingGenerated) {
      console.log('\n📱 CÓDIGO QR (ALTERNATIVO):');
      console.log('Si el pairing code no funciona, escanea este QR:');
      try {
        const QRCode = require('qrcode-terminal');
        QRCode.generate(qr, { small: true });
      } catch(e) {
        console.log('QR:', qr.substring(0, 80) + '...');
      }
    }

    if (connection === 'open') {
      console.log('\n✅ ¡CONECTADO A WHATSAPP!');
      console.log(`📱 Número: ${sock.user?.id?.split(':')[0] || 'desconocido'}`);
      process.exit(0);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      
      if (loggedOut) {
        console.log(`\n❌ Sesión cerrada (${code}).`);
        console.log('Posibles causas:');
        console.log('  - El número de teléfono no coincide con tu WhatsApp');
        console.log('  - WhatsApp bloqueó la solicitud');
        console.log('  - Código expiró');
        console.log('\nSoluciones:');
        console.log('  1. Verifica que tu número en .env sea exactamente tu WhatsApp');
        console.log('  2. Espera 5 minutos y vuelve a intentar');
        console.log('  3. Como respaldo, escanea el QR que apareció arriba');
        process.exit(1);
      } else {
        console.log('🔄 Reconexión...');
      }
    }
  });

  // Esperar conexión estable y generar pairing code
  await new Promise(r => setTimeout(r, 5000));

  if (!pairingGenerated) {
    pairingGenerated = true;
    console.log('\n═══════════════════════════════════════');
    try {
      const code = await sock.requestPairingCode(PHONE);
      console.log(`  🔐 CÓDIGO: ${code}`);
      console.log('');
      console.log('  📱 WhatsApp → Dispositivos vinculados');
      console.log('  → Vincular un dispositivo');
      console.log('  → "Vincular con número de teléfono"');
      console.log(`  → Escribe: ${code}`);
      console.log('\n  ⏱  Tienes 2 minutos');
      console.log('═══════════════════════════════════════\n');

      // Esperar hasta 2 minutos
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000));
        process.stdout.write('.');
        if (sock.authState.creds?.registered) {
          console.log('\n✅ ¡Vinculado exitosamente!');
          process.exit(0);
        }
      }

      console.log('\n⏰ Tiempo agotado.');
      console.log('Vuelve a ejecutar: node pair.js');
      process.exit(1);

    } catch(e) {
      console.log(`\n❌ Error: ${e.message}`);
      console.log('\n📱 Como respaldo, escanea el QR que apareció arriba.');
    }
  }
})();
