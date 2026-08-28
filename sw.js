const CACHE = 'densel-assistant-v3';
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
  Стратегия: "сеть первична, кэш — только запасной вариант при отсутствии сети".
  Раньше здесь был cache-first, из-за которого обновления кода не доходили до
  браузера, пока пользователь не очищал данные сайта вручную. теперь любой
  успешный сетевой ответ сразу кладётся в кэш и отдаётся пользователю, а кэш
  используется только если сеть недоступна (офлайн-режим).
*/
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

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
