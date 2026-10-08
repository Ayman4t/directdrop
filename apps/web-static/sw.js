const SHELL = 'dd-shell-v1', SHARE = 'dd-share';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.json', '/icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // Web Share Target: stash shared files, then open the app to pick a recipient
  if (e.request.method === 'POST' && u.pathname === '/share-target') {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const c = await caches.open(SHARE);
      let i = 0;
      for (const f of fd.getAll('files')) {
        if (f instanceof File) await c.put(`/shared/${Date.now()}-${i++}`, new Response(f, {
          headers: { 'X-Name': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' },
        }));
      }
      return Response.redirect('/?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  );
});
