/*
 * Works out the formulas in a RampXlsx workbook the way a spreadsheet would. The export stores the results
 * next to the formulas, so previews that don't recalculate (Quick Look, chat and mail previews) still show the
 * numbers, and the tests use it to check the export against the simulation. Covers what the export uses:
 * + − × ÷ ^ & and comparisons, references and ranges across sheets, and IF AND OR NOT MIN MAX SUM COUNT
 * COUNTIF SUMIFS INDEX MINVERSE MMULT IFERROR ISNUMBER EXP ABS MOD ROUND WEEKDAY. Blank cells count as 0 or "",
 * and text compares ignore case. No page code in here, so it also runs under Node.
 */
(function (root) {
  "use strict";

  const BLANK = Symbol("blank");
  class SheetError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  // ---------- reading formulas ----------

  // One pattern for every kind of token, tried in this order: spaces, text, references with a quoted or plain sheet name,
  // function names, TRUE/FALSE, references on the same sheet, numbers, operators.
  const TOKEN = new RegExp([
    /(\s+)/.source,
    /"((?:[^"]|"")*)"/.source,
    /'((?:[^']|'')+)'!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/.source,
    /([A-Za-z_][A-Za-z0-9_.]*)!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/.source,
    /([A-Z][A-Z0-9.]*)\(/.source,
    /(TRUE|FALSE)\b/.source,
    /(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/.source,
    /((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.source,
    /(<>|<=|>=|[-+*/^&=<>(),])/.source,
  ].join("|"), "y");

  function tokenize(text) {
    const tokens = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < text.length) {
      const at = TOKEN.lastIndex;
      const m = TOKEN.exec(text);
      if (!m) throw new Error(`Can't read the formula at "${text.slice(at)}" in ${text}`);
      if (m[1] !== undefined) continue;
      if (m[2] !== undefined) tokens.push({ t: "str", v: m[2].replace(/""/g, '"') });
      else if (m[3] !== undefined) tokens.push({ t: "ref", sheet: m[3].replace(/''/g, "'"), from: m[4], to: m[5] });
      else if (m[6] !== undefined) tokens.push({ t: "ref", sheet: m[6], from: m[7], to: m[8] });
      else if (m[9] !== undefined) tokens.push({ t: "fn", v: m[9] });
      else if (m[10] !== undefined) tokens.push({ t: "bool", v: m[10] === "TRUE" });
      else if (m[11] !== undefined) tokens.push({ t: "ref", sheet: null, from: m[11], to: m[12] });
      else if (m[13] !== undefined) tokens.push({ t: "num", v: Number(m[13]) });
      else tokens.push({ t: "op", v: m[14] });
    }
    return tokens;
  }

  // Precedence, lowest first: comparisons, &, + −, × ÷, ^, then negation (which binds tighter than ^, as in spreadsheets).
  function parse(text) {
    const tokens = tokenize(text);
    let at = 0;
    const peek = () => tokens[at];
    const isOp = (...ops) => peek()?.t === "op" && ops.includes(peek().v);
    const take = () => tokens[at++];
    const expect = (v) => {
      const tok = take();
      if (tok?.t !== "op" || tok.v !== v) throw new Error(`Expected ${v} in ${text}`);
    };
    const binary = (next, ops) => () => {
      let node = next();
      while (isOp(...ops)) node = { t: "bin", op: take().v, a: node, b: next() };
      return node;
    };
    const primary = () => {
      const tok = take();
      if (!tok) throw new Error(`Formula ends early: ${text}`);
      if (tok.t === "num" || tok.t === "str" || tok.t === "bool") return tok;
      if (tok.t === "ref") return tok;
      if (tok.t === "fn") {
        const args = [];
        if (!isOp(")")) {
          do args.push(comparison()); while (isOp(",") && take());
        }
        expect(")");
        return { t: "call", name: tok.v, args };
      }
      if (tok.t === "op" && tok.v === "(") {
        const node = comparison();
        expect(")");
        return node;
      }
      throw new Error(`Unexpected ${tok.v ?? tok.t} in ${text}`);
    };
    const unary = () => {
      if (isOp("-")) { take(); return { t: "neg", a: unary() }; }
      if (isOp("+")) { take(); return unary(); }
      return primary();
    };
    const power = binary(unary, ["^"]);
    const product = binary(power, ["*", "/"]);
    const sum = binary(product, ["+", "-"]);
    const concat = binary(sum, ["&"]);
    const comparison = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);
    const node = comparison();
    if (at < tokens.length) throw new Error(`Left over in ${text}: ${tokens.slice(at).map((x) => x.v).join(" ")}`);
    return node;
  }

  // ---------- values ----------

  const colNumber = (name) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const cellOf = (ref) => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return { col: colNumber(m[1]), row: Number(m[2]) }; };

  function toNumber(v) {
    if (v === BLANK) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    throw new SheetError("#VALUE!");
  }
  const toText = (v) => (v === BLANK ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
  function truthy(v) {
    if (v === BLANK) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string" && /^(true|false)$/i.test(v)) return /^true$/i.test(v);
    throw new SheetError("#VALUE!");
  }
  // Spreadsheet order: numbers < text < booleans; text ignores case; a blank is 0, "" or FALSE to match the other side.
  function compare(a, b) {
    const fill = (x, other) => (x !== BLANK ? x : typeof other === "string" ? "" : typeof other === "boolean" ? false : 0);
    a = fill(a, b);
    b = fill(b, a);
    const rank = (x) => (typeof x === "number" ? 0 : typeof x === "string" ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (typeof a === "string") { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // ">=5", "<>x", "yes": a test for COUNTIF and SUMIFS.
  function criterion(spec) {
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(toText(spec));
    const op = m[1] ?? "=";
    const raw = m[2];
    const numeric = raw.trim() !== "" && Number.isFinite(Number(raw));
    return (v) => {
      if (numeric) {
        if (typeof v !== "number") return op === "<>";
        const c = v - Number(raw);
        return { "=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[op];
      }
      const c = compare(v === BLANK ? "" : toText(v), raw);
      return { "=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[op];
    };
  }

  function invert(matrix) {
    const n = matrix.length;
    if (matrix.some((row) => row.length !== n)) throw new SheetError("#VALUE!");
    const a = matrix.map((row, i) => [...row.map(toNumber), ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let pivot = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
      if (Math.abs(a[pivot][c]) < 1e-15) throw new SheetError("#NUM!");
      [a[c], a[pivot]] = [a[pivot], a[c]];
      const p = a[c][c];
      for (let j = 0; j < 2 * n; j++) a[c][j] /= p;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r][c];
        if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
      }
    }
    return a.map((row) => row.slice(n));
  }

  // ---------- the evaluator ----------

  function evaluator(workbook) {
    const sheets = new Map(workbook.sheets.map((s) => [s.name, s]));
    const memo = new Map();
    const busy = new Set();
    const parsed = new Map();

    function value(sheetName, ref) {
      const key = `${sheetName}!${ref.replace(/\$/g, "")}`;
      if (memo.has(key)) return memo.get(key);
      const sheet = sheets.get(sheetName);
      if (!sheet) throw new Error(`No sheet called ${sheetName}`);
      const cell = sheet.get(ref.replace(/\$/g, ""));
      let result;
      if (!cell || cell.value === null) result = BLANK;
      else if (typeof cell.value === "object") {
        if (busy.has(key)) throw new Error(`Circular reference at ${key}`);
        busy.add(key);
        try {
          if (!parsed.has(cell.value.f)) parsed.set(cell.value.f, parse(cell.value.f));
          result = scalar(run(parsed.get(cell.value.f), sheetName));
        } catch (e) {
          if (!(e instanceof SheetError)) throw new Error(`${key} =${cell.value.f}: ${e.message}`);
          result = e;
        } finally {
          busy.delete(key);
        }
      } else result = cell.value;
      memo.set(key, result);
      return result;
    }

    // A cell's value, raising its error if it has one.
    function read(sheetName, ref) {
      const v = value(sheetName, ref);
      if (v instanceof SheetError) throw v;
      return v;
    }

    function rangeOf(node, sheetName) {
      const sheet = node.sheet ?? sheetName;
      const a = cellOf(node.from);
      const b = cellOf(node.to ?? node.from);
      const rows = [];
      for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
        const row = [];
        for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) row.push(read(sheet, colName(c) + r));
        rows.push(row);
      }
      return { range: rows, ref: !node.to };
    }

    const scalar = (v) => {
      if (v && v.range) {
        if (v.range.length === 1 && v.range[0].length === 1) return v.range[0][0];
        throw new SheetError("#VALUE!");
      }
      return v;
    };
    const grid = (v) => (v && v.range ? v.range : [[v]]);
    // Numbers to add up: from cells only the numbers count; typed values are read as numbers.
    const numbersIn = (args) => args.flatMap((v) => (v && v.range ? v.range.flat().filter((x) => typeof x === "number") : [toNumber(v)]));

    function run(node, sheetName) {
      switch (node.t) {
        case "num": case "str": case "bool": return node.v;
        case "ref": return rangeOf(node, sheetName);
        case "neg": return -toNumber(scalar(run(node.a, sheetName)));
        case "bin": {
          const a = scalar(run(node.a, sheetName));
          const b = scalar(run(node.b, sheetName));
          switch (node.op) {
            case "+": return toNumber(a) + toNumber(b);
            case "-": return toNumber(a) - toNumber(b);
            case "*": return toNumber(a) * toNumber(b);
            case "/": { const d = toNumber(b); if (d === 0) throw new SheetError("#DIV/0!"); return toNumber(a) / d; }
            case "^": return toNumber(a) ** toNumber(b);
            case "&": return toText(a) + toText(b);
            case "=": return compare(a, b) === 0;
            case "<>": return compare(a, b) !== 0;
            case "<": return compare(a, b) < 0;
            case ">": return compare(a, b) > 0;
            case "<=": return compare(a, b) <= 0;
            case ">=": return compare(a, b) >= 0;
          }
          break;
        }
        case "call": return call(node, sheetName);
      }
      throw new Error(`Can't work out ${JSON.stringify(node)}`);
    }

    function call(node, sheetName) {
      const arg = (i) => run(node.args[i], sheetName);
      const all = () => node.args.map((a) => run(a, sheetName));
      switch (node.name) {
        case "IF": {
          const yes = truthy(scalar(arg(0)));
          if (yes) return node.args.length > 1 ? scalar(arg(1)) : true;
          return node.args.length > 2 ? scalar(arg(2)) : false;
        }
        case "IFERROR": {
          try { const v = scalar(arg(0)); if (v instanceof SheetError) throw v; return v; } catch (e) {
            if (e instanceof SheetError) return scalar(arg(1));
            throw e;
          }
        }
        case "AND": return all().every((v) => grid(v).flat().every(truthy));
        case "OR": return all().some((v) => grid(v).flat().some(truthy));
        case "NOT": return !truthy(scalar(arg(0)));
        case "SUM": return numbersIn(all()).reduce((a, b) => a + b, 0);
        case "MIN": { const n = numbersIn(all()); return n.length ? Math.min(...n) : 0; }
        case "MAX": { const n = numbersIn(all()); return n.length ? Math.max(...n) : 0; }
        case "COUNT": return all().flatMap((v) => grid(v).flat()).filter((x) => typeof x === "number").length;
        case "COUNTIF": { const test = criterion(scalar(arg(1))); return grid(arg(0)).flat().filter(test).length; }
        case "SUMIFS": {
          const values = grid(arg(0)).flat();
          const tests = [];
          for (let i = 1; i < node.args.length; i += 2) tests.push([grid(arg(i)).flat(), criterion(scalar(arg(i + 1)))]);
          return values.reduce((s, v, i) => (tests.every(([cells, test]) => test(cells[i])) && typeof v === "number" ? s + v : s), 0);
        }
        case "INDEX": {
          const g = grid(arg(0));
          let r = toNumber(scalar(arg(1)));
          let c = node.args.length > 2 ? toNumber(scalar(arg(2))) : 1;
          if (node.args.length < 3 && g.length === 1) { c = r; r = 1; }
          const v = g[r - 1]?.[c - 1];
          if (v === undefined) throw new SheetError("#REF!");
          return v;
        }
        case "MINVERSE": return { range: invert(grid(arg(0))) };
        case "MMULT": {
          const a = grid(arg(0)).map((row) => row.map(toNumber));
          const b = grid(arg(1)).map((row) => row.map(toNumber));
          if (a[0].length !== b.length) throw new SheetError("#VALUE!");
          return { range: a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0))) };
        }
        case "ISNUMBER": return typeof scalar(arg(0)) === "number";
        case "EXP": return Math.exp(toNumber(scalar(arg(0))));
        case "ABS": return Math.abs(toNumber(scalar(arg(0))));
        case "ROUND": {
          // Halves away from zero.
          const scale = 10 ** (node.args.length > 1 ? Math.trunc(toNumber(scalar(arg(1)))) : 0);
          const v = toNumber(scalar(arg(0))) * scale;
          return (Math.sign(v) * Math.round(Math.abs(v))) / scale;
        }
        case "MOD": { const n = toNumber(scalar(arg(0))); const d = toNumber(scalar(arg(1))); if (d === 0) throw new SheetError("#DIV/0!"); return n - d * Math.floor(n / d); }
        case "WEEKDAY": {
          const serial = Math.floor(toNumber(scalar(arg(0))));
          const type = node.args.length > 1 ? toNumber(scalar(arg(1))) : 1;
          const sundayFirst = ((serial + 6) % 7) + 1; // serial 1 (Sunday in spreadsheets) -> 1
          if (type === 1) return sundayFirst;
          if (type === 2) return ((serial + 5) % 7) + 1;
          throw new SheetError("#NUM!");
        }
      }
      throw new Error(`The evaluator doesn't know ${node.name}`);
    }

    return {
      // A cell's result as { kind: "number" | "string" | "boolean" | "blank" | "error", value }.
      result(sheetName, ref) {
        const v = value(sheetName, ref);
        if (v === BLANK) return { kind: "blank", value: null };
        if (v instanceof SheetError) return { kind: "error", value: v.code };
        return { kind: typeof v, value: v };
      },
      // A cell's value: a number, text, boolean, null for blank, or an error code like "#DIV/0!".
      get(sheetName, ref) {
        const v = value(sheetName, ref);
        if (v === BLANK) return null;
        if (v instanceof SheetError) return v.code;
        return v;
      },
      // Works out every cell, sheet by sheet. Days run across from column C and each day leans on the one before,
      // so the day columns go first, left to right, then columns A and B: chains of references stay short.
      all(order = workbook.sheets.map((s) => s.name)) {
        for (const name of order) {
          const cells = [...sheets.get(name).cells.keys()].map((ref) => ({ ref, ...cellOf(ref) }))
            .sort((a, b) => (a.col < 3) - (b.col < 3) || a.col - b.col || a.row - b.row);
          for (const { ref } of cells) value(name, ref);
        }
      },
    };
  }

  const RampSheetEval = { evaluator, parse, colName, colNumber };
  if (typeof module === "object" && module.exports) module.exports = RampSheetEval;
  else root.RampSheetEval = RampSheetEval;
})(typeof window !== "undefined" ? window : globalThis);
