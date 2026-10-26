const M = require("../model.js");
const S = require("../simulate.js");
const assert = require("assert");
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}:${Math.round(v * 10) / 10}`).join(" ");

// Example inputs: straight chain, P=4, T(−1)=3, reviews 1h (L4 0.5h), target 100.
let x = M.exampleInputs();
let check = M.validate(x); assert.strictEqual(check.ok, true, JSON.stringify(check.errors));
let plan = S.run(check, check.values.ramp);
const d = plan.domains[0];
console.log("reached day", d.reachedDay, "contributors then", d.contributorsAtEnd);
for (const day of d.days.slice(0, 4)) console.log(`day ${day.day}  C[${fmt(day.contributors)}]  A[${fmt(day.attempts)}]  done ${day.completed.toFixed(1)} total ${day.total.toFixed(1)}  starved ${day.starved} bottleneck ${day.bottlenecks}`);
// Day 1: 50 contributors × 4h = 200h at L−1 → 66.67 attempts, nothing done yet.
assert.strictEqual(d.days[0].contributors[-1], 50); assert.strictEqual(d.days[0].contributors[0], 0);
assert.ok(Math.abs(d.days[0].attempts[-1] - 200 / 3) < 1e-9);
// Day 2: 2 join L−1 and 5 are converted to L0; nobody higher yet (L0 was empty when L1 tried to convert).
assert.strictEqual(d.days[1].contributors[-1], 47); assert.strictEqual(d.days[1].contributors[0], 5); assert.strictEqual(d.days[1].contributors[8], 0);
// Conservation: tasks created at L−1 = done + waiting + cleared (straight chain, nothing cleared).
const created = d.days.reduce((s, day) => s + day.attempts[-1], 0);
const waitingEnd = Object.values(d.days.at(-1).waiting).reduce((a, b) => a + b, 0) - Object.entries(d.days.at(-1).attempts).filter(([k]) => k !== "-1").reduce((s, [, a]) => s + a, 0);
console.log("created", created.toFixed(2), "done", d.days.at(-1).total.toFixed(2));

// L10 as an eval: tasks reaching L10 finish the same day, so the target comes sooner.
x = M.exampleInputs(); x.evals[10] = true;
let p2 = S.run(M.validate(x), M.validate(x).values.ramp);
console.log("with L10 eval: reached day", p2.domains[0].reachedDay, "vs", d.reachedDay);
assert.ok(p2.domains[0].reachedDay <= d.reachedDay);
assert.deepStrictEqual(p2.human, [-1, 0, 1, 4, 8]);

// Clearing 50% at L0 slows it down while new tasks are scarce (10 CBs at L−1, then 6 more a day). With the
// default 50 the top review layers set the pace, so it makes no difference.
const scarce = (y) => { y.ramp.start[-1] = "10"; y.ramp.periods[-1] = [M.newPeriod("add", "6")]; return y; };
const runOf = (y) => S.run(M.validate(y), M.validate(y).values.ramp).domains[0].reachedDay;
x = M.exampleInputs(); x.moves[0] = { ...x.moves[0], 1: "50", "-1": "50" };
assert.strictEqual(runOf(x), d.reachedDay);
let p3 = runOf(scarce(x));
console.log("L0 clears 50%, scarce new tasks: reached day", p3, "vs", runOf(scarce(M.exampleInputs())));
assert.ok(p3 > runOf(scarce(M.exampleInputs())));

// Domains: each runs on its own with its own target and assumptions.
x = M.exampleInputs(); x.domains.split = true;
for (const [name, target] of [["Audio & Music", "12"], ["3D Modeling & CAD", "40"]]) {
  const id = M.newDomainId(x); x.domains.list.push({ id, name }); x.targets[id] = target; x.backlog[id] = M.blankBacklog(); x.overrides[id] = M.blankOverrides();
}
x.overrides[x.domains.list[1].id].attemptHours[-1] = "8";
check = M.validate(x); assert.strictEqual(check.ok, true, JSON.stringify(check.errors));
const p4 = S.run(check, check.values.ramp);
console.log("domains:", p4.domains.map((dm) => `${dm.name} target ${dm.target} → day ${dm.reachedDay}`), "all by", p4.reachedDay);

// A starting backlog at L8 finishes early.
x = M.exampleInputs(); x.backlog.all[8] = "30";
const p5 = S.run(M.validate(x), M.validate(x).values.ramp);
console.log("30 waiting at L8: day-2 done", p5.domains[0].days[1].completed.toFixed(1), "reached", p5.domains[0].reachedDay);

// Nobody working: never reached, stops at maxDays.
x = M.exampleInputs();
const p6 = (() => { for (const k of M.WORKING) { x.ramp.start[k] = "0"; x.ramp.periods[k] = [M.newPeriod(k === -1 ? "add" : "convert", "0")]; } const c = M.validate(x); assert.strictEqual(c.ok, true, JSON.stringify(c.errors)); return S.run(c, c.values.ramp, { maxDays: 50 }); })();
assert.strictEqual(p6.domains[0].reachedDay, null); assert.strictEqual(p6.domains[0].days.length, 50); assert.strictEqual(p6.reachedDay, null);
// The plan runs on the ramp's CBs: 5 already at L0 on day 1 show up in the plan.
x = M.exampleInputs(); x.ramp.start[0] = "5";
const c7 = M.validate(x); assert.strictEqual(c7.ok, true, JSON.stringify(c7.errors));
const p7 = S.run(c7, c7.values.ramp).domains[0];
assert.strictEqual(p7.days[0].contributors[0], 5); assert.strictEqual(p7.days[0].contributors[-1], 50);
// Day 2: 2 join L−1, 5 move L−1→L0, 4 move L0→L1 (L0 had 5).
assert.strictEqual(p7.days[1].contributors[-1], 47); assert.strictEqual(p7.days[1].contributors[0], 6); assert.strictEqual(p7.days[1].contributors[1], 4);
// Ramp numbers are checked like any input.
x.ramp.periods[8] = [{ preset: "convert", amount: "", days: "zero" }, M.newPeriod("convert", "1")]; console.log(M.validate(x).errors.map((e) => e.field + " | " + e.message));
console.log("sim tests ok");
