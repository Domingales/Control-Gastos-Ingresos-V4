/* app.js - Control de Gastos v1 */
(async function(){
  const appEl = document.getElementById("app");
  const loadingEl = document.getElementById("loading");
  const subtitleEl = document.getElementById("subtitle");
  const quickAddBtn = document.getElementById("quickAddBtn");

  const DEFAULT_SETTINGS = {
    version: 1,
    currency: "EUR",
    theme: "light", // light | dark | contrast
    periodMode: "calendar", // calendar | paycycle
    paycycleStartDay: 25, // 1..31 (si el mes no tiene ese día, se usa el último día del mes)
    accounts: [
      {id:"cash", name:"Efectivo", initialBalance:0},
      {id:"card", name:"Tarjeta", initialBalance:0},
      {id:"bank", name:"Banco", initialBalance:0},
    ],
    categories: [
      // income
      {id:"inc_salary", name:"Nómina", kind:"income"},
      {id:"inc_other", name:"Otros ingresos", kind:"income"},
      // expense
      {id:"exp_home", name:"Vivienda", kind:"expense"},
      {id:"exp_food", name:"Alimentación", kind:"expense"},
      {id:"exp_transport", name:"Transporte", kind:"expense"},
      {id:"exp_bills", name:"Suministros", kind:"expense"},
      {id:"exp_health", name:"Salud", kind:"expense"},
      {id:"exp_fun", name:"Ocio", kind:"expense"},
      {id:"exp_subs", name:"Suscripciones", kind:"expense"},
      {id:"exp_house", name:"Hogar", kind:"expense"},
      {id:"exp_unexp", name:"Imprevistos", kind:"expense"},
      {id:"exp_savings", name:"Ahorro", kind:"expense"},
    ],
    budgets: {
      // catId -> monthly/period cap
      // default: none (0)
    }
  };

  const state = {
    db: null,
    settings: null,
    route: "panel",
    periodOffset: 0, // 0 = periodo actual, -1 anterior, +1 siguiente
    range: { enabled:false, startYMD:"", endYMD:"" }, // rango personalizado (inclusive)
    rangeDraft: { startYMD:"", endYMD:"" }, // valores del selector antes de aplicar
    cache: {
      tx: [],
      tr: []
    }
  };

  // ---------- Service worker (offline cache) ----------
  try{
    if("serviceWorker" in navigator){
      await navigator.serviceWorker.register("./sw.js");
    }
  }catch(_){}

  // ---------- Init DB + Settings ----------
  try{
    state.db = await DB.openDB();
    let s = await DB.getSettings(state.db);
    if(!s){
      s = structuredClone(DEFAULT_SETTINGS);
      await DB.saveSettings(state.db, s);
    }else{
      // forward compatibility
      s = { ...structuredClone(DEFAULT_SETTINGS), ...s };
      s.accounts = (s.accounts && s.accounts.length) ? s.accounts : structuredClone(DEFAULT_SETTINGS.accounts);
      s.categories = (s.categories && s.categories.length) ? s.categories : structuredClone(DEFAULT_SETTINGS.categories);
      s.budgets = s.budgets || {};
      await DB.saveSettings(state.db, s);
    }
    state.settings = s;
    applyTheme();
  }catch(err){
    console.error(err);
    appEl.innerHTML = "";
    appEl.appendChild(U.el("div",{class:"card"},[
      U.el("div",{class:"h1",text:"Error iniciando la app"}),
      U.el("div",{class:"tiny muted", style:"margin-top:8px"}, "No se ha podido abrir la base de datos del navegador (IndexedDB). Prueba en otro navegador o revisa permisos.")
    ]));
    loadingEl?.remove();
    return;
  }

  // ---------- Routing ----------
  function setActiveNav(){
    document.querySelectorAll(".nav__item").forEach(a=>{
      const r = a.getAttribute("data-route");
      a.classList.toggle("active", r===state.route);
    });
  }
  function parseRoute(){
    const h = (location.hash || "#/panel").replace("#/","");
    const ok = ["panel","movimientos","presupuesto","cuentas","ajustes"].includes(h) ? h : "panel";
    state.route = ok;
  }
  window.addEventListener("hashchange", ()=>{ parseRoute(); render(); });

  // Quick add modal
  quickAddBtn.addEventListener("click", ()=> openQuickAddModal());
// ---------- Period helpers ----------
  function daysInMonth(y,m){ // m 0-11
    return new Date(y, m+1, 0).getDate();
  }

  function periodRangeFor(date, offset=0){
    const s = state.settings;
    const d = new Date(date.getTime());
    if(s.periodMode === "calendar"){
      const base = new Date(d.getFullYear(), d.getMonth()+offset, 1, 0,0,0,0);
      const start = base;
      const end = new Date(base.getFullYear(), base.getMonth()+1, 1, 0,0,0,0);
      return { start, end };
    }

    // paycycle: startDay in each month (or last day if month shorter)
    const startDay = U.clamp(parseInt(s.paycycleStartDay||1,10) || 1, 1, 31);

    // Determine period start for "d" with offset 0
    const y = d.getFullYear();
    const m = d.getMonth();
    const dim = daysInMonth(y,m);
    const startThisMonthDay = Math.min(startDay, dim);
    const startThisMonth = new Date(y, m, startThisMonthDay, 0,0,0,0);

    let start0;
    if(d >= startThisMonth){
      start0 = startThisMonth;
    }else{
      const prev = new Date(y, m-1, 1);
      const dimPrev = daysInMonth(prev.getFullYear(), prev.getMonth());
      const dayPrev = Math.min(startDay, dimPrev);
      start0 = new Date(prev.getFullYear(), prev.getMonth(), dayPrev, 0,0,0,0);
    }

    // Apply offset: move start0 by offset months keeping the rule
    let start = start0;
    if(offset !== 0){
      const tmp = new Date(start0.getFullYear(), start0.getMonth()+offset, 1);
      const dimTmp = daysInMonth(tmp.getFullYear(), tmp.getMonth());
      const dayTmp = Math.min(startDay, dimTmp);
      start = new Date(tmp.getFullYear(), tmp.getMonth(), dayTmp, 0,0,0,0);
    }

    // End is next cycle start
    const tmpEnd = new Date(start.getFullYear(), start.getMonth()+1, 1);
    const dimEnd = daysInMonth(tmpEnd.getFullYear(), tmpEnd.getMonth());
    const dayEnd = Math.min(startDay, dimEnd);
    const end = new Date(tmpEnd.getFullYear(), tmpEnd.getMonth(), dayEnd, 0,0,0,0);
    return { start, end };
  }

  function currentPeriodRange(){
    return periodRangeFor(new Date(), state.periodOffset);
  }

  function periodLabel({start,end}){
    const s = state.settings;
    if(s.periodMode === "calendar"){
      return start.toLocaleDateString("es-ES",{month:"long",year:"numeric"});
    }
    const a = start.toLocaleDateString("es-ES",{day:"2-digit",month:"short",year:"numeric"});
    const b = new Date(end.getTime()-1).toLocaleDateString("es-ES",{day:"2-digit",month:"short",year:"numeric"});
    return `${a} – ${b}`;
  }


  // ---------- Date range (inicio/fin) ----------
  function dateToYMD(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  }

  function ymdToDate(ymd){
    const s = String(ymd||"").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    const y = parseInt(m[1],10), mo = parseInt(m[2],10)-1, da = parseInt(m[3],10);
    return new Date(y, mo, da, 0,0,0,0);
  }

  function addDays(d, n){
    const x = new Date(d.getTime());
    x.setDate(x.getDate()+n);
    x.setHours(0,0,0,0);
    return x;
  }

  function formatRangeLabel(startDate, endInclusiveDate){
    const a = startDate.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric"});
    const b = endInclusiveDate.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric"});
    return `${a} – ${b}`;
  }

  // Rango activo para filtrar (end es EXCLUSIVO). Si no hay rango personalizado, usa el periodo configurado.
  function activeRangeMeta(){
    if(state.range?.enabled){
      const sY = state.range.startYMD;
      const eY = state.range.endYMD;
      const sD = ymdToDate(sY);
      const eD = ymdToDate(eY);
      if(sD && eD){
        const start = sD;
        const endExclusive = addDays(eD, 1);
        if(endExclusive.getTime() > start.getTime()){
          return {
            start,
            end: endExclusive,
            label: formatRangeLabel(start, eD),
            startYMD: sY,
            endYMD: eY,
            isCustom: true
          };
        }
      }
    }
    const base = currentPeriodRange();
    const start = base.start;
    const end = base.end; // exclusivo
    const endInc = addDays(end, -1);
    return {
      start,
      end,
      label: periodLabel(base),
      startYMD: dateToYMD(start),
      endYMD: dateToYMD(endInc),
      isCustom: false
    };
  }

  function ensureRangeDraft(){
    const meta = activeRangeMeta();
    if(!state.rangeDraft) state.rangeDraft = {startYMD:"", endYMD:""};
    if(!state.rangeDraft.startYMD || !state.rangeDraft.endYMD){
      state.rangeDraft.startYMD = meta.startYMD;
      state.rangeDraft.endYMD = meta.endYMD;
    }
    return meta;
  }

  function resetRangeToCurrentPeriod(){
    state.range.enabled = false;
    state.periodOffset = 0;
    const meta = activeRangeMeta();
    state.rangeDraft.startYMD = meta.startYMD;
    state.rangeDraft.endYMD = meta.endYMD;
  }

  function rangeControls(){
    const meta = ensureRangeDraft();

    const startInp = U.el("input",{class:"input", type:"date", style:"max-width:160px"});
    const endInp = U.el("input",{class:"input", type:"date", style:"max-width:160px"});
    startInp.value = state.rangeDraft.startYMD;
    endInp.value = state.rangeDraft.endYMD;

    startInp.addEventListener("input", ()=>{ state.rangeDraft.startYMD = startInp.value; });
    endInp.addEventListener("input", ()=>{ state.rangeDraft.endYMD = endInp.value; });

    const applyBtn = U.el("button",{class:"btn small", text:"Aplicar"});
    const resetBtn = U.el("button",{class:"btn small", text:"Periodo"});

    applyBtn.onclick = ()=>{
      const sD = ymdToDate(state.rangeDraft.startYMD);
      const eD = ymdToDate(state.rangeDraft.endYMD);
      if(!sD || !eD){ U.toast("Elige fecha inicio y fecha fin."); return; }
      if(eD.getTime() < sD.getTime()){ U.toast("La fecha fin no puede ser anterior a inicio."); return; }
      state.range.enabled = true;
      state.range.startYMD = state.rangeDraft.startYMD;
      state.range.endYMD = state.rangeDraft.endYMD;
      render();
    };

    resetBtn.onclick = ()=>{
      resetRangeToCurrentPeriod();
      render();
    };

    const badge = U.el("div",{class:"badge", text: meta.label});
    return U.el("div",{class:"row", style:"gap:8px; flex-wrap:wrap; align-items:flex-end"},[
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Inicio"}), startInp]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Fin"}), endInp]),
      applyBtn,
      resetBtn,
      badge
    ]);
  }

  function capFactorForActiveRange(){
    const meta = activeRangeMeta();
    let factor = 0;
    let cursor = new Date(meta.start.getTime());
    cursor.setHours(0,0,0,0);

    let p = periodRangeFor(cursor, 0);
    let guard = 0;
    while(p.start.getTime() < meta.end.getTime() && guard < 200){
      guard++;
      const os = Math.max(meta.start.getTime(), p.start.getTime());
      const oe = Math.min(meta.end.getTime(), p.end.getTime());
      if(oe > os){
        const frac = (oe - os) / (p.end.getTime() - p.start.getTime());
        factor += frac;
      }
      if(p.end.getTime() <= cursor.getTime()) break;
      cursor = new Date(p.end.getTime());
      cursor.setHours(0,0,0,0);
      p = periodRangeFor(cursor, 0);
    }
    return factor;
  }

  // ---------- Data helpers ----------
  function accounts(){ return state.settings.accounts || []; }
  function categories(){ return state.settings.categories || []; }
  function catById(id){ return categories().find(c=>c.id===id) || null; }
  function accById(id){ return accounts().find(a=>a.id===id) || null; }

  async function loadPeriodData(){
    const {start,end} = activeRangeMeta();
    const startMs = start.getTime();
    const endMs = end.getTime();
    const [tx, tr] = await Promise.all([
      DB.listTxByRange(state.db, startMs, endMs),
      DB.listTrByRange(state.db, startMs, endMs)
    ]);
    // sort by date desc
    tx.sort((a,b)=>b.dateMs - a.dateMs);
    tr.sort((a,b)=>b.dateMs - a.dateMs);
    state.cache.tx = tx;
    state.cache.tr = tr;
  }

  async function loadAllData(){
    const [tx, tr] = await Promise.all([DB.listAllTx(state.db), DB.listAllTr(state.db)]);
    tx.sort((a,b)=>b.dateMs - a.dateMs);
    tr.sort((a,b)=>b.dateMs - a.dateMs);
    return { tx, tr };
  }

  function sumPeriod(txList){
    let income=0, expense=0;
    for(const t of txList){
      if(t.type==="income") income += Number(t.amount||0);
      else expense += Number(t.amount||0);
    }
    return { income, expense, balance: income - expense };
  }

  function groupByCategoryExpenses(txList){
    const map = new Map();
    for(const t of txList){
      if(t.type!=="expense") continue;
      const k = t.categoryId || "sin_categoria";
      map.set(k, (map.get(k)||0) + Number(t.amount||0));
    }
    return map;
  }

  function groupByAccountNet(txList, trList){
    // net change within period (income-expense + transfers)
    const map = new Map();
    for(const a of accounts()) map.set(a.id, 0);

    for(const t of txList){
      const id = t.accountId || "cash";
      const cur = map.get(id) || 0;
      const delta = (t.type==="income") ? Number(t.amount||0) : -Number(t.amount||0);
      map.set(id, cur + delta);
    }
    for(const tr of trList){
      const amt = Number(tr.amount||0);
      map.set(tr.fromAccountId, (map.get(tr.fromAccountId)||0) - amt);
      map.set(tr.toAccountId, (map.get(tr.toAccountId)||0) + amt);
    }
    return map;
  }

  async function computeBalances(){
    const all = await loadAllData();
    const map = new Map();
    for(const a of accounts()) map.set(a.id, Number(a.initialBalance||0));

    for(const t of all.tx){
      const id = t.accountId || "cash";
      const delta = (t.type==="income") ? Number(t.amount||0) : -Number(t.amount||0);
      map.set(id, (map.get(id)||0) + delta);
    }
    for(const tr of all.tr){
      const amt = Number(tr.amount||0);
      map.set(tr.fromAccountId, (map.get(tr.fromAccountId)||0) - amt);
      map.set(tr.toAccountId, (map.get(tr.toAccountId)||0) + amt);
    }
    return map;
  }


  async function computeBalancesSnapshots(cutoffMsList){
    const { tx, tr } = await loadAllData();
    const cutoffs = Array.from(new Set((cutoffMsList||[]).map(x=>Number(x)).filter(x=>Number.isFinite(x)))).sort((a,b)=>a-b);

    const events = [];
    for(const t of tx) events.push({dateMs: Number(t.dateMs||0), kind:"tx", t});
    for(const x of tr) events.push({dateMs: Number(x.dateMs||0), kind:"tr", tr:x});
    events.sort((a,b)=>a.dateMs-b.dateMs);

    const cur = new Map();
    for(const a of accounts()) cur.set(a.id, Number(a.initialBalance||0));

    const snaps = new Map();
    let ci = 0;

    function applyTx(t){
      const id = t.accountId || "cash";
      const amt = Number(t.amount||0);
      const delta = (t.type==="income") ? amt : -amt;
      cur.set(id, (cur.get(id)||0) + delta);
    }
    function applyTr(x){
      const amt = Number(x.amount||0);
      cur.set(x.fromAccountId, (cur.get(x.fromAccountId)||0) - amt);
      cur.set(x.toAccountId, (cur.get(x.toAccountId)||0) + amt);
    }

    for(const ev of events){
      while(ci < cutoffs.length && ev.dateMs >= cutoffs[ci]){
        snaps.set(cutoffs[ci], new Map(cur));
        ci++;
      }
      if(ev.kind==="tx") applyTx(ev.t);
      else applyTr(ev.tr);
    }
    while(ci < cutoffs.length){
      snaps.set(cutoffs[ci], new Map(cur));
      ci++;
    }

    return { now: new Map(cur), snaps };
  }

  // ---------- UI helpers ----------
  function sectionHeader(title, rightNode=null){
    return U.el("div",{class:"row space", style:"margin-bottom:10px"},[
      U.el("div",{class:"h1", text:title}),
      rightNode
    ]);
  }

  function periodSwitcher(){
    const range = currentPeriodRange();
    const label = periodLabel(range);
    return U.el("div",{class:"row", style:"gap:8px"},[
      U.el("button",{class:"btn small", text:"◀", onclick: ()=>{ state.periodOffset -= 1; render(); }}),
      U.el("div",{class:"badge", text: label}),
      U.el("button",{class:"btn small", text:"▶", onclick: ()=>{ state.periodOffset += 1; render(); }})
    ]);
  }

  function exportBtn(onclick, text="Exportar XLSX"){
    return U.el("button",{class:"btn small", text, onclick});
  }

  function printBtn(onclick, text="Imprimir"){
    return U.el("button",{class:"btn small", text, onclick});
  }

  function setSubtitle(text){ subtitleEl.textContent = text; }

  function applyTheme(){
    const t = state.settings.theme || "light";
    document.documentElement.setAttribute("data-theme", t);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t==="dark" ? "#0b1220" : "#f2f4f7");
  }

  function ensureNum(n){ const x = Number(n); return Number.isFinite(x) ? x : 0; }

  // ---------- Modal: Add/Edit transaction ----------
  function txFormNode({tx=null, defaultType="expense"}={}){
    const s = state.settings;
    const isEdit = !!tx;
    const typeSel = U.el("select",{});
    ["expense","income"].forEach(v=>{
      typeSel.appendChild(U.el("option",{value:v, text: v==="expense" ? "Gasto" : "Ingreso"}));
    });
    typeSel.value = tx?.type || defaultType;

    const amountInp = U.el("input",{class:"input", placeholder:"Importe (ej: 12,50)", inputmode:"decimal"});
    amountInp.value = tx ? U.number2(tx.amount).replace(/\./g,"") : "";

    const dateInp = U.el("input",{class:"input", type:"date"});
    dateInp.value = tx ? new Date(tx.dateMs).toISOString().slice(0,10) : U.todayISO();

    const accSel = U.el("select",{});
    for(const a of accounts()){
      accSel.appendChild(U.el("option",{value:a.id, text:a.name}));
    }
    accSel.value = tx?.accountId || "cash";

    const catSel = U.el("select",{});
    function refreshCats(){
      catSel.innerHTML = "";
      const kind = typeSel.value;
      const list = categories().filter(c=>c.kind===kind);
      for(const c of list){
        catSel.appendChild(U.el("option",{value:c.id, text:c.name}));
      }
      if(tx?.categoryId && list.some(c=>c.id===tx.categoryId)) catSel.value = tx.categoryId;
    }
    refreshCats();
    typeSel.addEventListener("change", refreshCats);

    const noteInp = U.el("textarea",{placeholder:"Nota (opcional)"});
    noteInp.value = tx?.note || "";

    const form = U.el("div",{class:"grid", style:"gap:10px"},[
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Tipo"}), typeSel]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Importe"}), amountInp]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Fecha"}), dateInp]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Cuenta"}), accSel]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Categoría"}), catSel]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Nota"}), noteInp]),
    ]);

    function getValue(){
      const amount = U.parseAmount(amountInp.value);
      const iso = dateInp.value || U.todayISO();
      const dateMs = new Date(iso+"T00:00:00").getTime();
      const obj = {
        id: tx?.id || U.uid(),
        type: typeSel.value,
        amount: ensureNum(amount),
        dateMs,
        categoryId: catSel.value || null,
        accountId: accSel.value || "cash",
        note: noteInp.value?.trim() || ""
      };
      return obj;
    }

    return { node: form, getValue, typeSel, amountInp };
  }

  function openTxModal({mode="add", tx=null, _forceType=null}={}){
    const isEdit = mode==="edit";
    const defaultType = _forceType || (tx?.type) || "expense";
    const {node, getValue, amountInp} = txFormNode({tx, defaultType});

    const saveBtn = U.el("button",{class:"btn primary", text: isEdit ? "Guardar" : "Añadir"});
    const cancelBtn = U.el("button",{class:"btn", text:"Cancelar"});

    const modal = U.openModal({
      title: isEdit ? "Editar movimiento" : "Añadir movimiento",
      contentNode: node,
      footerNodes: [cancelBtn, saveBtn]
    });

    cancelBtn.onclick = ()=> modal.close();
    saveBtn.onclick = async ()=>{
      const obj = getValue();
      if(!obj.amount || obj.amount<=0){
        U.toast("Introduce un importe válido.");
        amountInp.focus();
        return;
      }
      await DB.putTx(state.db, obj);
      modal.close();
      U.toast(isEdit ? "Movimiento actualizado." : "Movimiento añadido.");
      await render(); // refresh
    };
  }

  // ---------- Modal: Quick add (Gasto / Ingreso / Transferencia) ----------
  function openQuickAddModal(){
    const content = U.el("div",{class:"grid", style:"gap:10px"},[
      U.el("div",{class:"tiny muted", text:"¿Qué quieres añadir?"}),
      U.el("button",{class:"btn primary", text:"Gasto", onclick: ()=>{ modal.close(); openTxModal({mode:"add", tx:null, _forceType:"expense"}); }}),
      U.el("button",{class:"btn primary", text:"Ingreso", onclick: ()=>{ modal.close(); openTxModal({mode:"add", tx:null, _forceType:"income"}); }}),
      U.el("button",{class:"btn", text:"Transferencia entre cuentas", onclick: ()=>{ modal.close(); openTransferModal({}); }}),
    ]);

    const closeBtn = U.el("button",{class:"btn", text:"Cerrar"});
    const modal = U.openModal({
      title: "Añadir",
      contentNode: content,
      footerNodes: [closeBtn]
    });
    closeBtn.onclick = ()=> modal.close();
  }

  // ---------- Modal: Transfer ----------
  function openTransferModal({tr=null}={}){
    const isEdit = !!tr;
    const dateInp = U.el("input",{class:"input", type:"date"});
    dateInp.value = tr ? new Date(tr.dateMs).toISOString().slice(0,10) : U.todayISO();

    const fromSel = U.el("select",{});
    const toSel = U.el("select",{});
    for(const a of accounts()){
      fromSel.appendChild(U.el("option",{value:a.id, text:a.name}));
      toSel.appendChild(U.el("option",{value:a.id, text:a.name}));
    }
    fromSel.value = tr?.fromAccountId || "bank";
    toSel.value = tr?.toAccountId || "cash";

    const amountInp = U.el("input",{class:"input", placeholder:"Importe (ej: 50,00)", inputmode:"decimal"});
    amountInp.value = tr ? U.number2(tr.amount).replace(/\./g,"") : "";

    const noteInp = U.el("textarea",{placeholder:"Nota (opcional)"});
    noteInp.value = tr?.note || "";

    const form = U.el("div",{class:"grid", style:"gap:10px"},[
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Fecha"}), dateInp]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Desde"}), fromSel]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Hacia"}), toSel]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Importe"}), amountInp]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Nota"}), noteInp]),
    ]);

    const saveBtn = U.el("button",{class:"btn primary", text: isEdit ? "Guardar" : "Transferir"});
    const cancelBtn = U.el("button",{class:"btnung", text:"Cancelar"});
    cancelBtn.className = "btn";

    const modal = U.openModal({
      title: isEdit ? "Editar transferencia" : "Transferencia entre cuentas",
      contentNode: form,
      footerNodes: [cancelBtn, saveBtn]
    });

    cancelBtn.onclick = ()=> modal.close();
    saveBtn.onclick = async ()=>{
      const amount = U.parseAmount(amountInp.value);
      if(!amount || amount<=0){ U.toast("Importe no válido."); amountInp.focus(); return; }
      if(fromSel.value === toSel.value){ U.toast("Elige cuentas distintas."); return; }
      const iso = dateInp.value || U.todayISO();
      const obj = {
        id: tr?.id || U.uid(),
        dateMs: new Date(iso+"T00:00:00").getTime(),
        fromAccountId: fromSel.value,
        toAccountId: toSel.value,
        amount: ensureNum(amount),
        note: noteInp.value?.trim() || ""
      };
      await DB.putTr(state.db, obj);
      modal.close();
      U.toast(isEdit ? "Transferencia actualizada." : "Transferencia guardada.");
      await render();
    };
  }


  // ---------- Modal: Añadir / Borrar cuenta ----------
  function safeAccountId(){
    // U.uid() ya se usa para movimientos/transferencias; si no existiera por algún motivo, fallback.
    try{
      const u = (typeof U!=="undefined" && typeof U.uid==="function") ? U.uid() : null;
      if(u) return "acc_"+String(u).replace(/[^a-zA-Z0-9_-]/g,"");
    }catch(_){}
    return "acc_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
  }

  function normName(s){ return String(s||"").trim().toLowerCase(); }

  function openAddAccountModal(){
    const nameInp = U.el("input",{class:"input", placeholder:"Nombre de la cuenta…"});
    const initInp = U.el("input",{class:"input", type:"number", step:"0.01", placeholder:"Saldo inicial (opcional)", value:"0"});
    const tip = U.el("div",{class:"tiny muted", text:"Consejo: puedes crear varias cuentas (p. ej., 'Banco 1', 'Banco 2', 'Ahorros', etc.)."});

    const saveBtn = U.el("button",{class:"btn primary", text:"Añadir"});
    const cancelBtn = U.el("button",{class:"btn", text:"Cancelar"});

    const modal = U.openModal({
      title:"Añadir cuenta",
      contentNode: U.el("div",{class:"grid", style:"gap:10px"},[
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Nombre"}), nameInp]),
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Saldo inicial"}), initInp]),
        tip
      ]),
      footerNodes:[cancelBtn, saveBtn]
    });

    cancelBtn.onclick = ()=> modal.close();

    saveBtn.onclick = async ()=>{
      const name = String(nameInp.value||"").trim();
      if(!name){
        U.toast("Escribe un nombre para la cuenta.");
        nameInp.focus();
        return;
      }
      const exists = accounts().some(a=> normName(a.name) === normName(name));
      if(exists){
        U.toast("Ya existe una cuenta con ese nombre.");
        nameInp.focus();
        return;
      }
      const initialBalance = ensureNum(initInp.value);
      const id = safeAccountId();

      state.settings.accounts = [...accounts(), {id, name, initialBalance}];
      await DB.saveSettings(state.db, state.settings);

      modal.close();
      U.toast("Cuenta añadida.");
      await render();
    };
  }

  function openDeleteAccountModal(){
    const accs = accounts();

    if(accs.length<=1){
      U.toast("No puedes borrar la última cuenta.");
      return;
    }

    const sel = U.el("select",{class:"input"});
    for(const a of accs){
      sel.appendChild(U.el("option",{value:a.id, text:a.name}));
    }

    const info = U.el("div",{class:"tiny muted", text:"Selecciona una cuenta para ver su extracto y opciones de borrado."});

    const reassignWrap = U.el("div",{style:"display:none"});
    const reassignSel = U.el("select",{class:"input"});
    const reassignHint = U.el("div",{class:"tiny muted", style:"margin-top:6px", text:"Esta cuenta tiene movimientos/transferencias. Para borrarla con seguridad, reasigna su historial a otra cuenta."});
    reassignWrap.appendChild(U.el("div",{class:"tiny muted", text:"Reasignar historial a:"}));
    reassignWrap.appendChild(reassignSel);
    reassignWrap.appendChild(reassignHint);

    let txAll = null;
    let trAll = null;

    async function ensureAllLoaded(){
      if(!txAll) txAll = await DB.listAllTx(state.db);
      if(!trAll) trAll = await DB.listAllTr(state.db);
    }

    function fillReassignOptions(delId){
      reassignSel.innerHTML = "";
      const others = accounts().filter(a=>a.id!==delId);
      for(const a of others){
        reassignSel.appendChild(U.el("option",{value:a.id, text:a.name}));
      }
    }

    async function refresh(){
      const delId = sel.value;
      await ensureAllLoaded();

      const txCount = (txAll||[]).filter(t=>(t.accountId||"cash")===delId).length;
      const trCount = (trAll||[]).filter(x=>x.fromAccountId===delId || x.toAccountId===delId).length;

      if(txCount===0 && trCount===0){
        info.textContent = "La cuenta no tiene movimientos ni transferencias asociados. Puedes borrarla.";
        reassignWrap.style.display = "none";
      }else{
        info.textContent = `La cuenta tiene ${txCount} movimientos y ${trCount} transferencias asociados. Para borrarla, debes reasignar ese historial.`;
        fillReassignOptions(delId);
        reassignWrap.style.display = "";
      }
    }

    sel.addEventListener("change", ()=>{ refresh(); });

    const delBtn = U.el("button",{class:"btn danger", text:"Borrar cuenta"});
    const cancelBtn = U.el("button",{class:"btn", text:"Cancelar"});

    const modal = U.openModal({
      title:"Borrar cuenta",
      contentNode: U.el("div",{class:"grid", style:"gap:10px"},[
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Cuenta"}), sel]),
        info,
        reassignWrap
      ]),
      footerNodes:[cancelBtn, delBtn]
    });

    cancelBtn.onclick = ()=> modal.close();

    delBtn.onclick = async ()=>{
      const delId = sel.value;

      if(accounts().length<=1){
        U.toast("No puedes borrar la última cuenta.");
        return;
      }

      await ensureAllLoaded();
      const txRel = (txAll||[]).filter(t=>(t.accountId||"cash")===delId);
      const trRel = (trAll||[]).filter(x=>x.fromAccountId===delId || x.toAccountId===delId);

      // Si hay historial, exigimos reasignación (seguro y reversible).
      let reassignTo = null;
      if(txRel.length || trRel.length){
        reassignTo = reassignSel.value;
        if(!reassignTo){
          U.toast("Selecciona una cuenta de destino para reasignar.");
          return;
        }
      }

      const ok = await U.confirmDialog({
        title:"Confirmar borrado",
        message: (txRel.length || trRel.length)
          ? "Se reasignará el historial a otra cuenta y luego se borrará la cuenta seleccionada. ¿Continuar?"
          : "Se borrará la cuenta seleccionada. ¿Continuar?",
        okText:"Borrar",
        cancelText:"Cancelar"
      });
      if(!ok) return;

      // Reasignación (si procede)
      if(reassignTo){
        for(const t of txRel){
          t.accountId = reassignTo;
          await DB.putTx(state.db, t);
        }
        for(const x of trRel){
          if(x.fromAccountId===delId) x.fromAccountId = reassignTo;
          if(x.toAccountId===delId) x.toAccountId = reassignTo;
          await DB.putTr(state.db, x);
        }
      }

      // Borrar cuenta de settings
      state.settings.accounts = accounts().filter(a=>a.id!==delId);

      // Si la cuenta borrada era la que se usaba por defecto en algún sitio (p. ej., selector inicial),
      // no hace falta más: los selectores se repintan con render().
      await DB.saveSettings(state.db, state.settings);

      modal.close();
      U.toast("Cuenta borrada.");
      await render();
    };

    // inicial
    refresh();
  }

  // ---------- Export (XLSX) builders ----------
  function rowsMovements(txList){
    const rows = [["Fecha","Tipo","Categoría","Cuenta","Nota","Importe"]];
    for(const t of txList){
      rows.push([
        new Date(t.dateMs).toLocaleDateString("es-ES"),
        t.type==="income" ? "Ingreso" : "Gasto",
        catById(t.categoryId)?.name || "",
        accById(t.accountId)?.name || "",
        t.note || "",
        ensureNum(t.amount)
      ]);
    }
    // total
    const {income, expense, balance} = sumPeriod(txList);
    rows.push(["","","","","TOTAL INGRESOS", income]);
    rows.push(["","","","","TOTAL GASTOS", expense]);
    rows.push(["","","","","BALANCE", balance]);
    return rows;
  }

  function rowsTransfers(trList){
    const rows = [["Fecha","Desde","Hacia","Nota","Importe"]];
    for(const t of trList){
      rows.push([
        new Date(t.dateMs).toLocaleDateString("es-ES"),
        accById(t.fromAccountId)?.name || "",
        accById(t.toAccountId)?.name || "",
        t.note || "",
        ensureNum(t.amount)
      ]);
    }
    return rows;
  }

  function rowsByCategory(txList){
    const exp = groupByCategoryExpenses(txList);
    const rows = [["Categoría","Gasto"]];
    const items = Array.from(exp.entries()).map(([catId, amt])=>({catId, amt}))
      .sort((a,b)=>b.amt-a.amt);
    for(const it of items){
      rows.push([catById(it.catId)?.name || it.catId, ensureNum(it.amt)]);
    }
    return rows;
  }

  function rowsByAccountPeriod(txList, trList){
    const net = groupByAccountNet(txList, trList);
    const rows = [["Cuenta","Variación en periodo"]];
    for(const a of accounts()){
      rows.push([a.name, ensureNum(net.get(a.id)||0)]);
    }
    return rows;
  }

  function rowsBudget(txList, capFactor=1){
    const exp = groupByCategoryExpenses(txList);
    const rows = [["Categoría","Tope","Gastado","Restante"]];
    for(const c of categories().filter(x=>x.kind==="expense")){
      const capBase = ensureNum(state.settings.budgets?.[c.id] || 0);
      const cap = capBase ? (capBase * capFactor) : 0;
      const spent = ensureNum(exp.get(c.id)||0);
      const remaining = cap ? (cap - spent) : 0;
      rows.push([c.name, cap, spent, remaining]);
    }
    return rows;
  }

  function panelWorkbook(){
    const meta = activeRangeMeta();
    const label = meta.label;
    const txList = state.cache.tx;
    const trList = state.cache.tr;
    const sums = sumPeriod(txList);

    const sheetResumen = [
      ["Periodo", label],
      ["Ingresos", sums.income],
      ["Gastos", sums.expense],
      ["Balance", sums.balance],
      ["" ,""],
      ["Nota", "Exportado desde Control de Gastos"]
    ];

    return {
      filename: `ControlGastos_Panel_${label.replace(/\s+/g,"_")}.xlsx`,
      sheets: [
        {name:"Resumen", rows: sheetResumen, currencyCols:[1]},
        {name:"Por categoría", rows: rowsByCategory(txList), currencyCols:[1]},
        {name:"Por cuenta (periodo)", rows: rowsByAccountPeriod(txList, trList), currencyCols:[1]},
        {name:"Movimientos", rows: rowsMovements(txList), currencyCols:[5]},
        {name:"Transferencias", rows: rowsTransfers(trList), currencyCols:[4]},
      ]
    };
  }

  // ---------- Print builders ----------
  function tableHtml(headers, rows, numericCols=new Set()){
    let h = "<table><thead><tr>";
    for(const th of headers) h += `<th>${escapeHtml(th)}</th>`;
    h += "</tr></thead><tbody>";
    for(const r of rows){
      h += "<tr>";
      for(let i=0;i<headers.length;i++){
        const v = r[i] ?? "";
        const cls = numericCols.has(i) ? "num" : "";
        h += `<td class="${cls}">${escapeHtml(String(v))}</td>`;
      }
      h += "</tr>";
    }
    h += "</tbody></table>";
    return h;
  }

  function escapeHtml(s){
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function printPanel(){
    const meta = activeRangeMeta();
    const label = meta.label;
    const txList = state.cache.tx;
    const trList = state.cache.tr;
    const sums = sumPeriod(txList);

    const kpis = `
      <div class="kpis">
        <div class="kpi"><div class="label">Ingresos</div><div class="value">${escapeHtml(U.money(sums.income, state.settings.currency))}</div></div>
        <div class="kpi"><div class="label">Gastos</div><div class="value">${escapeHtml(U.money(sums.expense, state.settings.currency))}</div></div>
        <div class="kpi"><div class="label">Balance</div><div class="value">${escapeHtml(U.money(sums.balance, state.settings.currency))}</div></div>
      </div>
    `;
    const byCatRows = rowsByCategory(txList).slice(1).map(r=>[r[0], U.money(r[1], state.settings.currency)]);
    const byAccRows = rowsByAccountPeriod(txList, trList).slice(1).map(r=>[r[0], U.money(r[1], state.settings.currency)]);

    const html = kpis +
      "<h3 style='margin:14px 0 8px'>Gasto por categoría</h3>" +
      tableHtml(["Categoría","Gasto"], byCatRows, new Set([1])) +
      "<h3 style='margin:14px 0 8px'>Variación por cuenta (periodo)</h3>" +
      tableHtml(["Cuenta","Variación"], byAccRows, new Set([1]));

    Print.printHtml({title:"Panel", subtitle:`Periodo: ${label}`, html});
  }

  function printMovements(){
    const label = activeRangeMeta().label;
    const rows = state.cache.tx.map(t=>[
      new Date(t.dateMs).toLocaleDateString("es-ES"),
      t.type==="income" ? "Ingreso" : "Gasto",
      catById(t.categoryId)?.name || "",
      accById(t.accountId)?.name || "",
      t.note || "",
      U.money(t.amount, state.settings.currency)
    ]);
    const html = tableHtml(["Fecha","Tipo","Categoría","Cuenta","Nota","Importe"], rows, new Set([5]));
    Print.printHtml({title:"Movimientos", subtitle:`Periodo: ${label}`, html});
  }

  function printBudget(){
    const label = periodLabel(currentPeriodRange());
    const txList = state.cache.tx;
    const exp = groupByCategoryExpenses(txList);
    const rows = categories().filter(c=>c.kind==="expense").map(c=>{
      const cap = ensureNum(state.settings.budgets?.[c.id]||0);
      const spent = ensureNum(exp.get(c.id)||0);
      const rem = cap ? (cap - spent) : 0;
      return [c.name, U.money(cap, state.settings.currency), U.money(spent, state.settings.currency), U.money(rem, state.settings.currency)];
    });
    const html = tableHtml(["Categoría","Tope","Gastado","Restante"], rows, new Set([1,2,3]));
    Print.printHtml({title:"Presupuesto (Topes)", subtitle:`Periodo: ${label}`, html});
  }

  async function printAccounts(){
    const meta = activeRangeMeta();
    const label = meta.label;
    const startMs = meta.start.getTime();
    const endMs = meta.end.getTime();
    const snap = await computeBalancesSnapshots([startMs, endMs]);
    const balancesStart = snap.snaps.get(startMs) || new Map();
    const balancesEnd = snap.snaps.get(endMs) || new Map();
    const balancesNow = snap.now;

const rows = accounts().map(a=>[a.name, U.money(balances.get(a.id)||0, state.settings.currency)]);
    const html = tableHtml(["Cuenta","Saldo actual"], rows, new Set([1]));
    Print.printHtml({title:"Cuentas", subtitle:`Saldo actual (histórico). Periodo visual: ${label}`, html});
  }

  // ---------- Views ----------
  async function viewPanel(){
    setSubtitle("Resumen del periodo");
    await loadPeriodData();

    const meta = activeRangeMeta();
    const label = meta.label;
    const txList = state.cache.tx;
    const trList = state.cache.tr;
    const sums = sumPeriod(txList);

    const head = sectionHeader("Panel", U.el("div",{class:"row", style:"gap:8px"},[
      rangeControls(),
      printBtn(()=>printPanel()),
      exportBtn(()=>{ const wb = panelWorkbook(); XLSXMini.exportXLSX(wb); })
    ]));

    const kpis = U.el("div",{class:"grid cols2"},[
      U.el("div",{class:"kpi"},[U.el("div",{class:"label",text:"Ingresos"}), U.el("div",{class:"value",text:U.money(sums.income, state.settings.currency)})]),
      U.el("div",{class:"kpi"},[U.el("div",{class:"label",text:"Gastos"}), U.el("div",{class:"value",text:U.money(sums.expense, state.settings.currency)})]),
      U.el("div",{class:"kpi"},[U.el("div",{class:"label",text:"Balance"}), U.el("div",{class:"value",text:U.money(sums.balance, state.settings.currency)})]),
      U.el("div",{class:"kpi"},[U.el("div",{class:"label",text:"Tasa de ahorro (aprox.)"}), U.el("div",{class:"value",text: (sums.income>0 ? ( (sums.balance/sums.income)*100 ).toFixed(1).replace(".",",")+"%" : "—")})]),
    ]);

    // Alerts budgets
    const exp = groupByCategoryExpenses(txList);
    const alerts = [];
    for(const c of categories().filter(c=>c.kind==="expense")){
      const cap = ensureNum(state.settings.budgets?.[c.id]||0);
      if(cap<=0) continue;
      const spent = ensureNum(exp.get(c.id)||0);
      if(spent > cap){
        alerts.push(`${c.name}: superado el tope (${U.money(spent, state.settings.currency)} / ${U.money(cap, state.settings.currency)})`);
      }
    }

    const alertsNode = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"row space"},[
        U.el("div",{class:"h2",text:"Avisos"}),
        U.el("span",{class:"badge " + (alerts.length? "danger":"success"), text: alerts.length ? `${alerts.length} aviso(s)` : "Sin avisos"})
      ]),
      U.el("hr",{class:"sep"}),
      alerts.length
        ? U.el("div",{class:"list"}, alerts.map(a=>U.el("div",{class:"item"},[
            U.el("div",{class:"left"},[
              U.el("div",{class:"title",text:"Presupuesto superado"}),
              U.el("div",{class:"meta",text:a})
            ])
          ])))
        : U.el("div",{class:"tiny muted",text:"Todo correcto. No hay categorías por encima del tope."})
    ]);

    // By category (top 6)
    const catItems = Array.from(exp.entries())
      .map(([catId, amt])=>({catId, amt}))
      .sort((a,b)=>b.amt-a.amt)
      .slice(0,6);

    const byCat = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"row space"},[
        U.el("div",{class:"h2",text:"Gasto por categoría (Top)"}),
        U.el("a",{href:"#/presupuesto", class:"btn small ghost", text:"Ver topes"})
      ]),
      U.el("hr",{class:"sep"}),
      catItems.length ? U.el("table",{class:"table"},[
        U.el("thead",{}, U.el("tr",{},[
          U.el("th",{text:"Categoría"}),
          U.el("th",{text:"Gasto", style:"text-align:right"})
        ])),
        U.el("tbody",{}, catItems.map(it=>{
          return U.el("tr",{},[
            U.el("td",{text: catById(it.catId)?.name || it.catId}),
            U.el("td",{class:"num", text: U.money(it.amt, state.settings.currency)})
          ]);
        }))
      ]) : U.el("div",{class:"tiny muted",text:"Aún no hay gastos en el periodo."})
    ]);

    // By account (period net)
    const net = groupByAccountNet(txList, trList);
    const byAcc = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"h2",text:"Variación por cuenta (periodo)"}),
      U.el("hr",{class:"sep"}),
      U.el("table",{class:"table"},[
        U.el("thead",{}, U.el("tr",{},[
          U.el("th",{text:"Cuenta"}),
          U.el("th",{text:"Variación", style:"text-align:right"})
        ])),
        U.el("tbody",{}, accounts().map(a=>{
          const v = ensureNum(net.get(a.id)||0);
          return U.el("tr",{},[
            U.el("td",{text:a.name}),
            U.el("td",{class:"num", text: U.money(v, state.settings.currency)})
          ]);
        }))
      ])
    ]);

    return U.el("div",{},[head, kpis, alertsNode, byCat, byAcc]);
  }

  async function viewMovimientos(){
    setSubtitle("Ingresos y gastos");
    await loadPeriodData();

    const meta = activeRangeMeta();
    const label = meta.label;

    const filters = {
      q: "",
      type: "all",
      account: "all",
      category: "all",
    };

    const qInp = U.el("input",{class:"input", placeholder:"Buscar (nota/categoría)…"});
    const typeSel = U.el("select",{});
    [["all","Todos"],["income","Ingresos"],["expense","Gastos"]].forEach(([v,t])=> typeSel.appendChild(U.el("option",{value:v,text:t})));

    const accSel = U.el("select",{});
    accSel.appendChild(U.el("option",{value:"all", text:"Todas las cuentas"}));
    for(const a of accounts()) accSel.appendChild(U.el("option",{value:a.id,text:a.name}));

    const catSel = U.el("select",{});
    function refreshCatOptions(){
      catSel.innerHTML = "";
      catSel.appendChild(U.el("option",{value:"all", text:"Todas las categorías"}));
      const kind = (typeSel.value==="all") ? null : typeSel.value;
      const list = kind ? categories().filter(c=>c.kind===kind) : categories();
      for(const c of list){
        catSel.appendChild(U.el("option",{value:c.id, text:`${c.name} (${c.kind==="income"?"Ingreso":"Gasto"})`}));
      }
    }
    refreshCatOptions();

    const transferBtn = U.el("button",{class:"btn small", text:"Transferir", onclick: ()=> openTransferModal({})});

    const addBtn = U.el("button",{class:"btn primary", text:"Añadir", onclick: ()=> openQuickAddModal()});
    const printB = printBtn(()=>printMovements());
    const exportB = exportBtn(()=>{
      const rows = rowsMovements(filteredList());
      XLSXMini.exportXLSX({
        filename: `ControlGastos_Movimientos_${label.replace(/\s+/g,"_")}.xlsx`,
        sheets: [{name:"Movimientos", rows, currencyCols:[5]}]
      });
    });

    const head = sectionHeader("Movimientos", U.el("div",{class:"row", style:"gap:8px"},[
      rangeControls(), printB, exportB, transferBtn, addBtn
    ]));

    function matches(t, q){
      if(!q) return true;
      const cat = catById(t.categoryId)?.name || "";
      const hay = (cat+" "+(t.note||"")).toLowerCase();
      return hay.includes(q.toLowerCase());
    }

    function filteredList(){
      const q = filters.q.trim();
      return state.cache.tx.filter(t=>{
        if(filters.type!=="all" && t.type!==filters.type) return false;
        if(filters.account!=="all" && (t.accountId||"cash")!==filters.account) return false;
        if(filters.category!=="all" && (t.categoryId||"")!==filters.category) return false;
        if(!matches(t,q)) return false;
        return true;
      });
    }

    const listNode = U.el("div",{class:"list"});

    function renderList(){
      const items = filteredList();
      listNode.innerHTML = "";
      if(!items.length){
        listNode.appendChild(U.el("div",{class:"card"}, U.el("div",{class:"tiny muted",text:"No hay movimientos con los filtros actuales."})));
        return;
      }
      for(const t of items){
        const cat = catById(t.categoryId)?.name || "";
        const acc = accById(t.accountId)?.name || "";
        const date = new Date(t.dateMs).toLocaleDateString("es-ES",{day:"2-digit",month:"short"});
        const amtCls = t.type==="income" ? "pos" : "neg";
        const amtSign = t.type==="income" ? "+" : "-";

        const editBtn = U.el("button",{class:"btn small", text:"Editar", onclick: ()=> openTxModal({mode:"edit", tx:t})});
        const delBtn = U.el("button",{class:"btn small danger", text:"Borrar", onclick: async ()=>{
          const ok = await U.confirmDialog({title:"Borrar movimiento", message:"Se borrará este movimiento. ¿Quieres continuar?", okText:"Borrar", cancelText:"Cancelar"});
          if(!ok) return;
          await DB.delTx(state.db, t.id);
          U.toast("Movimiento borrado.");
          await render();
        }});

        listNode.appendChild(U.el("div",{class:"item"},[
          U.el("div",{class:"left"},[
            U.el("div",{class:"title",text: `${cat || (t.type==="income"?"Ingreso":"Gasto")}`}),
            U.el("div",{class:"meta",text: `${date} · ${acc}${t.note? " · "+t.note : ""}`})
          ]),
          U.el("div",{class:"right"},[
            U.el("div",{class:`amount ${amtCls}`, text: `${amtSign}${U.money(t.amount, state.settings.currency)}`}),
            U.el("div",{class:"row", style:"gap:8px"},[editBtn, delBtn])
          ])
        ]));
      }
    }

    qInp.addEventListener("input", ()=>{ filters.q = qInp.value; renderList(); });
    typeSel.addEventListener("change", ()=>{ filters.type = typeSel.value; refreshCatOptions(); renderList(); });
    accSel.addEventListener("change", ()=>{ filters.account = accSel.value; renderList(); });
    catSel.addEventListener("change", ()=>{ filters.category = catSel.value; renderList(); });

    const filterCard = U.el("div",{class:"card", style:"margin:10px 0 12px"},[
      U.el("div",{class:"h2",text:"Filtros"}),
      U.el("hr",{class:"sep"}),
      U.el("div",{class:"grid cols2"},[
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Buscar"}), qInp]),
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Tipo"}), typeSel]),
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Cuenta"}), accSel]),
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Categoría"}), catSel]),
      ])
    ]);

    renderList();
    return U.el("div",{},[head, filterCard, listNode]);
    }

  async function viewPresupuesto(){
    setSubtitle("Topes por categoría");

    // Presupuesto (Topes) es un ajuste: se define por categoría y no depende de un rango personalizado.
    // Para el "gastado" usamos siempre el periodo actual configurado (mes natural o cobro-a-cobro).
    const range = currentPeriodRange();
    const label = periodLabel(range);

    // Cargar datos del periodo (ignorando rango personalizado)
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    state.cache.tx = await DB.listTxByRange(state.db, startMs, endMs);
    state.cache.tr = await DB.listTrByRange(state.db, startMs, endMs);
    state.cache.loadedRange = { startMs, endMs };

    const head = sectionHeader("Presupuesto (Topes)", U.el("div",{class:"row", style:"gap:8px;flex-wrap:wrap;justify-content:flex-end"},[
      U.el("div",{class:"badge", text: label}),
      printBtn(()=>printBudget()),
      exportBtn(()=>{
        const rows = rowsBudget(state.cache.tx);
        XLSXMini.exportXLSX({
          filename:`presupuesto_${label.replace(/\s+/g,"_")}.xlsx`,
          sheets:[{name:"Presupuesto", rows, currencyCols:[1,2,3]}]
        });
      })
    ]));
    const txList = state.cache.tx;
    const exp = groupByCategoryExpenses(txList);

    const wrap = U.el("div",{class:"card"},[
      U.el("div",{class:"tiny muted", text:"Define un tope por categoría. La app avisará si lo superas."}),
      U.el("hr",{class:"sep"})
    ]);

    const table = U.el("table",{class:"table"});
    const thead = U.el("thead",{}, U.el("tr",{},[
      U.el("th",{text:"Categoría"}),
      U.el("th",{text:"Tope", style:"text-align:right"}),
      U.el("th",{text:"Gastado", style:"text-align:right"}),
      U.el("th",{text:"Restante", style:"text-align:right"}),
    ]));
    const tbody = U.el("tbody",{});
    table.appendChild(thead);
    table.appendChild(tbody);

    function makeRow(cat){
      const cap = ensureNum(state.settings.budgets?.[cat.id] || 0);
      const spent = ensureNum(exp.get(cat.id)||0);
      const remaining = cap ? (cap - spent) : 0;
      const ratio = cap>0 ? Math.min(1, spent/cap) : 0;

      const capInp = U.el("input",{class:"input", inputmode:"decimal", style:"text-align:right; max-width:140px"});
      capInp.value = cap ? U.number2(cap).replace(/\./g,"") : "";

      let saveTimer=null;
      capInp.addEventListener("input", ()=>{
        clearTimeout(saveTimer);
        saveTimer=setTimeout(async ()=>{
          const v = U.parseAmount(capInp.value);
          state.settings.budgets = state.settings.budgets || {};
          if(!v) delete state.settings.budgets[cat.id];
          else state.settings.budgets[cat.id] = ensureNum(v);
          await DB.saveSettings(state.db, state.settings);
          U.toast("Tope guardado.");
          // rerender
          await render();
        }, 450);
      });

      const tr = U.el("tr",{},[
        U.el("td",{},[
          U.el("div",{style:"font-weight:900"}, cat.name),
          U.el("div",{class:"progress", style:"margin-top:6px"}, U.el("div",{style:`width:${(ratio*100).toFixed(1)}%`}))
        ]),
        U.el("td",{class:"num"}, capInp),
        U.el("td",{class:"num", text: U.money(spent, state.settings.currency)}),
        U.el("td",{class:"num", text: cap>0 ? U.money(remaining, state.settings.currency) : "—"})
      ]);
      return tr;
    }

    const expCats = categories().filter(c=>c.kind==="expense");
    expCats.forEach(c=> tbody.appendChild(makeRow(c)));

    wrap.appendChild(table);
    wrap.appendChild(U.el("div",{class:"tiny muted", style:"margin-top:10px"},
      "Nota: si un tope está vacío o a 0, la categoría no tendrá límite."
    ));
    return U.el("div",{},[head, wrap]);
  }

  async function viewCuentas(){
    setSubtitle("Efectivo, Tarjeta y Banco");
    await loadPeriodData();
    const meta = activeRangeMeta();
    const label = meta.label;

    const balances = await computeBalances();

    const head = sectionHeader("Cuentas", U.el("div",{class:"row", style:"gap:8px"},[
      rangeControls(),
      printBtn(()=>printAccounts()),
      exportBtn(async ()=>{
        const rows = [["Cuenta","Saldo actual"]];
        for(const a of accounts()) rows.push([a.name, ensureNum(balancesNow.get(a.id)||0)]);
        XLSXMini.exportXLSX({ filename:`ControlGastos_Cuentas_${label.replace(/\s+/g,"_")}.xlsx`, sheets:[{name:"Cuentas", rows, currencyCols:[1]}] });
      }),
      U.el("button",{class:"btn small", text:"Añadir cuenta", onclick: ()=> openAddAccountModal()}),
      U.el("button",{class:"btn danger small", text:"Borrar cuenta", onclick: ()=> openDeleteAccountModal()}),
      U.el("button",{class:"btn primary small", text:"Transferir", onclick: ()=> openTransferModal({})})
    ]));

    const cards = U.el("div",{class:"grid cols2"});

    for(const a of accounts()){
      const bal = ensureNum(balances.get(a.id)||0);
      const card = U.el("div",{class:"card"},[
        U.el("div",{class:"row space"},[
          U.el("div",{class:"h2", text:a.name}),
          U.el("span",{class:"badge", text:"Saldo"})
        ]),
        U.el("div",{style:"font-size:22px;font-weight:900;margin-top:8px;font-variant-numeric:tabular-nums"}, U.money(bal, state.settings.currency)),
        U.el("div",{class:"tiny muted", style:"margin-top:6px"}, "Incluye saldo inicial + histórico de movimientos y transferencias."),
        U.el("hr",{class:"sep"}),
        U.el("button",{class:"btn small", text:"Ver extracto del periodo", onclick: ()=> openAccountExtractModal(a.id)})
      ]);
      cards.appendChild(card);
    }

    async function openAccountExtractModal(accountId){
      const acc = accById(accountId);
      const txList = state.cache.tx.filter(t=>(t.accountId||"cash")===accountId);
      const trList = state.cache.tr.filter(t=>t.fromAccountId===accountId || t.toAccountId===accountId)
        .sort((a,b)=>b.dateMs-a.dateMs);

      const content = U.el("div",{class:"col"},[
        U.el("div",{class:"tiny muted", text:`Rango: ${label}`}),
        U.el("div",{class:"grid cols2", style:"margin-top:8px"},[
          U.el("div",{class:"kpi"},[
            U.el("div",{class:"label",text:"Saldo inicio rango"}),
            U.el("div",{class:"value",text:U.money((balancesStart.get(accountId)||0), state.settings.currency)})
          ]),
          U.el("div",{class:"kpi"},[
            U.el("div",{class:"label",text:"Saldo fin rango"}),
            U.el("div",{class:"value",text:U.money((balancesEnd.get(accountId)||0), state.settings.currency)})
          ]),
          U.el("div",{class:"kpi"},[
            U.el("div",{class:"label",text:"Variación en rango"}),
            U.el("div",{class:"value",text:U.money(((balancesEnd.get(accountId)||0) - (balancesStart.get(accountId)||0)), state.settings.currency)})
          ]),
          U.el("div",{class:"kpi"},[
            U.el("div",{class:"label",text:"Saldo actual"}),
            U.el("div",{class:"value",text:U.money((balancesNow.get(accountId)||0), state.settings.currency)})
          ]),
        ]),
        U.el("hr",{class:"sep"}),
        U.el("div",{class:"h2", text:"Movimientos"}),
      ]);

      const movTable = U.el("table",{class:"table"});
      movTable.appendChild(U.el("thead",{}, U.el("tr",{},[
        U.el("th",{text:"Fecha"}),
        U.el("th",{text:"Tipo"}),
        U.el("th",{text:"Categoría"}),
        U.el("th",{text:"Importe", style:"text-align:right"}),
      ])));
      const movBody = U.el("tbody",{});
      movTable.appendChild(movBody);
      txList.forEach(t=>{
        movBody.appendChild(U.el("tr",{},[
          U.el("td",{text:new Date(t.dateMs).toLocaleDateString("es-ES")}),
          U.el("td",{text:t.type==="income"?"Ingreso":"Gasto"}),
          U.el("td",{text:catById(t.categoryId)?.name || ""}),
          U.el("td",{class:"num", text: (t.type==="income"?"+":"-")+U.money(t.amount, state.settings.currency)})
        ]));
      });
      content.appendChild(movTable);

      content.appendChild(U.el("div",{class:"h2", style:"margin-top:12px"}, "Transferencias"));
      const trTable = U.el("table",{class:"table"});
      trTable.appendChild(U.el("thead",{}, U.el("tr",{},[
        U.el("th",{text:"Fecha"}),
        U.el("th",{text:"Dirección"}),
        U.el("th",{text:"Otra cuenta"}),
        U.el("th",{text:"Importe", style:"text-align:right"}),
      ])));
      const trBody = U.el("tbody",{});
      trTable.appendChild(trBody);
      trList.forEach(t=>{
        const dir = (t.fromAccountId===accountId) ? "Sale a" : "Entra de";
        const other = (t.fromAccountId===accountId) ? accById(t.toAccountId)?.name : accById(t.fromAccountId)?.name;
        const sign = (t.fromAccountId===accountId) ? "-" : "+";
        trBody.appendChild(U.el("tr",{},[
          U.el("td",{text:new Date(t.dateMs).toLocaleDateString("es-ES")}),
          U.el("td",{text:dir}),
          U.el("td",{text:other || ""}),
          U.el("td",{class:"num", text: sign+U.money(t.amount, state.settings.currency)})
        ]));
      });
      content.appendChild(trTable);

      const exportBtn2 = U.el("button",{class:"btn small", text:"Exportar XLSX (extracto)", onclick: ()=>{
        const rows1 = [["Fecha","Tipo","Categoría","Importe"]];
        txList.forEach(t=>rows1.push([new Date(t.dateMs).toLocaleDateString("es-ES"), t.type==="income"?"Ingreso":"Gasto", catById(t.categoryId)?.name||"", (t.type==="income"?1:-1)*ensureNum(t.amount)]));
        const rows2 = [["Fecha","Dirección","Otra cuenta","Importe"]];
        trList.forEach(t=>{
          const dir = (t.fromAccountId===accountId) ? "Sale a" : "Entra de";
          const other = (t.fromAccountId===accountId) ? accById(t.toAccountId)?.name : accById(t.fromAccountId)?.name;
          const sign = (t.fromAccountId===accountId) ? -1 : 1;
          rows2.push([new Date(t.dateMs).toLocaleDateString("es-ES"), dir, other||"", sign*ensureNum(t.amount)]);
        });
        XLSXMini.exportXLSX({
          filename:`ControlGastos_Extracto_${acc?.name||accountId}_${label.replace(/\s+/g,"_")}.xlsx`,
          sheets:[
            {name:"Movimientos", rows: rows1, currencyCols:[3]},
            {name:"Transferencias", rows: rows2, currencyCols:[3]},
          ]
        });
      }});

      const printBtn2 = U.el("button",{class:"btn small", text:"Imprimir extracto", onclick: ()=>{
        // Simple print: combine tables
        const movRows = txList.map(t=>[
          new Date(t.dateMs).toLocaleDateString("es-ES"),
          t.type==="income"?"Ingreso":"Gasto",
          catById(t.categoryId)?.name||"",
          (t.type==="income"?"+":"-")+U.money(t.amount, state.settings.currency)
        ]);
        const trRows = trList.map(t=>{
          const dir = (t.fromAccountId===accountId) ? "Sale a" : "Entra de";
          const other = (t.fromAccountId===accountId) ? accById(t.toAccountId)?.name : accById(t.fromAccountId)?.name;
          const sign = (t.fromAccountId===accountId) ? "-" : "+";
          return [new Date(t.dateMs).toLocaleDateString("es-ES"), dir, other||"", sign+U.money(t.amount, state.settings.currency)];
        });
        const html = "<h3 style='margin:10px 0 8px'>Movimientos</h3>" +
          tableHtml(["Fecha","Tipo","Categoría","Importe"], movRows, new Set([3])) +
          "<h3 style='margin:14px 0 8px'>Transferencias</h3>" +
          tableHtml(["Fecha","Dirección","Otra cuenta","Importe"], trRows, new Set([3]));
        Print.printHtml({title:`Extracto - ${acc?.name||""}`, subtitle:`Periodo: ${label}`, html});
      }});

      const closeBtn = U.el("button",{class:"btn", text:"Cerrar"});
      const modal = U.openModal({ title:`Extracto - ${acc?.name||""}`, contentNode: content, footerNodes: [printBtn2, exportBtn2, closeBtn] });
      closeBtn.onclick = ()=> modal.close();
    }

    return U.el("div",{},[head, cards]);
  }

  async function viewAjustes(){
    setSubtitle("Opciones y apariencia");
    const s = state.settings;

    const head = sectionHeader("Ajustes");

    // Period settings
    const modeSel = U.el("select",{});
    modeSel.appendChild(U.el("option",{value:"calendar", text:"Mes natural (día 1 a 30/31)"}));
    modeSel.appendChild(U.el("option",{value:"paycycle", text:"De cobro a cobro (día de inicio configurable)"}));
    modeSel.value = s.periodMode || "calendar";

    const startDayInp = U.el("input",{class:"input", type:"number", min:"1", max:"31"});
    startDayInp.value = String(s.paycycleStartDay || 25);

    const themeSel = U.el("select",{});
    themeSel.appendChild(U.el("option",{value:"light", text:"Claro (suave) - por defecto"}));
    themeSel.appendChild(U.el("option",{value:"dark", text:"Oscuro"}));
    themeSel.appendChild(U.el("option",{value:"contrast", text:"Alto contraste"}));
    themeSel.value = s.theme || "light";

    const currencyInfo = U.el("div",{class:"tiny muted", html:`Moneda: <b>EUR</b> · Formato: <b>es-ES</b> (1.000,00)`});

    const savePeriodBtn = U.el("button",{class:"btn primary small", text:"Guardar periodo"});
    savePeriodBtn.onclick = async ()=>{
      s.periodMode = modeSel.value;
      s.paycycleStartDay = U.clamp(parseInt(startDayInp.value||"25",10) || 25, 1, 31);
      await DB.saveSettings(state.db, s);
      U.toast("Ajustes de periodo guardados.");
      state.periodOffset = 0;
      await render();
    };

    const saveThemeBtn = U.el("button",{class:"btn primary small", text:"Guardar apariencia"});
    saveThemeBtn.onclick = async ()=>{
      s.theme = themeSel.value;
      await DB.saveSettings(state.db, s);
      applyTheme();
      U.toast("Apariencia guardada.");
    };

    const periodCard = U.el("div",{class:"card"},[
      U.el("div",{class:"h2", text:"Periodo"}),
      U.el("hr",{class:"sep"}),
      U.el("div",{class:"grid cols2"},[
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Modo de periodo"}), modeSel]),
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Día inicio (solo cobro a cobro)"}), startDayInp]),
      ]),
      U.el("div",{class:"tiny muted", style:"margin-top:10px"}, "Nota: si un mes no tiene ese día (ej: 31), se usará el último día del mes."),
      U.el("div",{class:"row", style:"justify-content:flex-end;margin-top:10px"}, savePeriodBtn)
    ]);

    const themeCard = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"h2", text:"Apariencia"}),
      U.el("hr",{class:"sep"}),
      U.el("div",{class:"grid cols2"},[
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Tema"}), themeSel]),
        U.el("div",{},[U.el("div",{class:"tiny muted",text:"Moneda y formato"}), currencyInfo]),
      ]),
      U.el("div",{class:"row", style:"justify-content:flex-end;margin-top:10px"}, saveThemeBtn)
    ]);

    // Categories management
    const catCard = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"row space"},[
        U.el("div",{class:"h2", text:"Categorías"}),
        U.el("span",{class:"badge", text:`${categories().length} total`})
      ]),
      U.el("hr",{class:"sep"})
    ]);

    const catList = U.el("div",{class:"list"});
    function renderCats(){
      catList.innerHTML = "";
      for(const c of categories()){
        const del = U.el("button",{class:"btn small danger", text:"Borrar"});
        del.onclick = async ()=>{
          const ok = await U.confirmDialog({title:"Borrar categoría", message:`Se borrará la categoría "${c.name}". Los movimientos existentes conservarán el ID interno, pero dejarán de mostrar el nombre. ¿Continuar?`, okText:"Borrar", cancelText:"Cancelar"});
          if(!ok) return;
          s.categories = s.categories.filter(x=>x.id!==c.id);
          // remove budget
          if(s.budgets && s.budgets[c.id]!=null) delete s.budgets[c.id];
          await DB.saveSettings(state.db, s);
          U.toast("Categoría borrada.");
          await render();
        };

        const nameInp = U.el("input",{class:"input", value:c.name});
        nameInp.addEventListener("change", async ()=>{
          c.name = nameInp.value.trim() || c.name;
          await DB.saveSettings(state.db, s);
          U.toast("Categoría actualizada.");
          await render();
        });

        catList.appendChild(U.el("div",{class:"item"},[
          U.el("div",{class:"left"},[
            U.el("div",{class:"title"},[
              nameInp
            ]),
            U.el("div",{class:"meta",text: c.kind==="income" ? "Ingreso" : "Gasto"})
          ]),
          U.el("div",{class:"right"},[del])
        ]));
      }
    }
    renderCats();
    catCard.appendChild(catList);

    const addName = U.el("input",{class:"input", placeholder:"Nombre de nueva categoría"});
    const addKind = U.el("select",{});
    addKind.appendChild(U.el("option",{value:"expense", text:"Gasto"}));
    addKind.appendChild(U.el("option",{value:"income", text:"Ingreso"}));
    const addBtn = U.el("button",{class:"btn primary small", text:"Añadir categoría"});
    addBtn.onclick = async ()=>{
      const name = addName.value.trim();
      if(!name){ U.toast("Escribe un nombre."); addName.focus(); return; }
      const id = "cat_"+Date.now().toString(16)+"_"+Math.random().toString(16).slice(2,6);
      s.categories.push({id, name, kind:addKind.value});
      await DB.saveSettings(state.db, s);
      addName.value = "";
      U.toast("Categoría añadida.");
      await render();
    };

    catCard.appendChild(U.el("hr",{class:"sep"}));
    catCard.appendChild(U.el("div",{class:"grid cols2"},[
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Nombre"}), addName]),
      U.el("div",{},[U.el("div",{class:"tiny muted",text:"Tipo"}), addKind]),
    ]));
    catCard.appendChild(U.el("div",{class:"row", style:"justify-content:flex-end;margin-top:10px"}, addBtn));

    // Accounts initial balances
    const accCard = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"h2", text:"Cuentas (saldo inicial)"}),
      U.el("hr",{class:"sep"}),
      U.el("div",{class:"tiny muted", text:"El saldo actual se calcula: saldo inicial + histórico de movimientos/transferencias."})
    ]);

    for(const a of s.accounts){
      const inp = U.el("input",{class:"input", inputmode:"decimal", style:"text-align:right"});
      inp.value = a.initialBalance ? U.number2(a.initialBalance).replace(/\./g,"") : "";
      inp.addEventListener("change", async ()=>{
        a.initialBalance = ensureNum(U.parseAmount(inp.value));
        await DB.saveSettings(state.db, s);
        U.toast("Saldo inicial guardado.");
      });
      accCard.appendChild(U.el("div",{style:"margin-top:10px"},[
        U.el("div",{class:"tiny muted", text:a.name}),
        inp
      ]));
    }

    // Backup
    const backupCard = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"h2", text:"Copia de seguridad"}),
      U.el("hr",{class:"sep"}),
      U.el("div",{class:"tiny muted", text:"Exporta un JSON para guardar todos tus datos. Puedes restaurarlo más tarde en el mismo navegador/dispositivo."})
    ]);

    const expBtn = U.el("button",{class:"btn primary", text:"Exportar JSON"});
    expBtn.onclick = async ()=>{
      const payload = await DB.exportAll(state.db);
      const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0,10);
      a.href = URL.createObjectURL(blob);
      a.download = `ControlGastos_Backup_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 350);
    };

    const copyBtn = U.el("button",{class:"btn", text:"Copiar JSON al portapapeles"});
    copyBtn.onclick = async ()=>{
      try{
        const payload = await DB.exportAll(state.db);
        const text = JSON.stringify(payload,null,2);

        if(navigator.clipboard && typeof navigator.clipboard.writeText==="function"){
          await navigator.clipboard.writeText(text);
          U.toast("JSON copiado al portapapeles.");
          return;
        }

        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly","");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand("copy");
        ta.remove();
        if(ok) U.toast("JSON copiado al portapapeles.");
        else U.toast("No se pudo copiar el JSON.");
      }catch(err){
        console.error(err);
        U.toast("Error copiando JSON.");
      }
    };


    const impInp = U.el("input",{class:"input", type:"file", accept:"application/json,.json"});
    const impBtn = U.el("button",{class:"btn danger", text:"Importar JSON (restaurar)"});
    impBtn.onclick = async ()=>{
      const f = impInp.files?.[0];
      if(!f){ U.toast("Selecciona un archivo JSON."); return; }
      const ok = await U.confirmDialog({
        title:"Restaurar copia",
        message:"Se reemplazarán los datos actuales por los del backup. ¿Continuar?",
        okText:"Restaurar",
        cancelText:"Cancelar"
      });
      if(!ok) return;

      try{
        const text = await f.text();
        const payload = JSON.parse(text);
        if(!payload || !payload.settings || !Array.isArray(payload.tx) || !Array.isArray(payload.tr)){
          U.toast("El archivo no parece un backup válido.");
          return;
        }
        await DB.importAll(state.db, payload);
        state.settings = payload.settings;
        applyTheme();
        U.toast("Backup restaurado.");
        state.periodOffset = 0;
        location.hash = "#/panel";
        await render();
      }catch(err){
        console.error(err);
        U.toast("Error importando JSON.");
      }
    };

    const pasteBtn = U.el("button",{class:"btn", text:"Pegar JSON (restaurar)"});
    pasteBtn.onclick = async ()=>{
      const ta = U.el("textarea",{
        class:"input",
        placeholder:"Pega aquí el contenido completo del backup JSON…",
        style:"min-height:220px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;white-space:pre;"
      });
      const tip = U.el("div",{class:"tiny muted", html:"Consejo: abre el .json en el ordenador, copia todo (Ctrl+A, Ctrl+C) y envíatelo por WhatsApp. En el móvil, copia el texto del chat y pégalo aquí."});

      const doBtn = U.el("button",{class:"btn danger", text:"Restaurar"});
      const cancelBtn = U.el("button",{class:"btn", text:"Cancelar"});

      const modal = U.openModal({
        title:"Pegar JSON",
        contentNode: U.el("div",{class:"grid", style:"gap:10px"},[tip, ta]),
        footerNodes:[cancelBtn, doBtn]
      });

      cancelBtn.onclick = ()=> modal.close();
      doBtn.onclick = async ()=>{
        const raw = String(ta.value||"").trim();
        if(!raw){ U.toast("Pega el contenido JSON."); ta.focus(); return; }

        const ok = await U.confirmDialog({
          title:"Restaurar copia",
          message:"Se reemplazarán los datos actuales por los del backup. ¿Continuar?",
          okText:"Restaurar",
          cancelText:"Cancelar"
        });
        if(!ok) return;

        try{
          const payload = JSON.parse(raw);
          if(!payload || !payload.settings || !Array.isArray(payload.tx) || !Array.isArray(payload.tr)){
            U.toast("El texto no parece un backup válido.");
            return;
          }
          await DB.importAll(state.db, payload);
          state.settings = payload.settings;
          applyTheme();
          U.toast("Backup restaurado.");
          state.periodOffset = 0;
          state.range.enabled = false;
          modal.close();
          location.hash = "#/panel";
          await render();
        }catch(err){
          console.error(err);
          U.toast("Error importando JSON pegado.");
        }
      };
    };


    backupCard.appendChild(U.el("div",{class:"grid cols2"},[
      U.el("div",{},[U.el("div",{class:"row", style:"gap:10px;flex-wrap:wrap;"},[expBtn, copyBtn])]),
      U.el("div",{},[
        impInp,
        U.el("div",{style:"margin-top:10px"},[
          impBtn,
          U.el("div",{style:"height:8px"}),
          pasteBtn
        ])
      ])
    ]));
const wipeBtn = U.el("button",{class:"btn danger", text:"Borrar todos los datos"});
    wipeBtn.onclick = async ()=>{
      const ok = await U.confirmDialog({title:"Borrar todo", message:"Esto borrará todos los movimientos, transferencias y ajustes. Acción irreversible. ¿Continuar?", okText:"Borrar", cancelText:"Cancelar"});
      if(!ok) return;
      await DB.importAll(state.db, {settings: structuredClone(DEFAULT_SETTINGS), tx:[], tr:[]});
      state.settings = structuredClone(DEFAULT_SETTINGS);
      applyTheme();
      U.toast("Datos borrados.");
      state.periodOffset = 0;
      await render();
    };

    const footer = U.el("div",{class:"card", style:"margin-top:12px"},[
      U.el("div",{class:"h2", text:"Mantenimiento"}),
      U.el("hr",{class:"sep"}),
      U.el("div",{class:"row space"},[
        U.el("div",{class:"tiny muted", text:"Versión: v1 · Datos en IndexedDB"}),
        wipeBtn
      ])
    ]);

    return U.el("div",{},[head, periodCard, themeCard, catCard, accCard, backupCard, footer]);
  }

  // ---------- Render ----------
  async function render(){
    parseRoute();
    setActiveNav();

    appEl.innerHTML = "";
    loadingEl.hidden = false;

    try{
      let node;
      if(state.route==="panel") node = await viewPanel();
      else if(state.route==="movimientos") node = await viewMovimientos();
      else if(state.route==="presupuesto") node = await viewPresupuesto();
      else if(state.route==="cuentas") node = await viewCuentas();
      else if(state.route==="ajustes") node = await viewAjustes();
      else node = await viewPanel();

      appEl.innerHTML = "";
      appEl.appendChild(node);
    }catch(err){
      console.error(err);
      appEl.innerHTML = "";
      appEl.appendChild(U.el("div",{class:"card"},[
        U.el("div",{class:"h1", text:"Error"}),
        U.el("div",{class:"tiny muted", style:"margin-top:8px"}, "Ha ocurrido un error renderizando la pantalla. Revisa la consola.")
      ]));
    }finally{
      loadingEl.hidden = true;
    }
  }

  // initial hash
  if(!location.hash) location.hash = "#/panel";
  parseRoute();
  setActiveNav();
  await render();

})();
