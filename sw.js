// =============================================================
// sw.js — Service Worker: App Shell + Background Sync
// Hilo independiente: aquí NO existen window ni document.
// =============================================================

// Fragmento A: importar el mini-wrapper de IndexedDB (ruta relativa)
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// ---------------------------------------------------------------
// install: precache del App Shell
// ---------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------
// activate: purgar cachés de versiones anteriores
// ---------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => {
        return Promise.all(
          nombres.map((nombre) => {
            if (nombre !== CACHE_STATIC_NAME) {
              console.log('[SW] Purgando caché obsoleta:', nombre);
              return caches.delete(nombre);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------
// fetch: Cache First para el App Shell (solo GET del mismo origen).
// Los POST a la API pasan directo a la red: si fallan, app.js
// los captura con .catch() y los encola en IndexedDB.
// ---------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((respuestaCache) => {
        if (respuestaCache) return respuestaCache;

        return fetch(event.request)
          .then((respuestaRed) => {
            if (respuestaRed.ok) {
              const copia = respuestaRed.clone();
              caches.open(CACHE_STATIC_NAME).then((cache) => cache.put(event.request, copia));
            }
            return respuestaRed;
          })
          .catch(() => {
            // Navegación offline sin coincidencia exacta: servir el index del App Shell
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return Response.error();
          });
      })
  );
});

// ---------------------------------------------------------------
// Fragmento B: avisar a las pestañas abiertas (postMessage)
// ---------------------------------------------------------------
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

// ---------------------------------------------------------------
// Fragmento C: motor de sincronización en segundo plano
// ---------------------------------------------------------------
function sincronizarPendientesSW() {
  console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then((respuesta) => {
            if (!respuesta.ok) {
              throw new Error(`Error HTTP ${respuesta.status} al sincronizar ID ${item.id}`);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(() => notificarClientesActualizacion());
    });
}

// ---------------------------------------------------------------
// Fragmento D: escucha del evento sync
// ---------------------------------------------------------------
self.addEventListener('sync', (event) => {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW()
        .catch((error) => {
          console.error('[SW-Sync] Falla en sincronización; el navegador reintentará luego:', error);
          // Relanzar = la promesa de waitUntil se rechaza => el navegador reprograma el sync
          throw error;
        })
    );
  }
});
