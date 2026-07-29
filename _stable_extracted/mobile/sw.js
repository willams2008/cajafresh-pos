const CACHE_NAME = 'punto-pila-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './app.js?v=41.4',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap'
];


// Install: cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching app shell');
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.warn('[SW] Some assets failed to cache:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Skip socket.io and API requests
    if (url.pathname.includes('socket.io') || event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone and cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                // Offline: serve from cache
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    // Fallback to main page for navigation
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html').then(navCache => {
                            return navCache || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
                        });
                    }
                    // Prevent "Returned response is null" error on Safari
                    return new Response('', { status: 404, statusText: 'Not Found' });
                });
            })
    );
});
