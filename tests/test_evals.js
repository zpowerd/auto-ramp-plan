const M = require("../model.js");
const assert = require("assert");
let x = M.exampleInputs();
assert.deepStrictEqual(M.layersOf(x).evals, []);
// L10 as an eval: no attempt time needed (even a bad stored one is ignored), T = 0, not a human layer.
x.evals[10] = true; x.attemptHours[10] = "abc";
let r = M.validate(x);
assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
assert.deepStrictEqual(r.layers.evals, [10]); assert.deepStrictEqual(r.layers.human, [-1, 0, 1, 4, 8]);
assert.strictEqual(r.values.attemptHours[10], 0); assert.strictEqual(r.values.byDomain.all.attemptHours[10], 0);
// It still has yields that must add up.
x.moves[10][12] = "80"; r = M.validate(x); assert.strictEqual(r.rows[10].state, "under");
x.moves[10][8] = "20"; r = M.validate(x); assert.strictEqual(r.ok, true);
// An eval that only loops on itself is still caught.
x.moves[10] = { ...x.moves[10], 12: "", 8: "", 10: "100" }; r = M.validate(x); console.log(r.warnings.map((w) => w.message));
// An eval layer that's switched off isn't listed.
x = M.exampleInputs(); x.evals[10] = true; x = M.setLayer(x, 10, false); assert.deepStrictEqual(M.layersOf(x).evals, []);
x = M.setLayer(x, 10, true); assert.deepStrictEqual(M.layersOf(x).evals, [10]);
console.log("eval tests ok");
