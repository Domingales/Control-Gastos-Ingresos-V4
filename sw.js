/* sw.js - Cache básico para uso offline */
const CACHE = "control-gastos-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/styles.css",
  "./assets/js/utils.js",
  "./assets/js/db.js",
  "./assets/js/xlsx-mini.js",
  "./assets/js/print.js",
  "./assets/js/app.js"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if(req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        // Cachea sólo recursos de mismo origen
        try{
          const url = new URL(req.url);
          const selfUrl = new URL(self.location.href);
          if(url.origin === selfUrl.origin){
            const copy = res.clone();
            caches.open(CACHE).then(cache=>cache.put(req, copy));
          }
        }catch(_){}
        return res;
      }).catch(()=>cached || caches.match("./index.html"));
    })
  );
});
