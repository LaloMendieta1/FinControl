/* FinControl - Service Worker
   Estrategia: cache-first (abre sin internet) + revalidacion en segundo plano.
   Regla de oro: si algo falla, nunca se rompe la app. Todo va con catch.
   Sube este archivo junto a index.html, manifest.json e iconos. */

var VERSION = 'fincontrol-v1';
var CACHE = VERSION;

/* Archivos base. Rutas relativas: funciona en la raiz o en un subdirectorio
   de GitHub Pages sin cambiar nada. */
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* Recursos externos utiles offline (tipografias y la libreria de Excel).
   Si no cargan, la app igual funciona: usa fuentes del sistema y avisa
   que Excel necesita internet. */
var EXTRAS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Space+Grotesk:wght@400;500;600;700&display=swap'
];

/* Guarda una URL en cache sin lanzar error jamas. */
function cachePut(cache, url) {
  var req = new Request(url, { cache: 'reload' });
  return fetch(req)
    .then(function (res) {
      // res.ok cubre same-origin; type 'opaque' cubre CDN sin CORS
      if (res && (res.ok || res.type === 'opaque')) {
        return cache.put(url, res.clone()).catch(function () {});
      }
    })
    .catch(function () { /* asset inexistente o sin red: se ignora */ });
}

/* INSTALL: guarda todo lo que pueda. Nunca falla por un asset faltante. */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        var all = CORE.concat(EXTRAS).map(function (url) {
          return cachePut(cache, url);
        });
        return Promise.all(all);
      })
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

/* ACTIVATE: borra caches de versiones viejas y toma control. */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k).catch(function () {});
        }));
      })
      .catch(function () {})
      .then(function () { return self.clients.claim(); })
  );
});

/* Guarda una respuesta en cache en segundo plano, sin bloquear. */
function stash(req, res) {
  try {
    if (!res || !(res.ok || res.type === 'opaque')) return;
    var copy = res.clone();
    caches.open(CACHE).then(function (cache) {
      cache.put(req, copy).catch(function () {});
    }).catch(function () {});
  } catch (e) {}
}

/* Respuesta de emergencia si no hay nada en cache (primer arranque sin red). */
function lastResort() {
  return new Response(
    '<!DOCTYPE html><html lang="es"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:system-ui;background:#EEF1EE;color:#11241F;' +
    'display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:20px;margin:0 0 8px">FinControl</h1>' +
    '<p style="color:#5C6B64;font-size:14px;margin:0">Abre la app una vez con internet ' +
    'para guardarla en tu telefono. Despues funcionara sin conexion.</p></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* FETCH: cache-first para todo GET, con revalidacion en segundo plano. */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Navegacion (abrir la app): el caso critico sin internet.
     Siempre responde con el HTML guardado si existe. */
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(req, { ignoreSearch: true })
          .then(function (hit) { return hit || cache.match('./index.html') || cache.match('./'); })
          .then(function (hit) {
            var net = fetch(req)
              .then(function (res) { stash(req, res); return res; })
              .catch(function () { return null; });

            if (hit) {
              // cache-first: entrega ya, y actualiza detras si hay red
              event.waitUntil(net.catch(function () {}));
              return hit;
            }
            return net.then(function (res) { return res || lastResort(); });
          });
      }).catch(function () { return lastResort(); })
    );
    return;
  }

  /* Resto de recursos: cache-first + revalidacion. */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req)
        .then(function (res) { stash(req, res); return res; })
        .catch(function () { return null; });

      if (hit) {
        event.waitUntil(net.catch(function () {}));
        return hit;
      }
      return net.then(function (res) {
        if (res) return res;
        return new Response('', { status: 504, statusText: 'Sin conexion' });
      });
    }).catch(function () {
      return fetch(req).catch(function () {
        return new Response('', { status: 504, statusText: 'Sin conexion' });
      });
    })
  );
});
