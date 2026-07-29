const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    // Use the organizations page (page 0)
    const p = pages[0];
    console.log('Using page:', p.title, p.url.substring(0, 100));
    
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
      // Explore the organizations page
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var result = { links: [], orgCards: [], orgId: null, orgSlug: null };
            
            // Get all link elements that might be org links
            document.querySelectorAll('a').forEach(function(a) {
              var href = a.href || '';
              if (href.includes('org/') && !href.includes('stripe')) {
                result.links.push({
                  text: a.textContent.trim().substring(0, 80),
                  href: href.substring(0, 150)
                });
              }
            });
            
            // Try to find org from __NEXT_DATA__
            var nextData = document.getElementById('__NEXT_DATA__');
            if (nextData) {
              try {
                var nd = JSON.parse(nextData.textContent);
                var props = nd.props?.pageProps || {};
                if (props.organizations) {
                  result.organizations = props.organizations.map(function(o) {
                    return { id: o.id, name: o.name, slug: o.slug };
                  });
                }
                // Check for user
                if (props.user) {
                  result.user = { email: props.user.email, id: props.user.id };
                }
              } catch(e) { result.error = e.message; }
            }
            
            // Check data attributes on elements
            var allOrgs = [];
            document.querySelectorAll('[data-org-slug], [data-org-id], [data-org-name]').forEach(function(el) {
              allOrgs.push({
                slug: el.getAttribute('data-org-slug'),
                id: el.getAttribute('data-org-id'),
                name: el.getAttribute('data-org-name'),
                tag: el.tagName
              });
            });
            result.dataAttrs = allOrgs;
            
            result.body = document.body.innerText.substring(0, 800);
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('ORG PAGE:', r?.result?.result?.value);
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
