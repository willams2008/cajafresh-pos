const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.title.includes('New Project'));
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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 10000);
      });
    }

    ws.on('open', async () => {
      await new Promise(r => setTimeout(r, 3000));
      
      // Check the page state
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            url: window.location.href,
            title: document.title,
            inputs: Array.from(document.querySelectorAll('input')).map(function(i) {
              return { p: i.placeholder, t: i.type, name: i.name, id: i.id, cls: i.className.substring(0,60) };
            }),
            buttons: Array.from(document.querySelectorAll('button')).map(function(b) {
              return { text: b.textContent.trim().substring(0,50), disabled: b.disabled, cls: b.className.substring(0,60) };
            }).filter(function(b) { return b.text.length > 0; }),
            selects: Array.from(document.querySelectorAll('select')).map(function(s) {
              return { name: s.name, options: Array.from(s.options).map(function(o) { return o.text; }) };
            }),
            body: document.body.innerText.substring(0, 1500)
          })
        `,
        returnByValue: true
      });
      console.log('PAGE STATE:', r?.result?.result?.value);
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
