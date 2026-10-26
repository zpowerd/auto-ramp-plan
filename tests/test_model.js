const M = require("../model.js");
const assert = require("assert");
const clone = (x) => JSON.parse(JSON.stringify(x));
// Example values are valid and give the straight-through Y.
let r = M.validate(M.exampleInputs());
assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
assert.deepStrictEqual(r.warnings, []);
assert.strictEqual(r.values.moves[-1][0], 1); assert.strictEqual(r.values.moves[10][12], 1);
assert.strictEqual(r.values.attemptHours[4], 0.5); assert.strictEqual(r.values.backlog[8], 0);
// Row under / over / invalid.
let x = clone(M.exampleInputs()); x.moves[4][8] = "90";
r = M.validate(x); assert.strictEqual(r.rows[4].state, "under"); console.log(r.errors.map(e => e.message));
x.moves[4][8] = "70"; x.moves[4][4] = "40"; r = M.validate(x); assert.strictEqual(r.rows[4].state, "over"); console.log(r.errors.map(e => e.message));
x.moves[4][4] = "abc"; r = M.validate(x); assert.strictEqual(r.rows[4].state, "invalid"); console.log(r.errors.map(e => e.message));
// 33.33 x3 within tolerance? (99.99 -> 0.01 gap, allowed)
x = clone(M.exampleInputs()); x.moves[0] = { 0: "33.33", 1: "33.33", 4: "33.34", 8: "", 10: "", 12: "" };
r = M.validate(x); assert.strictEqual(r.rows[0].state, "ok");
// Required / positive checks.
x = clone(M.exampleInputs()); x.hoursPerDay = ""; x.attemptHours[8] = "0"; x.backlog[1] = "-3"; x.moves[0][1] = "120";
r = M.validate(x); console.log(r.errors.map(e => e.field + " | " + e.message));
// Stuck loop: L4 -> L8 100%, L8 -> L4 100%.
x = clone(M.exampleInputs()); x.moves[8] = { 0: "", 1: "", 4: "100", 8: "", 10: "", 12: "" };
r = M.validate(x); assert.strictEqual(r.ok, true); console.log(r.warnings);
// Self-loop at L0 with nothing escaping -> L0 and nothing else stuck? L-1 -> L0 only, so everything stuck.
x = clone(M.exampleInputs()); x.moves[0] = { 0: "100", 1: "", 4: "", 8: "", 10: "", 12: "" };
r = M.validate(x); console.log(r.warnings);
// Partial rework loop that still finishes: no warning.
x = clone(M.exampleInputs()); x.moves[8] = { 0: "", 1: "", 4: "30", 8: "", 10: "70", 12: "" };
r = M.validate(x); assert.deepStrictEqual(r.warnings, []);
// Parsing.
assert.strictEqual(M.toNumber("1,250"), 1250); assert.strictEqual(M.toNumber(" 40% "), 40); assert.ok(Number.isNaN(M.toNumber("4h")));
console.log("all good");
// Loop entered from a layer that still finishes: L1 -> L4 50% / L10 50%, L4 <-> L8.
x = clone(M.exampleInputs());
x.moves[1] = { 0: "", 1: "", 4: "50", 8: "", 10: "50", 12: "" };
x.moves[8] = { 0: "", 1: "", 4: "100", 8: "", 10: "", 12: "" };
console.log(M.validate(x).warnings);
// Self-loop at L8 entered from L4, plus a starting backlog in L10 (fine).
x = clone(M.exampleInputs()); x.moves[8] = { 0: "", 1: "", 4: "", 8: "100", 10: "", 12: "" }; x.backlog[10] = "50";
console.log(M.validate(x).warnings);
