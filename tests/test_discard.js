const M = require("../model.js");
const assert = require("assert");
const blank = () => Object.fromEntries(M.DESTINATIONS.map((k) => [k, ""]));
// Example is still the straight chain, with an empty L−1 column.
let x = M.exampleInputs();
assert.strictEqual(x.moves[-1][0], "100"); assert.strictEqual(x.moves[-1][-1], ""); assert.strictEqual(x.moves[10][12], "100");
let r = M.validate(x); assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.layers.destinations, [-1, 0, 1, 4, 8, 10, 12]);
// L0 discards 30%: row adds up, Y(0,-1) = 0.3, no warnings.
x.moves[0] = { ...blank(), "-1": "30", 1: "70" };
r = M.validate(x); assert.strictEqual(r.ok, true, JSON.stringify(r.errors)); assert.strictEqual(r.values.moves[0][-1], 0.3); assert.deepStrictEqual(r.warnings, []);
// A loop with a discard is not stuck: L4 <-> L8, L8 discards 10%. But nothing ever reaches L12.
x = M.exampleInputs(); x.moves[8] = { ...blank(), "-1": "10", 4: "90" };
r = M.validate(x); console.log("loop + discard:", r.warnings.map((w) => w.message));
// L10 discards everything: nothing reaches L12, and it says why.
x = M.exampleInputs(); x.moves[10] = { ...blank(), "-1": "100" };
r = M.validate(x); console.log("all discarded:", r.warnings.map((w) => w.message));
// A loop with no way out still gets the loop warning.
x = M.exampleInputs(); x.moves[8] = { ...blank(), 4: "100" };
r = M.validate(x); console.log("loop, no discard:", r.warnings.map((w) => w.message));
// Turning off a layer that discards passes its discards on: L1 -> L4 100%, L4 discards 20% / 80% to L8.
x = M.exampleInputs(); x.moves[4] = { ...blank(), "-1": "20", 8: "80" };
const y = M.setLayer(x, 4, false);
assert.strictEqual(y.moves[1][-1], "20"); assert.strictEqual(y.moves[1][8], "80"); assert.strictEqual(M.validate(y).ok, true);
// Typos in the discard cell are flagged like any other.
x = M.exampleInputs(); x.moves[0][-1] = "abc"; r = M.validate(x);
console.log("typo:", r.errors.map((e) => e.message));
console.log("discard tests ok");
