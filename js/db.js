// IndexedDB mínimo – App de Campo (Miana Consulting)
const DB_NAME = 'appcampo_l2';
const DB_VER = 2;
const STORES = ['meta', 'estado', 'fotos', 'eventos', 'novos', 'arquivos', 'salas'];
let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('estado')) db.createObjectStore('estado', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('eventos')) db.createObjectStore('eventos', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('novos')) db.createObjectStore('novos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos');
      if (!db.objectStoreNames.contains('salas')) db.createObjectStore('salas', { keyPath: 'id' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const get = (store, key) => tx(store, 'readonly', s => req(s.get(key)));
export const put = (store, val, key) => tx(store, 'readwrite', s => req(key === undefined ? s.put(val) : s.put(val, key)));
export const del = (store, key) => tx(store, 'readwrite', s => req(s.delete(key)));
export const all = (store) => tx(store, 'readonly', s => req(s.getAll()));
export const clear = (store) => tx(store, 'readwrite', s => req(s.clear()));
export const putMany = (store, vals) => tx(store, 'readwrite', s => Promise.all(vals.map(v => req(s.put(v)))));
export const STORE_NAMES = STORES;
