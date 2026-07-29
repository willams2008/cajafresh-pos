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
      // Get full page HTML to find token
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            // Look for the token text anywhere in the page
            var allText = document.body.innerText;
            
            // Find the generated token - look for sbp_ pattern
            var match = allText.match(/sbp_[a-zA-Z0-9]+/);
            
            // Also look in inputs
            var inputs = document.querySelectorAll('input[type=\"text\"], input[type=\"password\"], textarea');
            var inputVals = Array.from(inputs).map(i => i.value).filter(v => v.includes('sbp_'));
            
            // Look for any element containing the full token
            var allEls = document.querySelectorAll('[class*=\"token\"], code, pre, [data-token]');
            var elsText = Array.from(allEls).map(e => e.textContent.trim()).filter(t => t.includes('sbp_'));
            
            // Check clipboard
            var clipboardItems = '';
            
            return JSON.stringify({
              match: match ? match[0] : '',
              inputs: inputVals,
              els: elsText,
              // Check if there's a "Copy" button nearby with the token
              copyBtn: (function() {
                var btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Copy'));
                if (btn) {
                  var parent = btn.parentElement;
                  var sibling = parent.previousElementSibling || parent.parentElement.previousElementSibling;
                  return sibling ? sibling.textContent.trim() : parent.textContent.trim();
                }
                return '';
              })()
            });
          })()
        `,
        returnByValue: true
      });
      console.log('SEARCH:', r?.result?.result?.value || 'NONE');

      // Try to read the clipboard via the Clipboard API
      const r2 = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            try {
              var text = await navigator.clipboard.readText();
              return 'CLIPBOARD: ' + text.substring(0, 100);
            } catch(e) {
              return 'CLIPBOARD_ERROR: ' + e.message;
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: true
      });
      console.log('CLIPBOARD:', r2?.result?.result?.value || 'NONE');

      // Check if the token was stored somewhere in React state
      const r3 = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify(
            Array.from(document.querySelectorAll('*')).filter(el => el.textContent.includes('sbp_')).map(el => ({
              tag: el.tagName,
              class: el.className,
              text: el.textContent.trim().substring(0, 100)
            }))
          )
        `,
        returnByValue: true
      });
      console.log('ELEMENTS:', r3?.result?.result?.value || 'NONE');

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
