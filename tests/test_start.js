const M = require("../model.js");
const S = require("../simulate.js");
const assert = require("assert");
const today = new Date(2026, 9, 23, 9, 0); // Fri Oct 23 2026

// Blank start = tomorrow (Sat Oct 24).
let x = M.exampleInputs();
let c = M.validate(x, today);
assert.strictEqual(c.values.startDate, "2026-10-24"); assert.strictEqual(c.values.startIsTomorrow, true);

// A picked date: Wed Nov 4.
x.startDate = "2026-11-04";
c = M.validate(x, today);
assert.strictEqual(c.ok, true, JSON.stringify(c.errors));
assert.strictEqual(c.values.startDate, "2026-11-04"); assert.strictEqual(c.values.startIsTomorrow, false);
const plan = S.run(c, c.values.ramp);
assert.strictEqual(plan.startDate, "2026-11-04");
// The plan itself (days, CBs, tasks) doesn't depend on the date, only the dates it's shown on.
assert.strictEqual(S.run(M.validate(M.exampleInputs(), today), M.validate(M.exampleInputs(), today).values.ramp).domains[0].reachedDay,
  S.run(M.validate({ ...M.exampleInputs(), startDate: "2026-11-04" }, today), M.validate({ ...M.exampleInputs(), startDate: "2026-11-04" }, today).values.ramp).domains[0].reachedDay);

// Bad dates are flagged.
for (const bad of ["2026-02-31", "Nov 4", "2026-13-01"]) {
  x.startDate = bad;
  const e = M.validate(x, today).errors.find((er) => er.field === "startDate");
  assert.ok(e, bad); assert.strictEqual(e.message, "Enter the start date as a full date.");
}
// A date in the past is allowed (a plan that already started).
x.startDate = "2026-10-01"; assert.strictEqual(M.validate(x, today).ok, true);
console.log("start date tests ok");
