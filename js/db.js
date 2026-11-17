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
    Promise.resolve(fn(s)).then(v => { out = v; }).catch(() => { /* o erro chega pelo onerror / onabort da transação, abaixo */ });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// v1.6.0 – Safari (iPad): algumas versões e modos não gravam Blob no IndexedDB ("Error preparing Blob/File data to be stored…").
// Quando a gravação de um Blob falha, ele passa a ser guardado como bytes (ArrayBuffer) + tipo, e volta a ser Blob na leitura.
// Nos navegadores que gravam Blob (Chrome, Safari atual) nada muda: o registro fica igual ao das versões anteriores.
let semBlob = false;
const ehBlob = v => typeof Blob !== 'undefined' && v instanceof Blob;
const temBlob = v => ehBlob(v) || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(ehBlob));
const embrulha = async b => ({ __blob: 1, type: b.type || '', buf: await b.arrayBuffer() });
async function semBlobs(val) {
  if (ehBlob(val)) return embrulha(val);
  const out = { ...val };
  for (const k of Object.keys(val)) if (ehBlob(val[k])) out[k] = await embrulha(val[k]);
  return out;
}
const ehEmbrulho = x => !!x && typeof x === 'object' && x.__blob === 1 && x.buf instanceof ArrayBuffer;
const desembrulha = x => new Blob([x.buf], { type: x.type || '' });
function comBlobs(v) {
  if (!v || typeof v !== 'object') return v;
  if (ehEmbrulho(v)) return desembrulha(v);
  for (const k of Object.keys(v)) if (ehEmbrulho(v[k])) v[k] = desembrulha(v[k]);
  return v;
}
const putCru = (store, val, key) => tx(store, 'readwrite', s => req(key === undefined ? s.put(val) : s.put(val, key)));

export const get = (store, key) => tx(store, 'readonly', s => req(s.get(key))).then(comBlobs);
export async function put(store, val, key) {
  if (!temBlob(val)) return putCru(store, val, key);
  if (!semBlob) { try { return await putCru(store, val, key); } catch { semBlob = true; } }
  return putCru(store, await semBlobs(val), key);
}
export const del = (store, key) => tx(store, 'readwrite', s => req(s.delete(key)));
export const all = (store) => tx(store, 'readonly', s => req(s.getAll())).then(l => l.map(comBlobs));
export const clear = (store) => tx(store, 'readwrite', s => req(s.clear()));
export const putMany = async (store, vals) => { for (const v of vals) await put(store, v); };
export const blobComoBytes = () => semBlob;
export const STORE_NAMES = STORES;
