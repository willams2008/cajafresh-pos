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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 30000);
      });
    }

    function evalJs(expr) {
      return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    }

    ws.on('open', async () => {
      await new Promise(r => setTimeout(r, 2000));
      
      const password = 'CajaFresh_' + Math.random().toString(36).slice(2, 12) + '_2026!';
      console.log('Password:', password);
      
      const r1 = await evalJs(`
        (function() {
          var pw = "${password}";
          var result = {};
          var inputs = document.querySelectorAll('input');
          
          inputs.forEach(function(inp) {
            if (inp.name === 'projectName' || inp.placeholder === 'Project name') {
              var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(inp, 'almacen-cliente');
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              var t = inp._valueTracker;
              if (t) t.setValue('almacen-cliente');
              result.name = 'ok';
            }
            if (inp.name === 'dbPass' || (inp.type === 'password' && inp.placeholder)) {
              var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(inp, pw);
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              var t = inp._valueTracker;
              if (t) t.setValue(pw);
              result.pass = 'ok';
            }
          });
          
          return JSON.stringify(result);
        })()
      `);
      console.log('FILL:', r1?.result?.result?.value);
      
      await new Promise(r => setTimeout(r, 1500));
      
      const r2 = await evalJs(`
        JSON.stringify({
          name: document.querySelector('input[name="projectName"]')?.value || '',
          pass: (document.querySelector('input[name="dbPass"]')?.value || '').substring(0,10)
        })
      `);
      console.log('VALUES:', r2?.result?.result?.value);
      
      var vals = JSON.parse(r2?.result?.result?.value || '{}');
      
      // Try Input.insertText if React didn't take our values
      if (!vals.name) {
        console.log('React didn\'t accept programmatic set, trying Input.insertText...');
        await evalJs(`document.querySelector('input[name="projectName"]').focus()`);
        await new Promise(r => setTimeout(r, 200));
        await send('Input.insertText', { text: 'almacen-cliente' });
        await new Promise(r => setTimeout(r, 300));
        
        await evalJs(`document.querySelector('input[name="dbPass"]').focus()`);
        await new Promise(r => setTimeout(r, 200));
        await send('Input.insertText', { text: password });
        await new Promise(r => setTimeout(r, 300));
        
        const r3 = await evalJs(`
          JSON.stringify({
            name: document.querySelector('input[name="projectName"]')?.value || '',
            passSet: (document.querySelector('input[name="dbPass"]')?.value || '').length > 0
          })
        `);
        console.log('VALUES2:', r3?.result?.result?.value);
      }
      
      // Click Create new project
      await new Promise(r => setTimeout(r, 500));
      
      const r4 = await evalJs(`
        (function() {
          var btns = document.querySelectorAll('button');
          for (var b of btns) {
            if (b.textContent.trim() === 'Create new project' && !b.disabled) {
              b.click();
              return 'CLICKED';
            }
          }
          return 'NO_BUTTON';
        })()
      `);
      console.log('CREATE:', r4?.result?.result?.value);
      
      // Poll for project creation
      for (var i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 10000));
        const r5 = await evalJs(`
          JSON.stringify({
            url: window.location.href,
            title: document.title,
            body: document.body.innerText.substring(0, 200)
          })
        `);
        console.log('POLL ' + (i+1) + ':', r5?.result?.result?.value);
        
        var data = JSON.parse(r5?.result?.result?.value || '{}');
        if (data.url && data.url.includes('/project/') && !data.url.includes('/new/')) {
          console.log('PROJECT CREATED!');
          console.log('Project URL:', data.url);
          break;
        }
      }
      
      ws.close();
      process.exit(0);
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
