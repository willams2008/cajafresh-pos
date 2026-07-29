const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages[0];
    
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
      // Try clicking the "New project" link
      const clickR = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var target = Array.from(document.querySelectorAll('a')).find(function(el) {
              return el.textContent.toLowerCase().trim() === 'new project';
            });
            if (target) {
              target.click();
              return 'Clicked New project link';
            }
            return 'NOT_FOUND';
          })()
        `,
        returnByValue: true
      });
      console.log('CLICK:', clickR?.result?.result?.value);

      // Wait for navigation / modal
      await new Promise(r => setTimeout(r, 4000));
      
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            url: window.location.href,
            title: document.title,
            buttons: Array.from(document.querySelectorAll('button')).map(function(b) {
              return { text: b.textContent.trim().substring(0, 60), disabled: b.disabled };
            }).filter(function(t) { return t.text.length > 0 && t.text.length < 60; }),
            inputs: Array.from(document.querySelectorAll('input')).map(function(i) {
              return { placeholder: i.placeholder.substring(0, 40), type: i.type };
            }),
            modals: document.querySelectorAll('[role=dialog], .modal, [class*=modal]').length
          })
        `,
        returnByValue: true
      });
      console.log('AFTER CLICK:', r?.result?.result?.value);

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
