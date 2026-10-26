const M = require("../model.js");
const S = require("../simulate.js");
const assert = require("assert");
const today = new Date(2026, 9, 23, 9, 0);
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
const run = (x, maxDays) => {
  const c = M.validate(x, today);
  assert.strictEqual(c.ok, true, JSON.stringify(c.errors));
  return S.run(c, c.values.ramp, maxDays ? { maxDays } : {});
};

// On by default, straight to L12, made by everyone at L0 and above.
let c = M.validate(M.exampleInputs(), today);
assert.deepStrictEqual(c.values.superAttempts, { on: true, to: 12, from: 0 });

// A review team with nothing to review yet: 5 CBs at L−1, 10 at L0 and 4 at L10, nobody joining or converted.
const idle = () => {
  const x = M.exampleInputs();
  x.ramp.start[-1] = "5"; x.ramp.start[0] = "10"; x.ramp.start[10] = "4";
  x.ramp.periods[-1] = [M.newPeriod("add", "0")];
  for (const k of [0, 1, 4, 8, 10]) x.ramp.periods[k] = [M.newPeriod("convert", "0")];
  x.targets.all = "200";
  return x;
};
// Day 1: the reviewers' 56 hours all fall back to L−1, as 56 ÷ 3 super attempts done the same day; L−1's own 20 hours
// make 20 ÷ 3 tasks for L0. Day 2: L0 attempts those 6.67, so 49.33 hours fall back.
let plan = run(idle());
let [d1, d2] = plan.domains[0].days;
near(d1.attempts[-1], 76 / 3, "day 1 L−1 attempts"); near(d1.superAttempts, 56 / 3, "day 1 super attempts");
near(d1.completed, 56 / 3, "day 1 done"); near(d2.waiting[0], 20 / 3, "day 2 waiting at L0");
near(d2.superAttempts, (56 - 20 / 3) / 3, "day 2 super attempts");
assert.strictEqual(plan.reachedDay, 13);
assert.strictEqual(plan.superTo, 12);
// Off, they're ordinary L−1 attempts: everything goes to L0 first, and it takes far longer.
let x = idle(); x.superAttempts.on = false;
plan = run(x);
assert.ok(plan.domains[0].days.every((d) => d.superAttempts === 0)); assert.strictEqual(plan.superTo, null);
near(plan.domains[0].days[1].waiting[0], 76 / 3, "off: day 2 waiting at L0");
assert.strictEqual(plan.reachedDay, 48);

// To a review layer: they wait there the next day. L4 works them with the hours L10 passes down.
x = idle(); x.superAttempts.to = 4;
[d1, d2] = run(x).domains[0].days;
near(d1.completed, 0, "to L4: nothing done on day 1"); near(d2.waiting[4], 56 / 3, "to L4: waiting at L4 on day 2");
near(d2.attempts[4], 56 / 3, "to L4: attempted on day 2");

// To an eval: passed on the same day by the eval's yields (L8 sends everything to L10).
x = idle(); x.evals[8] = true; x.superAttempts.to = 8;
[d1, d2] = run(x).domains[0].days;
near(d1.evalPassed[8], 56 / 3, "eval passes them on"); near(d2.waiting[10], 56 / 3, "waiting at L10 on day 2");

// Every task created is done, waiting or cleared, super attempts included (L0 clears 20%).
x = idle(); x.moves[0] = { ...x.moves[0], 1: "80", "-1": "20" }; x.superAttempts.to = 1; x.targets.all = "1000000";
const days = run(x, 31).domains[0].days;
const first30 = days.slice(0, 30);
const created = first30.reduce((s, d) => s + d.attempts[-1], 0);
const accounted = first30.at(-1).total + first30.reduce((s, d) => s + d.cleared, 0) + Object.values(days[30].waiting).reduce((a, b) => a + b, 0);
near(created, accounted, "created = done + cleared + waiting");

// Where they go is checked: picked, and in the pipeline. A layer switched off and back on is fine again.
x = M.exampleInputs(); x.superAttempts.to = "";
assert.deepStrictEqual(M.validate(x, today).errors, [{ field: "superTo", message: "Pick the layer super attempts go to." }]);
x.superAttempts.to = 8;
x = M.setLayer(x, 8, false);
assert.deepStrictEqual(M.validate(x, today).errors.map((e) => e.message), ["Super attempts go to L8, which isn't in the pipeline. Pick another layer."]);
x = M.setLayer(x, 8, true);
assert.strictEqual(M.validate(x, today).ok, true);
// Off, where they'd go doesn't matter.
x.superAttempts = { on: false, to: "" };
assert.strictEqual(M.validate(x, today).ok, true);
// With L0 off, the lowest human review layer is where super attempters start; with every review layer an eval, there are none.
x = M.setLayer(M.exampleInputs(), 0, false);
assert.strictEqual(M.validate(x, today).values.superAttempts.from, 1);
x = M.exampleInputs(); for (const k of M.REVIEW_OPTIONS) x.evals[k] = true;
assert.strictEqual(M.validate(x, today).values.superAttempts.on, false);

// The pipeline checks count them as a way for new tasks to move: a layer only super attempts reach isn't idle.
x = M.exampleInputs();
x.moves[1] = { ...x.moves[1], 4: "", 8: "100" }; // L1 skips L4
x.superAttempts.to = 4;
assert.deepStrictEqual(M.validate(x, today).warnings, []);
x.superAttempts.on = false;
assert.deepStrictEqual(M.validate(x, today).warnings.map((w) => w.message), ["No tasks move to L4, so it never gets any work."]);
console.log("super attempt tests ok");
