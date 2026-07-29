const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    console.log('No se encontro la pestana de Gemini');
    return;
  }
  await page.bringToFront();
  await page.waitForTimeout(1000);

  const input = await page.$('div.ql-editor[contenteditable="true"]');
  if (input) {
    await input.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    console.log('Mensaje enviado a Gemini!');
  } else {
    console.log('No se encontro el input');
  }
})();
