const CACHE_NAME = 'nexus-bms-v47';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './bms-logo.jpeg',
    './css/index.css',
    './css/layout.css',
    './css/components.css',
    './js/app.js',
    './js/auth.js',
    './js/dashboard.js',
    './js/supabase.js',
    './icons/bms-logo-72.png',
    './icons/bms-logo-96.png',
    './icons/bms-logo-128.png',
    './icons/bms-logo-144.png',
    './icons/bms-logo-152.png',
    './icons/bms-logo-192.png',
    './icons/bms-logo-384.png',
    './icons/bms-logo-512.png'
];

// Install Event - Cache Assets
self.addEventListener('install', (event) => {
    // Force new SW to take control immediately
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching app shell');
            // Use {cache: 'reload'} to force network fetch and bypass browser cache
            return Promise.all(
                ASSETS_TO_CACHE.map(url =>
                    fetch(url, { cache: 'reload' }).then(response => {
                        if (!response.ok) throw Error('Fetch failed ' + response.statusText);
                        return cache.put(url, response);
                    })
                )
            );
        })
    );
});

// Activate Event - Cleanup Old Caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

// Fetch Event - Network First for static assets, NEVER cache API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // NEVER cache API calls or non-GET requests
    // This includes all Supabase API calls and authentication endpoints
    if (
        event.request.method !== 'GET' ||
        url.hostname.includes('supabase.co') ||
        url.pathname.includes('/rest/v1/') ||
        url.pathname.includes('/auth/v1/') ||
        url.hostname !== self.location.hostname
    ) {
        // Let API calls pass through directly to network, no caching
        return;
    }

    // Only cache static assets from our origin (HTML, CSS, JS, images)
    event.respondWith(
        fetch(event.request, { cache: 'no-cache' })
            .then((response) => {
                // If network fetch succeeds, update the cache and return
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            })
            .catch(() => {
                // If network fails (offline), try to serve from cache
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log('[Service Worker] Offline - serving from cache:', event.request.url);
                        return cachedResponse;
                    }
                    // No cache available, return basic offline response
                    console.log('[Service Worker] Offline - no cached version available:', event.request.url);
                    return new Response('Offline - no cached version available', {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: { 'Content-Type': 'text/plain' }
                    });
                });
            })
    );
});

// Listen for SKIP_WAITING message to force activation
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
