const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    // Use any supabase dashboard page
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/project') && !p.url.includes('stripe'));
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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 8000);
      });
    }

    ws.on('open', async () => {
      console.log('Connected. Navigating to new project page...');
      
      // Use location.href for navigation
      const navR = await send('Runtime.evaluate', {
        expression: `
          window.location.href = 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj/projects/new';
          'navigating...'
        `,
        returnByValue: true,
        awaitPromise: false
      });
      console.log('Nav result:', navR?.result?.result?.value);
      
      await new Promise(r => setTimeout(r, 7000));
      
      // Single expression to check page and fill form
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var pw = 'CajaFresh_' + Math.random().toString(36).slice(2,10) + '!';
            var result = {
              url: window.location.href,
              title: document.title,
              inputs: [],
              buttons: [],
              pw: pw
            };
            
            // Find all input fields
            var inputs = document.querySelectorAll('input');
            inputs.forEach(function(inp) {
              var info = {
                placeholder: inp.placeholder,
                type: inp.type,
                name: inp.name,
                id: inp.id
              };
              
              // Try to fill
              if (inp.placeholder && inp.placeholder.toLowerCase().includes('name')) {
                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, 'almacen-cliente');
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                info.filled = 'name';
              }
              if (inp.type === 'password') {
                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, pw);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                info.filled = 'password';
              }
              
              result.inputs.push(info);
            });
            
            // Check for buttons
            document.querySelectorAll('button').forEach(function(b) {
              result.buttons.push({
                text: b.textContent.trim().substring(0, 80),
                disabled: b.disabled,
                type: b.type,
                className: b.className.substring(0, 100)
              });
            });
            
            // Check for any selects
            result.hasSelect = document.querySelector('select') !== null;
            
            // Get visible text
            result.bodyText = document.body.innerText.substring(0, 1000);
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('PAGE STATE:', r?.result?.result?.value);

      ws.close();
    });
    ws.on('error', (e) => { ws.close(); console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
