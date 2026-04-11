const STATIC_CACHE = "cts-static-v2";
const IMAGE_CACHE = "cts-images-v2";
const BASE_PATH = self.location.pathname.replace(/serviceworker\.js$/, "");
const STATIC_ASSETS = [
  `${BASE_PATH}favicon.svg`,
  `${BASE_PATH}cpu-silhouette.svg`,
  `${BASE_PATH}icons.svg`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

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
});