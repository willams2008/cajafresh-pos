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

async function go() {
  // Find any Supabase dashboard page to navigate from
  var pages = await getPages();
  var p = pages.find(p => p.url.includes('supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw') && !p.url.includes('stripe'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  var c = await connect(p);
  if (!c) return;
  
  // Navigate to SQL editor new query
  await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/sql/new'");
  console.log('Navigating...');
  await new Promise(r => setTimeout(r, 6000));
  c.ws.close();
  
  await new Promise(r => setTimeout(r, 2000));
  
  pages = await getPages();
  p = pages.find(p => p.url.includes('/sql/new'));
  if (!p) {
    console.log('NO_SQL_PAGE');
    pages.filter(pg => pg.url.includes('gmbqwybdrstmmdbcmitw')).forEach(f => console.log(f.title, '|', f.url));
    return;
  }
  
  console.log('Found:', p.title, p.url.substring(0, 100));
  c = await connect(p);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Set SQL
  console.log('Setting SQL...');
  var r = await evalJs(c, `
    (function() {
      try {
        var model = monaco.editor.getModels()[0];
        if (model) {
          model.setValue(${JSON.stringify(sql)});
          return 'SET: ' + model.getValue().length + ' chars';
        }
        return 'NO_MODEL';
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `);
  console.log('RESULT:', r);
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Click Run
  console.log('Clicking Run...');
  await evalJs(c, `
    (function() {
      var buttons = document.querySelectorAll('button');
      for (var b of buttons) {
        var txt = b.textContent.trim().toLowerCase().replace(/\\s+/g, ' ');
        if (txt === 'run' || txt === 'run ctrl ↵') {
          b.click();
          return;
        }
      }
    })()
  `);
  
  // Poll for results
  for (var i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    var state = await evalJs(c, 'document.body.innerText.substring(0, 2000)');
    console.log('POLL ' + (i+1));
    
    // Check for success or error
    if (state.includes('Success. No rows returned') || state.includes('Success, no rows')) {
      console.log('SQL EXECUTED SUCCESSFULLY');
      console.log('STATE:', state);
      break;
    }
    if (state.includes('ERROR') && (state.includes('syntax') || state.includes('SQL'))) {
      console.log('SQL ERROR:');
      console.log('STATE:', state);
      break;
    }
    if (state.includes('Results') && !state.includes('Click Run')) {
      console.log('SQL probably finished:');
      console.log('STATE:', state);
      // Check for specific results
      var fullState = await evalJs(c, 'document.body.innerText');
      console.log('FULL:', fullState.substring(0, 4000));
      break;
    }
  }
  
  c.ws.close();
  process.exit(0);
}

go();
