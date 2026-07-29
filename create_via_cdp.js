const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    // Find the new project page or any Supabase dashboard page
    const p = pages.find(p => p.url.includes('supabase.com/dashboard') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
    if (!p) { console.log('NO_PAGE'); 
      pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(' -', f.title, f.url.substring(0,100)));
      return; 
    }
    console.log('Using page:', p.title, p.url.substring(0,100));
    
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    let msgId = 1;
    function send(method, params) {
      return new Promise((resolve2) => {
        const id = msgId++;
        ws.send(JSON.stringify({ id, method, params }));
        const handler = (data) => {
          try { const m = JSON.parse(data.toString()); if (m.id === id) resolve2(m); } catch(e) {}
        };
        ws.on('message', handler);
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 15000);
      });
    }
    ws.on('open', async () => {
      // Get current URL
      const urlR = await send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true
      });
      console.log('Current URL:', urlR?.result?.result?.value);

      // Get the access_token from localStorage
      const tokenR = await send('Runtime.evaluate', {
        expression: 'try { JSON.parse(localStorage.getItem("supabase.dashboard.auth.token")).access_token } catch(e) { "" }',
        returnByValue: true
      });
      const token = tokenR?.result?.result?.value || '';
      console.log('Token length:', token.length > 0 ? token.substring(0, 30) + '...' : 'NONE');

      // Try calling the correct Supabase Management API
      // The management API is at https://api.supabase.com but needs a specific auth header
      const password = 'CajaFresh' + Math.random().toString(36).slice(2, 8) + '!';
      console.log('Attempting API call...');

      // Try the correct project creation endpoint
      const createR = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            try {
              // Get the session access token
              const sbToken = JSON.parse(localStorage.getItem("supabase.dashboard.auth.token"));
              const token = sbToken.access_token;
              
              const res = await fetch('https://api.supabase.com/v1/projects', {
                method: 'POST',
                headers: {
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json',
                  'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                  org_id: 'zyxkuofvorykdlnutrlj',
                  name: 'almacen-cliente-' + Date.now().toString(36),
                  plan: 'free',
                  db_pass: '${password}',
                  region: 'us-east-1',
                  db_version: '15.6.1.116'
                })
              });
              
              if (!res.ok) {
                const text = await res.text();
                return 'HTTP ' + res.status + ': ' + text.substring(0, 500);
              }
              const data = await res.json();
              return 'SUCCESS: ' + JSON.stringify(data);
            } catch(e) {
              return 'FETCH ERROR: ' + e.message;
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: true
      });
      
      const result = createR?.result?.result?.value || 'NO_RESULT';
      console.log('RESULT:', result);
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
