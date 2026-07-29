const { chromium } = require('playwright');
const { execSync } = require('child_process');

const preguntas = [
  "Ahora cuentame mas detalles: ¿Que opinas especificamente de usar Electron (JavaScript vanilla) para un sistema POS de escritorio? ¿Es buena eleccion?",
  "¿Crees que deberiamos migrar a React, Vue o Svelte? ¿O con vanilla JS basta para un POS?",
  "Hablando de la base de datos: SQLite3 para un POS que maneja ventas, inventario y reportes ¿es escalable? ¿Cuando conviene pasar a PostgreSQL o MySQL?",
  "El proyecto usa whatsapp-web.js para enviar notificaciones a clientes. ¿Es confiable para produccion? ¿Que alternativas recomiendas?",
  "Sobre los reportes: actualmente usamos jsPDF con jsPDF-autotable para generar reportes de ventas. ¿Hay mejores opciones o esta bien asi?",
  "Para sincronizacion en la nube estamos evaluando Cloudflared, Ngrok y LocalTunnel. ¿Cual recomiendas para un POS que necesita acceso remoto?",
  "¿Que medidas de seguridad recomiendas para un sistema POS que maneja transacciones y datos de clientes?",
  "¿Como podriamos mejorar la experiencia de usuario (UX) en un POS tactil? ¿Alguna libreria o patron de diseno que recomiendes?",
  "¿Que opinas del rendimiento general de Electron para esta aplicacion? ¿Hay optimizaciones clave que deberiamos implementar?",
  "Por ultimo: si tuvieras que redisenar Caja Fresh desde cero, ¿que stack usarias y cual seria la arquitectura ideal?"
];

let idx = 0;

async function esperarRespuestaGemini(page) {
  // Esperar a que desaparezca el indicador de "generando"
  for (let i = 0; i < 120; i++) {
    const stopBtn = await page.$('button:has(svg[data-icon="stop"])');
    const sendBtn = await page.$('button[aria-label="Enviar"], button[aria-label="Send"]');
    if (!stopBtn && sendBtn) {
      return true; // Gemini termino de responder
    }
    if (!stopBtn) {
      // Verificar si hay nuevo contenido
      return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function obtenerUltimaRespuesta(page) {
  try {
    const mensajes = await page.$$('div[data-message-author-role="model"], .model-response, .gemini-response, [data-test-id="model-response"]');
    if (mensajes.length > 0) {
      const ultimo = mensajes[mensajes.length - 1];
      const texto = await ultimo.textContent();
      return texto.substring(0, 200);
    }
    const allResponses = await page.$$('.response-content, .message-content, .conversation-turn');
    if (allResponses.length > 0) {
      const ultimo = allResponses[allResponses.length - 1];
      return (await ultimo.textContent()).substring(0, 200);
    }
  } catch(e) {
    return '(no se pudo leer)';
  }
  return '(vacio)';
}

(async () => {
  console.log('=== INICIANDO CONVERSACION INFINITA CON GEMINI ===');
  console.log('Presiona Ctrl+C para detener');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }
  await page.bringToFront();

  // Ciclo infinito de preguntas
  while (true) {
    console.log(`\n--- Pregunta ${idx + 1} ---`);
    
    const mensaje = preguntas[idx % preguntas.length];
    console.log('Enviando:', mensaje.substring(0, 60) + '...');

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) {
      console.log('No se encontro el input. Saliendo.');
      break;
    }

    await input.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(mensaje, { delay: 5 });
    await page.waitForTimeout(300);

    // Enviar con Enter
    // Primero intentar con Enter, si no funciona buscar boton
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    // Si el mensaje sigue ahi, intentar con el boton
    const inputText = await page.evaluate(() => {
      const el = document.querySelector('div.ql-editor[contenteditable="true"]');
      return el ? el.textContent : '';
    });
    if (inputText.length > 0) {
      // Buscar boton de enviar
      const sendBtn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"], button.send-button');
      if (sendBtn) await sendBtn.click();
    }

    console.log('Esperando respuesta de Gemini...');
    const respondio = await esperarRespuestaGemini(page);
    
    const respuesta = await obtenerUltimaRespuesta(page);
    console.log('Gemini respondio:', respuesta.substring(0, 100) + '...');

    idx++;
    
    // Pequena pausa entre preguntas
    await page.waitForTimeout(2000);
  }
})();
