const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/org') && p.url.includes('/new'));
    if (!p) { 
      console.log('NO_PAGE - checking all supabase pages...');
      pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(f.title, '|', f.url.substring(0,120)));
      return; 
    }
    console.log('Found page:', p.title, p.url.substring(0,100));
    
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
      // Wait for page to load fully
      await new Promise(r => setTimeout(r, 3000));
      
      // Check what's on the page
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            url: window.location.href,
            title: document.title,
            buttons: Array.from(document.querySelectorAll('button')).map(b => ({ text: b.textContent.trim().substring(0, 50), disabled: b.disabled })),
            inputs: Array.from(document.querySelectorAll('input')).map(i => ({ placeholder: i.placeholder, type: i.type, name: i.name, id: i.id })),
            h1: document.querySelector('h1')?.textContent,
            bodyPreview: document.body.innerText.substring(0, 500)
          })
        `,
        returnByValue: true
      });
      console.log('PAGE STATE:', r?.result?.result?.value);

      // Try to fill the form
      const password = 'CajaFresh_' + Math.random().toString(36).slice(2, 10) + '!';
      console.log('Password:', password);
      
      const fillR = await send('Runtime.evaluate', {
        expression: `
          (function() {
            // Find all inputs and try to fill them
            var inputs = document.querySelectorAll('input');
            var result = { filled: [] };
            
            inputs.forEach(function(inp) {
              var name = inp.name || inp.placeholder || inp.id || '';
              result.filled.push({ name: name, type: inp.type });
              
              // Fill project name
              if (name.toLowerCase().includes('name') || inp.placeholder.toLowerCase().includes('name')) {
                var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(inp, 'almacen-cliente');
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                result.filled.push('FILLED_NAME');
              }
              
              // Fill database password
              if ((name.toLowerCase().includes('password') || name.toLowerCase().includes('db')) && inp.type === 'password') {
                var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(inp, '${password}');
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                result.filled.push('FILLED_PASSWORD');
              }
            });
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('FILL RESULT:', fillR?.result?.result?.value);

      // Check the page again after filling
      const r2 = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            buttons: Array.from(document.querySelectorAll('button')).map(b => ({ text: b.textContent.trim().substring(0, 50), disabled: b.disabled })),
            inputs: Array.from(document.querySelectorAll('input')).map(i => ({ placeholder: i.placeholder, value: (i.value || '').substring(0, 20) }))
          })
        `,
        returnByValue: true
      });
      console.log('AFTER FILL:', r2?.result?.result?.value);

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
