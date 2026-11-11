const CACHE_NAME = 'spark-__SPARK_CACHE_VERSION__';
const ASSETS = /* __SPARK_PRECACHE_ASSETS__ */ [];

function canCache(response) {
  return response.ok && !response.redirected;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Refuser aussi les redirections (par exemple vers une page de connexion).
      const responses = await Promise.all(ASSETS.map((asset) => fetch(asset, { cache: 'reload' })));
      if (!responses.every(canCache)) throw new Error('Précache Spark indisponible');
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(ASSETS.map((asset, index) => cache.put(asset, responses[index])));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('spark-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(api|wake|health)(\/|$)/.test(url.pathname)) return;

  if (event.request.mode === 'navigate') {
    // Aucune navigation authentifiée ne doit être persistée, même la racine.
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match('/offline.html');
      })
    );
    return;
  }

  if (url.search || !ASSETS.includes(url.pathname)) return;
  const network = (async () => {
    const response = await fetch(event.request);
    if (canCache(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })();
  // Prolonger la vie du worker pendant la revalidation, même si le cache répond.
  event.waitUntil(network.catch(() => {}));
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => (await cache.match(event.request)) || network)
  );
});
