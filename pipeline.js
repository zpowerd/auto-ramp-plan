/*
 * Ramp plan: draws the pipeline and its yields, L−1 on the left to L12 on the
 * right, using only the review layers that are switched on. Arrows to the next
 * layer run straight between the boxes, arrows that skip layers arc over the
 * top, and arrows back to the same or a lower layer loop underneath. Tasks sent
 * back to L−1 are cleared, so those arrows are dashed and grey.
 */
(function () {
  "use strict";

  const M = window.RampModel;
  const WIDTH = 816;
  const BOX_W = 72;
  const BOX_H = 60;
  const LOOP_DROP = 42;
  const LABEL_ROOM = 14;

  const skipLift = (span) => 26 + 18 * (span - 2); // how high an arc over the top climbs
  const backDrop = (span) => 30 + 18 * (span - 1); // how low an arc underneath dips

  const pct = (share) => M.formatNumber(share * 100) + "%";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const number = (k) => (k < 0 ? "−" + -k : String(k));

  const BADGES = {
    under: '<path class="shape" d="M8 .8l7.6 14.2H.4z"/><path class="glyph" d="M8 6v4M8 12.4v.1"/>',
    critical: '<circle class="shape" cx="8" cy="8" r="8"/><path class="glyph" d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>',
  };

  // Every move above 0%, with the shape its arrow takes. `at` gives each box's position in the row.
  function edgesOf(moves, layers, at) {
    const edges = [];
    for (const from of layers.working) {
      for (const to of layers.destinations) {
        const share = moves[from]?.[to] ?? 0;
        if (!(share > 0)) continue;
        const span = at.get(to) - at.get(from);
        const kind = span === 1 ? "next" : span > 1 ? "skip" : span === 0 ? "self" : "back";
        const style = to === M.DISCARD ? "discard" : span > 0 ? "up" : "back";
        edges.push({ from, to, share, kind, style, span: Math.abs(span) });
      }
    }
    return edges;
  }

  // Path and label position for one arrow; top is the y of the boxes' top edge.
  function shape(edge, top, boxLeft) {
    const bottom = top + BOX_H;
    if (edge.kind === "next") {
      const x1 = boxLeft(edge.from) + BOX_W + 2;
      const x2 = boxLeft(edge.to) - 2;
      const y = top + BOX_H / 2;
      return { d: `M${x1} ${y}H${x2}`, x: (x1 + x2) / 2, y: y - 10 };
    }
    if (edge.kind === "skip") {
      // Longer arcs leave further left and land further right, so they nest outside shorter ones.
      const lift = skipLift(edge.span);
      const inset = Math.min(10 + 7 * (edge.span - 2), BOX_W / 2);
      const x1 = boxLeft(edge.from) + BOX_W - inset;
      const x2 = boxLeft(edge.to) + inset;
      return { d: `M${x1} ${top}C${x1} ${top - lift} ${x2} ${top - lift} ${x2} ${top - 2}`, x: (x1 + x2) / 2, y: top - 0.75 * lift };
    }
    if (edge.kind === "back") {
      const drop = backDrop(edge.span);
      const inset = Math.min(10 + 7 * (edge.span - 1), BOX_W / 2);
      const x1 = boxLeft(edge.from) + inset;
      const x2 = boxLeft(edge.to) + BOX_W - inset;
      return { d: `M${x1} ${bottom}C${x1} ${bottom + drop} ${x2} ${bottom + drop} ${x2} ${bottom + 2}`, x: (x1 + x2) / 2, y: bottom + 0.75 * drop };
    }
    // Back into the same layer: a loop under the box.
    const cx = boxLeft(edge.from) + BOX_W / 2;
    return {
      d: `M${cx + 12} ${bottom}C${cx + 34} ${bottom + LOOP_DROP} ${cx - 34} ${bottom + LOOP_DROP} ${cx - 12} ${bottom + 2}`,
      x: cx,
      y: bottom + 0.75 * LOOP_DROP,
    };
  }

  // Plain-language version for screen readers; the table below is the full equivalent.
  function describe(edges, layers) {
    const parts = layers.working.map((from) => {
      const outs = edges.filter((e) => e.from === from).map((e) =>
        e.style === "discard" ? `${pct(e.share)} back to ${M.name(e.to)}, cleared` : `${pct(e.share)} to ${M.name(e.to)}`);
      return `${M.name(from)} sends ${outs.length ? outs.join(", ") : "nothing yet"}.`;
    });
    const path = [...layers.working, M.DONE].map(M.name).join(", ");
    return `Pipeline through ${path}. ${parts.join(" ")}`;
  }

  function render(container, { moves, rows, layers }) {
    const order = [...layers.working, M.DONE];
    const at = new Map(order.map((k, i) => [k, i]));
    const step = (WIDTH - BOX_W) / (order.length - 1);
    const boxLeft = (k) => at.get(k) * step;

    const edges = edgesOf(moves, layers, at);
    const top = Math.max(LABEL_ROOM + 8,
      ...edges.filter((e) => e.kind === "skip").map((e) => 0.75 * skipLift(e.span) + LABEL_ROOM));
    const below = Math.max(18,
      ...edges.filter((e) => e.kind === "back").map((e) => 0.75 * backDrop(e.span) + LABEL_ROOM),
      ...edges.filter((e) => e.kind === "self").map(() => 0.75 * LOOP_DROP + LABEL_ROOM));
    const height = Math.ceil(top + BOX_H + below);

    // Clears go underneath first, so rework arrows read on top of them.
    const drawOrder = [...edges].sort((a, b) => (a.style === "discard" ? 0 : 1) - (b.style === "discard" ? 0 : 1));
    const lines = drawOrder.map((e) => {
      const s = shape(e, top, boxLeft);
      const tip = e.style === "discard"
        ? `${M.name(e.from)} to ${M.name(e.to)}: ${pct(e.share)} of ${M.name(e.from)} attempts cleared`
        : `${M.name(e.from)} to ${M.name(e.to)}: ${pct(e.share)} of ${M.name(e.from)} attempts`;
      return `<g class="edge edge-${e.style}" data-from="${e.from}" data-to="${e.to}">` +
        `<path class="edge-line" d="${s.d}" marker-end="url(#head-${e.style})"/>` +
        `<path class="edge-hit" d="${s.d}"><title>${esc(tip)}</title></path></g>`;
    }).join("");

    const labels = edges.map((e) => {
      const s = shape(e, top, boxLeft);
      return `<text class="edge-label" data-from="${e.from}" data-to="${e.to}" x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}">${pct(e.share)}</text>`;
    }).join("");

    const boxes = order.map((k) => {
      const done = k === M.DONE;
      const isEval = layers.evals?.includes(k);
      const note = k === -1 ? "new tasks" : done ? "done" : isEval ? "eval" : "";
      const state = rows[k]?.state;
      const badge = state && state !== "ok"
        ? `<svg class="icon ${state === "under" ? "icon-warning" : "icon-critical"}" x="${BOX_W - 10}" y="-7" width="17" height="17" viewBox="0 0 16 16">${BADGES[state === "under" ? "under" : "critical"]}</svg>`
        : "";
      return `<g class="box${done ? " box-done" : ""}${isEval ? " box-eval" : ""}" data-layer="${k}" transform="translate(${boxLeft(k).toFixed(1)} ${top})">` +
        `<title>${done ? "Tasks that reach L12 are done" : `Edit where ${esc(M.name(k))} tasks go`}</title>` +
        `<rect width="${BOX_W}" height="${BOX_H}" rx="12"/>` +
        `<text class="box-name" x="${BOX_W / 2}" y="${note ? 29 : 36}"><tspan class="box-l">L</tspan><tspan class="box-n">${number(k)}</tspan></text>` +
        (note ? `<text class="box-note" x="${BOX_W / 2}" y="46">${note}</text>` : "") +
        badge + `</g>`;
    }).join("");

    container.innerHTML =
      `<svg class="pipeline-svg" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${esc(describe(edges, layers))}">` +
      `<defs>` +
      `<filter id="lift" x="-25%" y="-25%" width="150%" height="175%">` +
      `<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.07"/>` +
      `<feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity="0.08"/></filter>` +
      `<marker id="head-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="head-up" d="M0 1L10 5L0 9z"/></marker>` +
      `<marker id="head-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="head-back" d="M0 1L10 5L0 9z"/></marker>` +
      `<marker id="head-discard" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="head-discard" d="M0 1L10 5L0 9z"/></marker>` +
      `</defs>` +
      `<g class="edges">${lines}</g><g class="boxes">${boxes}</g><g class="labels">${labels}</g>` +
      `</svg>`;
  }

  window.RampPipeline = { render };
})();
