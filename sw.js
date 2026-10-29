/* Service worker мини-аппа: хранит сборку и справочник в телефоне, чтобы приложение открывалось без интернета
   и не качало catalog.json заново, пока он не поменялся.
   BUILD и PRECACHE вписывает miniapp/build.py: новая сборка — новый BUILD, файлы прошлой сборки удаляются.
   Страница — сначала из сети (свежие цены), без сети — из кеша; файлы с ?v=<хэш> не меняются — сразу из кеша;
   фото — из кеша, последние PHOTO_MAX просмотренных. */
const BUILD = "a65519df";
const PRECACHE = ["./", "app.js?v=9e2144d7", "search.js?v=85fd76b1", "atc.js?v=f0851cfc", "style.css?v=19119c74", "catalog.json?v=4704762a"];
const APP = `app-${BUILD}`, PHOTOS = "photos", EXT = "ext";   // EXT — telegram-web-app.js с telegram.org
const PHOTO_MAX = 400;
const PAGE_TIMEOUT = 4000;                                     // медленная сеть — через 4 с показываем сохранённое
const PAGE = new URL("./", self.location).href;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => ![APP, PHOTOS, EXT].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function put(cacheName, key, res) {
  if (res.ok || res.type === "opaque") {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(key, copy));
  }
  return res;
}

async function page(req) {
  // Telegram добавляет к адресу ?v=… и свои параметры — страница одна, храним её под одним ключом
  const net = fetch(req).then((res) => put(APP, PAGE, res));
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT));
  const res = await Promise.race([net.catch(() => null), timeout]);
  return res || (await caches.match(PAGE)) || net;
}

async function cacheFirst(cacheName, req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheName === PHOTOS) {
    put(PHOTOS, req, res);
    caches.open(PHOTOS).then(async (c) => {                    // старые фото — вон, чтобы не занять всю память
      const keys = await c.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - PHOTO_MAX))) c.delete(k);
    });
    return res;
  }
  return put(cacheName, req, res);
}

async function staleWhileRevalidate(req) {
  const hit = await caches.match(req);
  const net = fetch(req).then((res) => put(EXT, req, res)).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") return e.respondWith(page(req));
  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/photos/")) return e.respondWith(cacheFirst(PHOTOS, req));
    return e.respondWith(cacheFirst(APP, req));
  }
  if (url.hostname === "telegram.org") return e.respondWith(staleWhileRevalidate(req));
});
