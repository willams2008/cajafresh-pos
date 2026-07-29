const WebSocket = require('ws');
const http = require('http');

async function getPages() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', e => { console.error(e.message); resolve([]); });
  });
}

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  function send(method, params) {
    return new Promise((r) => {
      const mid = id++;
      ws.send(JSON.stringify({ id: mid, method, params }));
      const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === mid) r(m); } catch(e) {} };
      ws.on('message', h);
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 15000);
    });
  }
  return new Promise((r) => {
    ws.on('open', () => r({ ws, send }));
    ws.on('error', (e) => { console.error('WS Error:', e.message); r(null); });
  });
}

async function main() {
  let pages = await getPages();
  let p = pages.find(p => p.url.includes('integrations/data_api'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  let c = await connect(p);
  if (!c) return;
  
  // Try clicking the Settings tab
  await c.send('Runtime.evaluate', {
    expression: `
      (function() {
        var tabs = document.querySelectorAll('a, button');
        for (var t of tabs) {
          if (t.textContent.trim() === 'Settings') {
            t.click();
            return 'CLICKED_SETTINGS';
          }
        }
        return 'NO_SETTINGS_TAB';
      })()
    `,
    returnByValue: true
  });
  console.log('Clicking Settings...');
  await new Promise(r => setTimeout(r, 4000));
  
  const r = await c.send('Runtime.evaluate', {
    expression: `
      JSON.stringify({
        url: window.location.href,
        text: document.body.innerText.substring(0, 4000)
      })
    `,
    returnByValue: true
  });
  console.log('SETTINGS:', r?.result?.result?.value);
  
  c.ws.close();
  process.exit(0);
}

main();
