/* utils.js - utilidades (sin dependencias) */
(function(){
  const fmtEUR = new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtNum = new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});

  function money(n, currency="EUR"){
    try{
      return new Intl.NumberFormat("es-ES",{style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
    }catch(_){
      return fmtEUR.format(Number(n||0));
    }
  }
  function number2(n){ return fmtNum.format(Number(n||0)); }

  function parseAmount(input){
    // Acepta "1.234,56" o "1234.56" o "1234,56"
    const s = String(input ?? "").trim();
    if(!s) return 0;
    // Si hay coma, asumimos coma decimal y quitamos puntos miles.
    if(s.includes(",")){
      const cleaned = s.replace(/\./g,"").replace(",",".").replace(/\s/g,"");
      const x = Number(cleaned);
      return Number.isFinite(x) ? x : 0;
    }
    // Sin coma: puede traer puntos decimales.
    const cleaned = s.replace(/\s/g,"");
    const x = Number(cleaned);
    return Number.isFinite(x) ? x : 0;
  }

  function todayISO(){
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,10);
  }

  function isoToLocalDate(iso){
    try{
      return new Date(iso).toLocaleDateString("es-ES",{year:"numeric",month:"2-digit",day:"2-digit"});
    }catch(_){ return String(iso||""); }
  }

  function isoToLocalDateTime(iso){
    try{
      return new Date(iso).toLocaleString("es-ES",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
    }catch(_){ return String(iso||""); }
  }

  function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }

  function uid(){
    if(window.crypto?.randomUUID) return crypto.randomUUID();
    return "id_"+Math.random().toString(16).slice(2)+Date.now().toString(16);
  }

  function el(tag, attrs={}, children=null){
    const node = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs||{})){
      if(k==="class") node.className = v;
      else if(k==="html") node.innerHTML = v;
      else if(k==="text") node.textContent = v;
      else if(k.startsWith("on") && typeof v==="function") node.addEventListener(k.slice(2), v);
      else if(v===false || v===null || v===undefined) {}
      else node.setAttribute(k, String(v));
    }
    if(children!==null && children!==undefined){
      const arr = Array.isArray(children) ? children : [children];
      for(const ch of arr){
        if(ch===null || ch===undefined) continue;
        node.appendChild(typeof ch === "string" ? document.createTextNode(ch) : ch);
      }
    }
    return node;
  }

  function toast(msg, ms=2200){
    const t = el("div",{class:"toast", text: String(msg||"")});
    document.body.appendChild(t);
    setTimeout(()=>{ t.remove(); }, ms);
  }

  function confirmDialog({title="Confirmar", message="¿Seguro?", okText="Sí", cancelText="Cancelar"}){
    return new Promise((resolve)=>{
      const backdrop = document.getElementById("modalBackdrop");
      const body = document.getElementById("modalBody");
      const footer = document.getElementById("modalFooter");
      document.getElementById("modalTitle").textContent = title;

      body.innerHTML = "";
      footer.innerHTML = "";

      body.appendChild(el("div",{class:"tiny", style:"line-height:1.35"}, message));

      const cancelBtn = el("button",{class:"btn", text: cancelText, onclick: ()=>{ close(); resolve(false); }});
      const okBtn = el("button",{class:"btn danger", text: okText, onclick: ()=>{ close(); resolve(true); }});
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);

      function close(){
        backdrop.hidden = true;
        body.innerHTML = "";
        footer.innerHTML = "";
      }
      backdrop.hidden = false;
      document.getElementById("modalCloseBtn").onclick = ()=>{ close(); resolve(false); };
      backdrop.onclick = (e)=>{ if(e.target===backdrop){ close(); resolve(false);} };
    });
  }

  function openModal({title="Modal", contentNode=null, footerNodes=[]}){
    const backdrop = document.getElementById("modalBackdrop");
    const body = document.getElementById("modalBody");
    const footer = document.getElementById("modalFooter");
    document.getElementById("modalTitle").textContent = title;

    body.innerHTML = "";
    footer.innerHTML = "";

    if(contentNode) body.appendChild(contentNode);
    (footerNodes||[]).forEach(n=> footer.appendChild(n));

    function close(){
      backdrop.hidden = true;
      body.innerHTML = "";
      footer.innerHTML = "";
    }
    backdrop.hidden = false;
    document.getElementById("modalCloseBtn").onclick = close;
    backdrop.onclick = (e)=>{ if(e.target===backdrop) close(); };

    return { close };
  }

  window.U = { money, number2, parseAmount, todayISO, isoToLocalDate, isoToLocalDateTime, clamp, uid, el, toast, confirmDialog, openModal };
})();
