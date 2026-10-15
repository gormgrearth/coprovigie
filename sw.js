/* CoproVigie — service worker minimal
   - Met en cache la "coquille" de l'app pour un démarrage instantané / hors ligne
   - Ne touche JAMAIS aux appels Firebase (Firestore, Auth) : les données restent en direct
   - Incrémentez VERSION à chaque mise à jour de index.html pour forcer le rafraîchissement */
const VERSION = "v1";
const CACHE = "coprovigie-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.svg",
  "./favicon-32.png",
  "./favicon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

// Hôtes statiques qu'on peut mettre en cache (polices, bibliothèques, SDK Firebase JS)
const CACHEABLE_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
  "www.gstatic.com"          // https://www.gstatic.com/firebasejs/... (code du SDK, pas les données)
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages : réseau d'abord (toujours la dernière version), cache en secours hors ligne
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return; // Firebase API → laissé au réseau

  // Ressources statiques : cache d'abord, mise à jour en arrière-plan
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Clic sur une notification : ramener l'app au premier plan
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});
