const CACHE = 'densel-assistant-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/*
  Стратегия: "сеть первична, кэш — только запасной вариант при отсутствии сети",
  и ТОЛЬКО для собственных файлов сайта (тот же origin). Запросы к внешним
  доменам (api.github.com и т.п.) Service Worker вообще не трогает — их кэширование
  не нужно и рисковано (могло привести к устаревшим ответам GitHub API).
*/
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // не наш домен — не вмешиваемся

  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((resp) => {
        if (resp && resp.ok) {
          const respClone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, respClone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
