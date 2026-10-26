/*
 * Ramp plan export: the whole model as a workbook of live formulas, for Google Sheets.
 *   Plan          when every target is reached; the rows of the app's day-by-day table, each with that day's
 *                 number and the total so far; and the tasks created and done each Monday
 *   How it works  the model's equations in plain words, and the sheet that works each one out
 *   Inputs        every number that can change (the blue cells), laid out like the app
 *   CB ramp       CBs joining and converted up, and the CBs at each layer
 *   Day by day    the model itself (one sheet per domain when split)
 * Days run across, one column each from column C, like the app's timeline, up to the day every target is reached
 * (the app's whole 365 days when it isn't). The layers, evals, domains and ramp
 * periods are fixed when it's exported; every number can still change. No page code in here, so it also runs under Node.
 */
(function (root) {
  "use strict";

  const inNode = typeof module === "object" && module.exports;
  const M = inNode ? require("./model.js") : root.RampModel;
  const X = inNode ? require("./xlsx.js") : root.RampXlsx;
  const Eval = inNode ? require("./sheet_eval.js") : root.RampSheetEval;
  const Sim = inNode ? require("./simulate.js") : root.RampSim;
  const { colName, addr, quoteSheet, dateSerial } = X;

  const DONE = 12;
  const CLEARED = -1;
  // CB ramp and the day-by-day sheets: the dates in row 2 and the day numbers in row 3, then (day-by-day sheets)
  // whether the domain is still working. Column A labels each row, column B holds what a row uses (Tᵏ), days start in C.
  const DATE_ROW = 2;
  const DAY_ROW = 3;
  const WORK_ROW = 4;
  const FIRST_COL = 3;
  const dayCol = (t) => FIRST_COL + t - 1;
  const LEFT = 52; // characters across columns A and B, which stay put while the days scroll
  const F = (f) => ({ f });
  const L = M.name;

  const COLOR = {
    muted: "5F6670", faint: "A7ADB4", line: "D3D7DC", head: "F1F3F5",
    input: "E8F0FE", inputInk: "0B57D0", monday: "F3F2EA",
    bottleneck: "FCE7C0", bottleneckInk: "7A4B00", starved: "E4EBF4", starvedInk: "33475E",
    short: "FBE2DE", shortInk: "A3271B", met: "DFF2E4", metInk: "1D6B39",
  };

  function stylesFor(wb) {
    const s = (spec) => wb.style(spec);
    const NUM = "#,##0.0";
    const DATE = "ddd, mmm d, yyyy";
    const input = { fill: COLOR.input, font: { color: COLOR.inputInk } };
    const muted = { color: COLOR.muted };
    const headBase = { font: { bold: true }, fill: COLOR.head, border: { bottom: "thin", color: COLOR.line } };
    return {
      title: s({ font: { size: 16, bold: true } }),
      lede: s({ font: muted }),
      section: s({ font: { size: 12, bold: true } }),
      text: s({}),
      strong: s({ font: { bold: true } }),
      wrap: s({ align: { v: "top", wrap: true } }),
      wrapStrong: s({ font: { bold: true }, align: { v: "top", wrap: true } }),
      wrapMuted: s({ font: muted, align: { v: "top", wrap: true } }),
      wrapEq: s({ font: { name: "Arial" }, align: { v: "top", wrap: true } }),
      head: s({ ...headBase, align: { h: "center", v: "bottom", wrap: true } }),
      headLeft: s({ ...headBase, align: { h: "left", v: "bottom", wrap: true } }),
      band: s({ font: { bold: true }, fill: COLOR.head, align: { v: "center" }, border: { top: "thin", color: COLOR.line } }),
      bandRight: s({ font: { bold: true, color: COLOR.muted }, fill: COLOR.head, align: { h: "right", v: "center" },
        border: { top: "thin", color: COLOR.line } }),
      eq: s({ font: { italic: true, color: COLOR.muted }, align: { h: "left", v: "top", wrap: true } }),
      param: s({ font: muted, align: { h: "right" } }),
      rowHead: s({ font: { bold: true } }),
      indent: s({ align: { indent: 1 } }),
      label: s({ align: { indent: 1 } }),
      labelStrong: s({ font: { bold: true }, align: { indent: 1 } }),
      labelMuted: s({ font: muted, align: { h: "right" } }),
      headCell: s({ font: { bold: true }, fill: COLOR.head }),
      headCellLine: s({ font: { bold: true }, fill: COLOR.head, border: { bottom: "thin", color: COLOR.line } }),
      dateHead: s({ font: { bold: true }, fill: COLOR.head, numFmt: "ddd, mmm d", align: { h: "center" } }),
      dayHead: s({ font: muted, fill: COLOR.head, numFmt: '"day "0', align: { h: "center" }, border: { bottom: "thin", color: COLOR.line } }),
      work: s({ font: muted, align: { h: "center" }, border: { bottom: "thin", color: COLOR.line } }),
      workLabel: s({ font: { bold: true }, border: { bottom: "thin", color: COLOR.line } }),
      num: s({ numFmt: NUM }),
      numStrong: s({ font: { bold: true }, numFmt: NUM }),
      numMuted: s({ font: muted, numFmt: NUM }),
      change: s({ font: muted, numFmt: "+#,##0.0;-#,##0.0;0.0" }),
      shortDate: s({ numFmt: "ddd, mmm d", align: { h: "left" } }),
      plain: s({}),
      pct: s({ numFmt: "0%" }),
      pct2: s({ numFmt: "0.0#%" }),
      date: s({ numFmt: DATE, align: { h: "left" } }),
      centre: s({ align: { h: "center" } }),
      fixed: s({ font: muted }),
      inNum: s({ ...input }),
      inPct: s({ ...input, numFmt: "0%" }),
      inPct2: s({ ...input, numFmt: "0.0#%" }),
      inDate: s({ ...input, numFmt: DATE, align: { h: "left" } }),
      hero: s({ font: { size: 18, bold: true }, numFmt: DATE, align: { h: "left", v: "center" } }),
      big: s({ font: { size: 12, bold: true }, numFmt: "General", align: { h: "left" } }),
      value: s({ numFmt: "General", align: { h: "left" } }),
      valueNum: s({ numFmt: NUM, align: { h: "left" } }),
      valueDate: s({ numFmt: DATE, align: { h: "left" } }),
      valueDateStrong: s({ font: { bold: true }, numFmt: DATE, align: { h: "left" } }),
      // Conditional formats
      cfFaint: wb.dxf({ font: { color: COLOR.faint } }),
      cfMonday: wb.dxf({ fill: COLOR.monday }),
      cfBottleneck: wb.dxf({ fill: COLOR.bottleneck, font: { color: COLOR.bottleneckInk } }),
      cfStarved: wb.dxf({ fill: COLOR.starved, font: { color: COLOR.starvedInk } }),
      cfShort: wb.dxf({ fill: COLOR.short, font: { color: COLOR.shortInk } }),
      cfMet: wb.dxf({ fill: COLOR.met, font: { color: COLOR.metInk, bold: true } }),
      cfFinal: wb.dxf({ font: { bold: true } }),
      cfBad: wb.dxf({ fill: COLOR.short, font: { color: COLOR.shortInk, bold: true } }),
    };
  }

  // A tab name spreadsheets accept: no []:*?/\, at most 31 characters, and not already taken.
  function sheetName(name, taken) {
    const base = String(name).replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^'+|'+$/g, "").slice(0, 31).trim() || "Domain";
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = base.slice(0, 31 - suffix.length).trim() + suffix;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  }

  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  // Rough wrapped line count for 10pt Arial in a column `width` characters wide, and the row height for it.
  const lineCount = (text, width) => String(text).split("\n")
    .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(1, Math.floor(width * 1.15)))), 0);
  const heightFor = (count) => 13 * count + 4;
  const whole = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
  const listed = (names) => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);

  /*
   * Builds the workbook for a valid check (RampModel.validate) and the inputs it came from.
   * `days` is how many days the model runs, one column each: by default up to the day the app's plan reaches every
   * target, or its whole 365 days when it doesn't.
   * With `results`, every formula's result is stored with it, for previews that don't recalculate.
   */
  function build(check, inputs, { exportedOn = new Date(), days, results = true } = {}) {
    if (!check?.ok) throw new Error("Fix the inputs before exporting.");
    if (days === undefined) {
      const plan = Sim.run(check, check.values.ramp);
      days = plan.reachedDay ?? plan.maxDays;
    }
    const { values, layers } = check;
    const split = Boolean(inputs?.domains?.split);
    const { human, evals, working, review } = layers;
    const dest = layers.destinations;
    const hr = human.slice(1);                       // review layers people work
    const out = [...hr, DONE, CLEARED];              // where tasks end up once evals have passed them on
    const nonEval = dest.filter((k) => !evals.includes(k));
    const domains = values.domains;
    const lastCol = dayCol(days);
    const evalTag = (k) => (evals.includes(k) ? " eval" : "");
    const destLabel = (k) => (k === CLEARED ? "L−1 cleared" : k === DONE ? "L12 done" : L(k) + evalTag(k));
    const srcLabel = (j) => (j === -1 ? "L−1 new tasks" : L(j) + evalTag(j));
    const dayWhere = split ? "Each domain's sheet" : "Day by day";
    // Super attempts: L−1 attempts made with the hours CBs at the lowest human review layer and up fall back with.
    const sup = values.superAttempts?.on ? values.superAttempts : null;
    const supWho = sup ? `${L(sup.from)}+` : "";
    const raised = (k) => String(k).replace(/\d/g, (n) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[n]); // 10 -> ¹⁰

    const wb = X.workbook({ title: "Ramp plan", creator: "Ramp plan app", created: exportedOn });
    const st = stylesFor(wb);
    const taken = new Set(["history"]);
    const planSheet = wb.sheet(sheetName("Plan", taken));
    const howSheet = wb.sheet(sheetName("How it works", taken));
    const inSheet = wb.sheet(sheetName("Inputs", taken));
    const rampSheet = wb.sheet(sheetName("CB ramp", taken));
    const daySheets = domains.map((d) => wb.sheet(sheetName(split ? d.name : "Day by day", taken)));

    const at = (sheet, col, row) => ({ sheet: sheet.name, col, row });
    // An absolute reference, with the sheet name unless it's on `from`.
    const ref = (a, from) => (from && a.sheet === from.name ? "" : quoteSheet(a.sheet) + "!") + "$" + colName(a.col) + "$" + a.row;
    // One row across every day, absolute, with the sheet name unless it's on `from`.
    const across = (sheet, row, from) => `${from && sheet.name === from.name ? "" : quoteSheet(sheet.name) + "!"}` +
      `$${colName(FIRST_COL)}$${row}:$${colName(lastCol)}$${row}`;
    // Every day's column from row `from` to row `to`, for conditional formatting (written from its top-left cell, column C).
    const dayBlock = (from, to) => `${colName(FIRST_COL)}${from}:${colName(lastCol)}${to}`;
    const C = colName(FIRST_COL);
    const put = (sheet, col, row, value, style) => sheet.set(addr(col, row), value, style);
    // A merged cell across columns `from`…`to` on one row, styled throughout.
    const span = (sheet, from, to, row, value, style) => {
      put(sheet, from, row, value, style);
      for (let c = from + 1; c <= to; c++) put(sheet, c, row, null, style);
      if (to > from) sheet.merge(`${addr(from, row)}:${addr(to, row)}`);
    };

    // ---- what CB ramp, the day-by-day sheets and the Plan's table share ----
    // Columns A and B stay put while the days scroll, so long text wraps inside them.
    const leftWidths = (sh, a, b) => {
      sh.width(1, a);
      sh.width(2, b);
      for (let t = 1; t <= days; t++) sh.width(dayCol(t), 12);
    };
    const note = (sh, row, text, style = st.wrapMuted) => {
      span(sh, 1, 2, row, text, style);
      sh.height(row, heightFor(lineCount(text, LEFT)));
    };
    // The dates across, and the day numbers under them.
    const dateRows = (sh, dateRow, dayRow) => {
      put(sh, 1, dateRow, "Date", st.headCell);
      put(sh, 2, dateRow, null, st.headCell);
      put(sh, 1, dayRow, "Day", st.headCellLine);
      put(sh, 2, dayRow, null, st.headCellLine);
      for (let t = 1; t <= days; t++) {
        const c = dayCol(t);
        put(sh, c, dateRow, F(`${ref(I.start, sh)}+${addr(c, dayRow)}-1`), st.dateHead);
        put(sh, c, dayRow, t, st.dayHead);
      }
    };
    // A block of rows: its title (and what column B holds), then its equation. Returns the first row under them.
    const sectionHead = (sh, row, title, equation, param = null) => {
      put(sh, 1, row, title, st.band);
      put(sh, 2, row, param, st.bandRight);
      span(sh, 1, 2, row + 1, equation, st.eq);
      sh.height(row + 1, heightFor(lineCount(equation, LEFT)));
      return row + 2;
    };

    // ======================= Inputs =======================
    const I = { Y: {}, use: {}, end: {}, target: {}, backlog: {}, P: {}, T: {}, rampStart: {}, periods: {} };
    {
      const sh = inSheet;
      sh.width(1, 40);
      sh.width(2, 18);
      for (let c = 3; c <= 10; c++) sh.width(c, 13);
      put(sh, 1, 1, "Inputs", st.title);
      put(sh, 1, 2, "Blue cells are inputs. Change any of them and every sheet updates; everything else is worked out from them.", st.lede);
      put(sh, 1, 3, "The layers, evals, super attempts, domains and ramp periods come from the app. To change those, change them there " +
        "and export again.", st.lede);

      let r = 5;
      put(sh, 1, r++, "Plan", st.section);
      put(sh, 1, r, "Starts on (day 1)", st.text);
      put(sh, 2, r, dateSerial(values.startDate), st.inDate);
      if (String(inputs?.startDate ?? "").trim() === "") {
        put(sh, 4, r, "In the app the plan starts tomorrow. To keep that here, replace the date with =TODAY()+1.", st.lede);
      }
      I.start = at(sh, 2, r++);
      put(sh, 1, r, "Days the model runs", st.text);
      put(sh, 2, r, days, st.fixed);
      put(sh, 4, r, "One column per day on Plan, CB ramp and the day-by-day sheets, up to the day the app's plan reaches " +
        "the target. If a change here pushes that later, the sheets say it isn't reached: export again from the app.", st.lede);
      I.days = at(sh, 2, r++);

      // Pipeline and yield: Y(j→k) for every layer in use.
      r++;
      put(sh, 1, r++, "Pipeline and yield", st.section);
      put(sh, 1, r++, "For the tasks attempted in each layer (rows), the share that moves to each layer next (columns). " +
        "Back to L−1 clears a task. Each row has to add up to 100%.", st.lede);
      const totalCol = 2 + dest.length;
      put(sh, 1, r, "Attempted in", st.headLeft);
      dest.forEach((k, i) => put(sh, 2 + i, r, destLabel(k), st.head));
      put(sh, totalCol, r, "Adds up to", st.head);
      r++;
      const firstY = r;
      for (const j of working) {
        put(sh, 1, r, srcLabel(j), st.rowHead);
        I.Y[j] = {};
        dest.forEach((k, i) => {
          const v = values.moves[j][k];
          put(sh, 2 + i, r, v > 0 ? v : null, whole(v) ? st.inPct : st.inPct2);
          I.Y[j][k] = at(sh, 2 + i, r);
        });
        put(sh, totalCol, r, F(`SUM(${addr(2, r)}:${addr(totalCol - 1, r)})`), st.pct2);
        r++;
      }
      sh.rule(`${addr(totalCol, firstY)}:${addr(totalCol, r - 1)}`, `ABS(${addr(totalCol, firstY)}-1)>0.0001`, st.cfBad);
      if (sup) {
        r++;
        put(sh, 1, r++, "Super attempts", st.strong);
        put(sh, 1, r++, `${supWho} attempters are super attempters: when CBs at ${L(sup.from)} and above run out of review work and fall ` +
          `back to L−1, the tasks they create there skip the L−1 row and go straight to ${destLabel(sup.to)}.`, st.lede);
      }

      if (evals.length === 0) {
        for (const j of human) I.use[j] = Object.fromEntries(nonEval.map((k) => [k, I.Y[j][k]]));
      } else {
        // Evals pass tasks on the same day. X(e→k): where a task that lands on eval e ends up, through any evals after it,
        // = (I − Y between evals)⁻¹ × Y(evals → everything else). The yields the model uses fold that into each human layer's row.
        r++;
        put(sh, 1, r++, "How evals pass tasks on", st.strong);
        put(sh, 1, r++, "Evals take no CB time, so a task that lands on one moves on the same day by the eval's own yields. " +
          "These tables work out where it ends up and fold that into the yields of the layers that feed the evals.", st.lede);
        const n = evals.length;
        const endHead = r;
        const useHead = endHead + n + 2;
        const helpHead = useHead + human.length + 2;
        const invHead = helpHead + n + 2;
        const helpCell = (i, j) => at(sh, 2 + j, helpHead + 1 + i);
        const invCell = (i, j) => at(sh, 2 + j, invHead + 1 + i);

        const tableHead = (row, title, keys, total = true) => {
          put(sh, 1, row, title, st.headLeft);
          keys.forEach((k, i) => put(sh, 2 + i, row, typeof k === "number" ? destLabel(k) : k, st.head));
          if (total) put(sh, 2 + keys.length, row, "Adds up to", st.head);
        };

        tableHead(endHead, "Where a task that lands on an eval ends up", nonEval);
        evals.forEach((e, i) => {
          const row = endHead + 1 + i;
          put(sh, 1, row, L(e) + " eval", st.rowHead);
          I.end[e] = {};
          nonEval.forEach((k, c) => {
            const terms = evals.map((f, j) => `${ref(invCell(i, j), sh)}*${ref(I.Y[f][k], sh)}`);
            put(sh, 2 + c, row, F(terms.join("+")), st.pct2);
            I.end[e][k] = at(sh, 2 + c, row);
          });
          put(sh, 2 + nonEval.length, row, F(`SUM(${addr(2, row)}:${addr(1 + nonEval.length, row)})`), st.pct2);
        });

        tableHead(useHead, "Yields the model uses", nonEval);
        human.forEach((j, i) => {
          const row = useHead + 1 + i;
          put(sh, 1, row, srcLabel(j), st.rowHead);
          I.use[j] = {};
          nonEval.forEach((k, c) => {
            const terms = [ref(I.Y[j][k], sh), ...evals.map((e) => `${ref(I.Y[j][e], sh)}*${ref(I.end[e][k], sh)}`)];
            put(sh, 2 + c, row, F(terms.join("+")), st.pct2);
            I.use[j][k] = at(sh, 2 + c, row);
          });
          put(sh, 2 + nonEval.length, row, F(`SUM(${addr(2, row)}:${addr(1 + nonEval.length, row)})`), st.pct2);
        });

        const evalNames = evals.map((e) => L(e) + " eval");
        tableHead(helpHead, "Working: 1 for the same eval, minus the share it passes to each eval", evalNames, false);
        evals.forEach((e, i) => {
          put(sh, 1, helpHead + 1 + i, L(e) + " eval", st.rowHead);
          evals.forEach((f, j) => {
            const y = ref(I.Y[e][f], sh);
            put(sh, 2 + j, helpHead + 1 + i, F(i === j ? `1-${y}` : `-${y}`), st.plain);
          });
        });
        const helpRange = `${ref(helpCell(0, 0), sh)}:${ref(helpCell(n - 1, n - 1), sh)}`;
        tableHead(invHead, "Working: the inverse of the table above", evalNames, false);
        evals.forEach((e, i) => {
          put(sh, 1, invHead + 1 + i, L(e) + " eval", st.rowHead);
          evals.forEach((f, j) => put(sh, 2 + j, invHead + 1 + i, F(`IFERROR(INDEX(MINVERSE(${helpRange}),${i + 1},${j + 1}),0)`), st.plain));
        });
        r = invHead + n + 1;
      }

      // Domains and targets
      r++;
      put(sh, 1, r++, "Domains and targets", st.section);
      put(sh, 1, r++, "Task target is how many tasks need to reach L12. Tasks waiting are already in a review layer on day 1; " +
        "L−1 never runs out of new tasks.", st.lede);
      if (review.length) {
        span(sh, 3, 2 + review.length, r, "Tasks waiting on day 1, Bᵏ(0)", st.head);
        r++;
      }
      put(sh, 1, r, split ? "Domain" : "", st.headLeft);
      put(sh, 2, r, "Task target", st.head);
      review.forEach((k, i) => put(sh, 3 + i, r, L(k) + evalTag(k), st.head));
      r++;
      for (const d of domains) {
        put(sh, 1, r, split ? d.name : "All tasks", st.rowHead);
        put(sh, 2, r, values.targets[d.id], st.inNum);
        I.target[d.id] = at(sh, 2, r);
        I.backlog[d.id] = {};
        review.forEach((k, i) => {
          put(sh, 3 + i, r, values.backlogByDomain[d.id][k] || 0, st.inNum);
          I.backlog[d.id][k] = at(sh, 3 + i, r);
        });
        r++;
      }

      // Assumptions: P and Tᵏ, a default row and (when split) each domain's own, blank meaning the default.
      r++;
      put(sh, 1, r++, "Assumptions", st.section);
      put(sh, 1, r++, "Hours per day is the average an active CB works. Hours per attempt is how long one attempt takes in each layer; " +
        "evals are instant.", st.lede);
      span(sh, 3, 2 + working.length, r, "Hours per attempt, Tᵏ", st.head);
      r++;
      put(sh, 1, r, split ? "Domain" : "", st.headLeft);
      put(sh, 2, r, "Hours per CB per day, P", st.head);
      working.forEach((k, i) => put(sh, 3 + i, r, L(k) + evalTag(k), st.head));
      r++;
      const own = (text) => (String(text ?? "").trim() === "" ? null : M.toNumber(text));
      const assumptionRow = (row, label, P, T) => {
        put(sh, 1, row, label, st.rowHead);
        put(sh, 2, row, P, st.inNum);
        const cells = { P: at(sh, 2, row), T: {} };
        working.forEach((k, i) => {
          if (evals.includes(k)) { put(sh, 3 + i, row, "instant", st.fixed); return; }
          put(sh, 3 + i, row, T(k), st.inNum);
          cells.T[k] = at(sh, 3 + i, row);
        });
        return cells;
      };
      if (!split) {
        const cells = assumptionRow(r++, "All tasks", values.hoursPerDay, (k) => values.attemptHours[k]);
        const id = domains[0].id;
        I.P[id] = cells.P;
        I.T[id] = cells.T;
      } else {
        const defaults = assumptionRow(r++, "Every domain (default)", values.hoursPerDay, (k) => values.attemptHours[k]);
        const owned = domains.map((d) => assumptionRow(r++, d.name,
          own(inputs.overrides?.[d.id]?.hoursPerDay), (k) => own(inputs.overrides?.[d.id]?.attemptHours?.[k])));
        put(sh, 1, r++, "A domain's blank cell uses the default. What each domain uses:", st.lede);
        domains.forEach((d, i) => {
          put(sh, 1, r, d.name, st.text);
          const pick = (mine, fallback) => F(`IF(${ref(mine, sh)}="",${ref(fallback, sh)},${ref(mine, sh)})`);
          put(sh, 2, r, pick(owned[i].P, defaults.P), st.plain);
          I.P[d.id] = at(sh, 2, r);
          I.T[d.id] = {};
          working.forEach((k, c) => {
            if (evals.includes(k)) { put(sh, 3 + c, r, "instant", st.fixed); return; }
            put(sh, 3 + c, r, pick(owned[i].T[k], defaults.T[k]), st.plain);
            I.T[d.id][k] = at(sh, 3 + c, r);
          });
          r++;
        });
      }

      // The CB ramp: where each human layer starts on day 1, then its chain of periods from day 2.
      r++;
      put(sh, 1, r++, "CB ramp", st.section);
      put(sh, 1, r++, "New CBs join at L−1, a set number a day. Each review layer converts CBs up from the human layer below it, " +
        `never more than that layer has: a set number a day or, above ${L(M.SHARE_BASE)}, enough to keep a % of ${L(M.SHARE_BASE)}. ` +
        "Periods run one after another from day 2, and the last runs until the end." + (split ? " Each domain gets this ramp." : ""), st.lede);
      ["Layer and period", "Starts with", "Amount", "Days", "From day", "To day"].forEach((h, i) => put(sh, 1 + i, r, h, i ? st.head : st.headLeft));
      put(sh, 7, r, "What the amount is", st.headLeft);
      r++;
      human.forEach((k, h) => {
        const below = human[h - 1];
        put(sh, 1, r, k === -1 ? "L−1, new CBs join" : `${L(k)}, converted up from ${L(below)}`, st.rowHead);
        put(sh, 2, r, values.ramp.start[k], st.inNum);
        I.rampStart[k] = at(sh, 2, r);
        r++;
        const raw = inputs?.ramp?.periods?.[k] ?? [];
        I.periods[k] = values.ramp.periods[k].map((p, i) => {
          const row = r++;
          const what = lower(M.presetOf(k, raw[i]?.preset).label);
          put(sh, 1, row, `Period ${i + 1}: ${what}`, st.indent);
          let unit;
          if (p.kind === "share") {
            put(sh, 3, row, p.rate / 100, whole(p.rate / 100) ? st.inPct : st.inPct2);
            unit = `of the CBs ${L(M.SHARE_BASE)} had the day before, rounded to whole CBs and at least 1, converted up from ${L(below)}`;
          } else {
            put(sh, 3, row, p.perDay, st.inNum);
            unit = k === -1 ? "CBs join each day (below 0, CBs leave)" : `CBs converted up from ${L(below)} each day`;
          }
          const finite = Number.isFinite(p.days);
          put(sh, 4, row, finite ? p.days : "until the end", finite ? st.inNum : st.fixed);
          put(sh, 5, row, i === 0 ? 2 : F(`${addr(6, row - 1)}+1`), i === 0 ? st.fixed : st.plain);
          put(sh, 6, row, F(finite ? `${addr(5, row)}+${addr(4, row)}-1` : ref(I.days, sh)), st.plain);
          put(sh, 7, row, unit, st.lede);
          return {
            kind: p.kind, what, amount: at(sh, 3, row), days: at(sh, 4, row), from: at(sh, 5, row), to: at(sh, 6, row),
          };
        });
      });
    }

    // ======================= CB ramp =======================
    const R = { cb: {}, conv: {}, all: null };
    {
      const sh = rampSheet;
      leftWidths(sh, 36, 16);
      put(sh, 1, 1, "CB ramp", st.title);
      dateRows(sh, DATE_ROW, DAY_ROW);
      note(sh, 5, "How many CBs can work each layer, one column per day. CBs join at L−1 and are converted up one layer at a time, " +
        "and each one is counted at the highest layer they can work." + (split ? " Each domain gets this ramp." : ""));
      note(sh, 6, "The numbers that drive it are under CB ramp on Inputs. A converted cell turns red on a day the layer below " +
        "didn't have enough CBs.");

      let r = 8;
      const join = I.periods[-1];
      r = sectionHead(sh, r, "New CBs at L−1", "L−1 after joining = max(0, C⁻¹(t−1) + joining)");
      const periodRows = join.length > 1 ? join.map((p, i) => { put(sh, 1, r, `Period ${i + 1}: ${p.what}`, st.label); return r++; }) : [];
      const rowJoining = r;
      put(sh, 1, r++, join.length === 1 ? `Joining today: ${join[0].what}` : "Joining today", st.label);
      const rowAfter = r;
      put(sh, 1, r++, "L−1 after joining", st.label);
      r++;
      // Layers that keep a % of L0 in some period also get the number they're keeping, the target.
      const keeps = (k) => I.periods[k].some((p) => p.kind === "share");
      if (hr.length) {
        const base = L(M.SHARE_BASE);
        r = sectionHead(sh, r, "Converted up from the layer below", "converted = min(planned, CBs the layer below has)" + (hr.some(keeps)
          ? `. Keeping a % of ${base}: target = max(1, round(% × ${base} the day before)), planned = max(0, target − the CBs ` +
            "the layer has once the layer above has converted)" : ""));
        hr.forEach((k, h) => {
          R.conv[k] = {};
          if (keeps(k)) {
            R.conv[k].target = r;
            put(sh, 1, r++, `${L(k)} target, a % of ${base} (at least 1)`, st.label);
          }
          R.conv[k].planned = r;
          put(sh, 1, r++, `Into ${L(k)} from ${L(human[h])}, planned`, st.label);
          R.conv[k].moved = r;
          put(sh, 1, r++, `Into ${L(k)} from ${L(human[h])}, converted`, st.label);
        });
        r++;
      }
      r = sectionHead(sh, r, "CBs at the end of the day, Cᵏ(t)", "Cᵏ(t) = Cᵏ(t−1) + converted into k − converted out of k");
      for (const k of human) {
        R.cb[k] = r;
        put(sh, 1, r++, L(k), st.label);
      }
      R.all = r;
      put(sh, 1, r++, "All", st.labelStrong);
      const bottom = r - 1;

      for (let t = 1; t <= days; t++) {
        const c = dayCol(t);
        const prev = c - 1;
        const cell = (row, col = c) => addr(col, row);
        if (t === 1) {
          for (const k of human) put(sh, c, R.cb[k], F(ref(I.rampStart[k], sh)), st.num);
        } else {
          const day = `${colName(c)}$${DAY_ROW}`;
          const within = (p) => `AND(${day}>=${ref(p.from, sh)},${day}<=${ref(p.to, sh)})`;
          const before = cell(R.cb[-1], prev);
          const joining = (p) => `IF(${within(p)},${ref(p.amount, sh)},0)`;
          if (periodRows.length) {
            join.forEach((p, i) => put(sh, c, periodRows[i], F(joining(p)), st.num));
            put(sh, c, rowJoining, F(`SUM(${cell(periodRows[0])}:${cell(periodRows[periodRows.length - 1])})`), st.num);
          } else {
            put(sh, c, rowJoining, join.length ? F(joining(join[0])) : 0, st.num);
          }
          put(sh, c, rowAfter, F(`MAX(0,${before}+${cell(rowJoining)})`), st.num);
          hr.forEach((k, h) => {
            const below = human[h];
            const above = hr[h + 1];
            const periods = I.periods[k];
            // A set number while its period runs; a % of L0 plans whatever it takes to reach its target, counting
            // the CBs the layer has left once the layer above has converted some of them up.
            const planned = periods.filter((p) => p.kind !== "share").map((p) => `IF(${within(p)},${ref(p.amount, sh)},0)`);
            if (keeps(k)) {
              const base = cell(R.cb[M.SHARE_BASE], prev);
              const target = periods.filter((p) => p.kind === "share")
                .reduceRight((rest, p) => `IF(${within(p)},MAX(1,ROUND(${ref(p.amount, sh)}*${base}+1E-9,0)),${rest})`, '""');
              put(sh, c, R.conv[k].target, F(target), st.num);
              const t = cell(R.conv[k].target);
              const left = above === undefined ? cell(R.cb[k], prev) : `${cell(R.cb[k], prev)}-${cell(R.conv[above].moved)}`;
              planned.push(`IF(ISNUMBER(${t}),${t}-(${left}),0)`);
            }
            put(sh, c, R.conv[k].planned, F(planned.length ? `MAX(0,${planned.join("+")})` : "0"), st.num);
            const has = below === -1 ? cell(rowAfter) : cell(R.cb[below], prev);
            put(sh, c, R.conv[k].moved, F(`MIN(${cell(R.conv[k].planned)},${has})`), st.num);
          });
          human.forEach((k, h) => {
            const above = human[h + 1];
            const kept = k === -1 ? cell(rowAfter) : `${cell(R.cb[k], prev)}+${cell(R.conv[k].moved)}`;
            put(sh, c, R.cb[k], F(above === undefined ? kept : `${kept}-${cell(R.conv[above].moved)}`), st.num);
          });
        }
        put(sh, c, R.all, F(`SUM(${cell(R.cb[human[0]])}:${cell(R.cb[human[human.length - 1]])})`), st.numStrong);
      }

      if (days > 1) {
        const second = colName(dayCol(2));
        for (const k of hr) {
          const { planned, moved } = R.conv[k];
          sh.rule(`${second}${moved}:${colName(lastCol)}${moved}`, `${second}${moved}<${second}${planned}-0.000000001`, st.cfShort);
        }
      }
      sh.rule(dayBlock(DATE_ROW, bottom), `WEEKDAY(${C}$${DATE_ROW},2)=1`, st.cfMonday);
      sh.freeze(DAY_ROW, 2);
    }

    // ======================= Day by day, one sheet per domain =======================
    const D = domains.map((d, i) => {
      const sh = daySheets[i];
      const id = d.id;
      leftWidths(sh, 36, 16);
      put(sh, 1, 1, split ? `${d.name}, day by day` : "Day by day", st.title);
      dateRows(sh, DATE_ROW, DAY_ROW);
      put(sh, 1, WORK_ROW, "Working, while S(t−1) < target", st.workLabel);
      put(sh, 2, WORK_ROW, null, st.workLabel);
      note(sh, 6, "One column per day, worked out highest layer first. Each block of rows is one equation from How it works, " +
        "written under its title. Hours per attempt sit next to the attempts; the yields are on Inputs.");
      put(sh, 1, 7, "Hours per CB per day, P", st.text);
      put(sh, 2, 7, F(ref(I.P[id], sh)), st.value);
      put(sh, 1, 8, "Task target", st.text);
      put(sh, 2, 8, F(ref(I.target[id], sh)), st.value);
      put(sh, 1, 9, "Target reached on day", st.text);
      put(sh, 1, 10, "Target reached on", st.text);

      let r = 12;
      const row = {};
      const block = (key, title, equation, keys, label = L, param = null) => {
        row[key] = {};
        if (!keys.length) return;
        r = sectionHead(sh, r, title, equation, param);
        for (const k of keys) {
          row[key][k] = r;
          put(sh, 1, r++, label(k), st.label);
        }
        r++;
      };
      block("C", "CBs, Cᵏ(t)", "From CB ramp.", human);
      block("B", "Tasks waiting, Bᵏ(t)", "Bᵏ(t) = Bᵏ(t−1) − Aᵏ(t−1) + Lᵏ(t−1), at the start of the day", hr);
      block("H", "Own hours, Hᵏ(t)", "Hᵏ(t) = Cᵏ(t) × P, while working", human);
      block("Hav", "Hours available, H̃ᵏ(t)", "H̃ᵏ(t) = Hᵏ(t) + Rᵏ⁺(t)", human);
      block("A", "Attempts, Aᵏ(t)", "Aᵏ(t) = min(H̃ᵏ(t) ÷ Tᵏ, Bᵏ(t)); at L−1, H̃ ÷ T", human,
        (k) => (k === -1 ? "L−1 new tasks" : L(k)), "Tᵏ");
      block("Rd", "Hours passed down, Rᵏ(t)", "Rᵏ(t) = H̃ᵏ(t) − Aᵏ(t) × Tᵏ", hr);
      if (sup) {
        block("Sup", "Super attempts, A⁻¹ₛ(t)", `A⁻¹ₛ(t) = R${raised(sup.from)}(t) ÷ T⁻¹: the L−1 attempts made with the hours ${supWho} CBs ` +
          `fell back with. Their tasks go straight to ${destLabel(sup.to)}.`, ["s"], () => "L−1 super attempts");
      }
      block("Lm", "Tasks moved, Lᵏ(t)", sup
        ? `Lᵏ(t) = Σⱼ Aʲ(t) × Y(j→k), with the super attempts going to ${destLabel(sup.to)} instead of by the L−1 row; workable tomorrow`
        : "Lᵏ(t) = Σⱼ Aʲ(t) × Y(j→k), workable tomorrow", out,
        (k) => (k === DONE ? "L12 done" : k === CLEARED ? "L−1 cleared" : L(k)));
      block("S", "Done so far, S(t)", "S(t) = S(t−1) + L¹²(t)", ["S"], () => "Tasks done");
      block("U", "Utilisation, Uᵏ(t)", "Uᵏ(t) = Aᵏ(t) × Tᵏ ÷ H̃ᵏ(t)", hr);
      block("St", "Status", "Starved: Rᵏ > 0. Bottleneck: Rᵏ = 0 and Bᵏ grew.", hr);
      const bottom = r - 2;
      const rowS = row.S.S;

      // What the domain uses: P and its target above, Tᵏ next to each layer's attempts.
      for (const k of human) put(sh, 2, row.A[k], F(ref(I.T[id][k], sh)), st.param);
      const T = (k) => `$B$${row.A[k]}`;
      put(sh, 2, 9, F(`IF(${addr(lastCol, rowS)}>=$B$8-1E-9,COUNTIF(${across(sh, WORK_ROW, sh)},"yes"),"not reached")`), st.big);
      put(sh, 2, 10, F(`IF(ISNUMBER($B$9),${ref(I.start, sh)}+$B$9-1,"not reached")`), st.valueDateStrong);

      for (let t = 1; t <= days; t++) {
        const c = dayCol(t);
        const prev = c - 1;
        const cell = (key, k, col = c) => addr(col, row[key][k]);
        const working = `${colName(c)}$${WORK_ROW}`;
        put(sh, c, WORK_ROW, t === 1 ? "yes" : F(`IF(${addr(prev, rowS)}<$B$8-1E-9,"yes","no")`), st.work);
        for (const k of human) put(sh, c, row.C[k], F(`${quoteSheet(rampSheet.name)}!${addr(c, R.cb[k])}`), st.num);
        for (const k of hr) {
          // Day 1: the tasks waiting on Inputs, plus any waiting at an eval, passed on.
          const start = [ref(I.backlog[id][k], sh), ...evals.map((e) => `${ref(I.backlog[id][e], sh)}*${ref(I.end[e][k], sh)}`)];
          put(sh, c, row.B[k], F(t === 1 ? start.join("+") : `${cell("B", k, prev)}-${cell("A", k, prev)}+${cell("Lm", k, prev)}`), st.num);
        }
        human.forEach((k, h) => {
          const above = human[h + 1];
          put(sh, c, row.H[k], F(`IF(${working}="yes",${cell("C", k)}*$B$7,0)`), st.num);
          put(sh, c, row.Hav[k], F(above === undefined ? cell("H", k) : `${cell("H", k)}+${cell("Rd", above)}`), st.num);
          put(sh, c, row.A[k], F(k === -1 ? `${cell("Hav", k)}/${T(k)}` : `MIN(${cell("Hav", k)}/${T(k)},${cell("B", k)})`), st.num);
          if (k !== -1) put(sh, c, row.Rd[k], F(`${cell("Hav", k)}-${cell("A", k)}*${T(k)}`), st.num);
        });
        if (sup) put(sh, c, row.Sup.s, F(`${cell("Rd", sup.from)}/${T(-1)}`), st.num);
        for (const k of out) {
          // L−1's super attempts skip its row: straight to where they go, or through it when that's an eval.
          const terms = human.map((j) => `${j === -1 && sup ? `(${cell("A", j)}-${cell("Sup", "s")})` : cell("A", j)}*${ref(I.use[j][k], sh)}`);
          if (sup && evals.includes(sup.to)) terms.push(`${cell("Sup", "s")}*${ref(I.end[sup.to][k], sh)}`);
          else if (sup && sup.to === k) terms.push(cell("Sup", "s"));
          // Day 1 also counts tasks that were waiting at an eval and went straight to L12 or back to L−1.
          if (t === 1 && (k === DONE || k === CLEARED)) {
            for (const e of evals) terms.push(`${ref(I.backlog[id][e], sh)}*${ref(I.end[e][k], sh)}`);
          }
          put(sh, c, row.Lm[k], F(terms.join("+")), st.num);
        }
        put(sh, c, rowS, F(t === 1 ? cell("Lm", DONE) : `${addr(prev, rowS)}+${cell("Lm", DONE)}`), st.numStrong);
        for (const k of hr) {
          put(sh, c, row.U[k], F(`IF(${cell("Hav", k)}>1E-12,${cell("A", k)}*${T(k)}/${cell("Hav", k)},"")`), st.pct);
          const [Rk, Bk, Ak, Lk] = [cell("Rd", k), cell("B", k), cell("A", k), cell("Lm", k)];
          put(sh, c, row.St[k],
            F(`IF(${working}="yes",IF(${Rk}>1E-9,"starved",IF(${Bk}-${Ak}+${Lk}>${Bk}+1E-9,"bottleneck","")),"")`), st.centre);
        }
      }

      if (hr.length) {
        const first = row.St[hr[0]];
        const statuses = dayBlock(first, row.St[hr[hr.length - 1]]);
        sh.rule(statuses, `${C}${first}="bottleneck"`, st.cfBottleneck);
        sh.rule(statuses, `${C}${first}="starved"`, st.cfStarved);
      }
      sh.rule(dayBlock(rowS, rowS), `${C}$${DAY_ROW}=$B$9`, st.cfMet);
      sh.rule(dayBlock(DATE_ROW, bottom), `${C}$${WORK_ROW}="no"`, st.cfFaint);
      sh.rule(dayBlock(DATE_ROW, bottom), `WEEKDAY(${C}$${DATE_ROW},2)=1`, st.cfMonday);
      sh.freeze(WORK_ROW, 2);

      return { domain: d, sheet: sh, row, reachDay: at(sh, 2, 9), reachDate: at(sh, 2, 10), target: I.target[id] };
    });

    // Where things are, for the tests.
    const layout = {
      days, dayCol, dateRow: DATE_ROW, dayRow: DAY_ROW, workRow: WORK_ROW,
      ramp: { sheet: rampSheet.name, cb: R.cb, conv: R.conv, all: R.all },
      domains: D.map((x) => ({ id: x.domain.id, sheet: x.sheet.name, row: x.row, reachDay: "B9", reachDate: "B10" })),
    };
    wb.layout = layout;

    // ======================= Plan =======================
    {
      const sh = planSheet;
      sh.gridlines = false;
      leftWidths(sh, 34, 18);
      const when = exportedOn.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      put(sh, 1, 1, "Ramp plan", st.title);
      note(sh, 2, `Exported from the ramp plan app on ${when}. Every number is a live formula: change a blue cell on Inputs and the plan updates.`);

      const reach = D.map((x) => ref(x.reachDay, sh));
      const everyone = `COUNT(${reach.join(",")})=${reach.length}`;
      const latest = `MAX(${reach.join(",")})`;
      const start = ref(I.start, sh);
      const cbsOn = (x) => `INDEX(${across(rampSheet, R.all, sh)},1,` +
        `IF(ISNUMBER(${ref(x.reachDay, sh)}),${ref(x.reachDay, sh)},${ref(I.days, sh)}))`;
      put(sh, 1, 4, split ? "Every target reached on" : "Target reached on", st.lede);
      put(sh, 1, 5, F(`IF(${everyone},${start}+${latest}-1,"Not within ${days} days")`), st.hero);
      sh.height(5, 28);
      put(sh, 1, 7, "Day of the plan", st.text);
      put(sh, 2, 7, F(`IF(${everyone},${latest},"–")`), st.value);
      put(sh, 1, 8, "Plan starts (day 1)", st.text);
      put(sh, 2, 8, F(start), st.valueDate);
      put(sh, 1, 9, split ? "Tasks to reach L12, all domains" : "Tasks to reach L12", st.text);
      put(sh, 2, 9, F(`SUM(${D.map((x) => ref(x.target, sh)).join(",")})`), st.value);
      put(sh, 1, 10, split ? "CBs when each domain finishes" : "CBs working by then", st.text);
      put(sh, 2, 10, F(D.map(cbsOn).join("+")), st.valueNum);
      const lastDay = `IF(ISNUMBER($B$7),$B$7,${ref(I.days, sh)})`;

      // The rows of the app's day-by-day table, each as that day's number and the total so far.
      let r = 12;
      put(sh, 1, r++, "Day by day", st.section);
      note(sh, r++, "The rows of the app's day-by-day table, one column per day up to the day the target is reached, with " +
        "Mondays shaded. Each row shows that day's number and the total so far.");
      const dateRow = r++;
      const dayRow = r++;
      dateRows(sh, dateRow, dayRow);
      const table = { dateRow, dayRow, cb: {}, all: null, tasks: [] };
      const group = (title) => {
        r++;
        put(sh, 1, r, title, st.band);
        put(sh, 2, r++, null, st.band);
      };
      // Two rows: what happened that day, and the total so far.
      const pair = (label, words, strong) => {
        const rows = { each: r, total: r + 1 };
        put(sh, 1, r, label, strong ? st.labelStrong : st.label);
        put(sh, 2, r++, words[0], st.labelMuted);
        put(sh, 2, r++, words[1], st.labelMuted);
        return rows;
      };
      group(split ? "CBs per domain" : "CBs");
      const cbs = (label, from, strong) => {
        const rows = pair(label, ["change", "total"], strong);
        for (let t = 1; t <= days; t++) {
          const c = dayCol(t);
          put(sh, c, rows.total, F(`${quoteSheet(rampSheet.name)}!${addr(c, from)}`), strong ? st.numStrong : st.num);
          put(sh, c, rows.each, F(t === 1 ? addr(c, rows.total) : `${addr(c, rows.total)}-${addr(c - 1, rows.total)}`), st.change);
        }
        return rows;
      };
      for (const k of human) table.cb[k] = cbs(L(k), R.cb[k], false);
      table.all = cbs("All", R.all, true);
      const tasks = (title, list) => {
        group(title);
        const created = pair("Created", ["that day", "so far"], false);
        const supers = sup ? pair("Super attempts", ["that day", "so far"], false) : null;
        const done = pair("Done", ["that day", "so far"], false);
        for (let t = 1; t <= days; t++) {
          const c = dayCol(t);
          const sum = (rowOf) => list.map((x) => `${quoteSheet(x.sheet.name)}!${addr(c, rowOf(x))}`).join("+");
          put(sh, c, created.each, F(sum((x) => x.row.A[-1])), st.numMuted);
          put(sh, c, created.total, F(t === 1 ? addr(c, created.each) : `${addr(c - 1, created.total)}+${addr(c, created.each)}`), st.num);
          if (supers) {
            put(sh, c, supers.each, F(sum((x) => x.row.Sup.s)), st.numMuted);
            put(sh, c, supers.total, F(t === 1 ? addr(c, supers.each) : `${addr(c - 1, supers.total)}+${addr(c, supers.each)}`), st.num);
          }
          put(sh, c, done.each, F(sum((x) => x.row.Lm[DONE])), st.numMuted);
          put(sh, c, done.total, F(sum((x) => x.row.S.S)), st.numStrong);
        }
        table.tasks.push({ ids: list.map((x) => x.domain.id), created, supers, done });
      };
      tasks(split ? "Tasks, all domains" : "Tasks", D);
      if (split) for (const x of D) tasks(`Tasks, ${x.domain.name}`, [x]);
      const tableEnd = r - 1;
      sh.rule(dayBlock(dateRow, tableEnd), `${C}$${dayRow}>IF(ISNUMBER($B$7),$B$7,${days})`, st.cfFaint);
      sh.rule(dayBlock(dateRow, tableEnd), `WEEKDAY(${C}$${dateRow},2)=1`, st.cfMonday);

      const metTarget = {};
      if (split) {
        r++;
        put(sh, 1, r++, "By domain", st.section);
        ["Domain", "Task target", "Target reached on", "Day", "CBs that day"].forEach((h, i) => put(sh, 1 + i, r, h, i ? st.head : st.headLeft));
        r++;
        for (const x of D) {
          put(sh, 1, r, x.domain.name, st.rowHead);
          put(sh, 2, r, F(ref(x.target, sh)), st.plain);
          put(sh, 3, r, F(ref(x.reachDate, sh)), st.shortDate);
          put(sh, 4, r, F(ref(x.reachDay, sh)), st.plain);
          put(sh, 5, r, F(cbsOn(x)), st.num);
          metTarget[x.domain.id] = `$B$${r}`;
          r++;
        }
      } else {
        metTarget[D[0].domain.id] = "$B$9";
      }

      r++;
      put(sh, 1, r++, "Every Monday", st.section);
      note(sh, r++, "Tasks created count the week up to and including that Monday. The last row is the final delivery, the day " +
        (split ? "every domain reaches its target" : "the target is reached") + ", counting the days since the Monday before it.");
      if (split) {
        D.forEach((x, i) => span(sh, 3 + 2 * i, 4 + 2 * i, r, x.domain.name, st.head));
        span(sh, 3 + 2 * D.length, 4 + 2 * D.length, r, "All domains", st.head);
        r++;
      }
      put(sh, 1, r, "Monday", st.headLeft);
      put(sh, 2, r, "Day", st.head);
      if (split) {
        for (let i = 0; i <= D.length; i++) {
          put(sh, 3 + 2 * i, r, "Created that week", st.head);
          put(sh, 4 + 2 * i, r, "Done by end of day", st.head);
        }
      } else {
        ["Created that week", "Done by end of day", "Of the target"].forEach((h, i) => put(sh, 3 + i, r, h, st.head));
      }
      const noteCol = split ? 5 + 2 * D.length : 6;
      r++;
      // Every Monday up to the end, then the final delivery when it isn't on a Monday (only it can fall on another day).
      const rows = Math.floor((days - 1) / 7) + 2;
      const firstMonday = `1+MOD(8-WEEKDAY(${start},2),7)`;
      const final = "$B$7";
      const firstRow = r;
      for (let i = 0; i < rows; i++, r++) {
        const dayCell = `$B${r}`;
        const before = `$B${r - 1}`;
        put(sh, 2, r, F(i === 0
          ? `IF(${firstMonday}<=${lastDay},${firstMonday},IF(ISNUMBER(${final}),${final},""))`
          : `IF(${before}="","",IF(WEEKDAY(${start}+${before}-1,2)<>1,"",IF(${before}+7<=${lastDay},${before}+7,` +
            `IF(AND(ISNUMBER(${final}),${final}>${before}),${final},""))))`), st.plain);
        put(sh, 1, r, F(`IF(${dayCell}="","",${start}+${dayCell}-1)`), st.date);
        const blankOr = (formula) => F(`IF(${dayCell}="","",${formula})`);
        // Tasks created since the row before (the whole week for a Monday, the days since the last Monday for the final delivery).
        const created = (x) => {
          const dayNumbers = across(x.sheet, DAY_ROW, sh);
          const from = i === 0 ? "1" : `(${before}+1)`;
          return `SUMIFS(${across(x.sheet, x.row.A[-1], sh)},${dayNumbers},">="&${from},${dayNumbers},"<="&${dayCell})`;
        };
        const done = (x) => `INDEX(${across(x.sheet, x.row.S.S, sh)},1,${dayCell})`;
        if (split) {
          D.forEach((x, j) => {
            put(sh, 3 + 2 * j, r, blankOr(created(x)), st.num);
            put(sh, 4 + 2 * j, r, blankOr(done(x)), st.num);
          });
          const sum = (offset) => D.map((x, j) => addr(offset + 2 * j, r)).join("+");
          put(sh, 3 + 2 * D.length, r, blankOr(sum(3)), st.num);
          put(sh, 4 + 2 * D.length, r, blankOr(sum(4)), st.num);
        } else {
          put(sh, 3, r, blankOr(created(D[0])), st.num);
          put(sh, 4, r, blankOr(done(D[0])), st.num);
          put(sh, 5, r, blankOr(`MIN(1,${addr(4, r)}/${metTarget[D[0].domain.id]})`), st.pct);
        }
        put(sh, noteCol, r, F(`IF(AND(ISNUMBER(${final}),${dayCell}=${final}),"Final delivery: ${split ? "every target" : "target"} reached","")`), st.strong);
      }
      // Done by the end of a Monday, once the target is met.
      D.forEach((x, j) => {
        const c = colName(split ? 4 + 2 * j : 4);
        sh.rule(`${c}${firstRow}:${c}${r - 1}`, `AND(ISNUMBER(${c}${firstRow}),${c}${firstRow}>=${metTarget[x.domain.id]}-1E-9)`, st.cfMet);
      });
      // The final delivery's row in bold (after the rule above, which wins where both apply).
      sh.rule(`A${firstRow}:${colName(noteCol)}${r - 1}`, `AND(ISNUMBER(${final}),$B${firstRow}=${final})`, st.cfFinal);

      r++;
      put(sh, 1, r++, "In this workbook", st.section);
      for (const line of [
        "How it works: the model's equations in plain words, and where each one is worked out.",
        "Inputs: every number you can change, in blue.",
        "CB ramp: how many CBs can work each layer, one column per day.",
        split ? `${D.map((x) => x.sheet.name).join(", ")}: the model day by day, one sheet per domain, one column per day.`
          : "Day by day: the model, one column per day.",
      ]) note(sh, r++, line, st.wrap);
      sh.freeze(0, 2);
      layout.plan = { sheet: sh.name, hero: "A5", day: "B7", firstMonday: firstRow, mondays: rows, noteCol, split, table };
    }

    // ======================= How it works =======================
    {
      const sh = howSheet;
      sh.gridlines = false;
      const widths = [24, 40, 70, 30];
      widths.forEach((w, i) => sh.width(i + 1, w));
      const total = widths.reduce((a, b) => a + b, 0);
      let r = 1;
      put(sh, 1, r++, "How it works", st.title);
      const para = (text, style = st.wrap) => {
        span(sh, 1, 4, r, text, style);
        sh.height(r, heightFor(lineCount(text, total)));
        r++;
      };
      const section = (title) => { r++; put(sh, 1, r++, title, st.section); };
      const table = (rows) => {
        ["What", "Equation", "In plain words", "Where to see it"].forEach((h, i) => put(sh, 1 + i, r, h, st.headLeft));
        r++;
        for (const row of rows) {
          const styles = [st.wrapStrong, st.wrapEq, st.wrap, st.wrapMuted];
          row.forEach((text, i) => put(sh, 1 + i, r, text, styles[i]));
          sh.height(r, heightFor(Math.max(...row.map((text, i) => lineCount(text, widths[i])))));
          r++;
        }
      };

      para("The in-system ramp model from “In System Ramp Plan” (Z. Decker, September 2026), as this workbook works it out. " +
        "Days run across, one column each, like the app's timeline, up to the day the target is reached. Each equation below " +
        "is a live formula on the sheet it points to.",
        st.wrapMuted);

      section("The pipeline");
      const names = ["L−1 (new tasks)", ...review.map((k) => L(k) + (evals.includes(k) ? " (eval)" : "")), "L12 (done)"];
      para("Tasks are created at L−1, which never runs out, and are done when they reach L12. After every attempt a task moves on " +
        "by the yields on Inputs: up a layer, back to a lower layer, or back to L−1, which clears it. Tasks moved today can be worked tomorrow.");
      para(`This plan's layers: ${listed(names)}.`);
      para("CBs whose highest layer is k can work layer k or any layer below it. Each day the highest layer goes first; hours a layer " +
        "can't use fall back to the next human layer down, and L−1 takes whatever is left.");
      if (evals.length) {
        para("Evals take no CB time. A task that lands on an eval moves on the same day by the eval's own yields, so the model folds " +
          "the evals into the yields of the layers that feed them: “Yields the model uses” on Inputs.");
      }
      if (split) {
        para("Each domain runs on its own, with its own CBs (each domain gets the same ramp), tasks waiting, target and hours. " +
          "The yields are shared.");
      }

      section("CBs and the ramp");
      const base = L(M.SHARE_BASE);
      const rampRows = [
        ["CBs at a layer", "Cᵏ(t)", "CBs whose highest layer is k on day t, from the starting counts on Inputs.", "CB ramp: CBs at the end of the day"],
        ["New CBs", "L−1 after joining = max(0, C⁻¹(t−1) + joining)",
          "From day 2, a set number of new CBs join L−1 each day, by the L−1 periods on Inputs. Below 0, CBs leave.",
          "CB ramp: new CBs at L−1"],
      ];
      if (hr.length) {
        rampRows.push(["Conversions", "converted into k = min(planned, CBs at k⁻)",
          "Each review layer converts CBs up from the human layer just below it, never more than that layer has. Layers convert " +
          "highest first, so nobody moves up more than one layer a day.", "CB ramp: converted up"]);
      }
      if (hr.some((k) => I.periods[k].some((p) => p.kind === "share"))) {
        rampRows.push([`A % of ${base}`,
          `target = max(1, round(% × C⁰(t−1)));\nplanned = max(0, target − (Cᵏ(t−1) − converted out of k))`,
          `Instead of a set number, a review layer can keep a % of the CBs ${base} had the day before, rounded to whole CBs and ` +
          "never below 1. Each day it plans to convert as many as it takes to get there, counting what it has left once the layer " +
          `above has converted some of its CBs up. At ${base} itself, 100% holds it steady and more grows it.`,
          "CB ramp: target, planned and converted"]);
      }
      rampRows.push(["CBs each day", "Cᵏ(t) = Cᵏ(t−1) + converted into k − converted out of k",
        "L−1 starts from its count after joining.", "CB ramp: CBs at the end of the day"]);
      table(rampRows);

      section("Each day, highest layer first");
      table([
        ["Working", "S(t−1) < target", "A domain works until it reaches its target, then stops.", `${dayWhere}: working`],
        ["Own hours", "Hᵏ(t) = Cᵏ(t) × P", "Each CB works P hours a day.", `${dayWhere}: own hours`],
        ["Hours available", "H̃ᵏ(t) = Hᵏ(t) + Rᵏ⁺(t)",
          "A layer's own hours plus the hours the human layer above it couldn't use. The top layer gets none passed down.",
          `${dayWhere}: hours available`],
        ["Attempts", "Aᵏ(t) = min(H̃ᵏ(t) ÷ Tᵏ, Bᵏ(t))", "As many attempts as the hours allow, but no more than the tasks waiting.",
          `${dayWhere}: attempts`],
        ["Hours passed down", "Rᵏ(t) = H̃ᵏ(t) − Aᵏ(t) × Tᵏ", "What a layer can't use falls back to the next human layer down.",
          `${dayWhere}: hours passed down`],
        ["New tasks", "A⁻¹(t) = H̃⁻¹(t) ÷ T⁻¹",
          "L−1 never runs out, so it uses every hour that's left. Each of these attempts creates a task.", `${dayWhere}: attempts, L−1`],
        ...(sup ? [["Super attempts", `A⁻¹ₛ(t) = R${raised(sup.from)}(t) ÷ T⁻¹`,
          `${supWho} attempters are super attempters. The hours they fall back to L−1 with make super attempts, whose tasks go ` +
          `straight to ${destLabel(sup.to)} instead of by the L−1 row.`, `${dayWhere}: super attempts`]] : []),
        ["Tasks moved", sup ? `Lᵏ(t) = Σⱼ Aʲ(t) × Y(j→k), super attempts to ${L(sup.to)}` : "Lᵏ(t) = Σⱼ Aʲ(t) × Y(j→k)",
          "Every attempt sends its task on by the yields" + (sup ? `, except super attempts, which go to ${destLabel(sup.to)}` : "") +
          ". Moved tasks can be worked the next day.", `${dayWhere}: tasks moved`],
        ["Tasks waiting", "Bᵏ(t+1) = Bᵏ(t) − Aᵏ(t) + Lᵏ(t)",
          "Tomorrow's queue is today's, minus what was attempted, plus what arrived. Day 1 starts with the tasks waiting on Inputs.",
          `${dayWhere}: tasks waiting`],
        ["Done", "S(t) = S(t−1) + L¹²(t)", "Tasks that reach L12 are done; S adds them up.", `${dayWhere}: tasks moved to L12, done so far`],
      ]);

      section("Outputs and diagnostics");
      table([
        ["Utilisation", "Uᵏ(t) = Aᵏ(t) × Tᵏ ÷ H̃ᵏ(t)", "The share of a layer's available hours spent on its own tasks.", `${dayWhere}: utilisation`],
        ["Starved", "Rᵏ(t) > 0", "The layer ran out of tasks and passed hours down, so it has more CBs than it needs.", `${dayWhere}: status`],
        ["Bottleneck", "Rᵏ(t) = 0 and Bᵏ(t+1) > Bᵏ(t)", "No hours to spare, and its queue grew. More CBs here would speed things up.",
          `${dayWhere}: status`],
        ["Target reached", "the first day S(t) ≥ target", "The plan is done on the day the last domain reaches its target.",
          "Plan, and the top of each day-by-day sheet"],
      ]);

      section("Symbols");
      const symbols = [
        ["k", "A layer. k⁺ is the next human layer up and k⁻ the next one down; evals are skipped, as they take no CB time."],
        ["t", "The day of the plan, from 1."],
        ["P", "Hours per CB per day."],
        ["Tᵏ", "Hours per attempt at layer k."],
        ["Y(j→k)", "The share of the tasks attempted at layer j that move to layer k."],
        ["Bᵏ(0)", "Tasks waiting at layer k on day 1."],
      ];
      for (const [symbol, meaning] of symbols) {
        put(sh, 1, r, symbol, st.wrapStrong);
        span(sh, 2, 4, r, meaning, st.wrap);
        r++;
      }
    }

    if (results) {
      const ev = Eval.evaluator(wb);
      ev.all([inSheet, rampSheet, ...daySheets, planSheet, howSheet].map((sheet) => sheet.name));
      for (const sheet of wb.sheets) {
        for (const [ref, cell] of sheet.cells) {
          if (cell.value && typeof cell.value === "object") cell.value.result = ev.result(sheet.name, ref);
        }
      }
    }
    return wb;
  }

  // The file name: "Ramp plan 2026-10-24.xlsx", after the plan's first day.
  const fileName = (check) => `Ramp plan ${check.values.startDate}.xlsx`;

  const RampExport = { build, fileName };
  if (inNode) module.exports = RampExport;
  else root.RampExport = RampExport;
})(typeof window !== "undefined" ? window : globalThis);
