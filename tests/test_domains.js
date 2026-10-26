const M = require("../model.js");
const assert = require("assert");
// One pool: example is valid, target 100, backlog under "all".
let x = M.exampleInputs();
let r = M.validate(x);
assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
assert.deepStrictEqual(r.domains, [{ id: "all", name: "All tasks" }]);
assert.strictEqual(r.values.targets.all, 100); assert.strictEqual(r.values.totalTarget, 100);
// Split with no domains: one error.
x.domains.split = true; r = M.validate(x);
console.log("split, none:", r.errors.map((e) => e.field + " | " + e.message));
// Two domains, one unnamed, missing targets and a bad backlog.
const a = M.newDomainId(x); x.domains.list.push({ id: a, name: "Audio & Music" });
const b = M.newDomainId(x); x.domains.list.push({ id: b, name: "" });
x.backlog[a] = M.blankBacklog(); x.backlog[a][4] = "-2"; x.targets[a] = "12";
r = M.validate(x);
console.log("two:", r.errors.map((e) => e.field + " | " + e.message));
// Fix them: named, targets set, duplicate name check.
x.domains.list[1].name = "audio & music"; x.targets[b] = "12"; x.backlog[a][4] = "5";
r = M.validate(x); console.log("dup:", r.errors.map((e) => e.message));
x.domains.list[1].name = "3D Modeling & CAD"; x.backlog[b] = { 0: "3" };
r = M.validate(x); assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
assert.strictEqual(r.values.totalTarget, 24); assert.strictEqual(r.values.backlog[4], 5); assert.strictEqual(r.values.backlog[0], 3);
assert.strictEqual(r.values.backlogByDomain[a][4], 5);
// A starting backlog keeps an otherwise unreachable layer "in use".
x.moves[1] = { ...x.moves[1], 4: "", 8: "100" }; r = M.validate(x); console.log("skip L4 but backlog there:", r.warnings);
console.log("domain tests ok");
