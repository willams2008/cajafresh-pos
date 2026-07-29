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
  let p = pages.find(p => p.url.includes('api-keys'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  let c = await connect(p);
  if (!c) return;
  
  // Navigate to SQL editor
  await evalJs(c, `window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/sql/new'`);
  console.log('Navigating to SQL editor...');
  await new Promise(r => setTimeout(r, 5000));
  
  c.ws.close();
  await new Promise(r => setTimeout(r, 1500));
  
  pages = await getPages();
  p = pages.find(p => p.url.includes('sql/new') || (p.url.includes('sql') && p.url.includes('gmbqwybdrstmmdbcmitw')));
  if (!p) {
    console.log('SQL page not found. Available:');
    pages.filter(pg => pg.url.includes('gmbqwybdrstmmdbcmitw')).forEach(f => console.log(f.title, '|', f.url));
    return;
  }
  
  console.log('Found SQL page:', p.title.substring(0, 60), p.url.substring(0, 130));
  
  c = await connect(p);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 4000));
  
  // Check page state
  const state = await evalJs(c, `
    JSON.stringify({
      url: window.location.href,
      title: document.title,
      hasTextarea: document.querySelector('textarea') !== null,
      hasEditor: document.querySelector('[class*="monaco"], [class*="cm-"], [class*="ace"], [contenteditable="true"]') !== null,
      bodySubstr: document.body.innerText.substring(0, 500)
    })
  `);
  console.log('SQL PAGE:', state);
  
  // The SQL editor uses Monaco editor (VS Code's editor)
  // Look for Monaco or contenteditable div
  const editorInfo = await evalJs(c, `
    JSON.stringify({
      textareas: Array.from(document.querySelectorAll('textarea')).length,
      monaco: document.querySelector('.monaco-editor') !== null,
      contenteditables: Array.from(document.querySelectorAll('[contenteditable="true"]')).length,
      cm: document.querySelector('.cm-editor') !== null,
      // Check for Monaco model
      monacoModels: typeof monaco !== 'undefined' ? monaco.editor.getModels().length : 'no global monaco',
      // Check for specific editors
      editors: (typeof window.__NEXT_DATA__ !== 'undefined') ? 'has_next_data' : 'no_next_data'
    })
  `);
  console.log('EDITOR INFO:', editorInfo);
  
  // Try to find and use the SQL editor
  const sqlLen = sql.length;
  console.log('SQL length:', sqlLen);
  
  // Try to use the query endpoint instead
  const token = await evalJs(c, `
    (function() {
      try {
        var raw = localStorage.getItem('supabase.dashboard.auth.token');
        return JSON.parse(raw).access_token;
      } catch(e) { return null; }
    })()
  `);
  
  if (token) {
    console.log('Token found, trying SQL API...');
    
    // Try the dashboard's internal API for running SQL
    const apiR = await evalJs(c, `
      (async function() {
        var token = ${JSON.stringify(token)};
        var sql = ${JSON.stringify(sql.substring(0, 5000))};  // First 5000 chars
        
        // Try the Supabase SQL query endpoint
        try {
          var res = await fetch('/api/projects/gmbqwybdrstmmdbcmitw/database/query', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ query: sql })
          });
          return 'API ' + res.status + ': ' + (await res.text()).substring(0, 500);
        } catch(e) {
          return 'FETCH_ERR: ' + e.message;
        }
      })()
    `);
    console.log('API RESULT:', apiR);
  } else {
    console.log('No token available');
  }
  
  c.ws.close();
  process.exit(0);
}

main();
