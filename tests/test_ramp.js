const M = require("../model.js");
const S = require("../simulate.js");
const assert = require("assert");
const today = new Date(2026, 9, 23, 9, 0); // Fri Oct 23 2026: day 1 = Sat Oct 24
const period = (preset, amount = "", days = "") => ({ preset, amount, days });
const noConversions = (x) => { for (const k of [0, 1, 4, 8, 10]) x.ramp.periods[k] = [period("convert", "0")]; };
const ramp = (x, n = 8) => {
  const c = M.validate(x, today);
  assert.strictEqual(c.ok, true, JSON.stringify(c.errors));
  const cap = S.capacity(c.values.ramp, c.layers.human, n);
  const round = (a) => a.slice(1).map((v) => Math.round(v * 100) / 100);
  return { curves: Object.fromEntries(c.layers.human.map((k) => [k, round(cap.curves[k])])), short: cap.short };
};

// Defaults: 50 at L−1 on day 1, then 2 join a day; 5, 4, 3, 2, 1 converted up, so every review layer grows by one a day
// once the pipeline fills.
let r = ramp(M.exampleInputs());
assert.deepStrictEqual(r.curves[-1], [50, 47, 44, 41, 38, 35, 32, 29]);
assert.deepStrictEqual(r.curves[0], [0, 5, 6, 7, 8, 9, 10, 11]);
assert.deepStrictEqual(r.curves[1], [0, 0, 4, 5, 6, 7, 8, 9]);
assert.deepStrictEqual(r.curves[10], [0, 0, 0, 0, 0, 1, 2, 3]);
// A layer can't convert more than the layer below has: L1 gets nothing on day 2 because L0 is still empty.
assert.deepStrictEqual(Object.keys(r.short[1]), ["2"]); assert.strictEqual(r.short[1][2], 4);

// L−1 adds a set number a day, period by period: 3 a day for 2 days, none for 2, then 10 leave a day (never below 0).
let x = M.exampleInputs(); noConversions(x);
x.ramp.start[-1] = "10";
x.ramp.periods[-1] = [period("add", "3", "2"), period("add", "0", "2"), period("add", "-10")];
assert.deepStrictEqual(ramp(x).curves[-1], [10, 13, 16, 16, 16, 6, 0, 0]);
// Ways of joining that are gone (a %, an S-curve, batches) read as a set number a day.
x.ramp.periods[-1] = [period("pct", "5")];
assert.deepStrictEqual(ramp(x, 3).curves[-1], [10, 15, 20]);

// Conversions are capped by the supply below, and nobody climbs more than one layer a day.
x = M.exampleInputs(); noConversions(x);
x.ramp.start[-1] = "10";
x.ramp.periods[-1] = [period("add", "0")];
x.ramp.periods[0] = [period("convert", "8")]; // wants 8 a day from L−1, which only has 10
r = ramp(x, 4);
assert.deepStrictEqual(r.curves[-1], [10, 2, 0, 0]); assert.deepStrictEqual(r.curves[0], [0, 8, 10, 10]);
assert.strictEqual(r.short[0][3], 6);
x.ramp.periods[1] = [period("convert", "10")];
r = ramp(x, 4);
assert.deepStrictEqual(r.curves[0], [0, 8, 2, 0]); assert.deepStrictEqual(r.curves[1], [0, 0, 8, 10]);

// Periods chain: convert 1 a day to L0 for 3 days, then 3 a day.
x = M.exampleInputs(); noConversions(x); x.ramp.periods[-1] = [period("add", "0")];
x.ramp.periods[0] = [period("convert", "1", "3"), period("convert", "3")];
assert.deepStrictEqual(ramp(x, 6).curves[0], [0, 1, 2, 3, 6, 9]);

// Above L0, a layer can keep a % of the CBs L0 had the day before, in whole CBs. 10% of 25 is 2.5, so 3; the next day
// 10% of 22 is 2, but nobody is converted back down.
x = M.exampleInputs(); noConversions(x);
x.ramp.start[-1] = "0"; x.ramp.start[0] = "25";
x.ramp.periods[-1] = [period("add", "0")];
x.ramp.periods[1] = [period("share", "10")];
r = ramp(x, 3);
assert.deepStrictEqual(r.curves[1], [0, 3, 3]); assert.deepStrictEqual(r.curves[0], [25, 22, 22]);

// At least 1, even while L0 has nobody: on day 2 that comes up short, as L0 has no one to convert yet.
x = M.exampleInputs(); noConversions(x);
x.ramp.periods[0] = [period("convert", "1")];
x.ramp.periods[1] = [period("share", "10")];
r = ramp(x, 4);
assert.deepStrictEqual(r.curves[0], [0, 1, 1, 2]); assert.deepStrictEqual(r.curves[1], [0, 0, 1, 1]);
assert.deepStrictEqual(r.short[1], { 2: 1 });

// The layer above converts first and a % counts what's left, so L1 (keeping 50% of L0) tops itself back up the same day
// once L4 has taken 1 a day from it.
x = M.exampleInputs(); noConversions(x);
x.ramp.start[-1] = "0"; x.ramp.start[0] = "10";
x.ramp.periods[-1] = [period("add", "0")];
x.ramp.periods[1] = [period("share", "50")];
x.ramp.periods[4] = [period("convert", "1")];
r = ramp(x, 5);
assert.deepStrictEqual(r.curves[0], [10, 5, 5, 5, 4]);
assert.deepStrictEqual(r.curves[1], [0, 5, 4, 3, 3]);
assert.deepStrictEqual(r.curves[4], [0, 0, 1, 2, 3]);
assert.deepStrictEqual(r.short[4], { 2: 1 });

// A chain can switch: convert 0 a day for 3 days, then keep 20% of L0. L0 is 20 by then, so 4.
x = M.exampleInputs(); noConversions(x);
x.ramp.start[0] = "20";
x.ramp.periods[-1] = [period("add", "0")];
x.ramp.periods[1] = [period("convert", "0", "3"), period("share", "20")];
assert.deepStrictEqual(ramp(x, 6).curves[1], [0, 0, 0, 0, 4, 4]);

// Whole CBs: halves round up, even where floating point lands just under (14.5% of 100 is 14.499999999999998),
// and never below 1 (0% too). Every half % of every count up to 400, against the exact answer.
assert.strictEqual((14.5 / 100) * 100 < 14.5, true);
assert.strictEqual(M.shareTarget(14.5, 100), 15);
assert.strictEqual(M.shareTarget(10, 15), 2); assert.strictEqual(M.shareTarget(10, 14), 1);
assert.strictEqual(M.shareTarget(10, 4), 1); assert.strictEqual(M.shareTarget(10, 0), 1); assert.strictEqual(M.shareTarget(0, 50), 1);
for (let half = 0; half <= 400; half++) {
  for (let base = 0; base <= 400; base++) {
    const twice = half * base; // 200 × (half / 2)% of base, exactly
    assert.strictEqual(M.shareTarget(half / 2, base), Math.max(1, Math.floor((twice + 100) / 200)), `${half / 2}% of ${base}`);
  }
}

// Mistakes are named plainly, and nobody is converted down or kept below 0%.
x = M.exampleInputs();
x.ramp.periods[0] = [period("convert", "-2")];
x.ramp.periods[4] = [period("convert", "", "")];
x.ramp.periods[8] = [period("share", "-5")];
x.ramp.periods[10] = [period("share", "")];
let c = M.validate(x, today);
console.log(c.errors.map((e) => e.field + " | " + e.message));
assert.deepStrictEqual(c.errors.map((e) => e.field), ["rampAmount:0:0", "rampAmount:4:0", "rampAmount:8:0", "rampAmount:10:0"]);
assert.strictEqual(c.errors[3].message, "Enter the % of L0 that L10 keeps in period 1.");

// L0 itself only converts a set number (a % of itself means nothing).
x = M.exampleInputs(); x.ramp.periods[0] = [period("share", "5")];
assert.strictEqual(M.validate(x, today).values.ramp.periods[0][0].kind, "linear");

// A % of L0 needs L0 to have CBs: switched off, or an eval, it's an error whatever the number.
x = M.exampleInputs(); x.ramp.periods[4] = [period("share", "20")];
c = M.validate(M.setLayer(x, 0, false), today);
assert.deepStrictEqual(c.errors.map((e) => e.message),
  ["Period 1 at L4 keeps a % of L0, but L0 isn't in the pipeline. Convert a set number a day instead."]);
x.evals[0] = true;
c = M.validate(x, today);
assert.deepStrictEqual(c.errors.map((e) => e.message),
  ["Period 1 at L4 keeps a % of L0, but L0 is an eval, so it has no CBs. Convert a set number a day instead."]);
console.log("ramp tests ok");
