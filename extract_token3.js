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
      // Check __NEXT_DATA__ for initial props
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var nextData = document.getElementById('__NEXT_DATA__');
            if (!nextData) return 'NO_NEXT_DATA';
            try {
              var data = JSON.parse(nextData.textContent);
              var props = data.props?.pageProps || {};
              // Look for token in pageProps
              return JSON.stringify({
                hasToken: !!props.token,
                hasAccessToken: !!props.access_token,
                keys: Object.keys(props).filter(k => k.toLowerCase().includes('token') || k.toLowerCase().includes('key'))
              });
            } catch(e) { return 'PARSE_ERROR: ' + e.message; }
          })()
        `,
        returnByValue: true
      });
      console.log('NEXT_DATA:', r?.result?.result?.value);

      // Look for API response that might contain the token
      // Check if there's a generated token in the page's session
      const r2 = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            try {
              // Try to get the generated token from the API response
              // Supabase might have stored it in the generate endpoint response
              var tokenFromApi = sessionStorage.getItem('generated_token') || '';
              
              // Or check if the token is hidden in the page rendering
              var fullText = document.body.innerText;
              var sbpMatch = fullText.match(/sbp_[a-zA-Z0-9]{40,}/);
              
              return JSON.stringify({
                sessionToken: tokenFromApi,
                sbpFull: sbpMatch ? sbpMatch[0] : '',
                // Look for the original API response in __NEXT_DATA__
                nextDataToken: (function() {
                  var nd = document.getElementById('__NEXT_DATA__');
                  if (!nd) return '';
                  try {
                    var data = JSON.parse(nd.textContent);
                    return data.props?.pageProps?.generatedToken || '';
                  } catch(e) { return ''; }
                })()
              });
            } catch(e) { return 'ERROR: ' + e.message; }
          })()
        `,
        returnByValue: true,
        awaitPromise: true
      });
      console.log('TOKEN SEARCH:', r2?.result?.result?.value);

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
