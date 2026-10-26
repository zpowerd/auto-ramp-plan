/*
 * Ramp plan: runs the in-system model day by day, following "In System Ramp Plan"
 * (Z. Decker, Sept 2026). Each domain runs on its own (its own contributors, tasks,
 * target and assumptions); the pipeline and yields are shared. Evals take no
 * contributor time: tasks that land on one are passed on the same day.
 * No page code in here, so it also runs under Node.
 */
(function (root) {
  "use strict";

  const M = typeof module === "object" && module.exports ? require("./model.js") : root.RampModel;
  const DONE = 12;
  const CLEARED = -1;
  const EPS = 1e-9;

  // For one layer, which period applies on each day from day 2, and which day of that period it is (from 1).
  // After the last period with a length runs out, nothing applies: nobody joins or is converted.
  function scheduleFor(periods, maxDays) {
    const at = new Array(maxDays + 1).fill(null);
    let day = 2;
    for (const p of periods) {
      if (day > maxDays) break;
      const end = Math.min(maxDays, p.days === Infinity ? maxDays : day + p.days - 1);
      for (let d = day; d <= end; d++) at[d] = { p, t: d - day + 1 };
      day = end + 1;
    }
    return at;
  }

  /*
   * The CBs at each layer people work, on days 1…maxDays (C^k(t), counted by the highest layer each can work).
   * Day 1 has the starting counts. On each day after that:
   *   1. new CBs join at L−1, a set number a day (below 0, CBs leave);
   *   2. each review layer, highest first, converts CBs up from the human layer just below it: a set number, or
   *      (a share) as many as it takes to keep a % of L0's CBs from the day before, in whole CBs and at least 1.
   *      It can't take more than the layer below has, and going highest first means nobody moves up more than one
   *      layer a day. A share counts the layer's CBs after the layer above has converted some of them up.
   * Also returns `short[k][day]`: how many fewer were converted into layer k than planned, when the layer below ran out.
   */
  function capacity(ramp, human, maxDays) {
    const schedule = Object.fromEntries(human.map((k) => [k, scheduleFor(ramp.periods[k] ?? [], maxDays)]));
    const now = Object.fromEntries(human.map((k) => [k, Math.max(0, ramp.start[k])]));
    const curves = Object.fromEntries(human.map((k) => [k, new Array(maxDays + 1).fill(0)]));
    const short = Object.fromEntries(human.map((k) => [k, {}]));
    for (const k of human) curves[k][1] = now[k];

    for (let d = 2; d <= maxDays; d++) {
      const join = schedule[-1]?.[d];
      if (join) now[-1] = Math.max(0, now[-1] + join.p.perDay);
      const base = now[M.SHARE_BASE] ?? 0; // L0 at the end of the day before
      for (let i = human.length - 1; i >= 1; i--) {
        const k = human[i];
        const below = human[i - 1];
        const p = schedule[k][d]?.p;
        const wanted = p?.kind === "share" ? Math.max(0, M.shareTarget(p.rate, base) - now[k]) : Math.max(0, p?.perDay ?? 0);
        const moved = Math.min(wanted, now[below]);
        if (wanted - moved > EPS) short[k][d] = wanted - moved;
        now[below] -= moved;
        now[k] += moved;
      }
      for (const k of human) curves[k][d] = now[k];
    }

    // The day the last period with a set length ends (for how far to show the ramp).
    let lastChange = 1;
    for (const k of human) {
      let day = 1;
      for (const p of ramp.periods[k] ?? []) if (p.days !== Infinity) day += p.days;
      lastChange = Math.max(lastChange, Math.min(maxDays, day));
    }
    return { curves, lastChange, short };
  }

  // Contributors whose highest layer is k on day t (C^k(t)), from the ramp.
  function contributorsOn(day, human, ramp, curves) {
    return Object.fromEntries(human.map((k) => [k, curves[k][day]]));
  }

  // Passes tasks that landed on evals straight on, the same day (evals can feed evals).
  // Changes `arrivals` in place and returns how many tasks each eval passed on.
  function passThroughEvals(arrivals, evals, moves, destinations) {
    const passed = Object.fromEntries(evals.map((e) => [e, 0]));
    for (let round = 0; round < 1000; round++) {
      let moved = false;
      for (const e of evals) {
        const amount = arrivals[e];
        if (!(amount > EPS)) continue;
        passed[e] += amount;
        arrivals[e] = 0;
        for (const k of destinations) arrivals[k] += amount * (moves[e][k] ?? 0);
        moved = true;
      }
      if (!moved) break;
    }
    return passed;
  }

  function runDomain(domain, values, layers, ramp, curves, maxDays) {
    const { human, review, evals, destinations } = layers;
    const humanReview = review.filter((k) => !evals.includes(k));
    const P = values.byDomain[domain.id].hoursPerDay;
    const T = values.byDomain[domain.id].attemptHours;
    const Y = values.moves;
    const target = values.targets[domain.id];
    const start = values.backlogByDomain[domain.id];
    const sup = values.superAttempts?.on ? values.superAttempts : null;
    const blank = () => Object.fromEntries(destinations.map((k) => [k, 0]));

    // Day 1 starts with the tasks already waiting; any sitting at an eval are passed on first.
    const backlog = Object.fromEntries(humanReview.map((k) => [k, start[k] || 0]));
    const early = blank();
    for (const e of evals) early[e] = start[e] || 0;
    passThroughEvals(early, evals, Y, destinations);
    for (const k of humanReview) backlog[k] += early[k];

    const days = [];
    let total = 0;
    let reachedDay = null;
    for (let day = 1; day <= maxDays; day++) {
      const contributors = contributorsOn(day, human, ramp, curves);
      const waiting = { ...backlog };   // B^k(t): tasks waiting at the start of the day
      const hours = {};                 // H̃^k(t): hours available, including hours passed down
      const attempts = {};              // A^k(t)
      const spare = {};                 // R^k(t): hours passed down to the layer below
      let passedDown = 0;
      let superAttempts = 0;            // A^−1_s(t): L−1 attempts made with the hours L0+ CBs fell back with
      for (const k of [...human].reverse()) { // highest layer first
        hours[k] = contributors[k] * P + passedDown;
        if (k === -1) {
          attempts[k] = hours[k] / T[k];  // L−1 has unlimited supply, so it uses every hour left
          if (sup) superAttempts = passedDown / T[k];
          spare[k] = 0;
        } else {
          attempts[k] = Math.min(hours[k] / T[k], waiting[k]);
          spare[k] = hours[k] - attempts[k] * T[k];
          passedDown = spare[k];
        }
      }

      // Where the day's attempts send their tasks (workable tomorrow); evals pass theirs on today.
      // Super attempts skip the L−1 row and go straight to where super attempts go.
      const arrivals = blank();
      for (const j of human) {
        const moving = j === -1 ? attempts[j] - superAttempts : attempts[j];
        for (const k of destinations) arrivals[k] += moving * (Y[j][k] ?? 0);
      }
      if (sup) arrivals[sup.to] += superAttempts;
      if (day === 1) for (const k of destinations) arrivals[k] += k === DONE || k === CLEARED ? early[k] : 0;
      const evalPassed = passThroughEvals(arrivals, evals, Y, destinations);
      for (const k of humanReview) backlog[k] = waiting[k] - attempts[k] + arrivals[k];

      const completed = arrivals[DONE];
      total += completed;
      days.push({
        day,
        contributors,
        hours,
        attempts,
        superAttempts,
        evalPassed,
        waiting,
        completed,
        total,
        cleared: arrivals[CLEARED],
        // Starved: the layer ran out of tasks and passed hours down. Bottleneck: no hours to spare and its queue grew.
        starved: humanReview.filter((k) => spare[k] > EPS),
        bottlenecks: humanReview.filter((k) => spare[k] <= EPS && backlog[k] > waiting[k] + EPS),
      });
      if (total >= target - EPS) {
        reachedDay = day;
        break;
      }
    }
    const last = days[days.length - 1];
    const contributorsAtEnd = last ? Object.values(last.contributors).reduce((a, b) => a + b, 0) : 0;
    return { id: domain.id, name: domain.name, target, reachedDay, days, contributorsAtEnd };
  }

  /*
   * Runs every domain. `check` is RampModel.validate(inputs) for valid inputs.
   * Each domain stops on the day it reaches its target, or after `maxDays`.
   */
  function run(check, ramp, { maxDays = 365 } = {}) {
    const { values, layers } = check;
    const { curves, lastChange, short } = capacity(ramp, layers.human, maxDays);
    const domains = values.domains.map((d) => runDomain(d, values, layers, ramp, curves, maxDays));
    const everyone = domains.every((d) => d.reachedDay !== null);
    return {
      ramp,
      startDate: values.startDate,           // day 1, "YYYY-MM-DD"
      startIsTomorrow: values.startIsTomorrow,
      curves,          // each layer's CBs by day, from its ramp
      maxDays,
      domains,
      human: layers.human,
      reachedDay: everyone ? Math.max(...domains.map((d) => d.reachedDay)) : null,
      lastDay: Math.max(1, ...domains.map((d) => d.days.length)),
      rampLastChange: lastChange,
      short,           // per review layer and day: how many fewer CBs were converted than planned
      superTo: values.superAttempts?.on ? values.superAttempts.to : null, // where super attempts go, or null when they're off
    };
  }

  const RampSim = { run, contributorsOn, capacity };
  if (typeof module === "object" && module.exports) module.exports = RampSim;
  else root.RampSim = RampSim;
})(typeof window !== "undefined" ? window : globalThis);
