/* db.js - IndexedDB (Control de Gastos v1) */
(function(){
  const DB_NAME = "control_gastos_v1";
  const DB_VER = 1;

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onerror = ()=> reject(req.error);
      req.onupgradeneeded = (e)=>{
        const db = req.result;
        // kv store (settings)
        if(!db.objectStoreNames.contains("kv")){
          db.createObjectStore("kv",{keyPath:"key"});
        }
        // transactions
        if(!db.objectStoreNames.contains("tx")){
          const store = db.createObjectStore("tx",{keyPath:"id"});
          store.createIndex("dateMs","dateMs",{unique:false});
        }
        // transfers
        if(!db.objectStoreNames.contains("tr")){
          const store = db.createObjectStore("tr",{keyPath:"id"});
          store.createIndex("dateMs","dateMs",{unique:false});
        }
      };
      req.onsuccess = ()=> resolve(req.result);
    });
  }

  function tx(db, storeName, mode, fn){
    return new Promise((resolve,reject)=>{
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let res;
      try{ res = fn(store, t); }catch(err){ reject(err); return; }
      t.oncomplete = ()=> resolve(res);
      t.onerror = ()=> reject(t.error || new Error("Error DB"));
      t.onabort = ()=> reject(t.error || new Error("Abort DB"));
    });
  }

  async function getKV(db, key){
    const out = await tx(db,"kv","readonly",(s)=>new Promise((resolve,reject)=>{
      const r = s.get(key);
      r.onsuccess = ()=> resolve(r.result?.value ?? null);
      r.onerror = ()=> reject(r.error);
    }));
    return out;
  }

  async function setKV(db, key, value){
    await tx(db,"kv","readwrite",(s)=>new Promise((resolve,reject)=>{
      const r = s.put({key, value});
      r.onsuccess = ()=> resolve(true);
      r.onerror = ()=> reject(r.error);
    }));
  }

  function listByDateRange(db, storeName, startMs, endMs){
    return tx(db, storeName, "readonly", (s)=>new Promise((resolve,reject)=>{
      const idx = s.index("dateMs");
      const range = IDBKeyRange.bound(startMs, endMs, false, true);
      const out = [];
      const cursorReq = idx.openCursor(range);
      cursorReq.onerror = ()=> reject(cursorReq.error);
      cursorReq.onsuccess = ()=>{
        const cur = cursorReq.result;
        if(!cur){ resolve(out); return; }
        out.push(cur.value);
        cur.continue();
      };
    }));
  }

  function listAll(db, storeName){
    return tx(db, storeName, "readonly", (s)=>new Promise((resolve,reject)=>{
      const r = s.getAll();
      r.onsuccess = ()=> resolve(r.result || []);
      r.onerror = ()=> reject(r.error);
    }));
  }

  function putOne(db, storeName, obj){
    return tx(db, storeName, "readwrite", (s)=>new Promise((resolve,reject)=>{
      const r = s.put(obj);
      r.onsuccess = ()=> resolve(true);
      r.onerror = ()=> reject(r.error);
    }));
  }

  function delOne(db, storeName, id){
    return tx(db, storeName, "readwrite", (s)=>new Promise((resolve,reject)=>{
      const r = s.delete(id);
      r.onsuccess = ()=> resolve(true);
      r.onerror = ()=> reject(r.error);
    }));
  }

  async function wipeAndImport(db, payload){
    // payload: {settings, tx:[], tr:[]}
    await tx(db, "tx", "readwrite", (s)=>new Promise((resolve,reject)=>{
      const r = s.clear();
      r.onsuccess = ()=> resolve(true);
      r.onerror = ()=> reject(r.error);
    }));
    await tx(db, "tr", "readwrite", (s)=>new Promise((resolve,reject)=>{
      const r = s.clear();
      r.onsuccess = ()=> resolve(true);
      r.onerror = ()=> reject(r.error);
    }));
    await setKV(db, "settings", payload.settings);

    // bulk insert
    await tx(db,"tx","readwrite",(s)=> new Promise((resolve,reject)=>{
      const list = payload.tx || [];
      let i=0;
      function next(){
        if(i>=list.length){ resolve(true); return; }
        const r = s.put(list[i++]);
        r.onsuccess = ()=> next();
        r.onerror = ()=> reject(r.error);
      }
      next();
    }));
    await tx(db,"tr","readwrite",(s)=> new Promise((resolve,reject)=>{
      const list = payload.tr || [];
      let i=0;
      function next(){
        if(i>=list.length){ resolve(true); return; }
        const r = s.put(list[i++]);
        r.onsuccess = ()=> next();
        r.onerror = ()=> reject(r.error);
      }
      next();
    }));
  }

  window.DB = {
    openDB,
    getSettings: (db)=>getKV(db,"settings"),
    saveSettings: (db, settings)=>setKV(db,"settings", settings),
    listTxByRange: (db, startMs, endMs)=>listByDateRange(db,"tx",startMs,endMs),
    listTrByRange: (db, startMs, endMs)=>listByDateRange(db,"tr",startMs,endMs),
    listAllTx: (db)=>listAll(db,"tx"),
    listAllTr: (db)=>listAll(db,"tr"),
    putTx: (db, obj)=>putOne(db,"tx",obj),
    delTx: (db, id)=>delOne(db,"tx",id),
    putTr: (db, obj)=>putOne(db,"tr",obj),
    delTr: (db, id)=>delOne(db,"tr",id),
    exportAll: async (db)=>({ settings: await getKV(db,"settings"), tx: await listAll(db,"tx"), tr: await listAll(db,"tr") }),
    importAll: (db, payload)=>wipeAndImport(db,payload),
  };
})();
