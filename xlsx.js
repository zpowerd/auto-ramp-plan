/*
 * A small XLSX writer: sheets of values, live formulas and styles, zipped into a
 * workbook that Google Sheets (and Excel) open with every formula working.
 * Formulas are stored without cached results, so the app opening the file works them out.
 * No page code in here, so it also runs under Node.
 */
(function (root) {
  "use strict";

  // ---------- cell addresses ----------

  // 1 -> "A", 27 -> "AA"
  function colName(n) {
    let s = "";
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  function colNumber(name) {
    let n = 0;
    for (const ch of name) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  }
  const addr = (col, row) => colName(col) + row;
  function parseAddr(text) {
    const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(text);
    if (!m) throw new Error(`Not a cell address: ${text}`);
    return { col: colNumber(m[1]), row: Number(m[2]) };
  }
  // 'CB ramp' style quoting, which works for every sheet name.
  const quoteSheet = (name) => `'${name.replace(/'/g, "''")}'`;

  // Days since 1899-12-30, the spreadsheet date serial, for a "YYYY-MM-DD" date.
  function dateSerial(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  // ---------- XML ----------

  const esc = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  // ---------- styles ----------
  // A style is { font: { bold, italic, size, color }, fill, numFmt, align: { h, v, wrap, indent }, border: { top, bottom, color } }
  // with colours as "RRGGBB". Each distinct style becomes one cell format.

  const BUILT_IN_FORMATS = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10 };
  const BASE_FONT = { name: "Arial", size: 10, color: "1F2328", bold: false, italic: false };

  function makeStyles() {
    const fonts = [];
    const fills = [];
    const borders = [];
    const formats = new Map(); // custom code -> id
    const xfs = [];
    const dxfs = [];
    const index = new Map();   // "kind|json" -> position

    const intern = (kind, list, item) => {
      const key = kind + "|" + JSON.stringify(item);
      if (!index.has(key)) { index.set(key, list.length); list.push(item); }
      return index.get(key);
    };
    const fontOf = (spec = {}) => ({ ...BASE_FONT, ...spec });
    const borderOf = (spec) => (spec ? { top: spec.top ?? null, bottom: spec.bottom ?? null, color: spec.color ?? "D0D4D9" } : {});
    function formatId(code = "General") {
      if (code in BUILT_IN_FORMATS) return BUILT_IN_FORMATS[code];
      if (!formats.has(code)) formats.set(code, 164 + formats.size);
      return formats.get(code);
    }

    intern("font", fonts, fontOf());
    fills.push({ pattern: "none" }, { pattern: "gray125" });
    intern("border", borders, borderOf());
    intern("xf", xfs, { font: 0, fill: 0, border: 0, numFmt: 0, align: null });

    function style(spec = {}) {
      return intern("xf", xfs, {
        font: intern("font", fonts, fontOf(spec.font)),
        fill: spec.fill ? intern("fill", fills, { pattern: "solid", color: spec.fill }) : 0,
        border: intern("border", borders, borderOf(spec.border)),
        numFmt: formatId(spec.numFmt),
        align: spec.align ?? null,
      });
    }

    // Formats for conditional formatting: only the parts that change.
    function dxf(spec = {}) {
      return intern("dxf", dxfs, { font: spec.font ?? null, fill: spec.fill ?? null });
    }

    const colorXml = (rgb) => `<color rgb="FF${rgb}"/>`;
    const fontXml = (f) => `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}<sz val="${f.size}"/>${colorXml(f.color)}` +
      `<name val="${esc(f.name)}"/><family val="2"/></font>`;
    const side = (tag, b) => (b[tag] ? `<${tag} style="${b[tag]}">${colorXml(b.color)}</${tag}>` : `<${tag}/>`);

    function xml() {
      const numFmts = [...formats].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("");
      const fillXml = (f) => (f.pattern === "solid"
        ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${f.color}"/><bgColor indexed="64"/></patternFill></fill>`
        : `<fill><patternFill patternType="${f.pattern}"/></fill>`);
      const xfXml = (x) => {
        const a = x.align;
        const align = a ? `<alignment${a.h ? ` horizontal="${a.h}"` : ""}${a.v ? ` vertical="${a.v}"` : ""}` +
          `${a.wrap ? ' wrapText="1"' : ""}${a.indent ? ` indent="${a.indent}"` : ""}/>` : "";
        return `<xf numFmtId="${x.numFmt}" fontId="${x.font}" fillId="${x.fill}" borderId="${x.border}" xfId="0"` +
          `${x.numFmt ? ' applyNumberFormat="1"' : ""}${x.font ? ' applyFont="1"' : ""}${x.fill ? ' applyFill="1"' : ""}` +
          `${x.border ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
      };
      const dxfXml = (d) => "<dxf>" +
        (d.font ? `<font>${d.font.bold ? "<b/>" : ""}${d.font.italic ? "<i/>" : ""}${d.font.color ? colorXml(d.font.color) : ""}</font>` : "") +
        (d.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${d.fill}"/><bgColor rgb="FF${d.fill}"/></patternFill></fill>` : "") +
        "</dxf>";
      return XML_HEAD + `<styleSheet xmlns="${NS_MAIN}">` +
        (formats.size ? `<numFmts count="${formats.size}">${numFmts}</numFmts>` : "") +
        `<fonts count="${fonts.length}">${fonts.map(fontXml).join("")}</fonts>` +
        `<fills count="${fills.length}">${fills.map(fillXml).join("")}</fills>` +
        `<borders count="${borders.length}">${borders.map((b) =>
          `<border>${side("left", {})}${side("right", {})}${side("top", b)}${side("bottom", b)}<diagonal/></border>`).join("")}</borders>` +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.length}">${xfs.map(xfXml).join("")}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        `<dxfs count="${dxfs.length}">${dxfs.map(dxfXml).join("")}</dxfs>` +
        "</styleSheet>";
    }

    return { style, dxf, xml };
  }

  // ---------- sheets ----------
  // A cell holds a number, a string, a boolean, a formula { f: "SUM(A1:A3)" } (no leading "="), or nothing (just a style).
  // A formula can also carry its result, { kind: "number" | "string" | "boolean" | "blank" | "error", value },
  // stored for apps that show a file without recalculating it.

  class Sheet {
    constructor(workbook, name) {
      this.workbook = workbook;
      this.name = name;
      this.cells = new Map();   // "A1" -> { value, style }
      this.heights = new Map(); // row -> points
      this.widths = new Map();  // column number -> width in characters
      this.merges = [];
      this.rules = [];          // conditional formatting: { range, formula, dxf }
      this.frozen = null;       // { rows, cols }
      this.gridlines = true;
    }

    set(ref, value, style = 0) {
      this.cells.set(ref, { value: value ?? null, style });
      return this;
    }
    get(ref) { return this.cells.get(ref); }
    width(col, chars) { this.widths.set(typeof col === "string" ? colNumber(col) : col, chars); return this; }
    height(row, points) { this.heights.set(row, points); return this; }
    merge(range) { this.merges.push(range); return this; }
    freeze(rows, cols) { this.frozen = { rows, cols }; return this; }
    // A formula rule over a range, written relative to the range's top-left cell.
    rule(range, formula, dxf) { this.rules.push({ range, formula, dxf }); return this; }

    xml(strings, selected) {
      const rows = new Map();
      let maxRow = 1;
      let maxCol = 1;
      for (const [ref, cell] of this.cells) {
        const { col, row } = parseAddr(ref);
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row).push({ col, ref, cell });
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, col);
      }
      for (const row of this.heights.keys()) if (!rows.has(row)) rows.set(row, []);

      const cellXml = ({ ref, cell }) => {
        const { value, style } = cell;
        const s = style ? ` s="${style}"` : "";
        if (value === null) return `<c r="${ref}"${s}/>`;
        if (typeof value === "object") {
          const r = value.result;
          const f = `<f>${esc(value.f)}</f>`;
          if (!r || r.kind === "blank" || (r.kind === "number" && !Number.isFinite(r.value))) return `<c r="${ref}"${s}>${f}</c>`;
          if (r.kind === "number") return `<c r="${ref}"${s}>${f}<v>${r.value}</v></c>`;
          if (r.kind === "boolean") return `<c r="${ref}"${s} t="b">${f}<v>${r.value ? 1 : 0}</v></c>`;
          return `<c r="${ref}"${s} t="${r.kind === "error" ? "e" : "str"}">${f}<v>${esc(r.value)}</v></c>`;
        }
        if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
        if (typeof value === "number") {
          if (!Number.isFinite(value)) throw new Error(`${this.name}!${ref} isn't a finite number`);
          return `<c r="${ref}"${s}><v>${value}</v></c>`;
        }
        return `<c r="${ref}"${s} t="s"><v>${strings(String(value))}</v></c>`;
      };
      const sheetData = [...rows.keys()].sort((a, b) => a - b).map((row) => {
        const cells = rows.get(row).sort((a, b) => a.col - b.col).map(cellXml).join("");
        const h = this.heights.get(row);
        return `<row r="${row}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cells}</row>`;
      }).join("");

      let pane = "";
      if (this.frozen && (this.frozen.rows || this.frozen.cols)) {
        const { rows: fr, cols: fc } = this.frozen;
        const active = fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight";
        const topLeft = addr(fc + 1, fr + 1);
        pane = `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${topLeft}" activePane="${active}" state="frozen"/>` +
          `<selection pane="${active}" activeCell="${topLeft}" sqref="${topLeft}"/>`;
      }
      const view = `<sheetViews><sheetView workbookViewId="0"${this.gridlines ? "" : ' showGridLines="0"'}${selected ? ' tabSelected="1"' : ""}>` +
        `${pane}</sheetView></sheetViews>`;
      const cols = this.widths.size
        ? "<cols>" + [...this.widths].sort((a, b) => a[0] - b[0])
          .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`).join("") + "</cols>"
        : "";
      const merges = this.merges.length
        ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
        : "";
      const rules = this.rules.map((r, i) =>
        `<conditionalFormatting sqref="${r.range}"><cfRule type="expression" dxfId="${r.dxf}" priority="${i + 1}">` +
        `<formula>${esc(r.formula)}</formula></cfRule></conditionalFormatting>`).join("");

      return XML_HEAD + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<dimension ref="A1:${addr(maxCol, maxRow)}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${cols}` +
        `<sheetData>${sheetData}</sheetData>${merges}${rules}` +
        '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    }
  }

  // ---------- the workbook ----------

  class Workbook {
    constructor({ title = "Workbook", creator = "", created = new Date() } = {}) {
      this.sheets = [];
      this.styles = makeStyles();
      this.title = title;
      this.creator = creator;
      this.created = created;
    }

    sheet(name) {
      if (this.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`Two sheets are called ${name}`);
      const sheet = new Sheet(this, name);
      this.sheets.push(sheet);
      return sheet;
    }
    style(spec) { return this.styles.style(spec); }
    dxf(spec) { return this.styles.dxf(spec); }

    // The parts of the .xlsx file, as { name, text }.
    parts() {
      const list = [];
      const ids = new Map();
      const strings = (s) => {
        if (!ids.has(s)) { ids.set(s, list.length); list.push(s); }
        return ids.get(s);
      };
      const sheets = this.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml(strings, i === 0) }));
      const shared = XML_HEAD + `<sst xmlns="${NS_MAIN}" count="${list.length}" uniqueCount="${list.length}">` +
        list.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("") + "</sst>";
      const when = this.created.toISOString().replace(/\.\d{3}Z$/, "Z");
      const ct = "application/vnd.openxmlformats-";
      return [
        { name: "[Content_Types].xml", text: XML_HEAD +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          `<Override PartName="/xl/workbook.xml" ContentType="${ct}officedocument.spreadsheetml.sheet.main+xml"/>` +
          this.sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          `<Override PartName="/xl/styles.xml" ContentType="${ct}officedocument.spreadsheetml.styles+xml"/>` +
          `<Override PartName="/xl/sharedStrings.xml" ContentType="${ct}officedocument.spreadsheetml.sharedStrings+xml"/>` +
          `<Override PartName="/docProps/core.xml" ContentType="${ct}package.core-properties+xml"/>` +
          `<Override PartName="/docProps/app.xml" ContentType="${ct}officedocument.extended-properties+xml"/>` +
          "</Types>" },
        { name: "_rels/.rels", text: XML_HEAD +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          `<Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/>` +
          "</Relationships>" },
        { name: "docProps/core.xml", text: XML_HEAD +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
          'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
          'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          `<dc:title>${esc(this.title)}</dc:title><dc:creator>${esc(this.creator)}</dc:creator>` +
          `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>` +
          `<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>` },
        { name: "docProps/app.xml", text: XML_HEAD +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
          `<Application>${esc(this.creator || "XLSX writer")}</Application></Properties>` },
        { name: "xl/workbook.xml", text: XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
          '<workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
          this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
          '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
        { name: "xl/_rels/workbook.xml.rels", text: XML_HEAD +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          this.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          `<Relationship Id="rId${this.sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
          `<Relationship Id="rId${this.sheets.length + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
          "</Relationships>" },
        ...sheets,
        { name: "xl/styles.xml", text: this.styles.xml() },
        { name: "xl/sharedStrings.xml", text: shared },
      ];
    }

    // The .xlsx file. `deflate` compresses raw bytes (async); without it the parts are stored uncompressed.
    async bytes({ deflate = defaultDeflate() } = {}) {
      const encoder = new TextEncoder();
      const files = [];
      for (const part of this.parts()) {
        const data = encoder.encode(part.text);
        const packed = deflate ? await deflate(data) : null;
        files.push({ name: part.name, data, packed });
      }
      return zip(files, this.created);
    }
  }

  // ---------- zip ----------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Raw deflate where the platform has it (browsers and Node both do these days).
  function defaultDeflate() {
    if (typeof CompressionStream === "undefined" || typeof Blob === "undefined" || typeof Response === "undefined") return null;
    return async (bytes) => {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        return null; // stored instead
      }
    };
  }

  // files: [{ name, data, packed }] where `packed` is the deflated data or null.
  function zip(files, when = new Date()) {
    const encoder = new TextEncoder();
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
    const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const deflated = file.packed && file.packed.length < file.data.length;
      const body = deflated ? file.packed : file.data;
      const crc = crc32(file.data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true);            // names are UTF-8
      head.setUint16(8, deflated ? 8 : 0, true);
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, body.length, true);
      head.setUint32(22, file.data.length, true);
      head.setUint16(26, name.length, true);
      head.setUint16(28, 0, true);
      chunks.push(new Uint8Array(head.buffer), name, body);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, deflated ? 8 : 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, body.length, true);
      entry.setUint32(24, file.data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + body.length;
    }

    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let at = 0;
    for (const c of all) { out.set(c, at); at += c.length; }
    return out;
  }

  const RampXlsx = {
    workbook: (options) => new Workbook(options),
    colName, colNumber, addr, parseAddr, quoteSheet, dateSerial, crc32, zip,
  };
  if (typeof module === "object" && module.exports) module.exports = RampXlsx;
  else root.RampXlsx = RampXlsx;
})(typeof window !== "undefined" ? window : globalThis);
