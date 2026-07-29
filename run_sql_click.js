const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const sql = fs.readFileSync('supabase-completo.sql', 'utf8');

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
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 120000);
    });
  }
  return new Promise((r) => {
    ws.on('open', () => r({ ws, send }));
    ws.on('error', (e) => { console.error('WS Error:', e.message); r(null); });
  });
}

async function evalJs(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.result?.value;
}

async function main() {
  let pages = await getPages();
  let p = pages.find(p => p.url.includes('sql/new'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  let c = await connect(p);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Set SQL in Monaco
  console.log('Setting SQL...');
  await evalJs(c, `
    (function() {
      var model = monaco.editor.getModels()[0];
      if (model) model.setValue(${JSON.stringify(sql)});
      return 'done';
    })()
  `);
  await new Promise(r => setTimeout(r, 2000));
  
  // Click the Run button
  console.log('Clicking Run...');
  const clickR = await evalJs(c, `
    (function() {
      var btns = document.querySelectorAll('button');
      for (var b of btns) {
        var txt = b.textContent.trim().toLowerCase();
        if (txt === 'run' || txt === 'run ctrl ↵') {
          b.click();
          return 'CLICKED_RUN';
        }
      }
      return 'NO_RUN_BUTTON';
    })()
  `);
  console.log('CLICK:', clickR);
  
  // Wait for results and keep polling
  for (var i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const state = await evalJs(c, `
      JSON.stringify({
        body: document.body.innerText.substring(0, 1000),
        hasError: document.body.innerText.toLowerCase().includes('error') || 
                   document.body.innerText.toLowerCase().includes('fail'),
        hasSuccess: document.body.innerText.includes('Success') || 
                    document.body.innerText.includes('successfully')
      })
    `);
    console.log('POLL ' + (i+1) + ':', state);
    
    var data = JSON.parse(state || '{}');
    if (data.hasSuccess || data.hasError) {
      console.log('DONE!');
      break;
    }
  }
  
  // Final state
  const finalState = await evalJs(c, `JSON.stringify({ body: document.body.innerText.substring(0, 3000) })`);
  console.log('FINAL:', finalState);
  
  c.ws.close();
  process.exit(0);
}

main();
