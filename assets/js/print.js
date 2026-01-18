/* print.js - impresión consistente */
(function(){
  function printHtml({title="Imprimir", subtitle="", html=""}){
    const w = window.open("","_blank");
    if(!w){ U.toast("Ventana de impresión bloqueada."); return; }

    const css = `
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:0; padding:24px; color:#111;}
      .doc{max-width:900px; margin:0 auto;}
      .h1{font-size:18px; font-weight:900; margin:0 0 4px;}
      .muted{color:#555; font-size:12px; margin:0 0 14px;}
      table{width:100%; border-collapse:collapse; font-size:12px;}
      th,td{border:1px solid #ddd; padding:8px; vertical-align:top;}
      th{background:#f4f4f4; font-weight:900; text-align:left;}
      td.num{text-align:right; font-variant-numeric:tabular-nums;}
      .kpis{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:12px 0 14px;}
      .kpi{border:1px solid #ddd; border-radius:10px; padding:10px;}
      .kpi .label{font-size:11px; color:#555;}
      .kpi .value{font-size:16px; font-weight:900;}
      @media print{ body{padding:0} .doc{max-width:none} }
    `;
    w.document.open();
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>${escapeHtml(title)}</title>
      <style>${css}</style>
    </head><body>
      <div class="doc">
        <div class="h1">${escapeHtml(title)}</div>
        <div class="muted">${escapeHtml(subtitle)}</div>
        ${html}
      </div>
      <script>window.onload=()=>{window.focus(); window.print();};</script>
    </body></html>`);
    w.document.close();
  }

  function escapeHtml(s){
    return String(s||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  window.Print = { printHtml };
})();
