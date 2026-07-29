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
  var pages = await getPages();
  var p = pages.find(p => p.url.includes('gmbqwybdrstmmdbcmitw') && !p.url.includes('stripe'));
  if (!p) { console.log('NO_PAGE'); return; }

  var c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;

  // Navigate to SQL editor new query
  await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/sql/new'");
  console.log('Navigating to SQL editor...');
  await new Promise(r => setTimeout(r, 7000));
  c.ws.close();
  await new Promise(r => setTimeout(r, 2000));

  pages = await getPages();
  p = pages.find(p => p.url.includes('/sql/new'));
  if (!p) { console.log('NO_SQL_PAGE'); return; }

  c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  await new Promise(r => setTimeout(r, 4000));

  // Set SQL via Monaco
  await evalJs(c, `monaco.editor.getModels()[0]?.setValue(${JSON.stringify(sql)})`);
  console.log('SQL set');
  await new Promise(r => setTimeout(r, 2000));

  // Use Ctrl+Shift+Enter keyboard shortcut via CDP Input.dispatchKeyEvent
  // First, focus the editor
  await evalJs(c, `
    (function() {
      var editor = document.querySelector('.monaco-editor');
      if (editor) editor.focus();
      return 'focused';
    })()
  `);
  await new Promise(r => setTimeout(r, 500));

  // Send Ctrl+Enter
  console.log('Sending Ctrl+Enter...');
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 17, key: 'Control', code: 'ControlLeft' });
  await new Promise(r => setTimeout(r, 100));
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
  await new Promise(r => setTimeout(r, 100));
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
  await new Promise(r => setTimeout(r, 100));
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyUp', windowsVirtualKeyCode: 17, key: 'Control', code: 'ControlLeft' });

  // Poll for results
  for (var i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    var txt = await evalJs(c, 'document.body.innerText');
    if (txt.includes('Success. No rows returned') || txt.includes('Success, no rows')) {
      console.log('SUCCESS!');
      break;
    }
    if (txt.includes('Too small')) {
      console.log('Got "Too small" - trying to click Run button instead...');
      // Click Run directly
      await evalJs(c, `
        (function() {
          var buttons = document.querySelectorAll('button');
          for (var b of buttons) {
            if (b.textContent.trim().toLowerCase().startsWith('run')) {
              b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              b.click();
              return 'clicked';
            }
          }
        })()
      `);
      break;
    }
    if (txt.includes('ERROR') || txt.includes('Error:')) {
      var m = txt.match(/Error:[^\\n]+/);
      console.log('Error:', m ? m[0] : txt.substring(0, 2000));
      break;
    }
    if (i === 0 || i % 6 === 0) console.log('Waiting (' + ((i+1)*5) + 's)...');
  }

  // Final state
  var finalTxt = await evalJs(c, 'document.body.innerText');
  var relevant = finalTxt.split('Results')[1] || finalTxt.substring(finalTxt.lastIndexOf('0 rows'), finalTxt.length + 500);
  console.log('FINAL:', relevant.substring(0, 2000));
  
  c.ws.close();
  process.exit(0);
}

main();
