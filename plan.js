/*
 * Ramp plan view. Shows a plan from RampSim on real dates (day 1 is always tomorrow):
 * when every target is reached, a chart of tasks done against the target (one small
 * chart per domain), and the ramp as a timeline with one column per day.
 * Domain names are typed by people, so they only ever go in through textContent.
 */
(function () {
  "use strict";

  const M = window.RampModel;
  const NS = "http://www.w3.org/2000/svg";
  const one = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US");
  const whole = (n) => Math.round(n).toLocaleString("en-US");

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 0, 25, 50 style steps that cover `raw`.
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  }

  // ---------- dates: day 1 of the plan is always tomorrow, day 0 is today ----------

  // Day 1 of the plan being shown (set by render), at midday so daylight-saving changes never shift the day.
  // Day 0 is the day before it, where every chart starts: "Today" when the plan starts tomorrow.
  let firstDay = null;
  let dayZero = "Today";
  function planDate(day) {
    const date = new Date(firstDay ?? Date.now());
    if (!firstDay) { date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + 1); }
    date.setDate(date.getDate() + day - 1);
    return date;
  }

  // "Oct 24", or "Fri, Oct 24" with the weekday; the year only when it isn't this year.
  function dateText(day, weekday = false) {
    const date = planDate(day);
    return date.toLocaleDateString("en-US", {
      ...(weekday ? { weekday: "short" } : {}),
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    });
  }

  // ---------- the headline ----------

  function headline(plan, split) {
    const box = el("div", "plan-headline");
    const total = plan.domains.reduce((s, d) => s + d.target, 0);
    if (plan.reachedDay !== null) {
      box.append(el("p", "hero-number", dateText(plan.reachedDay, true)));
      box.append(el("p", "hero-label", split
        ? `to reach every domain's target, ${whole(total)} tasks in all.`
        : `to reach your target of ${whole(total)} tasks.`));
      const people = plan.domains.reduce((s, d) => s + d.contributorsAtEnd, 0);
      // How day 1 relates to today: tomorrow, today, later, or already past.
      const now = new Date();
      now.setHours(12, 0, 0, 0);
      const ahead = Math.round((planDate(1) - now) / 86400000);
      const starts = ahead === 1 ? `starts tomorrow, ${dateText(1, true)}`
        : ahead === 0 ? `starts today, ${dateText(1, true)}`
          : ahead > 1 ? `starts ${dateText(1, true)}` : `started ${dateText(1, true)}`;
      box.append(el("p", "hero-sub",
        `That's day ${plan.reachedDay} of a plan that ${starts}. ` +
        (split
          ? `${whole(people)} contributors across domains on the day each one finishes.`
          : `${whole(people)} contributors are working by then.`)));
    } else {
      box.append(el("p", "hero-number", "Not reached"));
      const missing = plan.domains.filter((d) => d.reachedDay === null).map((d) => d.name);
      box.append(el("p", "hero-label", split
        ? `${missing.join(", ")} ${missing.length === 1 ? "doesn't" : "don't"} reach the target by ${dateText(plan.maxDays, true)}.`
        : `The target isn't reached by ${dateText(plan.maxDays, true)}, ${plan.maxDays} days out. Check the yields and the ramp.`));
    }
    return box;
  }

  // ---------- one chart: tasks done so far against the target ----------

  function drawChart(wrap, domain, lastDay, height) {
    wrap.replaceChildren();
    const width = Math.max(220, wrap.clientWidth);
    const pad = { top: 16, right: 74, bottom: 28, left: 44 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const points = [{ day: 0, total: 0 }, ...domain.days.map((d) => ({ day: d.day, total: d.total }))];
    const top = Math.max(domain.target, ...points.map((p) => p.total));
    const step = niceStep(top / 3);
    const yMax = step * Math.ceil(top / step);
    const x = (day) => pad.left + (day / lastDay) * w;
    const y = (v) => pad.top + h - (v / yMax) * h;

    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
    for (let v = step; v <= yMax + 1e-9; v += step) {
      svg.append(svgEl("line", { class: "grid-line", x1: pad.left, x2: pad.left + w, y1: y(v), y2: y(v) }));
    }
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      svg.append(svgEl("text", { class: "tick", x: pad.left - 8, y: y(v), "text-anchor": "end", "dominant-baseline": "central" }, whole(v)));
    }
    svg.append(svgEl("line", { class: "axis-line", x1: pad.left, x2: pad.left + w, y1: y(0), y2: y(0) }));

    // Dates along the bottom: as many as fit, a week apart once the plan runs long.
    const fit = Math.max(1, Math.floor(w / 64));
    const dayStep = [1, 2, 3, 7, 14, 28, 56, 91].find((s) => lastDay / s <= fit) ?? 91;
    svg.append(svgEl("text", { class: "tick", x: x(0), y: pad.top + h + 18, "text-anchor": "start" }, dayZero));
    for (let d = dayStep; d <= lastDay; d += dayStep) {
      if (x(d) - x(0) < 48) continue; // leave room for the first label
      svg.append(svgEl("text", { class: "tick", x: x(d), y: pad.top + h + 18, "text-anchor": "middle" }, dateText(d)));
    }

    // The target, labelled at the right.
    svg.append(svgEl("line", { class: "target-line", x1: pad.left, x2: pad.left + w, y1: y(domain.target), y2: y(domain.target) }));
    svg.append(svgEl("text", { class: "end-label", x: pad.left + w + 8, y: y(domain.target), "dominant-baseline": "central" }, `Target ${whole(domain.target)}`));

    // Mondays: a hairline each.
    const mondays = [];
    for (let d = 1; d <= lastDay; d++) if (isMonday(d)) mondays.push(d);
    for (const m of mondays) svg.append(svgEl("line", { class: "monday-line", x1: x(m), x2: x(m), y1: pad.top, y2: pad.top + h }));

    // Tasks done so far, with a dot on the day the target is reached.
    svg.append(svgEl("path", { class: "series", d: points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p.total).toFixed(1)}`).join("") }));

    // Tasks done by the end of each Monday, labelled where the Mondays are far enough apart to read.
    const roomy = mondays.length < 2 || x(mondays[1]) - x(mondays[0]) >= 34;
    for (const m of mondays) {
      if (m > domain.days.length || m === domain.reachedDay) continue; // the plan has ended, or the finish label is there
      const total = domain.days[m - 1].total;
      svg.append(svgEl("circle", { class: "monday-dot", cx: x(m), cy: y(total), r: 4 }));
      if (roomy) svg.append(svgEl("text", { class: "monday-label", x: x(m), y: y(total) - 10, "text-anchor": "middle" }, one(total)));
    }
    const end = points[points.length - 1];
    if (domain.reachedDay !== null) {
      svg.append(svgEl("circle", { class: "series-dot", cx: x(end.day), cy: y(end.total), r: 4.5 }));
      const labelLeft = x(end.day) > pad.left + w - 60;
      svg.append(svgEl("text", {
        class: "end-label strong",
        x: x(end.day) + (labelLeft ? -10 : 10),
        y: y(end.total) - 12,
        "text-anchor": labelLeft ? "end" : "start",
      }, dateText(domain.reachedDay)));
    }

    // Crosshair and tooltip: hover, or focus the chart and use the arrow keys.
    const cross = svgEl("line", { class: "crosshair", y1: pad.top, y2: pad.top + h, x1: 0, x2: 0, visibility: "hidden" });
    const dot = svgEl("circle", { class: "series-dot", r: 4.5, visibility: "hidden" });
    svg.append(cross, dot);
    const tip = el("div", "chart-tip");
    tip.hidden = true;
    wrap.append(svg, tip);

    const lastIndex = points.length - 1;
    let shown = null;
    const show = (i) => {
      shown = Math.max(0, Math.min(lastIndex, i));
      const p = points[shown];
      cross.setAttribute("x1", x(p.day));
      cross.setAttribute("x2", x(p.day));
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(p.day));
      dot.setAttribute("cy", y(p.total));
      dot.setAttribute("visibility", "visible");
      tip.replaceChildren(
        el("span", "tip-label", p.day === 0 ? dayZero : dateText(p.day, true)),
        el("strong", "tip-value", `${one(p.total)} tasks done`),
        el("span", "tip-label", p.day === 0 ? `of ${whole(domain.target)}` : `of ${whole(domain.target)}, day ${p.day}`));
      tip.hidden = false;
      // Right of the crosshair if it fits, otherwise left of it.
      const right = x(p.day) + 12;
      tip.style.left = `${right + tip.offsetWidth <= width ? right : Math.max(0, x(p.day) - 12 - tip.offsetWidth)}px`;
      tip.style.top = `${pad.top}px`;
    };
    const hide = () => {
      shown = null;
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    };
    svg.addEventListener("pointermove", (event) => {
      const box = svg.getBoundingClientRect();
      show(Math.round(((event.clientX - box.left - pad.left) / w) * lastDay));
    });
    svg.addEventListener("pointerleave", hide);
    wrap.onfocus = () => show(lastIndex);
    wrap.onblur = hide;
    wrap.onkeydown = (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        show((shown ?? lastIndex) + (event.key === "ArrowLeft" ? -1 : 1));
      } else if (event.key === "Escape") hide();
    };
  }

  function chartPanel(domain, lastDay, height, titled) {
    const panel = el("figure", "chart-panel");
    if (titled) {
      const caption = el("figcaption", "chart-title");
      caption.append(el("span", "chart-name", domain.name));
      caption.append(el("span", "chart-when", domain.reachedDay !== null ? dateText(domain.reachedDay, true) : "not reached"));
      panel.append(caption);
    }
    const wrap = el("div", "chart");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", domain.reachedDay !== null
      ? `${domain.name}: ${whole(domain.target)} tasks done by ${dateText(domain.reachedDay, true)}. Use the arrow keys to read each day.`
      : `${domain.name}: the target isn't reached in ${lastDay} days.`);
    panel.append(wrap);
    return { panel, draw: () => drawChart(wrap, domain, lastDay, height) };
  }

  // ---------- tables ----------

  function domainTable(plan) {
    const table = el("table", "grid results");
    const head = el("thead");
    const hr = el("tr");
    for (const [text, cls] of [["Domain", "col-domain"], ["Task target", ""], ["Target reached", ""], ["Contributors that day", ""]]) {
      const th = el("th", cls, text);
      th.scope = "col";
      hr.append(th);
    }
    head.append(hr);
    const body = el("tbody");
    for (const d of plan.domains) {
      const tr = el("tr");
      const th = el("th", "domain-cell is-fixed");
      th.scope = "row";
      th.append(el("span", "domain-fixed", d.name));
      tr.append(th,
        el("td", "num-cell", whole(d.target)),
        el("td", "num-cell", d.reachedDay !== null ? `${dateText(d.reachedDay, true)} (day ${d.reachedDay})` : `Not in ${plan.maxDays} days`),
        el("td", "num-cell", whole(d.contributorsAtEnd)));
      body.append(tr);
    }
    table.append(head, body);
    return table;
  }

  const isMonday = (day) => planDate(day).getDay() === 1;

  // Tasks done by the end of a day, for a domain; a domain that already reached its target keeps its total.
  const doneBy = (domain, day) => (domain.days[day - 1] ?? domain.days[domain.days.length - 1])?.total ?? 0;

  // The timeline: one column per day (Mondays marked), for one domain or every domain added up.
  // The CB rows show the ramp; a layer's cell is marked on days it was a bottleneck or starved.
  function timeline(plan, which, split) {
    const human = plan.human;
    const all = which === "all";
    const domains = all ? plan.domains : plan.domains.filter((d) => d.id === which);
    const days = Math.min(plan.maxDays, Math.max(plan.lastDay, plan.rampLastChange));
    const onDay = (i) => domains.map((d) => d.days[i]).filter(Boolean);
    const cbs = (k, day) => plan.curves[k][day];
    const monday = (i) => (isMonday(i + 1) ? " is-monday" : "");

    const table = el("table", "grid timeline");
    const head = el("thead");
    const hr = el("tr");
    const corner = el("th", "corner");
    corner.scope = "col";
    hr.append(corner);
    for (let i = 1; i <= days; i++) {
      const th = el("th", `date-col${isMonday(i) ? " is-monday" : ""}`);
      th.scope = "col";
      th.append(el("span", "date-weekday", planDate(i).toLocaleDateString("en-US", { weekday: "short" })),
        el("span", "date-day", dateText(i)),
        el("span", "date-n", `day ${i}`));
      hr.append(th);
    }
    head.append(hr);

    const body = el("tbody");
    const section = (label) => {
      const tr = el("tr", "section-row");
      const th = el("th", "", label);
      th.scope = "rowgroup";
      tr.append(th);
      for (let i = 0; i < days; i++) tr.append(el("td"));
      body.append(tr);
    };
    const row = (labelNode, cells, cls = "") => {
      const tr = el("tr", cls);
      const th = el("th", "row-label");
      th.scope = "row";
      th.append(labelNode);
      tr.append(th, ...cells);
      body.append(tr);
    };
    const cell = (text, extra = "", title = "") => {
      const td = el("td", `num-cell ${extra}`.trim(), text);
      if (title) td.title = title;
      return td;
    };
    const layerName = (k) => {
      const span = el("span", "layer");
      span.append(el("span", "layer-l", "L"), el("span", "layer-n", k < 0 ? "−" + -k : String(k)));
      return span;
    };

    // The ramp is the same for every domain, so with domains these are CBs per domain.
    section(split ? "CBs per domain" : "CBs");
    for (const k of human) {
      const cells = [];
      for (let i = 0; i < days; i++) {
        const rows = onDay(i);
        const bottleneck = rows.filter((x) => x.bottlenecks.includes(k)).length;
        const starved = rows.filter((x) => x.starved.includes(k)).length;
        const short = plan.short[k]?.[i + 1] ?? 0;
        const where = (count) => (all && domains.length > 1 ? ` in ${count} ${count === 1 ? "domain" : "domains"}` : "");
        const classes = [bottleneck ? "is-bottleneck" : starved ? "is-starved" : "", short ? "is-short" : "", monday(i).trim()];
        const notes = [
          bottleneck ? `Bottleneck${where(bottleneck)}: no hours to spare and its queue grew` : "",
          starved && !bottleneck ? `Starved${where(starved)}: ran out of tasks, so spare hours went down a layer` : "",
          short ? `${one(short)} fewer converted than planned: ${M.name(human[human.indexOf(k) - 1])} didn't have enough CBs` : "",
        ];
        cells.push(cell(one(cbs(k, i + 1)), classes.filter(Boolean).join(" "), notes.filter(Boolean).join(". ")));
      }
      row(layerName(k), cells);
    }
    const totals = [];
    for (let i = 0; i < days; i++) totals.push(cell(one(human.reduce((s, k) => s + cbs(k, i + 1), 0)), `strong${monday(i)}`));
    row(el("span", "", "All"), totals, "total-row");

    // New tasks come from attempts at L−1; tasks done reach L12.
    section("Tasks");
    const created = [];
    const thatDay = [];
    const soFar = [];
    for (let i = 0; i < days; i++) {
      const ran = domains.some((d) => d.days[i]);
      created.push(cell(ran ? one(onDay(i).reduce((s, r) => s + r.attempts[-1], 0)) : "", monday(i).trim()));
      thatDay.push(cell(ran ? one(onDay(i).reduce((s, r) => s + r.completed, 0)) : "", monday(i).trim()));
      // By the end of each Monday, in bold.
      soFar.push(cell(ran ? one(domains.reduce((s, d) => s + doneBy(d, i + 1), 0)) : "", `${isMonday(i + 1) ? "strong" : ""}${monday(i)}`));
    }
    row(el("span", "", "Created"), created);
    row(el("span", "", "Done that day"), thatDay);
    row(el("span", "", "Done so far"), soFar);

    table.append(head, body);
    return table;
  }

  // New tasks a domain created from day `from` to day `to` (none once it has reached its target).
  const createdBetween = (domain, from, to) => {
    let n = 0;
    for (let d = from; d <= to; d++) n += domain.days[d - 1]?.attempts[-1] ?? 0;
    return n;
  };

  // Every Monday in the plan, then the final delivery (the day the target is reached) when that isn't a Monday:
  // tasks created since the row before (the week up to a Monday), and tasks done by the end of the day.
  function mondayTable(plan, split) {
    const rows = [];
    for (let day = 1; day <= plan.lastDay; day++) if (isMonday(day)) rows.push(day);
    const final = plan.reachedDay;
    if (final !== null && !isMonday(final)) rows.push(final);
    if (rows.length === 0) return el("p", "hint", "The plan finishes before the first Monday.");

    const table = el("table", "grid results mondays");
    const head = el("thead");
    const hr = el("tr");
    const th = (text, cls = "") => { const h = el("th", cls, text); h.scope = "col"; return h; };
    hr.append(th("Monday", "col-domain"));
    if (split) {
      for (const d of plan.domains) hr.append(th(d.name));
      hr.append(th("All domains"));
    } else {
      hr.append(th("Created that week"), th("Done by end of day"), th("Of the target"));
    }
    head.append(hr);

    const met = (domain, day) => doneBy(domain, day) >= domain.target - 1e-9;
    const body = el("tbody");
    rows.forEach((day, i) => {
      const from = i === 0 ? 1 : rows[i - 1] + 1;
      const tr = el("tr", day === final ? "is-final" : "");
      const label = el("th", "domain-cell is-fixed");
      label.scope = "row";
      label.append(el("span", "domain-fixed", dateText(day, true)),
        el("span", "domain-note", day === final ? `day ${day}, final delivery` : `day ${day}`));
      tr.append(label);
      if (split) {
        // Each cell: done by end of day, with the tasks created that week underneath.
        const both = (done, created, isMet) => {
          const td = el("td", `num-cell two-line${isMet ? " is-met" : ""}`);
          td.append(el("span", "cell-main", one(done)), el("span", "cell-sub", `${one(created)} created`));
          if (isMet) td.title = "Target met";
          return td;
        };
        for (const d of plan.domains) tr.append(both(doneBy(d, day), createdBetween(d, from, day), met(d, day)));
        tr.append(both(plan.domains.reduce((s, d) => s + doneBy(d, day), 0),
          plan.domains.reduce((s, d) => s + createdBetween(d, from, day), 0), false));
      } else {
        const d = plan.domains[0];
        const done = el("td", `num-cell${met(d, day) ? " is-met" : ""}`, one(doneBy(d, day)));
        if (met(d, day)) done.title = "Target met";
        tr.append(el("td", "num-cell", one(createdBetween(d, from, day))), done,
          el("td", "num-cell", `${Math.min(100, Math.round((doneBy(d, day) / d.target) * 100))}%`));
      }
      body.append(tr);
    });
    table.append(head, body);
    return table;
  }

  // ---------- the whole view ----------

  let redrawCharts = [];
  let selected = "all";
  const observer = new ResizeObserver(() => redrawCharts.forEach((draw) => draw()));

  // `fill(root)` puts the typed-over days back into the timeline's inputs (the page owns the inputs).
  function render(container, plan, { split, fill = () => {} }) {
    container.replaceChildren();
    redrawCharts = [];
    observer.disconnect();

    // Every date below counts from the plan's start date.
    const [y, m, d] = plan.startDate.split("-").map(Number);
    firstDay = new Date(y, m - 1, d, 12);
    dayZero = plan.startIsTomorrow ? "Today" : "Start";

    container.append(headline(plan, split));

    // Charts: one for one pool; one small chart per domain, all on the same dates, when split.
    const charts = el("div", split ? "chart-grid" : "chart-single");
    const height = split ? 170 : 260;
    for (const d of plan.domains) {
      const { panel, draw } = chartPanel(d, plan.lastDay, height, split);
      charts.append(panel);
      redrawCharts.push(draw);
    }
    container.append(charts);
    container.append(el("p", "hint chart-note", "The thin vertical lines are Mondays, labelled with tasks done by the end of that day."));

    if (split) {
      container.append(el("h3", "sub-title", "By domain"));
      const scroll = el("div", "scroll");
      scroll.append(domainTable(plan));
      container.append(scroll);
    }

    container.append(el("h3", "sub-title", "Every Monday"));
    container.append(el("p", "hint", "Tasks created count the week up to and including that Monday." + (plan.reachedDay === null ? ""
      : ` The last row is the final delivery, the day ${split ? "every domain reaches its target" : "the target is reached"}, ` +
        "counting the days since the Monday before it.")));
    const mondayScroll = el("div", "scroll");
    mondayScroll.append(mondayTable(plan, split));
    container.append(mondayScroll);

    // The day-by-day timeline, with a domain picker when split.
    const scroll = el("div", "scroll timeline-scroll");
    const dayHead = el("div", "day-head");
    dayHead.append(el("h3", "sub-title", "Day by day"));
    if (split) {
      if (selected !== "all" && !plan.domains.some((d) => d.id === selected)) selected = "all";
      const picker = el("select", "day-picker");
      picker.setAttribute("aria-label", "Domain to show day by day");
      picker.append(new Option("All domains added up", "all"));
      for (const d of plan.domains) picker.append(new Option(d.name, d.id));
      picker.value = selected;
      picker.addEventListener("change", () => {
        selected = picker.value;
        scroll.replaceChildren(timeline(plan, selected, split));
        fill(scroll);
      });
      dayHead.append(picker);
    } else {
      selected = "all";
    }
    container.append(dayHead);

    const legend = el("ul", "legend timeline-legend");
    const key = (cls, text) => {
      const li = el("li");
      li.append(el("span", `cell-key ${cls}`), document.createTextNode(text));
      return li;
    };
    legend.append(
      key("is-bottleneck", "Bottleneck: no hours to spare, and its queue grew"),
      key("is-starved", "Starved: ran out of tasks, so its spare hours went down a layer"),
      key("is-short", "Fewer converted than planned: the layer below didn't have enough CBs"),
      key("is-monday", "Monday"));
    container.append(legend);

    scroll.append(timeline(plan, selected, split));
    container.append(scroll);
    fill(scroll);

    redrawCharts.forEach((draw) => draw());
    for (const panel of charts.querySelectorAll(".chart")) observer.observe(panel);
  }

  window.RampPlan = { render };
})();
