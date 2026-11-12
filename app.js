// =============================================================
// app.js — Hilo principal: UI, envío resiliente (Outbox) y
// comunicación con el Service Worker.
// Regla: toda la asincronía con Promesas explícitas (.then/.catch).
// =============================================================

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// Fragmento G (5.3): escuchar avisos del Service Worker (postMessage)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

// Referencias al DOM
const formIncidencia = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');
const modoSync = document.getElementById('modo-sync');

// ---------------------------------------------------------------
// Indicador de red
// ---------------------------------------------------------------
function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// ---------------------------------------------------------------
// READ: dibujar la bandeja de salida desde IndexedDB
// ---------------------------------------------------------------
function formatearHora(timestamp) {
  return new Date(timestamp).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.replaceChildren();

      if (registros.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'vacio';
        vacio.textContent = 'La bandeja está vacía.';
        listaOutbox.appendChild(vacio);
        return;
      }

      // Más recientes primero
      registros
        .slice()
        .sort((a, b) => b.fechaCreacion - a.fechaCreacion)
        .forEach((item) => {
          const li = document.createElement('li');

          const info = document.createElement('div');
          const titulo = document.createElement('div');
          titulo.className = 'item-titulo';
          titulo.textContent = `#${item.id} · ${item.titulo}`; // textContent evita inyección HTML
          const hora = document.createElement('div');
          hora.className = 'item-hora';
          hora.textContent = formatearHora(item.fechaCreacion);
          info.appendChild(titulo);
          info.appendChild(hora);

          const estado = document.createElement('span');
          estado.className = `estado ${item.estado}`;
          estado.textContent = item.estado;

          li.appendChild(info);
          li.appendChild(estado);
          listaOutbox.appendChild(li);
        });
    })
    .catch((error) => {
      console.error('[Outbox] No se pudo leer IndexedDB:', error);
    });
}

// ---------------------------------------------------------------
// CREATE: envío resiliente con fallback a IndexedDB (Fragmentos B + E)
// ---------------------------------------------------------------
function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: datosFormulario.titulo, body: datosFormulario.descripcion })
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: bitácora local como 'sincronizado'
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch((error) => {
                // Si el registro falla, el fallback por 'online' no corre en Chrome;
                // lo dejamos registrado en consola para diagnóstico.
                console.error('[Outbox] No se pudo registrar Background Sync:', error);
              });
          }
        });
    })
    .then(() => {
      // Repintar la lista en ambos escenarios
      return renderizarColaOutbox();
    });
}

// ---------------------------------------------------------------
// UPDATE (fallback): reenvío desde la UI para navegadores sin
// SyncManager (Safari/iOS, Firefox). Antes: sincronizarPendientes().
// ---------------------------------------------------------------
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Arreglo de objetos -> arreglo de promesas (envío + actualización)
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// ---------------------------------------------------------------
// Eventos de red (Fragmento F: prevenir condición de carrera)
// ---------------------------------------------------------------
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: solo sincronizar desde la UI si NO hay Background Sync
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// ---------------------------------------------------------------
// Formulario (submit)
// ---------------------------------------------------------------
formIncidencia.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  if (!datos.titulo || !datos.descripcion) return;

  formIncidencia.reset();

  procesarEnvioReporte(datos)
    .catch((error) => {
      console.error('[Outbox] No se pudo procesar el reporte:', error);
    });
});

// ---------------------------------------------------------------
// DELETE: purgar registros ya sincronizados
// ---------------------------------------------------------------
btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error al purgar registros:', error);
    });
});

// ---------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => console.log('[SW] Registrado con scope:', reg.scope))
    .catch((error) => console.error('[SW] Error al registrar:', error));
}

modoSync.textContent = ('serviceWorker' in navigator && 'SyncManager' in window)
  ? 'Modo de sincronización: Background Sync API (Service Worker)'
  : 'Modo de sincronización: Fallback por evento online (sin SyncManager)';

actualizarIndicadorRed();

// Al cargar la página: READ de IndexedDB (rescata lo encolado aunque se haya cerrado la pestaña)
renderizarColaOutbox()
  .then(() => {
    // En navegadores sin SyncManager, intentar vaciar la cola si ya hay red
    if (navigator.onLine && !('SyncManager' in window)) {
      return sincronizarPendientesFallback();
    }
  });
