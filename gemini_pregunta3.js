const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) { console.log('ERROR: Gemini no abierto'); await browser.close(); return; }

  await page.bringToFront();
  await page.waitForTimeout(2000);

  let input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) input = await page.$('[contenteditable="true"]');
  if (!input) { console.log('ERROR: No input'); await browser.close(); return; }

  await input.click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);

  const msg = `Olvidate de Playwright y Opera GX, eso no va.

Mi duda es sobre la API de Gemini que mencionaste (Google Generative AI / Gemini API).

1. ¿Cuales son los LIMITES del tier gratuito? (requests por minuto, tokens por dia, etc)
2. ¿Hay riesgo de que bloquee por uso en Venezuela?
3. ¿Necesito tarjeta de credito para activarla o es completamente gratis sin tarjeta?
4. El modelo Gemini 1.5 Flash es suficiente para un chatbot de WhatsApp de una tienda pequeña?
5. ¿Que pasa si excedo el limite gratuito? Se corta o me cobra automaticamente?
6. ¿La API funciona bien desde una PC en Venezuela o hay restricciones regionales?

Dame datos concretos y actuales.`;

  await page.keyboard.type(msg, { delay: 2 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  console.log('✓ Pregunta 3 enviada');

  let prevLen = 0;
  let stable = 0;
  const inicio = Date.now();

  while (Date.now() - inicio < 300000) {
    await page.waitForTimeout(3000);
    const textLen = await page.evaluate(() => document.body.innerText.length);
    if (textLen === prevLen) { stable += 3; if (stable >= 18) break; }
    else { stable = 0; prevLen = textLen; process.stdout.write('█'); }
  }

  const res = await page.evaluate(() => document.body.innerText);
  console.log('\n\n=== GEMINI ===');
  console.log(res);
  console.log('\n==== FIN ====');
  await browser.close();
})().catch(e => console.error('Error:', e.message));
