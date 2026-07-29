const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/account/tokens'));
    if (!p) { console.log('NO_PAGE'); return; }
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    let msgId = 1;
    let tokenFound = false;
    
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

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Listen for network responses
        if (msg.method === 'Network.responseReceived' && !tokenFound) {
          const reqId = msg.params.requestId;
          const url = msg.params.response.url;
          
          if (url.includes('/tokens') || url.includes('/access-tokens')) {
            console.log('Token API response detected:', url);
            
            // Get the response body
            const bodyResult = await send('Network.getResponseBody', { requestId: reqId });
            const responseBody = bodyResult?.result?.body || '';
            
            if (responseBody.includes('sbp_') || responseBody.includes('token')) {
              console.log('RESPONSE BODY:', responseBody.substring(0, 500));
              tokenFound = true;
            }
          }
        }
      } catch(e) {}
    });

    ws.on('open', async () => {
      // Enable network monitoring
      await send('Network.enable');
      console.log('Network monitoring enabled. Generate the token now!');
      
      // Set a timeout
      setTimeout(async () => {
        if (!tokenFound) {
          // Try to get token from page one more time
          const r = await send('Runtime.evaluate', {
            expression: `
              (function() {
                var text = document.body.innerText;
                var match = text.match(/sbp_[a-zA-Z0-9]+/);
                return match ? match[0] : 'NOT_FOUND';
              })()
            `,
            returnByValue: true
          });
          console.log('FINAL CHECK:', r?.result?.result?.value);
        }
        ws.close();
      }, 30000);
    });
    
    ws.on('error', (e) => { console.error('Error:', e.message); });
  });
}).on('error', (e) => { console.error('Error:', e.message); });
