# PWA Outbox — Registro de Incidencias en Campo

PWA en JavaScript Vanilla (sin librerías, sin `async/await`) que implementa:

- **Tema 5.1** — `db-helper.js`: mini-wrapper promisificado de IndexedDB (`abrirDB`, `guardarRegistro`, `obtenerTodosLosRegistros`, `eliminarRegistro`).
- **Tema 5.2** — Patrón Outbox: los `POST` fallidos se encolan en IndexedDB como `'pendiente'`; `actualizarEstadoRegistro` (get + put en una transacción), render de la bandeja y purga de sincronizados.
- **Tema 5.3** — Background Sync API: `sw.js` reenvía los pendientes en el evento `sync` (`sync-reportes`) y avisa a la UI con `postMessage`; el evento `online` queda como fallback solo para navegadores sin `SyncManager` (Safari/iOS, Firefox).

## Estructura

```
├── index.html
├── styles.css
├── db-helper.js     # Mini-wrapper promisificado de IndexedDB
├── app.js           # UI, envío resiliente, fallback online, receptor de postMessage
├── sw.js            # App Shell (rutas relativas) + Background Sync
├── manifest.json
└── icons/
```

API de prueba: `https://jsonplaceholder.typicode.com/posts`
