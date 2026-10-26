const M = require("../model.js");
const assert = require("assert");
let x = M.exampleInputs();
// One pool: the pool uses the defaults.
let r = M.validate(x);
assert.strictEqual(r.ok, true); assert.strictEqual(r.values.byDomain.all.hoursPerDay, 4); assert.strictEqual(r.values.byDomain.all.attemptHours[4], 0.5);
// Split: blank overrides inherit; typed ones win; bad ones are flagged with the domain name.
x.domains.split = true;
const a = M.newDomainId(x); x.domains.list.push({ id: a, name: "Audio & Music" }); x.targets[a] = "12"; x.overrides[a] = M.blankOverrides();
const b = M.newDomainId(x); x.domains.list.push({ id: b, name: "3D Modeling & CAD" }); x.targets[b] = "12"; x.overrides[b] = M.blankOverrides();
x.overrides[b].hoursPerDay = "6"; x.overrides[b].attemptHours[-1] = "8";
r = M.validate(x); assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
assert.strictEqual(r.values.byDomain[a].hoursPerDay, 4); assert.strictEqual(r.values.byDomain[a].attemptHours[-1], 3);
assert.strictEqual(r.values.byDomain[b].hoursPerDay, 6); assert.strictEqual(r.values.byDomain[b].attemptHours[-1], 8);
assert.strictEqual(r.values.byDomain[b].attemptHours[0], 1);
// Changing a default flows to every domain that hasn't set its own.
x.attemptHours[0] = "2"; r = M.validate(x); assert.strictEqual(r.values.byDomain[a].attemptHours[0], 2); assert.strictEqual(r.values.byDomain[b].attemptHours[0], 2);
x.overrides[a].attemptHours[8] = "0"; x.overrides[a].hoursPerDay = "30";
r = M.validate(x); console.log(r.errors.map((e) => e.field.replace(a, "A") + " | " + e.message));
// Overrides are ignored in one-pool mode.
x.domains.split = false; r = M.validate(x); assert.strictEqual(r.ok, true);
console.log("override tests ok");
