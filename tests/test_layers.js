const M = require("../model.js");
const assert = require("assert");
const row = (inp, j) => Object.fromEntries(M.layersOf(inp).destinations.map((k) => [k, inp.moves[j][k]]).filter(([, v]) => v !== ""));
const show = (inp) => M.layersOf(inp).working.map((j) => `${M.name(j)} ${JSON.stringify(row(inp, j))}`).join("  ");

// 1. Straight-through: turning L1 and L4 off gives L0 -> L8.
let x = M.exampleInputs();
x = M.setLayer(x, 1, false); x = M.setLayer(x, 4, false);
console.log("off L1,L4:", show(x));
let r = M.validate(x); assert.strictEqual(r.ok, true, JSON.stringify(r.errors)); assert.deepStrictEqual(r.warnings, []);
assert.deepStrictEqual(r.layers.review, [0, 8, 10]);
// 2. Turning L4 back on puts it back between L0 and L8.
x = M.setLayer(x, 4, true);
console.log("on L4:    ", show(x));
r = M.validate(x); assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.warnings, []);

// 3. Rework: removing L4 sends its tasks where it would have, including back to L1.
x = M.exampleInputs();
x.moves[1] = { 0: "", 1: "", 4: "80", 8: "", 10: "", 12: "" }; x.moves[1][1] = "20";      // L1: 80% L4, 20% repeat
x.moves[4] = { 0: "", 1: "10", 4: "15", 8: "75", 10: "", 12: "" };                         // L4: 10% back to L1, 15% repeat, 75% L8
x.moves[8] = { 0: "", 1: "", 4: "30", 8: "", 10: "70", 12: "" };                           // L8: 30% back to L4
assert.strictEqual(M.validate(x).ok, true);
const y = M.setLayer(x, 4, false);
console.log("rework off L4:", show(y));
r = M.validate(y); assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
// L1: 80% of (10/85 back to L1, 75/85 to L8) -> 9.41 + 70.59; plus the existing 20% repeat
assert.strictEqual(y.moves[1][1], "29.41"); assert.strictEqual(y.moves[1][8], "70.59");
// L8: 30% of the same split -> 3.53 to L1, 26.47 back to L8
assert.strictEqual(y.moves[8][1], "3.53"); assert.strictEqual(y.moves[8][8], "26.47");

// 4. Turning a layer off when its own row is empty: tasks skip to the next layer up.
x = M.exampleInputs(); x.moves[4] = { 0: "", 1: "", 4: "", 8: "", 10: "", 12: "" };
const z = M.setLayer(x, 4, false);
assert.strictEqual(z.moves[1][8], "100"); assert.strictEqual(M.validate(z).ok, true);

// 5. A layer switched on with nothing skipping past it gets a warning; its stray row is reset.
x = M.exampleInputs(); x = M.setLayer(x, 8, false);           // L4 -> L10
x.moves[4] = { 0: "", 1: "", 4: "", 8: "", 10: "50", 12: "50" }; // L4 no longer goes to L10 only
x.moves[1] = { 0: "", 1: "", 4: "100", 8: "", 10: "", 12: "" };
x.moves[8] = { 0: "", 1: "", 4: "", 8: "", 10: "", 12: "" };    // L8's own row empty while off
x = M.setLayer(x, 8, true);
console.log("on L8 (no skip):", show(x));
r = M.validate(x); console.log(r.warnings);
assert.strictEqual(x.moves[8][10], "100");                      // reset to one layer up

// 6. No review layers at all: L-1 -> L12 directly.
x = M.exampleInputs(); for (const k of M.REVIEW_OPTIONS) x = M.setLayer(x, k, false);
console.log("none:", show(x)); assert.strictEqual(M.validate(x).ok, true);
// and all back on restores a straight chain
for (const k of M.REVIEW_OPTIONS) x = M.setLayer(x, k, true);
console.log("all back:", show(x)); r = M.validate(x); assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.warnings, []);
console.log("layer tests ok");
