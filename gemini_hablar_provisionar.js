const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function preguntar(page, mensaje) {
  let input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) input = await page.$('[contenteditable="true"]');
  if (!input) { console.log('No input'); return null; }

  await input.click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  await page.keyboard.type(mensaje, { delay: 1 });
  await page.waitForTimeout(800);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const resto = await page.evaluate(() => document.querySelector('[contenteditable="true"]')?.textContent?.length || 0);
  if (resto > 20) {
    const btn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"]');
    if (btn) await btn.click();
  }

  console.log('Enviado, esperando respuesta...');

  let prevLen = 0, stable = 0, inicio = Date.now();
  while (Date.now() - inicio < 300000) {
    await page.waitForTimeout(3000);
    const textLen = await page.evaluate(() => document.body.innerText.length);
    if (textLen === prevLen) { stable += 3; if (stable >= 18) break; }
    else { stable = 0; prevLen = textLen; process.stdout.write('.'); }
  }

  const res = await page.evaluate(() => document.body.innerText);
  console.log('\n\n=== GEMINI ===\n');
  console.log(res);
  fs.writeFileSync('gemini_ultima_respuesta.txt', res, 'utf8');
  console.log('\n=============\nRespuesta guardada en gemini_ultima_respuesta.txt');
  return res;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }
  await page.bringToFront();
  await page.waitForTimeout(2000);

  console.log('Conectado a Gemini\n');

  const msgFile = process.argv[2];
  if (!msgFile) {
    console.log('Uso: node gemini_hablar_provisionar.js <archivo_mensaje.txt>');
    await browser.close();
    return;
  }

  const mensaje = fs.readFileSync(msgFile, 'utf8');
  await preguntar(page, mensaje);
  await browser.close();
})();
