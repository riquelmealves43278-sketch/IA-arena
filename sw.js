const V = 'ia-arena-v2', F = ['./', 'index.html', 'app.js', 'worker.js', 'core.js', 'binjgb.js', 'binjgb.wasm', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(F))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
