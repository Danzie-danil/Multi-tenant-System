const CACHE_NAME = 'nexus-bms-v37';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
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
            return cache.addAll(ASSETS_TO_CACHE);
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

// Fetch Event - Network First, then Cache (Stale fallback)
self.addEventListener('fetch', (event) => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        fetch(event.request)
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
                // If network fails (offline), return from cache
                console.log('[Service Worker] Network failed, serving from cache:', event.request.url);
                return caches.match(event.request);
            })
    );
});
