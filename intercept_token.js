const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/account/tokens'));
    if (!p) { console.log('NO_PAGE'); 
      pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(f.title, f.url.substring(0,80)));
      return; 
    }
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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 10000);
      });
    }

    ws.on('open', async () => {
      // Override fetch to intercept API responses with tokens
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var origFetch = window.fetch;
            window.fetch = function() {
              var url = arguments[0];
              var opts = arguments[1] || {};
              
              return origFetch.apply(this, arguments).then(function(response) {
                // Clone the response so we can read it
                var clone = response.clone();
                
                if (typeof url === 'string' && (url.includes('/tokens') || url.includes('/access-tokens')) && opts.method === 'POST') {
                  clone.text().then(function(body) {
                    console.log('INTERCEPTED TOKEN RESPONSE:', body);
                    // Store in window for later retrieval
                    window._lastTokenResponse = body;
                  });
                }
                
                return response;
              });
            };
            return 'Fetch overridden for token capture';
          })()
        `,
        returnByValue: true
      });
      console.log('INJECT:', r?.result?.result?.value);

      console.log('Interceptor activo. Ahora GENERA EL TOKEN en Supabase.');
      console.log('Esperando... (max 30s)');

      // Wait and check for the token
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        const check = await send('Runtime.evaluate', {
          expression: 'window._lastTokenResponse || ""',
          returnByValue: true
        });
        const val = check?.result?.result?.value || '';
        
        if (val) {
          console.log('TOKEN CAPTURED:', val);
          ws.close();
          process.exit(0);
        }
      }
      
      console.log('No se capturo token. Intentando lectura directa del DOM...');
      const final = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var text = document.body.innerText;
            var match = text.match(/sbp_[a-zA-Z0-9]{50,}/);
            if (match) return match[0];
            // Try to find unmasked version
            var all = document.querySelectorAll('*');
            for (var el of all) {
              var t = el.textContent.trim();
              if (t.startsWith('sbp_') && !t.includes('••')) return t;
            }
            return 'MASKED_ONLY';
          })()
        `,
        returnByValue: true
      });
      console.log('DOM CHECK:', final?.result?.result?.value);
      
      ws.close();
    });
    
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
