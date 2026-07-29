const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) { console.log('No hay pestana de Gemini'); return; }
  await page.bringToFront();
  await page.waitForTimeout(2000);

  // Obtener toda la conversacion
  const conversacion = await page.evaluate(() => {
    const turns = document.querySelectorAll('.conversation-turn, [data-message-id], .turn, .chat-turn');
    const result = [];
    turns.forEach(t => {
      const text = t.textContent.trim();
      if (text) result.push(text.substring(0, 500));
    });
    return result;
  });

  if (conversacion.length === 0) {
    // Fallback: buscar cualquier cosa con texto
    const todo = await page.evaluate(() => {
      const body = document.querySelector('body');
      return body ? body.innerText.substring(0, 3000) : 'vacio';
    });
    console.log('Contenido de la pagina:');
    console.log(todo);
  } else {
    console.log('=== CONVERSACION CON GEMINI ===');
    conversacion.forEach((msg, i) => {
      console.log(`\n[${i % 2 === 0 ? 'YO' : 'GEMINI'}] ${msg.substring(0, 300)}`);
    });
  }
})();
