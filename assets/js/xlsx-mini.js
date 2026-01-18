/* xlsx-mini.js - Generador XLSX mínimo (sin dependencias), método ZIP "store" */
/* Soporta varias hojas con strings (inlineStr) y números. Incluye estilos básicos: header en negrita. */
(function(){
  // ---------- UTF-8 + XML helpers ----------
  function xmlEscape(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&apos;");
  }
  function u8(str){
    return new TextEncoder().encode(str);
  }

  // ---------- CRC32 ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c = i;
      for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i]=c>>>0;
    }
    return t;
  })();

  function crc32(buf){
    let c = 0xFFFFFFFF;
    for(let i=0;i<buf.length;i++){
      c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- ZIP (store) ----------
  function dosDateTime(d){
    const dt = d instanceof Date ? d : new Date();
    const year = Math.max(1980, dt.getFullYear());
    const month = dt.getMonth()+1;
    const day = dt.getDate();
    const hour = dt.getHours();
    const min = dt.getMinutes();
    const sec = Math.floor(dt.getSeconds()/2);
    const dosDate = ((year-1980)<<9) | (month<<5) | day;
    const dosTime = (hour<<11) | (min<<5) | sec;
    return {dosDate, dosTime};
  }

  function writeU16LE(arr, n){ arr.push(n & 255, (n>>>8) & 255); }
  function writeU32LE(arr, n){ arr.push(n & 255, (n>>>8)&255, (n>>>16)&255, (n>>>24)&255); }

  function zipStore(entries){
    // entries: [{name, data:Uint8Array, date?:Date}]
    const fileRecords = [];
    const centralRecords = [];
    let offset = 0;
    const out = [];

    for(const ent of entries){
      const nameBytes = u8(ent.name);
      const data = ent.data;
      const {dosDate, dosTime} = dosDateTime(ent.date || new Date());
      const crc = crc32(data);
      const compSize = data.length;
      const uncompSize = data.length;

      // Local file header
      const local = [];
      writeU32LE(local, 0x04034b50);
      writeU16LE(local, 20); // version
      writeU16LE(local, 0);  // flags
      writeU16LE(local, 0);  // compression 0=store
      writeU16LE(local, dosTime);
      writeU16LE(local, dosDate);
      writeU32LE(local, crc);
      writeU32LE(local, compSize);
      writeU32LE(local, uncompSize);
      writeU16LE(local, nameBytes.length);
      writeU16LE(local, 0); // extra len
      // write local header + name + data
      out.push(new Uint8Array(local));
      out.push(nameBytes);
      out.push(data);

      const localSize = local.length + nameBytes.length + data.length;
      fileRecords.push({ent, crc, compSize, uncompSize, nameBytes, dosDate, dosTime, offset});
      offset += localSize;
    }

    const centralStart = offset;

    for(const fr of fileRecords){
      const {crc, compSize, uncompSize, nameBytes, dosDate, dosTime, offset:localOffset} = fr;
      const central = [];
      writeU32LE(central, 0x02014b50);
      writeU16LE(central, 20); // ver made
      writeU16LE(central, 20); // ver needed
      writeU16LE(central, 0);  // flags
      writeU16LE(central, 0);  // store
      writeU16LE(central, dosTime);
      writeU16LE(central, dosDate);
      writeU32LE(central, crc);
      writeU32LE(central, compSize);
      writeU32LE(central, uncompSize);
      writeU16LE(central, nameBytes.length);
      writeU16LE(central, 0); // extra
      writeU16LE(central, 0); // comment
      writeU16LE(central, 0); // disk start
      writeU16LE(central, 0); // int attrs
      writeU32LE(central, 0); // ext attrs
      writeU32LE(central, localOffset);

      centralRecords.push(new Uint8Array(central));
      centralRecords.push(nameBytes);
      offset += central.length + nameBytes.length;
    }

    out.push(...centralRecords);

    const centralSize = offset - centralStart;

    // End of central dir
    const eocd = [];
    writeU32LE(eocd, 0x06054b50);
    writeU16LE(eocd, 0); // disk
    writeU16LE(eocd, 0); // disk central
    writeU16LE(eocd, fileRecords.length);
    writeU16LE(eocd, fileRecords.length);
    writeU32LE(eocd, centralSize);
    writeU32LE(eocd, centralStart);
    writeU16LE(eocd, 0); // comment len
    out.push(new Uint8Array(eocd));

    // concat
    let total = 0;
    for(const part of out) total += part.length;
    const finalBuf = new Uint8Array(total);
    let p=0;
    for(const part of out){ finalBuf.set(part,p); p+=part.length; }
    return finalBuf;
  }

  // ---------- XLSX builder ----------
  function colName(n){
    let s="";
    let x = n+1;
    while(x>0){
      const r = (x-1)%26;
      s = String.fromCharCode(65+r) + s;
      x = Math.floor((x-1)/26);
    }
    return s;
  }

  function cellRef(c,r){ return colName(c) + String(r+1); }

  function makeSheetXML(rows, opts={}){
    const currencyCols = new Set(opts.currencyCols || []);
    const header = opts.header !== false;

    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
      `<sheetData>`;

    for(let r=0;r<rows.length;r++){
      const row = rows[r] || [];
      const rn = r+1;
      xml += `<row r="${rn}">`;
      for(let c=0;c<row.length;c++){
        const v = row[c];
        const ref = cellRef(c,r);
        const isHeader = header && r===0;
        const isCurrency = currencyCols.has(c) && typeof v === "number";
        const style = isHeader ? 1 : (isCurrency ? 2 : 0);

        if(v === null || v === undefined || v === ""){
          xml += `<c r="${ref}" s="${style}"/>`;
        }else if(typeof v === "number" && Number.isFinite(v)){
          // number
          xml += `<c r="${ref}" s="${style}"><v>${String(v)}</v></c>`;
        }else{
          // string
          xml += `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xmlEscape(v)}</t></is></c>`;
        }
      }
      xml += `</row>`;
    }

    xml += `</sheetData></worksheet>`;
    return xml;
  }

  function makeWorkbookXML(sheetNames){
    let sheetsXml = "";
    for(let i=0;i<sheetNames.length;i++){
      const name = xmlEscape(sheetNames[i]);
      sheetsXml += `<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `+
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`+
      `<sheets>${sheetsXml}</sheets>`+
      `</workbook>`;
  }

  function makeWorkbookRelsXML(sheetCount){
    let rels = "";
    for(let i=0;i<sheetCount;i++){
      rels += `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`;
    }
    // styles
    rels += `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  }

  function makeRootRelsXML(){
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`+
      `</Relationships>`;
  }

  function makeContentTypesXML(sheetCount){
    let overrides = `
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    `;
    for(let i=0;i<sheetCount;i++){
      overrides += `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`+
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`+
      `<Default Extension="xml" ContentType="application/xml"/>`+
      overrides +
      `</Types>`;
  }

  function makeStylesXML(){
    // 0: default, 1: header (bold), 2: currency (numFmt)
    // Custom numFmtId 164
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="\\€ #,##0.00"/></numFmts>`+
      `<fonts count="2">`+
        `<font><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/></font>`+
        `<font><b/><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/></font>`+
      `</fonts>`+
      `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>`+
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`+
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`+
      `<cellXfs count="3">`+
        `<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0" applyFont="1"/>`+  // default
        `<xf xfId="0" numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>`+  // header
        `<xf xfId="0" numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>`+ // currency
      `</cellXfs>`+
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`+
    `</styleSheet>`;
  }

  function downloadBlob(blob, filename){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 350);
  }

  function exportXLSX({filename="export.xlsx", sheets=[]}){
    if(!sheets.length) throw new Error("No hay hojas para exportar.");

    const sheetNames = sheets.map(s=>s.name || "Datos");
    const entries = [];

    // parts
    entries.push({name:"[Content_Types].xml", data:u8(makeContentTypesXML(sheets.length))});
    entries.push({name:"_rels/.rels", data:u8(makeRootRelsXML())});
    entries.push({name:"xl/workbook.xml", data:u8(makeWorkbookXML(sheetNames))});
    entries.push({name:"xl/_rels/workbook.xml.rels", data:u8(makeWorkbookRelsXML(sheets.length))});
    entries.push({name:"xl/styles.xml", data:u8(makeStylesXML())});

    for(let i=0;i<sheets.length;i++){
      const rows = sheets[i].rows || [[]];
      const currencyCols = sheets[i].currencyCols || [];
      const xml = makeSheetXML(rows, {currencyCols});
      entries.push({name:`xl/worksheets/sheet${i+1}.xml`, data:u8(xml)});
    }

    const zip = zipStore(entries);
    const blob = new Blob([zip], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    downloadBlob(blob, filename);
  }

  window.XLSXMini = { exportXLSX };
})();
