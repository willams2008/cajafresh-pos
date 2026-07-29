const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/project') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
    if (!p) { 
      console.log('No project page found'); 
      return; 
    }
    
    console.log('Using page:', p.url.substring(0, 120));
    
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
      // Navigate to organizations page
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/organizations' });
      await new Promise(r => setTimeout(r, 5000));
      
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var result = {
              url: window.location.href,
              title: document.title,
              h1: document.querySelector('h1')?.textContent || '',
              links: [],
              orgNames: [],
              buttons: []
            };
            
            document.querySelectorAll('a').forEach(function(a) {
              var href = a.href || '';
              if (href.includes('org/') || href.includes('organizations')) {
                result.links.push(href.substring(0, 150));
                result.orgNames.push(a.textContent.trim().substring(0, 50));
              }
            });
            
            // Also try to find org from __NEXT_DATA__
            var nextData = document.getElementById('__NEXT_DATA__');
            if (nextData) {
              try {
                var nd = JSON.parse(nextData.textContent);
                if (nd.props && nd.props.pageProps) {
                  result.nextProps = Object.keys(nd.props.pageProps).join(', ');
                }
                if (nd.props && nd.props.pageProps && nd.props.pageProps.organizations) {
                  result.organizations = JSON.stringify(nd.props.pageProps.organizations.map(function(o) { return {id: o.id, name: o.name, slug: o.slug}; }));
                }
              } catch(e) { result.nextParseError = e.message; }
            }
            
            document.querySelectorAll('button').forEach(function(b) {
              if (b.textContent.trim().length < 100) {
                result.buttons.push(b.textContent.trim().substring(0, 50));
              }
            });
            
            result.body = document.body.innerText.substring(0, 500);
            
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
