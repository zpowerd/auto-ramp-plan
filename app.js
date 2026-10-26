/*
 * Ramp plan, inputs screen. Builds the layer picker and tables from RampModel,
 * saves what's typed in this browser, and shows what still needs fixing.
 */
(function () {
  "use strict";

  const M = window.RampModel;
  const STORAGE_KEY = "ramp-plan:inputs";
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const copy = (value) => JSON.parse(JSON.stringify(value));

  const ICONS = {
    good: '<svg class="icon icon-good" viewBox="0 0 16 16" aria-hidden="true"><circle class="shape" cx="8" cy="8" r="8"/><path class="glyph" d="M4.6 8.3l2.2 2.2 4.6-4.8"/></svg>',
    warning: '<svg class="icon icon-warning" viewBox="0 0 16 16" aria-hidden="true"><path class="shape" d="M8 .8l7.6 14.2H.4z"/><path class="glyph" d="M8 6v4M8 12.4v.1"/></svg>',
    critical: '<svg class="icon icon-critical" viewBox="0 0 16 16" aria-hidden="true"><circle class="shape" cx="8" cy="8" r="8"/><path class="glyph" d="M5.5 5.5l5 5M10.5 5.5l-5 5"/></svg>',
    on: '<svg class="chip-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.4"/></svg>',
    off: '<svg class="chip-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  };

  const matrix = $("#matrix");
  const pipeline = $("#pipeline");

  let inputs = load();
  let lastRemoval = null; // { layer, before, after }: a layer switched straight back on gets its numbers back
  let hoveredCell = null;
  let focusedCell = null;
  let hoveredEdge = null; // { from, to }
  let hoveredBox = null;  // layer number
  let planOpen = readPlanOpen(); // once a plan is created, it stays and follows the inputs
  let planTimer = null;

  const active = () => M.layersOf(inputs);

  // ---------- saved inputs ----------

  function load() {
    const base = M.exampleInputs();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* nothing saved yet */ }
    if (!saved || !Number.isInteger(saved.version) || saved.version < 1 || saved.version > M.VERSION) return base;
    // Keep what was saved, on the example's shape, so anything new gets its example value.
    // Saves from before the layer picker had every layer on; saves from before domains had one pool.
    const pick = (value, fallback) => (typeof value === "string" ? value : fallback);
    const pool = M.ONE_POOL;
    for (const k of M.REVIEW_OPTIONS) base.layers[k] = saved.layers?.[k] !== false;
    for (const k of M.REVIEW_OPTIONS) if (saved.evals?.[k] === true) base.evals[k] = true; // older saves: no evals
    base.hoursPerDay = pick(saved.hoursPerDay, base.hoursPerDay);
    base.startDate = pick(saved.startDate, base.startDate); // older saves: blank, so the plan starts tomorrow
    loadRamp(base, saved.ramp, pick, saved.version);
    for (const k of M.WORKING) base.attemptHours[k] = pick(saved.attemptHours?.[k], base.attemptHours[k]);
    for (const from of M.WORKING) {
      for (const to of M.DESTINATIONS) base.moves[from][to] = pick(saved.moves?.[from]?.[to], base.moves[from][to]);
    }
    const before = saved.version < 4;
    for (const k of M.REVIEW_OPTIONS) {
      base.backlog[pool][k] = pick(before ? saved.backlog?.[k] : saved.backlog?.[pool]?.[k], base.backlog[pool][k]);
    }
    if (!before) {
      base.targets[pool] = pick(saved.targets?.[pool], base.targets[pool]);
      base.domains.split = saved.domains?.split === true;
      base.domains.list = (Array.isArray(saved.domains?.list) ? saved.domains.list : [])
        .filter((d) => typeof d?.id === "string" && /^d[a-z0-9]+$/.test(d.id) && typeof d.name === "string")
        .map((d) => ({ id: d.id, name: d.name }));
      for (const d of base.domains.list) {
        base.targets[d.id] = pick(saved.targets?.[d.id], "");
        base.backlog[d.id] = M.blankBacklog();
        for (const k of M.REVIEW_OPTIONS) base.backlog[d.id][k] = pick(saved.backlog?.[d.id]?.[k], "");
        // Saves from before per-domain assumptions had every domain on the defaults.
        const own = saved.overrides?.[d.id];
        base.overrides[d.id] = M.blankOverrides();
        base.overrides[d.id].hoursPerDay = pick(own?.hoursPerDay, "");
        for (const k of M.WORKING) base.overrides[d.id].attemptHours[k] = pick(own?.attemptHours?.[k], "");
      }
    }
    return base;
  }

  // The ramp has changed shape over time: first one start (at L−1) and one growth rate for everyone,
  // then a start and a growth rate per layer, now a start and a chain of periods per layer.
  // Before version 10 the ramp set each layer's CB count directly. Now CBs join at L−1 and are converted up,
  // so those numbers mean something else: older saves start from the default ramp (everything else is kept).
  // Before version 11 CBs could also join L−1 by a %, an S-curve or in batches. Now it's a set number a day,
  // so those saves start L−1 from the default (50, then 2 a day) and keep the review layers' ramp.
  function loadRamp(base, ramp, pick, version) {
    if (!ramp || version < 10) return;
    for (const k of M.WORKING) {
      if (k === -1 && version < 11) continue;
      base.ramp.start[k] = pick(ramp.start?.[k], base.ramp.start[k]);
      if (!Array.isArray(ramp.periods?.[k]) || ramp.periods[k].length === 0) continue;
      base.ramp.periods[k] = ramp.periods[k].map((p) => ({
        preset: M.presetOf(k, p?.preset).id,
        amount: pick(p?.amount, ""),
        days: pick(p?.days, ""),
      }));
    }
  }

  function save() {
    const note = $("#save-note");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
      note.textContent = "Saved in this browser as you type.";
    } catch {
      note.textContent = "This browser isn't saving your inputs, so they'll be gone after a reload.";
    }
  }

  // Fields: "hoursPerDay", "attemptHours:4" (the defaults), "moves:4:8", and per domain id
  // "domainName:<id>", "target:<id>", "backlog:<id>:4" (the id is "all" for one pool),
  // "domainHours:<id>" and "domainAttempt:<id>:4" (a domain's own assumptions; blank = the default).
  function getValue(field) {
    const [kind, a, b] = field.split(":");
    if (kind === "hoursPerDay") return inputs.hoursPerDay;
    // A blank start date means tomorrow; the date box shows that date.
    if (kind === "startDate") return inputs.startDate || M.isoForDay(1);
    if (kind === "rampStart") return inputs.ramp.start[a];
    if (kind === "rampAmount") return inputs.ramp.periods[a]?.[b]?.amount ?? "";
    if (kind === "rampDays") return inputs.ramp.periods[a]?.[b]?.days ?? "";
    if (kind === "moves") return inputs.moves[a][b];
    if (kind === "backlog") return inputs.backlog[a]?.[b] ?? "";
    if (kind === "target") return inputs.targets[a] ?? "";
    if (kind === "domainName") return inputs.domains.list.find((d) => d.id === a)?.name ?? "";
    if (kind === "domainHours") return inputs.overrides[a]?.hoursPerDay ?? "";
    if (kind === "domainAttempt") return inputs.overrides[a]?.attemptHours?.[b] ?? "";
    return inputs.attemptHours[a];
  }

  function setValue(field, value) {
    const [kind, a, b] = field.split(":");
    if (kind === "hoursPerDay") inputs.hoursPerDay = value;
    else if (kind === "startDate") inputs.startDate = value;
    else if (kind === "rampStart") inputs.ramp.start[a] = value;
    else if (kind === "rampAmount") { if (inputs.ramp.periods[a]?.[b]) inputs.ramp.periods[a][b].amount = value; }
    else if (kind === "rampDays") { if (inputs.ramp.periods[a]?.[b]) inputs.ramp.periods[a][b].days = value; }
    else if (kind === "moves") inputs.moves[a][b] = value;
    else if (kind === "backlog") (inputs.backlog[a] ??= M.blankBacklog())[b] = value;
    else if (kind === "target") inputs.targets[a] = value;
    else if (kind === "domainHours") (inputs.overrides[a] ??= M.blankOverrides()).hoursPerDay = value;
    else if (kind === "domainAttempt") (inputs.overrides[a] ??= M.blankOverrides()).attemptHours[b] = value;
    else if (kind === "domainName") {
      const domain = inputs.domains.list.find((d) => d.id === a);
      if (domain) domain.name = value;
    } else inputs.attemptHours[a] = value;
  }

  // On leaving a cell: "070" -> "70", "40%" -> "40", and zero shares or backlogs show as blank.
  function tidy(field, text) {
    const trimmed = text.trim();
    if (field.startsWith("domainName:")) return trimmed;
    const n = M.toNumber(trimmed);
    if (!Number.isFinite(n)) return trimmed;
    if (n === 0 && (field.startsWith("moves:") || field.startsWith("backlog:"))) return "";
    return String(n);
  }

  // ---------- building the picker and tables ----------

  const layerLabel = (k, note = "") =>
    `<span class="layer"><span class="layer-l">L</span><span class="layer-n">${k < 0 ? "−" + -k : k}</span></span>` +
    (note ? `<span class="layer-note">${note}</span>` : "");

  const cellInput = (field, grid, r, c, label, placeholder = "", extra = "") =>
    `<input class="num" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
       data-field="${field}" data-grid="${grid}" data-r="${r}" data-c="${c}"
       aria-label="${label}" placeholder="${placeholder}" ${extra}>`;

  function buildPicker() {
    const chips = (id) => M.REVIEW_OPTIONS.map((k) =>
      `<button type="button" class="chip" data-layer="${k}" aria-pressed="true">${ICONS.on}${layerLabel(k)}</button>`).join("");
    $("#layer-chips").innerHTML = chips();
    $("#eval-chips").innerHTML = chips();
  }

  // Updated in place, so the chip that was just pressed keeps focus.
  function updatePicker() {
    const setChip = (chip, on, title) => {
      chip.setAttribute("aria-pressed", String(on));
      chip.title = title;
      chip.querySelector(".chip-mark").outerHTML = on ? ICONS.on : ICONS.off;
    };
    for (const chip of $$("#layer-chips .chip")) {
      const k = Number(chip.dataset.layer);
      const on = inputs.layers[k] !== false;
      setChip(chip, on, on ? `Take ${M.name(k)} out of the pipeline` : `Add ${M.name(k)} to the pipeline`);
    }
    // Only layers in the pipeline can be evals.
    for (const chip of $$("#eval-chips .chip")) {
      const k = Number(chip.dataset.layer);
      const isEval = inputs.evals[k] === true;
      chip.hidden = inputs.layers[k] === false;
      setChip(chip, isEval, isEval ? `Make ${M.name(k)} a human review layer` : `Make ${M.name(k)} an eval`);
    }
  }

  // "eval" under an eval layer's name, wherever layers are listed.
  const evalNote = (k) => (active().evals.includes(k) ? "eval" : "");

  // The default row (the only row with one pool), then one row per domain whose blank cells show the default.
  function buildAssumptions() {
    const split = Boolean(inputs.domains.split);
    const { working } = active();
    const table = $("#assumptions");

    $("thead", table).innerHTML = `
      <tr class="groups">
        <th scope="col" rowspan="2" class="col-domain">${split ? "Domain" : ""}</th>
        <th scope="col" rowspan="2" class="col-hours">Hours per contributor per&nbsp;day&nbsp;<span class="sym">P</span></th>
        <th scope="colgroup" colspan="${working.length}" class="group">Hours per attempt&nbsp;<span class="sym">T<sup>k</sup></span></th>
      </tr>
      <tr class="cols">${working.map((k) => `<th scope="col">${layerLabel(k, evalNote(k))}</th>`).join("")}</tr>`;

    // Evals take no contributor time, so they have nothing to enter.
    const instant = '<td class="cell-fixed instant">instant</td>';
    const row = (r, header, cells) => `<tr><th scope="row" class="domain-cell is-fixed">${header}</th>${cells}</tr>`;
    const defaults = row(0,
      split ? '<span class="domain-fixed">Every domain<span class="domain-note">default</span></span>' : '<span class="domain-fixed">All tasks</span>',
      `<td class="cell">${cellInput("hoursPerDay", "assumptions", 0, 0, `Hours per contributor per day${split ? ", default" : ""}`)}</td>` +
      working.map((k, i) => evalNote(k) ? instant : `<td class="cell">${cellInput(`attemptHours:${k}`, "assumptions", 0, i + 1,
        `Hours per attempt in ${M.name(k)}${split ? ", default" : ""}`)}</td>`).join(""));

    const own = split ? M.domainsOf(inputs).map((d, i) => {
      const r = i + 1;
      return row(r, `<span class="domain-fixed" data-domain-label="${d.id}"></span>`,
        `<td class="cell inherits">${cellInput(`domainHours:${d.id}`, "assumptions", r, 0,
          `Hours per contributor per day for domain ${r}`, "", 'data-inherit="hoursPerDay"')}</td>` +
        working.map((k, j) => evalNote(k) ? instant : `<td class="cell inherits">${cellInput(`domainAttempt:${d.id}:${k}`, "assumptions", r, j + 1,
          `Hours per attempt in ${M.name(k)} for domain ${r}`, "", `data-inherit="attemptHours:${k}"`)}</td>`).join(""));
    }).join("") : "";

    $("tbody", table).innerHTML = defaults + own;
    $("#assumptions-hint").hidden = !split;
  }

  // One row per domain (or a single "All tasks" row): name, task target, and tasks waiting in each review layer.
  function buildDomains() {
    const split = Boolean(inputs.domains.split);
    for (const radio of $$('input[name="domain-mode"]')) radio.checked = radio.value === (split ? "split" : "one");
    const { review } = active();
    const domains = M.domainsOf(inputs);
    const table = $("#domains");

    $("thead", table).innerHTML = `
      <tr class="groups">
        <th scope="col" rowspan="2" class="col-domain">Domain</th>
        <th scope="col" rowspan="2" class="col-target">Task target</th>
        <th scope="colgroup" colspan="${Math.max(review.length, 1)}" class="group">Tasks waiting on day&nbsp;1&nbsp;<span class="sym">B<sup>k</sup>(0)</span></th>
        ${split ? '<th scope="col" rowspan="2" class="col-action"><span class="sr-only">Remove</span></th>' : ""}
      </tr>
      <tr class="cols">${review.length
        ? review.map((k) => `<th scope="col">${layerLabel(k, evalNote(k))}</th>`).join("")
        : '<th scope="col">No review layers on</th>'}</tr>`;

    $("tbody", table).innerHTML = domains.map((d, r) => {
      const n = r + 1;
      const name = split
        ? `<input class="name" type="text" autocomplete="off" spellcheck="false" data-field="domainName:${d.id}"
             data-grid="domains" data-r="${r}" data-c="0" aria-label="Name of domain ${n}" placeholder="Domain name">`
        : `<span class="domain-fixed">All tasks</span>`;
      const target = cellInput(`target:${d.id}`, "domains", r, 1, split ? `Task target for domain ${n}` : "Task target");
      const waiting = review.length
        ? review.map((k, i) => `<td class="cell">${cellInput(`backlog:${d.id}:${k}`, "domains", r, i + 2,
            `Tasks waiting in ${M.name(k)} on day 1${split ? ` in domain ${n}` : ""}`, "0")}</td>`).join("")
        : '<td class="cell-fixed">&ndash;</td>';
      const remove = split
        ? `<td class="row-action"><button type="button" class="remove-domain" data-domain="${d.id}"
             aria-label="Remove domain ${n}" title="Remove this domain">${ICONS.remove}</button></td>`
        : "";
      return `<tr data-domain="${d.id}"><th scope="row" class="domain-cell${split ? "" : " is-fixed"}">${name}</th>` +
        `<td class="cell">${target}</td>${waiting}${remove}</tr>`;
    }).join("");

    $("#add-domain").hidden = !split;
  }

  // The CB ramp, one line per layer people work:
  // "Start with [50] then [add 2 a day] for [7] days then [add 5 a day] until the end  Add period".
  const rampInput = (field, label, placeholder = "") =>
    `<input class="num ramp-num" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
       data-field="${field}" aria-label="${label}" placeholder="${placeholder}">`;

  function buildRamp() {
    const { human } = active();
    const editor = $("#ramp-editor");
    const base = M.name(M.SHARE_BASE);
    const baseIsHuman = human.includes(M.SHARE_BASE);
    // L−1: how many CBs join each day. Review layers: how many are converted up from the layer below each day,
    // or, above L0, as many as it takes to keep a % of L0.
    editor.innerHTML = human.map((k, h) => {
      const joining = k === -1;
      const below = M.name(human[h - 1]);
      const periods = inputs.ramp.periods[k];
      const steps = periods.map((p, i) => {
        const last = i === periods.length - 1;
        const where = `period ${i + 1} at ${M.name(k)}`;
        const remove = periods.length < 2 ? "" :
          `<button type="button" class="ramp-remove" data-layer="${k}" data-period="${i}" aria-label="Remove ${where}" title="Remove this period">${ICONS.remove}</button>`;
        const length = last ? '<span class="ramp-word">until the end</span>'
          : `<span class="ramp-word">for</span>${rampInput(`rampDays:${k}:${i}`, `Days in ${where}`, "7")}<span class="ramp-word">days</span>`;
        const amount = (label, placeholder, unit) =>
          rampInput(`rampAmount:${k}:${i}`, `${label} in ${where}`, placeholder) + `<span class="ramp-word">${unit}</span>`;
        const preset = M.presetOf(k, p.preset);
        // Above L0 a layer can keep a % of L0 instead, while L0 has CBs (in the pipeline and not an eval).
        // A period that keeps a % without one still shows the choice, so it can be switched back.
        const choose = k > M.SHARE_BASE && (baseIsHuman || preset === M.SHARE);
        let body;
        if (joining) {
          body = '<span class="ramp-word">add</span>' + amount("CBs joining each day", "2", "a day");
        } else if (!choose) {
          body = '<span class="ramp-word">convert</span>' + amount(`CBs converted to ${M.name(k)} each day`, "2", `a day from ${below}`);
        } else {
          const options = M.CONVERT_PRESETS.map((x) => `<option value="${x.id}"${x === preset ? " selected" : ""}` +
            `${x === M.SHARE && !baseIsHuman && x !== preset ? " disabled" : ""}>${x.label}</option>`).join("");
          body = `<select class="ramp-preset" data-layer="${k}" data-period="${i}" aria-label="How CBs are converted to ${M.name(k)} in ${where}">` +
            `${options}</select>` + (preset === M.SHARE
            ? amount(`Percent of ${base}'s CBs that ${M.name(k)} keeps`, "10", `%, at least 1 CB, from ${below}`)
            : amount(`CBs converted to ${M.name(k)} each day`, "2", `a day from ${below}`));
        }
        return `<span class="ramp-word">then</span><span class="ramp-period" data-layer="${k}" data-period="${i}">` +
          `${body}${length}${remove}</span>`;
      }).join("");
      return `<div class="ramp-row">` +
        `<div class="ramp-layer">${layerLabel(k, joining ? "new CBs join" : "")}</div>` +
        `<div class="ramp-chain"><span class="ramp-word">Start with</span>${rampInput(`rampStart:${k}`, `CBs at ${M.name(k)} on day 1`, "0")}` +
        `${steps}<button type="button" class="ramp-add" data-layer="${k}">Add period</button></div></div>`;
    }).join("");
    $("#ramp-per-domain").hidden = !inputs.domains.split;
  }

  // The start date: tomorrow and moving forward each day, or a date that was picked.
  function updateStart(result) {
    const picked = String(inputs.startDate ?? "").trim() !== "";
    $("#start-mode").textContent = !picked ? "Tomorrow, moving forward each day"
      : result.values.startIsTomorrow ? "Picked date (tomorrow), stays put" : "Picked date, stays put";
    $("#start-tomorrow").hidden = !picked;
  }

  $("#start-tomorrow").addEventListener("click", () => {
    inputs.startDate = "";
    $("#plan-start").value = M.isoForDay(1);
    save();
    refresh();
  });

  // After the ramp's shape changes, put the cursor back on the control that was used.
  function rebuildRampAndFocus(selector) {
    save();
    rebuild();
    $(selector)?.focus();
  }

  // Switching between a set number and a % of L0 clears the number, since it means something else now.
  $("#ramp-editor").addEventListener("change", (event) => {
    const select = event.target.closest(".ramp-preset");
    if (!select) return;
    const { layer, period } = select.dataset;
    const p = inputs.ramp.periods[layer][period];
    p.preset = select.value;
    p.amount = "";
    // The choice goes away when L0 has no CBs and the period is back to a set number; then its number gets the cursor.
    const box = `.ramp-period[data-layer="${layer}"][data-period="${period}"]`;
    rebuildRampAndFocus(`${box} .ramp-preset, ${box} input`);
  });

  $("#ramp-editor").addEventListener("click", (event) => {
    const add = event.target.closest(".ramp-add");
    const remove = event.target.closest(".ramp-remove");
    if (add) {
      const periods = inputs.ramp.periods[add.dataset.layer];
      // The period that ran until the end now needs a length.
      const last = periods[periods.length - 1];
      if (last && String(last.days).trim() === "") last.days = "7";
      periods.push(M.newPeriod(Number(add.dataset.layer) === -1 ? M.JOIN.id : M.CONVERT.id));
      // The new period's first control: its choice where it has one, otherwise its number.
      const fresh = `.ramp-period[data-layer="${add.dataset.layer}"][data-period="${periods.length - 1}"]`;
      rebuildRampAndFocus(`${fresh} .ramp-preset, ${fresh} input`);
    } else if (remove) {
      const periods = inputs.ramp.periods[remove.dataset.layer];
      periods.splice(Number(remove.dataset.period), 1);
      rebuildRampAndFocus(`.ramp-add[data-layer="${remove.dataset.layer}"]`);
    }
  });

  function addDomain(name = "", at = inputs.domains.list.length) {
    const id = M.newDomainId(inputs);
    inputs.domains.list.splice(at, 0, { id, name });
    inputs.targets[id] = "";
    inputs.backlog[id] = M.blankBacklog();
    inputs.overrides[id] = M.blankOverrides();
    return id;
  }

  function focusName(id) {
    const el = $(`input[data-field="domainName:${id}"]`);
    if (!el) return;
    el.focus();
    el.select();
  }

  function buildMatrix() {
    const { working, destinations } = active();
    const up = (from, to) => to > from;
    $(".group", matrix).colSpan = destinations.length;
    $("thead .cols", matrix).innerHTML = destinations.map((to, c) =>
      `<th scope="col" data-c="${c}">${layerLabel(to, to === M.DONE ? "done" : to === M.DISCARD ? "cleared" : evalNote(to))}</th>`).join("");

    $("tbody", matrix).innerHTML = working.map((from, r) => {
      const below = working[r + 1];
      const cells = destinations.map((to, c) => {
        const classes = ["cell", to === M.DISCARD ? "discard" : up(from, to) ? "up" : "back"];
        if (up(from, to) && c > 0 && !up(from, destinations[c - 1])) classes.push("step-left");
        if (below !== undefined && up(from, to) && !up(below, to)) classes.push("step-below");
        const input = cellInput(`moves:${from}:${to}`, "moves", r, c, to === M.DISCARD
          ? `Percent of ${M.name(from)} attempts sent back to ${M.name(to)} and cleared`
          : `Percent of ${M.name(from)} attempts that move to ${M.name(to)}`);
        return `<td class="${classes.join(" ")}">${input}</td>`;
      }).join("");
      return `
        <tr>
          <th scope="row" data-r="${r}">${layerLabel(from, from === -1 ? "new tasks" : evalNote(from))}</th>
          ${cells}
          <td class="total" data-row="${from}"></td>
        </tr>`;
    }).join("");
  }

  function fillInputs() {
    for (const el of $$("input[data-field]")) el.value = getValue(el.dataset.field) ?? "";
  }

  // After the layers or domains change: new rows and columns, same numbers.
  function rebuild() {
    hoveredCell = null;
    focusedCell = null;
    buildMatrix();
    buildDomains();
    buildAssumptions();
    buildRamp();
    updatePicker();
    fillInputs();
    refresh();
  }

  function toggleLayer(layer) {
    const on = inputs.layers[layer] === false;
    const unchanged = lastRemoval?.layer === layer && JSON.stringify(inputs.moves) === JSON.stringify(lastRemoval.after);
    if (on && unchanged) {
      inputs.layers[layer] = true;
      inputs.moves = copy(lastRemoval.before);
      lastRemoval = null;
    } else {
      const next = M.setLayer(inputs, layer, on);
      lastRemoval = on ? null : { layer, before: copy(inputs.moves), after: copy(next.moves) };
      inputs = next;
    }
    save();
    rebuild();
  }

  // ---------- showing the check ----------

  function refresh() {
    const result = M.validate(inputs);
    const problems = new Map(result.errors.map((e) => [e.field, e.message]));

    for (const el of $$("input[data-field]")) {
      const message = problems.get(el.dataset.field);
      if (message) {
        el.setAttribute("aria-invalid", "true");
        el.title = message;
      } else {
        el.removeAttribute("aria-invalid");
        el.removeAttribute("title");
      }
    }

    // A domain's blank assumption shows the default it's using; its row label follows the name as it's typed.
    for (const el of $$("input[data-inherit]")) el.placeholder = String(getValue(el.dataset.inherit) ?? "").trim();
    for (const el of $$("[data-domain-label]")) {
      const i = inputs.domains.list.findIndex((d) => d.id === el.dataset.domainLabel);
      el.textContent = inputs.domains.list[i]?.name.trim() || `Domain ${i + 1}`;
    }

    // Deeper tint for a bigger share; anything above 0 gets at least a light wash so it stands out.
    for (const el of $$('input[data-grid="moves"]')) {
      const pct = M.toNumber(el.value);
      const share = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) : 0;
      el.parentElement.style.setProperty("--mix", share > 0 ? (14 + 0.86 * share).toFixed(1) + "%" : "0%");
    }

    for (const from of result.layers.working) {
      const row = result.rows[from];
      const gap = M.formatNumber(row.gap);
      const view = {
        ok: ["good", '<span class="sr-only">Adds up</span>'],
        under: ["warning", `${gap}% left`],
        over: ["critical", `${gap}% over`],
        invalid: ["critical", "Fix the marked cell"],
      }[row.state];
      // A row with an unreadable cell has no meaningful total yet.
      const total = row.state === "invalid" ? "–" : `${M.formatNumber(row.total)}%`;
      $(`td.total[data-row="${from}"]`, matrix).innerHTML =
        `<div class="total-inner">${ICONS[view[0]]}<span class="total-n">${total}</span>` +
        `<span class="total-note">${view[1]}</span></div>`;
    }

    window.RampPipeline.render(pipeline, { moves: result.values.moves, rows: result.rows, layers: result.layers });
    highlight();
    renderSummary(result);
    updateStart(result);
    updatePlan(result);
  }

  // ---------- the ramp plan ----------

  function readPlanOpen() {
    try { return localStorage.getItem("ramp-plan:plan-open") === "1"; } catch { return false; }
  }

  function updatePlan(result) {
    $("#create-plan").disabled = !result.ok;
    $("#create-hint").textContent = result.ok ? "" : "Fix the inputs above to create the plan.";
    $("#create-row").hidden = planOpen;
    $("#plan").hidden = !planOpen;
    if (!planOpen) return;
    // While something is wrong, the last good plan stays on screen, dimmed, so a bad cell in it can still be fixed.
    $("#plan-blocked").hidden = result.ok;
    $("#plan-body").classList.toggle("is-stale", !result.ok);
    $("#export-plan").disabled = !result.ok;
    if (!result.ok) return;
    // Typing stays smooth: the plan redraws once the keys stop for a moment.
    clearTimeout(planTimer);
    planTimer = setTimeout(() => drawPlan(result), 120);
  }

  // Draws the plan, keeping the cursor (and the timeline's sideways scroll) where it was,
  // so typing over a day in the timeline carries on uninterrupted.
  function drawPlan(result) {
    const body = $("#plan-body");
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const keep = focused?.dataset?.field
      ? { field: focused.dataset.field, start: focused.selectionStart, end: focused.selectionEnd }
      : null;
    const scrollLeft = $(".timeline-scroll", body)?.scrollLeft ?? 0;

    // The plan's timeline inputs are the days typed over by hand.
    const problems = new Map(result.errors.map((e) => [e.field, e.message]));
    const fill = (root) => {
      for (const el of $$("input[data-field]", root)) {
        el.value = getValue(el.dataset.field) ?? "";
        if (problems.has(el.dataset.field)) el.setAttribute("aria-invalid", "true");
      }
    };
    window.RampPlan.render(body, window.RampSim.run(result, result.values.ramp), { split: Boolean(inputs.domains.split), fill });
    const scroller = $(".timeline-scroll", body);
    if (scroller) scroller.scrollLeft = scrollLeft;
    if (keep) {
      const el = $(`input[data-field="${keep.field}"]`, body);
      if (el) {
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text input */ }
      }
    }
  }

  $("#create-plan").addEventListener("click", () => {
    planOpen = true;
    try { localStorage.setItem("ramp-plan:plan-open", "1"); } catch { /* the plan just won't reopen after a reload */ }
    refresh();
    clearTimeout(planTimer);
    const result = M.validate(inputs);
    if (result.ok) drawPlan(result);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#plan").scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  });

  // ---------- export ----------

  const DRIVE = "https://drive.google.com/drive/my-drive";
  const driveLink = () => {
    const link = document.createElement("a");
    link.href = DRIVE;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open Google Drive";
    return link;
  };

  // Builds the workbook from the inputs as they are now, downloads it, then opens Google Drive to upload it to.
  // Drive opens last: a new tab in front would leave this page in the background while it builds. Browsers allow
  // the new tab for a few seconds after the click, and the status line links to Drive in case it's blocked.
  $("#export-plan").addEventListener("click", async () => {
    const result = M.validate(inputs);
    const status = $("#export-status");
    if (!result.ok) {
      status.textContent = "Fix the inputs above to export.";
      return;
    }
    const button = $("#export-plan");
    button.disabled = true;
    status.textContent = "Building the spreadsheet…";
    // Building takes a moment and holds the page, so let the line above show first (frames pause in hidden tabs, hence the timer).
    await Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    try {
      const bytes = await window.RampExport.build(result, inputs).bytes();
      const name = window.RampExport.fileName(result);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.replaceChildren(`${name} is in your downloads. Drag it into Google Drive, then open it with Google Sheets. `, driveLink());
      window.open(DRIVE, "_blank", "noopener");
    } catch (error) {
      status.textContent = `The spreadsheet couldn't be built: ${error.message}`;
    } finally {
      button.disabled = !M.validate(inputs).ok;
    }
  });

  function renderSummary({ errors, warnings }) {
    const box = $("#summary");
    box.replaceChildren();

    if (errors.length === 0 && warnings.length === 0) {
      const line = document.createElement("p");
      line.className = "summary-line";
      line.innerHTML = ICONS.good + "<span>Inputs are complete.</span>";
      box.append(line);
      return;
    }

    const group = (title, items, icon) => {
      const h = document.createElement("h3");
      h.textContent = title;
      const list = document.createElement("ul");
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = ICONS[icon];
        const msg = document.createElement("span");
        msg.className = "msg";
        msg.textContent = item.message;
        button.append(msg);
        button.addEventListener("click", () => focusField(item.field));
        const li = document.createElement("li");
        li.append(button);
        list.append(li);
      }
      box.append(h, list);
    };

    if (errors.length) group(errors.length === 1 ? "1 input to fix" : `${errors.length} inputs to fix`, errors, "critical");
    if (warnings.length) group("Worth a look", warnings, "warning");
  }

  // "row:4" goes to the first cell of the L4 row; "col:4" to the cell that would send tasks to L4.
  function focusField(field) {
    const [kind, key] = field.split(":");
    let target;
    if (kind === "row") {
      target = $(`input[data-field^="moves:${key}:"]`);
    } else if (kind === "col") {
      const { working } = active();
      const before = working[working.indexOf(Number(key)) - 1];
      target = $(`input[data-field="moves:${before}:${key}"]`);
    } else if (kind === "domains") {
      target = $("#add-domain");
      target.focus();
      return;
    } else {
      target = $(`input[data-field="${field}"]`);
    }
    if (!target) return;
    target.focus();
    target.select();
  }

  // ---------- typing, moving and pasting ----------

  const gridInput = (grid, r, c) => $(`input[data-grid="${grid}"][data-r="${r}"][data-c="${c}"]`);

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!el.matches?.("input[data-field]")) return;
    setValue(el.dataset.field, el.value);
    save();
    refresh();
  });

  document.addEventListener("change", (event) => {
    const el = event.target;
    if (!el.matches?.("input[data-field]")) return;
    const tidied = tidy(el.dataset.field, el.value);
    if (tidied === el.value) return;
    el.value = tidied;
    setValue(el.dataset.field, tidied);
    save();
    refresh();
  });

  // Arrow keys and Enter move between cells, like a spreadsheet.
  document.addEventListener("keydown", (event) => {
    const el = event.target;
    if (!el.matches?.("input[data-grid]") || event.altKey || event.ctrlKey || event.metaKey) return;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    const atStart = all || el.selectionEnd === 0;
    const atEnd = all || el.selectionStart === el.value.length;
    let step = null;
    if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) step = [1, 0];
    else if (event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)) step = [-1, 0];
    else if (event.key === "ArrowLeft" && atStart) step = [0, -1];
    else if (event.key === "ArrowRight" && atEnd) step = [0, 1];
    if (!step) return;
    // Skip over cells with nothing to type in (an eval's "instant", say).
    let next = null;
    for (let i = 1; i <= 12 && !next; i++) next = gridInput(el.dataset.grid, r + step[0] * i, c + step[1] * i);
    if (event.key === "Enter" || next) event.preventDefault();
    if (next) { next.focus(); next.select(); }
  });

  // A block copied from a spreadsheet fills the cells from the one pasted into.
  document.addEventListener("paste", (event) => {
    const el = event.target;
    if (!el.matches?.("input[data-grid]")) return;
    const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r/g, "").replace(/\n+$/, "");
    if (!/[\t\n]/.test(text)) return; // a single value pastes normally
    event.preventDefault();

    const block = text.split("\n").map((line) => line.split("\t"));

    // Into a domain name: each line is a domain (name, then target, then tasks waiting), added as needed.
    if (el.dataset.field.startsWith("domainName:")) {
      const { review } = active();
      const start = inputs.domains.list.findIndex((d) => `domainName:${d.id}` === el.dataset.field);
      let last = null;
      block.forEach((cells, i) => {
        const id = inputs.domains.list[start + i]?.id ?? addDomain("", start + i);
        last = id;
        const [name, ...numbers] = cells.map((s) => s.trim());
        if (name) setValue(`domainName:${id}`, name);
        numbers.forEach((raw, j) => {
          const field = j === 0 ? `target:${id}` : review[j - 1] !== undefined ? `backlog:${id}:${review[j - 1]}` : null;
          const n = M.toNumber(raw);
          if (!field || (raw !== "" && !Number.isFinite(n))) return; // skip headers and labels
          setValue(field, raw === "" ? "" : tidy(field, String(n)));
        });
      });
      save();
      rebuild();
      focusName(last);
      return;
    }
    const numbers = block.flat().map(M.toNumber).filter(Number.isFinite);
    // Yields often live in sheets as proportions (0.7). If every number is between 0 and 1, read them that way.
    const scale = el.dataset.grid === "moves" && numbers.length > 0 && numbers.every((n) => n >= 0 && n <= 1) ? 100 : 1;

    const r0 = Number(el.dataset.r);
    const c0 = Number(el.dataset.c);
    block.forEach((cells, dr) => cells.forEach((raw, dc) => {
      const target = gridInput(el.dataset.grid, r0 + dr, c0 + dc);
      if (!target) return;
      const value = raw.trim();
      const n = M.toNumber(value);
      if (value !== "" && !Number.isFinite(n)) return; // skip headers and labels
      target.value = value === "" ? "" : tidy(target.dataset.field, String(Math.round(n * scale * 1e6) / 1e6));
      setValue(target.dataset.field, target.value);
    }));
    save();
    refresh();
  });

  // ---------- linking the table and the pipeline ----------
  // Pointing at a cell lights up its row and column headers and its arrow.
  // Pointing at an arrow or a box lights up the numbers behind it.

  function highlight() {
    for (const el of $$(".is-hl, .is-linked")) el.classList.remove("is-hl", "is-linked");
    const mark = (selector, cls, scope) => $$(selector, scope).forEach((el) => el.classList.add(cls));

    const cells = [hoveredCell, focusedCell].filter((el) => el?.isConnected);
    if (hoveredEdge) {
      const cell = $(`input[data-field="moves:${hoveredEdge.from}:${hoveredEdge.to}"]`);
      if (cell) {
        cells.push(cell);
        cell.parentElement.classList.add("is-linked");
      }
    }
    for (const el of cells) {
      const [, from, to] = el.dataset.field.split(":");
      mark(`tbody th[data-r="${el.dataset.r}"]`, "is-hl", matrix);
      mark(`thead th[data-c="${el.dataset.c}"]`, "is-hl", matrix);
      mark(`[data-from="${from}"][data-to="${to}"]`, "is-linked", pipeline);
      mark(`.box[data-layer="${from}"], .box[data-layer="${to}"]`, "is-linked", pipeline);
    }
    if (hoveredBox !== null) {
      const r = active().working.indexOf(hoveredBox);
      if (r >= 0) mark(`tbody th[data-r="${r}"]`, "is-hl", matrix);
      // A layer's own arrows; for L12, the arrows that arrive there.
      mark(hoveredBox === M.DONE ? `[data-to="${M.DONE}"]` : `[data-from="${hoveredBox}"]`, "is-linked", pipeline);
      mark(`.box[data-layer="${hoveredBox}"]`, "is-linked", pipeline);
    }
    pipeline.classList.toggle("has-link", $$(".edge.is-linked", pipeline).length > 0);
  }

  matrix.addEventListener("mouseover", (event) => {
    hoveredCell = event.target.closest("td.cell")?.querySelector("input") ?? null;
    highlight();
  });
  matrix.addEventListener("mouseleave", () => { hoveredCell = null; highlight(); });
  matrix.addEventListener("focusin", (event) => {
    focusedCell = event.target.matches('input[data-grid="moves"]') ? event.target : null;
    highlight();
  });
  matrix.addEventListener("focusout", () => { focusedCell = null; highlight(); });

  pipeline.addEventListener("mouseover", (event) => {
    const edge = event.target.closest(".edge");
    const box = edge ? null : event.target.closest(".box");
    hoveredEdge = edge ? { from: edge.dataset.from, to: edge.dataset.to } : null;
    hoveredBox = box ? Number(box.dataset.layer) : null;
    highlight();
  });
  pipeline.addEventListener("mouseleave", () => { hoveredEdge = null; hoveredBox = null; highlight(); });

  // Clicking an arrow or a box jumps to the numbers behind it.
  pipeline.addEventListener("click", (event) => {
    const edge = event.target.closest(".edge");
    if (edge) {
      focusField(`moves:${edge.dataset.from}:${edge.dataset.to}`);
      return;
    }
    const box = event.target.closest(".box");
    if (box && active().working.includes(Number(box.dataset.layer))) focusField(`row:${box.dataset.layer}`);
  });

  $("#layer-chips").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (chip) toggleLayer(Number(chip.dataset.layer));
  });

  $("#eval-chips").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const k = Number(chip.dataset.layer);
    if (inputs.evals[k]) delete inputs.evals[k];
    else inputs.evals[k] = true;
    save();
    rebuild();
  });

  // ---------- domains ----------

  for (const radio of $$('input[name="domain-mode"]')) {
    radio.addEventListener("change", () => {
      const split = radio.value === "split";
      inputs.domains.split = split;
      // Splitting for the first time starts with one empty domain to name.
      const first = split && inputs.domains.list.length === 0 ? addDomain() : null;
      save();
      rebuild();
      if (first) focusName(first);
    });
  }

  $("#add-domain").addEventListener("click", () => {
    const id = addDomain();
    save();
    rebuild();
    focusName(id);
  });

  $("#domains").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-domain");
    if (!button) return;
    const id = button.dataset.domain;
    const i = inputs.domains.list.findIndex((d) => d.id === id);
    if (i < 0) return;
    const label = inputs.domains.list[i].name.trim() || "this domain";
    const own = inputs.overrides[id];
    const hasNumbers = [inputs.targets[id], ...Object.values(inputs.backlog[id] ?? {}),
      own?.hoursPerDay, ...Object.values(own?.attemptHours ?? {})].some((v) => String(v ?? "").trim() !== "");
    if (hasNumbers && !window.confirm(`Remove ${label} and its numbers?`)) return;
    inputs.domains.list.splice(i, 1);
    delete inputs.targets[id];
    delete inputs.backlog[id];
    delete inputs.overrides[id];
    save();
    rebuild();
    const next = inputs.domains.list[Math.min(i, inputs.domains.list.length - 1)];
    if (next) focusName(next.id);
    else $("#add-domain").focus();
  });

  $("#reset").addEventListener("click", () => {
    if (!window.confirm("Replace all your inputs with the example values?")) return;
    inputs = M.exampleInputs();
    lastRemoval = null;
    save();
    rebuild();
  });

  // ---------- start ----------

  buildPicker();
  rebuild();

  // For the next step (and the console): the current inputs and their check.
  window.rampPlan = {
    get inputs() { return copy(inputs); },
    check: () => M.validate(inputs),
  };
})();
