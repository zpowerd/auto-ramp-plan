/*
 * Ramp plan inputs: the layers, example values and input checks, following
 * "In System Ramp Plan" (Z. Decker, Sept 2026). No page code in here, so the
 * simulation step can reuse it, and it also runs under Node for quick checks.
 */
(function (root) {
  "use strict";

  const REVIEW_OPTIONS = [0, 1, 4, 8, 10];          // review layers a pipeline can use
  const WORKING = [-1, ...REVIEW_OPTIONS];          // every layer where attempts can happen
  const DESTINATIONS = [-1, ...REVIEW_OPTIONS, 12]; // every layer a task can move to; back to −1 clears it
  const DONE = 12;
  const DISCARD = -1;
  const ONE_POOL = "all"; // domain id when contributors and tasks aren't split by domain
  const VERSION = 12;

  // "L−1", "L0", … (true minus sign, as in the model doc)
  const name = (k) => "L" + (k < 0 ? "−" + -k : k);

  // The layers this pipeline uses, limited to the review layers switched on. A task can move to
  // any of them, to L12, or back to L−1, which clears it (L−1 has unlimited supply anyway).
  // Evals are review layers with no people in them: they take no contributor time and happen instantly.
  // `human` lists the layers contributors actually work, which is where their hours fall back through.
  function layersOf(inputs) {
    const review = REVIEW_OPTIONS.filter((k) => inputs?.layers?.[k] !== false);
    const evals = review.filter((k) => inputs?.evals?.[k] === true);
    return {
      review,
      working: [-1, ...review],
      destinations: [DISCARD, ...review, DONE],
      evals,
      human: [-1, ...review.filter((k) => !evals.includes(k))],
    };
  }

  // The domains contributors and tasks are split into, or a single pool for everyone.
  function domainsOf(inputs) {
    if (!inputs?.domains?.split) return [{ id: ONE_POOL, name: "All tasks" }];
    return (inputs.domains.list ?? []).map((d) => ({ id: d.id, name: d.name ?? "" }));
  }

  // A short id that no other domain uses (and that isn't the one-pool id).
  function newDomainId(inputs) {
    const taken = new Set((inputs?.domains?.list ?? []).map((d) => d.id));
    let id;
    do id = "d" + Math.random().toString(36).slice(2, 8); while (taken.has(id));
    return id;
  }

  const blankBacklog = () => Object.fromEntries(REVIEW_OPTIONS.map((k) => [k, ""]));
  // A domain's own assumptions; blank means "same as the default".
  const blankOverrides = () => ({ hoursPerDay: "", attemptHours: Object.fromEntries(WORKING.map((k) => [k, ""])) });

  // Example values: every review layer on, one pool, and every attempt moves the task one layer up.
  function exampleInputs() {
    const layers = {};
    for (const k of REVIEW_OPTIONS) layers[k] = true;
    const oneUp = [...REVIEW_OPTIONS, DONE];
    const moves = {};
    WORKING.forEach((from, i) => {
      moves[from] = {};
      for (const to of DESTINATIONS) moves[from][to] = to === oneUp[i] ? "100" : "";
    });
    return {
      version: VERSION,
      layers,
      startDate: "",                     // day 1 of the plan as "YYYY-MM-DD"; blank = tomorrow, moving forward each day
      evals: {},                         // review layers that are evals: { [layer]: true }
      // CBs at L0 and above whose spare hours fall back to L−1 are super attempters: the tasks they create there skip the
      // L−1 row and go straight to `to` (a review layer, or L12).
      superAttempts: { on: true, to: DONE },
      domains: { split: false, list: [] },
      hoursPerDay: "4",
      attemptHours: { "-1": "3", 0: "1", 1: "1", 4: "0.5", 8: "1", 10: "1" },
      targets: { [ONE_POOL]: "100" },          // tasks that need to reach L12, per domain id
      backlog: { [ONE_POOL]: blankBacklog() }, // tasks waiting on day 1, per domain id and layer
      overrides: {},                           // per domain id: its own P and T^k, blank = the default above
      // The CB ramp. New CBs join the project at L−1; review layers fill up by converting CBs from the layer below.
      // `start`: CBs at each layer on day 1 (counted by the highest layer they can work).
      // `periods`: from day 2, a chain of periods per layer; the last one runs until the end.
      //   L−1: how many join each day, a set number in each period.
      //   Review layers: how many are converted up into the layer each day, a set number or enough to keep a % of L0.
      // The defaults convert fewer CBs at each step up, so every review layer grows by about one a day.
      ramp: {
        start: Object.fromEntries(WORKING.map((k) => [k, k === -1 ? "50" : "0"])),
        periods: {
          "-1": [newPeriod("add", "2")],
          0: [newPeriod("convert", "5")],
          1: [newPeriod("convert", "4")],
          4: [newPeriod("convert", "3")],
          8: [newPeriod("convert", "2")],
          10: [newPeriod("convert", "1")],
        },
      },
      moves,
    };
  }

  // How a ramp period adds CBs to a layer:
  //   linear  a set number every day: CBs joining L−1 (below 0, CBs leave), or converted up into a review layer
  //   share   (review layers) as many converted up as it takes to keep a % of L0's CBs, at least 1. At L0 itself, 100%
  //           holds it steady (it refills what moved up a layer) and more grows it.
  const JOIN = { id: "add", label: "Add a set number a day", kind: "linear" };
  const CONVERT_PRESETS = [
    { id: "convert", label: "Convert a set number", kind: "linear" },
    { id: "share", label: "Keep a % of L0", kind: "share" },
  ];
  const CONVERT = CONVERT_PRESETS[0];
  const SHARE = CONVERT_PRESETS[1];
  const SHARE_BASE = 0; // the layer a share is a % of
  // The preset a layer's period uses: L−1 only adds a set number; a share needs L0 or a review layer above it.
  const presetOf = (k, id) => (k === -1 ? JOIN : k >= SHARE_BASE && id === SHARE.id ? SHARE : CONVERT);
  function newPeriod(preset, amount = "") { return { preset, amount, days: "" }; }

  // A share's CBs: the % of L0's CBs (from the day before) as whole CBs, rounding halves up, and at least 1.
  // The 1e-9 keeps floating point from dropping a half (14.5% of 100 works out to 14.499999999999998);
  // the export's formula adds the same, so every spreadsheet rounds it the same way.
  function shareTarget(rate, base) {
    return Math.max(1, Math.round((rate / 100) * Math.max(0, base) + 1e-9));
  }

  // Plan days count from tomorrow (day 1). Dates are local "YYYY-MM-DD".
  function midday(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const isoOf = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  function isoForDay(day, today = new Date()) {
    const d = midday(today);
    d.setDate(d.getDate() + day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dayForIso(iso, today = new Date()) {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round((new Date(y, m - 1, d, 12) - midday(today)) / 86400000);
  }

  // Reads a typed value: "12", "0.5", "1,250", "40%". NaN if it isn't a number.
  function toNumber(text) {
    const s = String(text ?? "").trim().replace(/,/g, "").replace(/%$/, "").trim();
    return /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
  }

  // 33.3333 -> "33.33", 70 -> "70"
  const formatNumber = (n) => String(Math.round(n * 100) / 100);

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Checks one typed value. Returns the number, or records the problem and returns NaN.
  function read(text, rule, errors) {
    const { field, what, required = false, positive = false, negative = false, whole = false, max, maxLabel = String(max) } = rule;
    if (String(text ?? "").trim() === "") {
      if (!required) return 0;
      errors.push({ field, message: `Enter ${what}.` });
      return NaN;
    }
    const n = toNumber(text);
    let problem = "";
    if (Number.isNaN(n)) problem = "needs to be a number";
    else if (positive && n <= 0) problem = "needs to be more than 0";
    else if (!negative && n < 0) problem = "can't be negative";
    else if (whole && !Number.isInteger(n)) problem = "needs to be a whole number";
    else if (max !== undefined && n > max) problem = `can't be more than ${maxLabel}`;
    if (!problem) return n;
    errors.push({ field, message: `${capitalize(what)} ${problem}.` });
    return NaN;
  }

  // "L1", "L1 and L4", "L1, L4 and L8"
  const joinNames = (layers, word) => {
    const names = layers.map(name);
    return names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + ` ${word} ` + names[names.length - 1];
  };

  // Layers that never get any tasks, tasks that never leave, and pipelines where nothing reaches L12.
  function flowWarnings(values, { review, destinations }) {
    // Moves that keep a task in the pipeline. Back to L−1 clears it: a way out, not a move to follow.
    // New tasks can also go where super attempts go.
    const superTo = values.superAttempts?.on && Number.isFinite(values.superAttempts.to) ? [values.superAttempts.to] : [];
    const next = (k) => (k === DONE ? [] : [...destinations.filter((to) => to !== DISCARD && values.moves[k][to] > 0),
      ...(k === -1 ? superTo : [])]);
    const discards = (k) => k !== DONE && values.moves[k][DISCARD] > 0;
    const reach = (start) => {
      const seen = new Set([start]);
      for (const queue = [start]; queue.length; ) {
        for (const to of next(queue.shift())) {
          if (!seen.has(to)) { seen.add(to); queue.push(to); }
        }
      }
      return seen;
    };
    const inUse = reach(-1);
    for (const k of review) if (values.backlog[k] > 0) reach(k).forEach((x) => inUse.add(x));
    const warnings = [];

    // Stuck: layers whose tasks can't reach L12 and are never cleared on the way, so they loop forever.
    const canLeave = (k) => [...reach(k)].some((m) => m === DONE || discards(m));
    const stuck = [...inUse].filter((k) => k !== DONE && !canLeave(k)).sort((a, b) => a - b);
    // Where they loop: layers that every layer they lead to leads back to.
    const loop = stuck.filter((k) => [...reach(k)].every((m) => reach(m).has(k)));
    const looping = loop.length === 1 ? `looping in ${name(loop[0])}` : `looping between ${joinNames(loop, "and")}`;
    if (stuck.includes(-1)) {
      // Every later layer sits idle as a result, so this is the only thing worth saying.
      return [{ field: `row:${loop[0]}`, message: `New tasks never get to ${name(DONE)}. They end up ${looping}.` }];
    }

    if (!reach(-1).has(DONE)) {
      const loopsOnTheWay = stuck.some((k) => reach(-1).has(k));
      warnings.push({
        field: "row:-1",
        message: loopsOnTheWay
          ? `No task ever gets to ${name(DONE)}.`
          : `No task ever gets to ${name(DONE)}. Every path sends tasks back to ${name(-1)} first.`,
      });
    }

    if (stuck.length) {
      // Where they enter: stuck layers fed by a layer that can still leave, or holding a starting backlog.
      const entries = stuck.filter((k) => values.backlog[k] > 0 ||
        [...inUse].some((j) => !stuck.includes(j) && j !== DONE && values.moves[j][k] > 0));
      warnings.push({
        field: `row:${loop[0]}`,
        message: `Tasks that reach ${joinNames(entries.length ? entries : stuck, "or")} never get to ${name(DONE)}. They end up ${looping}.`,
      });
    }

    const idle = review.filter((k) => !inUse.has(k));
    if (idle.length) {
      warnings.push({
        field: `col:${idle[0]}`,
        message: `No tasks move to ${joinNames(idle, "or")}, so ${idle.length === 1 ? "it never gets" : "they never get"} any work.`,
      });
    }
    return warnings;
  }

  /*
   * Checks every input for the layers that are switched on. Returns
   *   errors   [{ field, message }]  must be fixed before the plan can run
   *   warnings [{ field, message }]  allowed, but probably not what was meant
   *   rows     { [layer]: { total, gap, state: "ok" | "under" | "over" | "invalid" } }
   *   values   the inputs as numbers: P, T^k, Y^(j,k) as proportions, the domains,
   *            B^k(0) per domain (backlogByDomain) and summed over domains (backlog)
   *   layers   { review, working, destinations } in use
   */
  function validate(inputs, today = new Date()) {
    const layers = layersOf(inputs);
    const { review, working, destinations } = layers;
    const errors = [];
    const warnings = [];
    const rows = {};
    const values = {
      hoursPerDay: NaN, attemptHours: {}, moves: {},
      domains: [], targets: {}, totalTarget: 0, backlogByDomain: {}, backlog: {},
      byDomain: {}, // per domain id: the P and T^k it actually uses (its own, or the default)
    };

    values.hoursPerDay = read(inputs.hoursPerDay,
      { field: "hoursPerDay", what: "hours per contributor per day", required: true, positive: true, max: 24 }, errors);

    // Day 1 of the plan: a date the person picked, or tomorrow (moving forward each day) when it's left blank.
    const tomorrow = midday(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let start = tomorrow;
    const picked = String(inputs.startDate ?? "").trim();
    if (picked) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(picked);
      const date = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
      if (!date || date.getMonth() !== Number(m[2]) - 1) errors.push({ field: "startDate", message: "Enter the start date as a full date." });
      else start = date;
    }
    values.startDate = isoOf(start);
    values.startIsTomorrow = values.startDate === isoOf(tomorrow);

    // The CB ramp, for each layer people work: day 1, then each period in turn.
    values.ramp = { start: {}, periods: {} };
    const baseIsHuman = layers.human.includes(SHARE_BASE);
    for (const k of layers.human) {
      values.ramp.start[k] = read(inputs.ramp?.start?.[k],
        { field: `rampStart:${k}`, what: `the CBs at ${name(k)} on day 1`, required: true }, errors);

      const joining = k === -1;
      const periods = inputs.ramp?.periods?.[k] ?? [];
      values.ramp.periods[k] = periods.map((p, i) => {
        const preset = presetOf(k, p.preset);
        const period = { kind: preset.kind, perDay: 0, rate: 0, days: Infinity };
        const field = `rampAmount:${k}:${i}`;
        if (preset === SHARE && !baseIsHuman) {
          // L0 switched off, or an eval: it has no CBs to take a % of, whatever the number.
          const why = layers.review.includes(SHARE_BASE) ? "is an eval, so it has no CBs" : "isn't in the pipeline";
          errors.push({ field, message: `Period ${i + 1} at ${name(k)} keeps a % of ${name(SHARE_BASE)}, but ${name(SHARE_BASE)} ${why}. ` +
            "Convert a set number a day instead." });
          period.rate = NaN;
        } else if (preset === SHARE) {
          period.rate = read(p.amount, { field, what: `the % of ${name(SHARE_BASE)} that ${name(k)} keeps in period ${i + 1}`, required: true }, errors);
        } else {
          // CBs can leave L−1 (a negative number), but nobody is converted back down.
          period.perDay = read(p.amount, {
            field,
            what: joining ? `how many CBs join each day in period ${i + 1}` : `how many CBs are converted to ${name(k)} each day in period ${i + 1}`,
            required: true,
            negative: joining,
          }, errors);
        }
        // The last period runs until the end; the others need a length.
        if (i < periods.length - 1) {
          period.days = read(p.days,
            { field: `rampDays:${k}:${i}`, what: `how many days period ${i + 1} at ${name(k)} lasts`, required: true, positive: true, whole: true }, errors);
        }
        return period;
      });
    }

    // Super attempts: hours CBs at L0 and above fall back to L−1 with make tasks that go straight to `to`.
    // `from` is the lowest human review layer, whose spare hours are the ones that reach L−1; with none, there are no super attempts.
    const lowest = layers.human[1];
    values.superAttempts = { on: inputs.superAttempts?.on === true && lowest !== undefined, to: NaN, from: lowest };
    if (values.superAttempts.on) {
      const raw = inputs.superAttempts.to;
      const to = raw === "" || raw === null || raw === undefined ? NaN : Number(raw);
      if ([...review, DONE].includes(to)) values.superAttempts.to = to;
      else {
        errors.push({ field: "superTo", message: REVIEW_OPTIONS.includes(to)
          ? `Super attempts go to ${name(to)}, which isn't in the pipeline. Pick another layer.`
          : "Pick the layer super attempts go to." });
      }
    }

    const isEval = (k) => layers.evals.includes(k);
    for (const k of working) {
      values.attemptHours[k] = isEval(k) ? 0 : read(inputs.attemptHours?.[k],
        { field: `attemptHours:${k}`, what: `hours per attempt in ${name(k)}`, required: true, positive: true }, errors);
    }
    const split = Boolean(inputs.domains?.split);
    const domains = domainsOf(inputs);
    if (split) {
      if (domains.length === 0) errors.push({ field: "domains", message: "Add a domain, or switch back to one pool for everyone." });
      const seen = new Set();
      domains.forEach((d, i) => {
        const label = d.name.trim();
        if (!label) errors.push({ field: `domainName:${d.id}`, message: `Name domain ${i + 1}.` });
        else if (seen.has(label.toLowerCase())) errors.push({ field: `domainName:${d.id}`, message: `Two domains are called ${label}.` });
        seen.add(label.toLowerCase());
      });
    }
    values.domains = domains.map((d) => ({ id: d.id, name: d.name.trim() }));
    for (const k of review) values.backlog[k] = 0;
    domains.forEach((d, i) => {
      const label = d.name.trim() || `domain ${i + 1}`;
      values.targets[d.id] = read(inputs.targets?.[d.id],
        { field: `target:${d.id}`, what: split ? `the task target for ${label}` : "the task target", required: true, positive: true }, errors);
      if (Number.isFinite(values.targets[d.id])) values.totalTarget += values.targets[d.id];

      // Its own assumptions where it has them, the defaults everywhere else.
      const own = split ? inputs.overrides?.[d.id] : null;
      const ownOr = (text, rule, fallback) => (String(text ?? "").trim() === "" ? fallback : read(text, rule, errors));
      values.byDomain[d.id] = {
        hoursPerDay: ownOr(own?.hoursPerDay,
          { field: `domainHours:${d.id}`, what: `hours per contributor per day in ${label}`, positive: true, max: 24 }, values.hoursPerDay),
        attemptHours: Object.fromEntries(working.map((k) => [k, isEval(k) ? 0 : ownOr(own?.attemptHours?.[k],
          { field: `domainAttempt:${d.id}:${k}`, what: `hours per attempt in ${name(k)} for ${label}`, positive: true }, values.attemptHours[k])])),
      };

      values.backlogByDomain[d.id] = {};
      const where = split ? ` in ${label}` : "";
      for (const k of review) {
        const n = read(inputs.backlog?.[d.id]?.[k],
          { field: `backlog:${d.id}:${k}`, what: `the ${name(k)} starting backlog${where}` }, errors);
        values.backlogByDomain[d.id][k] = n;
        if (Number.isFinite(n)) values.backlog[k] += n;
      }
    });

    let movesOk = true;
    for (const from of working) {
      let total = 0;
      let readable = true;
      values.moves[from] = {};
      for (const to of destinations) {
        const pct = read(inputs.moves?.[from]?.[to],
          { field: `moves:${from}:${to}`, what: `the ${name(from)} to ${name(to)} share`, max: 100, maxLabel: "100%" }, errors);
        if (Number.isNaN(pct)) readable = false;
        else total += pct;
        values.moves[from][to] = Number.isNaN(pct) ? 0 : pct / 100;
      }
      total = Math.round(total * 1e6) / 1e6;
      const gap = Math.abs(100 - total);
      let state = "ok";
      if (!readable) state = "invalid";
      else if (gap > 0.01) {
        state = total < 100 ? "under" : "over";
        errors.push({
          field: `row:${from}`,
          message: state === "under"
            ? `The ${name(from)} row adds up to ${formatNumber(total)}%. Place the other ${formatNumber(gap)}%.`
            : `The ${name(from)} row adds up to ${formatNumber(total)}%. Take off ${formatNumber(gap)}%.`,
        });
      }
      if (state !== "ok") movesOk = false;
      rows[from] = { total, gap, state };
    }

    // Only once every row adds up, so the checks don't flicker while a row is half typed.
    if (movesOk) warnings.push(...flowWarnings(values, layers));

    return { ok: errors.length === 0, errors, warnings, rows, values, layers, domains: values.domains };
  }

  // ---------- switching layers on and off ----------

  const asShare = (text) => { const n = toNumber(text); return Number.isFinite(n) && n > 0 ? n : 0; };
  const asText = (n) => (n > 0 ? String(Math.round(n * 100) / 100) : "");

  // Splits a share into parts by weight, in hundredths, so the parts still add up exactly.
  function splitShare(share, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const exact = weights.map((w) => (Math.round(share * 100) * w) / sum);
    const parts = exact.map((x) => Math.floor(x + 1e-9));
    let left = Math.round(share * 100) - parts.reduce((a, b) => a + b, 0);
    const byRemainder = exact.map((x, i) => [x - parts[i], i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of byRemainder) {
      if (left <= 0) break;
      parts[i] += 1;
      left -= 1;
    }
    return parts.map((p) => p / 100);
  }

  /*
   * Switches a review layer on or off, and keeps every row in use adding up.
   *   Off: tasks that were moving to it go where it would have sent them.
   *   On:  tasks that moved from the layer below it straight to the layer above it now go through it.
   * The layer's own numbers stay saved while it's off.
   */
  function setLayer(inputs, layer, on) {
    const next = JSON.parse(JSON.stringify(inputs));
    next.layers = { ...next.layers };
    if (!REVIEW_OPTIONS.includes(layer) || (next.layers[layer] !== false) === on) return next;

    if (!on) {
      const { working, destinations } = layersOf(next);
      const above = destinations[destinations.indexOf(layer) + 1];
      // Where this layer sends its tasks, leaving out repeat attempts in the layer itself.
      const outs = destinations.filter((k) => k !== layer && asShare(next.moves[layer][k]) > 0)
        .map((k) => [k, asShare(next.moves[layer][k])]);
      const targets = outs.length ? outs : [[above, 1]];
      for (const from of working) {
        const share = from === layer ? 0 : asShare(next.moves[from][layer]);
        if (share === 0) continue;
        splitShare(share, targets.map(([, w]) => w)).forEach((part, i) => {
          const to = targets[i][0];
          next.moves[from][to] = asText(asShare(next.moves[from][to]) + part);
        });
        next.moves[from][layer] = "";
      }
      next.layers[layer] = false;
      return next;
    }

    next.layers[layer] = true;
    const { working, destinations } = layersOf(next);
    const above = destinations[destinations.indexOf(layer) + 1];
    const below = working[working.indexOf(layer) - 1];
    // Its own row: keep it if it only uses layers that are on and adds up; otherwise send everything one layer up.
    const own = next.moves[layer];
    const total = destinations.reduce((sum, k) => sum + asShare(own[k]), 0);
    const strays = DESTINATIONS.some((k) => !destinations.includes(k) && asShare(own[k]) > 0);
    if (strays || Math.abs(total - 100) > 0.01) {
      for (const k of DESTINATIONS) own[k] = k === above ? "100" : "";
    }
    const skipping = asShare(next.moves[below][above]);
    if (skipping > 0) {
      next.moves[below][layer] = asText(asShare(next.moves[below][layer]) + skipping);
      next.moves[below][above] = "";
    }
    return next;
  }

  const RampModel = {
    REVIEW_OPTIONS, WORKING, DESTINATIONS, DONE, DISCARD, ONE_POOL, VERSION, JOIN, CONVERT_PRESETS, CONVERT, SHARE, SHARE_BASE,
    name, layersOf, domainsOf, newDomainId, blankBacklog, blankOverrides, exampleInputs, newPeriod, presetOf, shareTarget,
    isoForDay, dayForIso, toNumber, formatNumber, validate, setLayer,
  };
  if (typeof module === "object" && module.exports) module.exports = RampModel;
  else root.RampModel = RampModel;
})(typeof window !== "undefined" ? window : globalThis);
