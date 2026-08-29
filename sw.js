const CACHE = 'densel-assistant-feature-history-v17';
const ASSETS = ['./','./index.html','./style.css','./app.js','./manifest.json','./patch-61.js','./patch-72.js','./payment-rules.js','./patch-91.js','./patch-92.js','./patch-93.js','./patch-101.js','./patch-102.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const isDocument = e.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/densel-assistant/');
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(async resp => {
    if (isDocument && resp.ok) {
      const html = await resp.text();
      const scripts = '<script src="./patch-61.js"></script><script src="./patch-72.js"></script><script src="./payment-rules.js"></script><script src="./patch-91.js"></script><script src="./patch-92.js"></script><script src="./patch-93.js"></script><script src="./patch-101.js"></script><script src="./patch-102.js"></script>';
      return new Response(html.replace('</body>', scripts + '</body>'), {status:resp.status,statusText:resp.statusText,headers:resp.headers});
    }
    if(resp && resp.ok){ const clone=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,clone)).catch(()=>{}); }
    return resp;
  }).catch(()=>caches.match(e.request)));
});
