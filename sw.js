const CACHE_NAME = 'kanjidego-anki-cache-v13';
// アプリ本体（これが保存できないとオフライン起動できないので必須）
const CORE_ASSETS = ['./', './index.html'];
// あると良いもの（外部CDNなど）。取得に失敗してもインストール自体は止めない
const OPTIONAL_ASSETS = [
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // ブラウザのHTTPキャッシュに残った古い版を拾わないよう、サーバーから取り直す
    await cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    await Promise.all(OPTIONAL_ASSETS.map(async (url) => {
      try {
        // 外部ファイルは CORS ヘッダーの有無に関係なく保存できるよう no-cors で取得する
        const sameOrigin = new URL(url, self.location.href).origin === self.location.origin;
        const res = await fetch(url, sameOrigin ? { cache: 'reload' } : { mode: 'no-cors' });
        if (res.ok || res.type === 'opaque') await cache.put(url, res);
      } catch (e) {
        // 取得できなくても無視（後で通常の読み込み時に保存される）
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // ページ本体：オンラインなら最新版を取得して保存し直す。オフライン・圏外なら保存版で起動する
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // HTTPキャッシュ（GitHub Pages は約10分保持）を使わず、毎回サーバーに最新版を確認する
        let res = await fetchWithTimeout(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000);
        if (res.redirected) {
          // リダイレクト経由の応答はそのまま返すと Safari がページを表示できないため作り直す
          res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
        }
        if (res.ok) {
          await cache.put('./index.html', res.clone());
        }
        return res;
      } catch (e) {
        const cached =
          (await cache.match('./index.html')) ||
          (await cache.match('./')) ||
          (await caches.match(req, { ignoreSearch: true }));
        return cached || Response.error();
      }
    })());
    return;
  }

  // それ以外（スクリプト・CSS・フォントなど）：保存版を優先し、無ければ取得して保存する
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
