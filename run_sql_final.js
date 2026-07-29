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
    });
  });
}

async function connect(wsurl) {
  const ws = new WebSocket(wsurl);
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
    ws.on('error', (e) => r(null));
  });
}

async function evalJs(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.result?.value;
}

async function main() {
  // Navigate to SQL editor from any project page
  var pages = await getPages();
  var p = pages.find(p => p.url.includes('gmbqwybdrstmmdbcmitw') && p.url.includes('sql/new'));
  
  if (!p) {
    p = pages.find(p => p.url.includes('gmbqwybdrstmmdbcmitw') && !p.url.includes('stripe'));
    if (!p) { console.log('NO_PAGE'); return; }
    
    var c = await connect(p.webSocketDebuggerUrl);
    if (!c) return;
    await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/sql/new'");
    console.log('Navigating...');
    await new Promise(r => setTimeout(r, 7000));
    c.ws.close();
    await new Promise(r => setTimeout(r, 2000));
    
    pages = await getPages();
    p = pages.find(p => p.url.includes('/sql/new'));
    if (!p) { console.log('NO_SQL_PAGE'); return; }
  }
  
  console.log('Connected to SQL editor');
  var c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Ensure the editor is loaded and set SQL
  console.log('Setting SQL...');
  var r = await evalJs(c, `
    (function() {
      try {
        var model = monaco.editor.getModels()[0];
        if (!model) return 'NO_MODEL';
        model.setValue(${JSON.stringify(sql)});
        return 'OK ' + model.getValue().length;
      } catch(e) { return e.message; }
    })()
  `);
  console.log('Set result:', r);
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Verify the value is set
  var check = await evalJs(c, `monaco.editor.getModels()[0]?.getValue()?.length || 0`);
  console.log('Value length in editor:', check);
  
  // Try clicking Run using a more specific selector
  console.log('Clicking Run button...');
  await evalJs(c, `
    (function() {
      // Try to find the Run button by its text content specifically
      var buttons = document.querySelectorAll('button');
      for (var b of buttons) {
        var txt = b.textContent.trim();
        if (txt === 'Run' || txt === 'Run Ctrl ↵' || txt === 'Run\\nCtrl ↵') {
          console.log('Found Run button:', b.outerHTML.substring(0, 200));
          // Dispatch mousedown, mouseup, click on the button
          b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          b.click();
          return 'CLICKED';
        }
      }
      return 'NOT_FOUND: ' + buttons.map(function(b) { return JSON.stringify(b.textContent.trim()); }).join(', ');
    })()
  `);
  
  // Wait for results
  for (var i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    var txt = await evalJs(c, 'document.body.innerText');
    
    // Check status
    if (txt.includes('Success. No rows returned') || txt.includes('Success, no rows')) {
      console.log('SUCCESS after ' + (i+1) + ' polls');
      console.log(txt.substring(0, 2000));
      break;
    }
    if (txt.includes('Too small') || txt.includes('Error:')) {
      console.log('ERROR:');
      // Find error section
      var errMatch = txt.match(/Error:[^\\n]+/);
      if (errMatch) console.log(errMatch[0]);
      console.log(txt.substring(0, 2000));
      break;
    }
    if (i === 0) console.log('Waiting for results...');
  }
  
  c.ws.close();
  process.exit(0);
}

main();
