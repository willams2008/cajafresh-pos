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
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 60000);
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
  
  // Set the SQL content in Monaco
  const sqlLen = sql.length;
  console.log('Setting SQL content (' + sqlLen + ' chars)...');
  
  // Split SQL into chunks for Monaco
  const chunkSize = 50000;
  const chunks = [];
  for (let i = 0; i < sql.length; i += chunkSize) {
    chunks.push(sql.substring(i, i + chunkSize));
  }
  
  // Use Monaco API to set the content
  const setR = await evalJs(c, `
    (function() {
      try {
        var model = monaco.editor.getModels()[0];
        if (model) {
          var sql = ${JSON.stringify(chunks[0])};
          model.setValue(sql);
          return 'SET_OK model=' + model.uri.toString();
        }
        // Try to find editor instances
        var editors = document.querySelectorAll('.monaco-editor');
        return 'No model found, editors=' + editors.length;
      } catch(e) {
        return 'ERROR: ' + e.message;
      }
    })()
  `);
  console.log('SET:', setR);
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Check if content was set
  const checkR = await evalJs(c, `
    JSON.stringify({
      modelValueLen: monaco.editor.getModels()[0]?.getValue()?.length || 0,
      modelValueStart: (monaco.editor.getModels()[0]?.getValue() || '').substring(0, 100)
    })
  `);
  console.log('CHECK:', checkR);
  
  // Press Ctrl+Enter to run
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    windowsVirtualKeyCode: 17,
    key: 'Control',
    code: 'ControlLeft'
  });
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    windowsVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter'
  });
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyUp',
    windowsVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter'
  });
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyUp',
    windowsVirtualKeyCode: 17,
    key: 'Control',
    code: 'ControlLeft'
  });
  console.log('Ctrl+Enter sent');
  
  // Wait for results
  await new Promise(r => setTimeout(r, 5000));
  
  // Check page state
  const resultR = await evalJs(c, `
    JSON.stringify({
      body: document.body.innerText.substring(0, 1500),
      buttons: Array.from(document.querySelectorAll('button')).map(function(b) {
        return { text: b.textContent.trim().substring(0, 30), disabled: b.disabled };
      }).filter(function(b) { return b.text.length > 0; })
    })
  `);
  console.log('RESULT:', resultR);
  
  c.ws.close();
  process.exit(0);
}

main();
