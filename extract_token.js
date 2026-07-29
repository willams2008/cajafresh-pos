const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/account/tokens'));
    if (!p) { console.log('NO_PAGE: Access Tokens page not found'); 
      pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(f.title, '|', f.url.substring(0,100)));
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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 5000);
      });
    }
    ws.on('open', async () => {
      // Try to extract the token from the page - might be in DOM or API response
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            dom: (function() {
              var el = document.querySelector('[data-token]') || document.querySelector('code, .token-value, [class*="token"]');
              return el ? el.textContent.trim() : '';
            })(),
            localTokens: Object.keys(localStorage).filter(k => k.includes('token') || k.includes('pat')),
            url: window.location.href
          })
        `,
        returnByValue: true
      });
      console.log('PAGE INFO:', r?.result?.result?.value || 'NONE');

      // Also check the page body for the token
      const r2 = await send('Runtime.evaluate', {
        expression: 'document.body.innerText.substring(0, 3000)',
        returnByValue: true
      });
      console.log('BODY:', r2?.result?.result?.value || 'NONE');

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
