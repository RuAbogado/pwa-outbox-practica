// =============================================================
// db-helper.js — Mini-wrapper promisificado de IndexedDB
// Se carga en index.html (<script>) y en sw.js (importScripts).
// Por eso NO usa window ni document: solo `indexedDB`, que existe
// en ambos contextos (ventana y Service Worker).
// =============================================================

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// Pieza 1: Apertura y migración de esquema
function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Solo corre si la BD es nueva o DB_VERSION subió.
    // Es el ÚNICO lugar donde se pueden crear/borrar Object Stores.
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Pieza 2: CREATE — escritura segura
// req.onsuccess solo entrega el ID; el dato está garantizado en disco
// hasta tx.oncomplete, por eso resolvemos ahí.
function guardarRegistro(datos) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const req = store.add(datos);
      let idGenerado;

      req.onsuccess = (event) => {
        idGenerado = event.target.result;
      };

      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// Pieza 3: READ — lectura completa en modo 'readonly'
function obtenerTodosLosRegistros() {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  });
}

// Pieza 4: DELETE — eliminación por llave primaria
function eliminarRegistro(id) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// Pieza 5 (Tema 5.2): UPDATE — get + put dentro de UNA misma transacción 'readwrite'
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 1. Leer el registro actual por su llave primaria
      const reqGet = store.get(id);

      reqGet.onsuccess = (event) => {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error(`No se encontró el registro con ID: ${id}`));
          return;
        }

        // 2. Modificar y sobrescribir con put() (misma transacción)
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      // 3. Resolver cuando la transacción confirma la escritura en disco
      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}
