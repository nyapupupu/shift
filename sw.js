// オフラインでも開けるようにするサービスワーカー
// ・ネットにつながるときは新しい版を取りに行く（更新がすぐ反映される）
// ・圏外や電波が弱いとき（3秒以上かかるとき）は、端末に保存してある版で開く
const CACHE = 'shiftpay-v10';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'holidays.js', 'ics.js', 'migrate.js', 'manifest.webmanifest', 'icon.svg'];
const NETWORK_TIMEOUT_MS = 3000;
// 一度つながらなかったら、しばらくは待たずに保存してある版を使う（ファイルごとに3秒ずつ待たないため）
const SLOW_WINDOW_MS = 30000;
let slowUntil = 0;

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

async function fromCache(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  // 保存していないページを開いたときは、アプリ本体を表示する
  if (request.mode === 'navigate') return caches.match('index.html');
  return undefined;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    // cache: 'no-cache' で毎回サーバーに更新の有無を確かめる（変わっていなければ通信は小さく済む）
    const network = fetch(req, { cache: 'no-cache' }).then(async (res) => {
      if (res.ok) { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
      return res;
    });
    network.catch(() => {}); // 裏で取得を続けて保存だけする場合のエラーは無視
    if (Date.now() < slowUntil) {
      const cached = await fromCache(req);
      if (cached) return cached;
    }
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
      const first = await Promise.race([network, timeout.then(() => null)]);
      if (first) { slowUntil = 0; return first; }
      slowUntil = Date.now() + SLOW_WINDOW_MS;
      // 3秒たってもつながらない：保存してある版があればそれで開く。なければネットを待つ
      return (await fromCache(req)) || (await network);
    } catch {
      slowUntil = Date.now() + SLOW_WINDOW_MS;
      const cached = await fromCache(req);
      if (cached) return cached;
      throw new Error('offline');
    }
  })());
});
