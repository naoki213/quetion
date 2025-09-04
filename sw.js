// sw.js
const CACHE_NAME = 'tax-anki-v1.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  // 使っていれば同梱（CDNでなくローカルに置く場合）
  //'./vendor/chart.umd.min.js'
];

// インストール時にApp Shellをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 有効化：古いキャッシュを破棄
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// フェッチ戦略：App ShellはCache First、その他はNetwork First
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET以外はスルー
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isAppShell = APP_SHELL.some((path) => url.pathname.endsWith(path.replace('./','/')));

  if (isAppShell) {
    // Cache First
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        // 将来の更新に備えアップデート
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
  } else {
    // Network First（失敗時はキャッシュ）
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
