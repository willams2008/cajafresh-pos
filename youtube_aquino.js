const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto('https://www.youtube.com/results?search_query=Aquino');
  await page.waitForTimeout(4000);

  // Click primer video
  const videoLink = await page.$('a#video-title');
  if (videoLink) {
    await videoLink.click();
    console.log('Video clickeado por #video-title');
  } else {
    console.log('No se encontro #video-title, intentando otro selector...');
    const fallback = await page.$('ytd-video-renderer a#thumbnail');
    if (fallback) {
      await fallback.click();
      console.log('Video clickeado por thumbnail');
    }
  }
  await page.waitForTimeout(6000);

  console.log('URL actual:', page.url());

  // Intentar varios selectores para comentarios
  const selectors = [
    '#simplebox-placeholder',
    '#placeholder-area',
    'yt-formatted-string#placeholder',
    '#comment-chip',
    '#comments #placeholder-area'
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      console.log(`Selector encontrado: ${sel}`);
      const text = await el.textContent();
      console.log(`Texto: "${text}"`);
      await el.click();
      await page.waitForTimeout(2000);
      await page.keyboard.type('hola aquino', { delay: 50 });
      console.log('Comentario escrito correctamente');
      break;
    }
  }

  // Verificar si hay boton de login
  const loginBtn = await page.$('a[href^="https://accounts.google.com"]');
  if (loginBtn) console.log('Botón de login detectado - No estás logueado');

  console.log('Script finalizado');
})();
