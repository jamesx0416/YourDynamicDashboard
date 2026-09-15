const STARTUP_WALLPAPER_CACHE_NAME = "ydd-startup-wallpaper-v1";
const STARTUP_WALLPAPER_PATH = "/__ydd/wallpaper-current";
const DB_NAME = "YDD_Storage";
const DB_VERSION = 2;
const STORE_NAME = "images";
const CURRENT_BACKGROUND_KEY = "current_bg";

function openBackgroundDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB could not be opened."));
    request.onblocked = () =>
      reject(new Error("IndexedDB open was blocked."));
  });
}

async function readStoredWallpaper() {
  const db = await openBackgroundDatabase();
  try {
    if (!db.objectStoreNames.contains(STORE_NAME)) return null;
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_BACKGROUND_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("Wallpaper read failed."));
      transaction.onerror = () =>
        reject(transaction.error || new Error("Wallpaper transaction failed."));
      transaction.onabort = () =>
        reject(transaction.error || new Error("Wallpaper read was aborted."));
    });
  } finally {
    db.close();
  }
}

function createWallpaperResponse(blob) {
  return new Response(blob, {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

async function serveStartupWallpaper(request) {
  try {
    const cache = await caches.open(STARTUP_WALLPAPER_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const blob = await readStoredWallpaper();
    if (!(blob instanceof Blob)) {
      return new Response(null, { status: 404 });
    }

    const response = createWallpaperResponse(blob);
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return new Response(null, { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== STARTUP_WALLPAPER_PATH) {
    return;
  }
  event.respondWith(serveStartupWallpaper(event.request));
});
