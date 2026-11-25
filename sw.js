// オフラインでも開けるようにするサービスワーカー（ネット優先、失敗したらキャッシュ）
const CACHE = 'shiftpay-v8';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'holidays.js', 'ics.js', 'migrate.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // cache: 'no-cache' で毎回サーバーに更新の有無を確かめる（変わっていなければ通信は小さく済む）。
  // これにより、更新を公開した直後でも古いプログラムが使われない。
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
