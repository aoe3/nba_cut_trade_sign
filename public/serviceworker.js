const STATIC_CACHE = "cts-static-v1";
const IMAGE_CACHE = "cts-images-v1";
const STATIC_ASSETS = ["/", "/favicon.svg", "/cpu-silhouette.svg", "/icons.svg"];

/**
 * Pre-caches a tiny set of stable assets so the app shell loads reliably on repeat visits.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

/**
 * Clears older cache versions after an updated worker becomes active.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => ![STATIC_CACHE, IMAGE_CACHE].includes(name))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

function isImageRequest(request) {
  return request.destination === "image";
}

/**
 * Uses stale-while-revalidate for images so already-seen headshots appear immediately while the
 * cache quietly refreshes in the background.
 */
async function handleImageRequest(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached ?? networkPromise;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  if (isImageRequest(request)) {
    event.respondWith(handleImageRequest(request));
    return;
  }

  if (STATIC_ASSETS.includes(new URL(request.url).pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});
