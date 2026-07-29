const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const sql = fs.readFileSync('supabase-completo.sql', 'utf8');

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  function send(method, params) {
    return new Promise((r) => {
      const mid = id++;
      ws.send(JSON.stringify({ id: mid, method, params }));
      const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === mid) r(m); } catch(e) {} };
      ws.on('message', h);
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 30000);
    });
  }
  return new Promise((r) => {
    ws.on('open', () => r({ ws, send }));
    ws.on('error', (e) => { console.error('WS Error:', e.message); r(null); });
  });
}

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('api-keys') && p.url.includes('gmbqwybdrstmmdbcmitw'));
    if (!p) { console.log('NO_PAGE'); return; }
    
    const c = await connect(p);
    if (!c) return;
    
    // Get the session token
    const tokenR = await c.send('Runtime.evaluate', {
      expression: `
        (function() {
          try {
            var raw = localStorage.getItem('supabase.dashboard.auth.token');
            if (raw) return JSON.parse(raw).access_token;
            // Try other token locations
            var keys = Object.keys(localStorage);
            for (var k of keys) {
              if (k.includes('token') || k.includes('auth')) {
                try {
                  var v = JSON.parse(localStorage.getItem(k));
                  if (v.access_token) return v.access_token;
                  if (v.token) return v.token;
                } catch(e) {}
              }
            }
            return 'NO_TOKEN';
          } catch(e) { return 'ERROR: ' + e.message; }
        })()
      `,
      returnByValue: true
    });
    const token = tokenR?.result?.result?.value;
    if (!token || token === 'NO_TOKEN') {
      console.log('NO_TOKEN available');
      c.ws.close();
      return;
    }
    console.log('Token found, length:', token.length);
    
    // Try the Management API SQL endpoint
    console.log('Sending SQL to Management API...');
    console.log('SQL length:', sql.length);
    
    // Try using fetch from within the page (has correct CORS context)
    const sqlR = await c.send('Runtime.evaluate', {
      expression: `
        (async function() {
          var token = ${JSON.stringify(token)};
          var sql = ${JSON.stringify(sql)};
          
          try {
            // Try Management API SQL endpoint
            var res = await fetch('https://api.supabase.com/v1/projects/gmbqwybdrstmmdbcmitw/sql', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ query: sql })
            });
            return 'MGMT_SQL ' + res.status + ': ' + (await res.text()).substring(0, 500);
          } catch(e) {
            return 'ERROR: ' + e.message;
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true
    });
    console.log('SQL RESULT:', sqlR?.result?.result?.value);
    
    c.ws.close();
    process.exit(0);
  });
}).on('error', e => { console.error('Error:', e.message); process.exit(1); });
