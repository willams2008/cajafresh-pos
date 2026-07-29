const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('api-keys'));
    if (!p) { console.log('NO_PAGE'); return; }
    
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    let id = 1;
    function send(method, params) {
      return new Promise((r) => {
        const mid = id++;
        ws.send(JSON.stringify({ id: mid, method, params }));
        const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === mid) r(m); } catch(e) {} };
        ws.on('message', h);
        setTimeout(() => { ws.removeListener('message', h); r(null); }, 10000);
      });
    }
    
    ws.on('open', async () => {
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            projUrl: 'https://gmbqwybdrstmmdbcmitw.supabase.co',
            allInputs: Array.from(document.querySelectorAll('input')).map(function(i) { return {t: i.type, v: i.value}; }),
            pageText: document.body.innerText
          })
        `,
        returnByValue: true
      });
      var data = JSON.parse(r?.result?.result?.value || '{}');
      
      // Find anon key from inputs
      var anonKey = '';
      data.allInputs.forEach(function(inp) {
        if (inp.t === 'text' && inp.v.startsWith('eyJ')) {
          anonKey = inp.v;
        }
      });
      
      console.log('Supabase URL:', data.projUrl);
      console.log('Anon Key:', anonKey);
      console.log('Service Key:', data.allInputs.find(function(i) { return i.t === 'password'; })?.v || '');
      
      ws.close();
      process.exit(0);
    });
  });
}).on('error', e => { console.error('Error:', e.message); process.exit(1); });
