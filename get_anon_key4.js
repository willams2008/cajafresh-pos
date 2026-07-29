const WebSocket = require('ws');
const http = require('http');

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
  const http = require('http');
  const pages = await new Promise((resolve) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
  });
  
  const p = pages.find(p => p.url.includes('api-keys'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  const c = await connect(p);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Try to click "Legacy" section to reveal keys
  const r = await c.send('Runtime.evaluate', {
    expression: `
      (function() {
        var result = {};
        
        // Find links/buttons with "Legacy" text
        var elements = document.querySelectorAll('a, button, [role="button"], summary, details, span, div');
        elements.forEach(function(el) {
          var txt = el.textContent.trim().toLowerCase();
          if (txt.includes('legacy') || txt.includes('anon') || txt.includes('service_role')) {
            result.found = {
              tag: el.tagName,
              text: el.textContent.trim().substring(0, 80),
              role: el.getAttribute('role') || ''
            };
            el.click();
          }
        });
        
        result.clicked = result.found ? 'yes' : 'no';
        
        // Also look for any collapsed sections
        var details = document.querySelectorAll('details');
        result.detailsCount = details.length;
        details.forEach(function(d) {
          if (!d.open) d.open = true;
        });
        
        return JSON.stringify(result);
      })()
    `,
    returnByValue: true
  });
  console.log('CLICK LEGACY:', r?.result?.result?.value);
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Now look for the anon key in the page
  const r2 = await c.send('Runtime.evaluate', {
    expression: `
      JSON.stringify({
        text: document.body.innerText.substring(0, 6000),
        inputs: Array.from(document.querySelectorAll('input')).map(function(i) {
          return { type: i.type, value: (i.value || '').substring(0, 200) };
        }).filter(function(i) { return i.value.length > 0; })
      })
    `,
    returnByValue: true
  });
  console.log('PAGE:', r2?.result?.result?.value);
  
  c.ws.close();
  process.exit(0);
}

main();
