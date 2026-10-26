// The exported workbook works out the same plan as the app: every formula is run by sheet_eval.js
// and compared with RampSim, day by day, for the CB ramp, every domain, the Plan's day-by-day table,
// the headline and the Mondays (with the final delivery). By default the days run to the one the target is reached.
const M = require("../model.js");
const S = require("../simulate.js");
const E = require("../export.js");
const X = require("../xlsx.js");
const zlib = require("zlib");
const { evaluator, colName } = require("../sheet_eval.js");
const assert = require("assert");
const today = new Date(2026, 9, 23, 9, 0); // Fri Oct 23 2026: day 1 = Sat Oct 24
const period = (preset, amount = "", days = "") => ({ preset, amount, days });
const row = (x, from, shares) => {
  for (const to of M.DESTINATIONS) x.moves[from][to] = "";
  for (const [to, pct] of Object.entries(shares)) x.moves[from][to] = String(pct);
};

// `days` sets how many days the sheets run; left out, the export picks: up to the day every target is reached.
function compare(name, x, days) {
  const c = M.validate(x, today);
  assert.ok(c.ok, `${name}: ${JSON.stringify(c.errors)}`);
  const wb = E.build(c, x, { exportedOn: today, ...(days === undefined ? {} : { days }) });
  const lay = wb.layout;
  if (days === undefined) {
    const whole = S.run(c, c.values.ramp);
    assert.strictEqual(lay.days, whole.reachedDay ?? whole.maxDays, `${name}: the days run to the one the target is reached`);
  }
  days = lay.days;
  const plan = S.run(c, c.values.ramp, { maxDays: days });
  // Nothing past the last day.
  for (const sheet of wb.sheets) assert.strictEqual(sheet.get(colName(lay.dayCol(days + 1)) + lay.dayRow), undefined, `${name}: ${sheet.name} stops at day ${days}`);
  const ev = evaluator(wb);
  ev.all(["Inputs", lay.ramp.sheet, ...lay.domains.map((d) => d.sheet), lay.plan.sheet, "How it works"]);
  const col = (t) => colName(lay.dayCol(t));
  // A formula pointing at a blank cell shows blank in Google Sheets (0 in Excel); either way it counts as 0.
  const near = (got, want, what) => {
    if (got === null) got = 0;
    if (typeof got === "number" && Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want))) return;
    throw new assert.AssertionError({ message: `${name}: ${what}: the sheet has ${got}, the app ${want}` });
  };
  const human = plan.human;
  const hr = human.slice(1);
  const start = X.dateSerial(plan.startDate);

  // No cell anywhere works out to an error.
  for (const sheet of wb.sheets) {
    for (const ref of sheet.cells.keys()) {
      const v = ev.get(sheet.name, ref);
      assert.ok(!(typeof v === "string" && v.startsWith("#")), `${name}: ${sheet.name}!${ref} is ${v}`);
    }
  }

  // Days run across: one column per day, the dates counting up from the start.
  for (const sheet of [lay.ramp.sheet, ...lay.domains.map((d) => d.sheet)]) {
    for (const t of new Set([1, Math.min(2, days), days])) {
      assert.strictEqual(ev.get(sheet, col(t) + lay.dayRow), t, `${name}: ${sheet} day ${t}`);
      assert.strictEqual(ev.get(sheet, col(t) + lay.dateRow), start + t - 1, `${name}: ${sheet} date of day ${t}`);
    }
  }

  // The CB ramp, and the days a conversion came up short.
  const rs = lay.ramp.sheet;
  for (const k of human) for (let t = 1; t <= days; t++) {
    near(ev.get(rs, col(t) + lay.ramp.cb[k]), plan.curves[k][t], `CBs at ${M.name(k)} on day ${t}`);
  }
  for (const k of hr) for (let t = 2; t <= days; t++) {
    const { planned, moved } = lay.ramp.conv[k];
    const gap = ev.get(rs, col(t) + planned) - ev.get(rs, col(t) + moved);
    near(gap > 1e-9 ? gap : 0, plan.short[k][t] ?? 0, `short at ${M.name(k)} on day ${t}`);
  }

  // Every domain, every day.
  plan.domains.forEach((d, i) => {
    const { sheet, row } = lay.domains[i];
    const get = (key, k, t) => ev.get(sheet, col(t) + row[key][k]);
    const final = d.days[d.days.length - 1].total;
    for (let t = 1; t <= days; t++) {
      const r = d.days[t - 1];
      assert.strictEqual(ev.get(sheet, col(t) + lay.workRow), r ? "yes" : "no", `${name}: ${d.name} working on day ${t}`);
      const what = (s) => `${d.name}, ${s}, day ${t}`;
      if (!r) {
        for (const k of human) near(get("A", k, t), 0, what(`attempts at ${M.name(k)} after the target`));
        near(get("S", "S", t), final, what("done so far after the target"));
        continue;
      }
      for (const k of human) {
        near(get("C", k, t), r.contributors[k], what(`CBs at ${M.name(k)}`));
        near(get("Hav", k, t), r.hours[k], what(`hours at ${M.name(k)}`));
        near(get("A", k, t), r.attempts[k], what(`attempts at ${M.name(k)}`));
      }
      for (const k of hr) near(get("B", k, t), r.waiting[k], what(`waiting at ${M.name(k)}`));
      near(get("Lm", 12, t), r.completed, what("done"));
      near(get("Lm", -1, t), r.cleared, what("cleared"));
      near(get("S", "S", t), r.total, what("done so far"));
      for (const k of hr) {
        const want = r.starved.includes(k) ? "starved" : r.bottlenecks.includes(k) ? "bottleneck" : "";
        assert.strictEqual(get("St", k, t), want, `${name}: ${what(`status at ${M.name(k)}`)}`);
      }
    }
    assert.strictEqual(ev.get(sheet, lay.domains[i].reachDay), d.reachedDay ?? "not reached", `${name}: ${d.name} day reached`);
  });

  // The headline: the date every target is reached, and which day that is.
  const ps = lay.plan.sheet;
  assert.strictEqual(ev.get(ps, lay.plan.hero), plan.reachedDay !== null ? start + plan.reachedDay - 1 : `Not within ${days} days`, `${name}: headline`);
  assert.strictEqual(ev.get(ps, lay.plan.day), plan.reachedDay ?? "–", `${name}: day of the plan`);

  // The Plan's day-by-day table: the app's rows, each as that day's number and the total so far.
  const doneBy = (d, day) => (d.days[day - 1] ?? d.days[d.days.length - 1]).total;
  const { table } = lay.plan;
  const allCBs = (t) => human.reduce((s, k) => s + plan.curves[k][t], 0);
  for (let t = 1; t <= days; t++) {
    const at = (r) => ev.get(ps, col(t) + r);
    for (const k of human) {
      near(at(table.cb[k].total), plan.curves[k][t], `Plan: CBs at ${M.name(k)} on day ${t}`);
      near(at(table.cb[k].each), plan.curves[k][t] - (t > 1 ? plan.curves[k][t - 1] : 0), `Plan: CB change at ${M.name(k)} on day ${t}`);
    }
    near(at(table.all.total), allCBs(t), `Plan: all CBs on day ${t}`);
    near(at(table.all.each), allCBs(t) - (t > 1 ? allCBs(t - 1) : 0), `Plan: change in all CBs on day ${t}`);
    for (const rows of table.tasks) {
      const ds = plan.domains.filter((d) => rows.ids.includes(d.id));
      const created = (day) => ds.reduce((s, d) => s + (d.days[day - 1]?.attempts[-1] ?? 0), 0);
      let soFar = 0;
      for (let k = 1; k <= t; k++) soFar += created(k);
      const which = ds.length > 1 ? "all domains" : ds[0].name;
      near(at(rows.created.each), created(t), `Plan: ${which} created on day ${t}`);
      near(at(rows.created.total), soFar, `Plan: ${which} created by day ${t}`);
      near(at(rows.done.each), ds.reduce((s, d) => s + (d.days[t - 1]?.completed ?? 0), 0), `Plan: ${which} done on day ${t}`);
      near(at(rows.done.total), ds.reduce((s, d) => s + doneBy(d, t), 0), `Plan: ${which} done by day ${t}`);
    }
  }

  // Every Monday up to the end of the plan, then the final delivery when it isn't a Monday. Tasks created count
  // from the row before; done is by the end of the day.
  const [y, m, dd] = plan.startDate.split("-").map(Number);
  const isMonday = (day) => new Date(y, m - 1, dd + day - 1).getDay() === 1;
  const rows = [];
  for (let day = 1; day <= plan.lastDay; day++) if (isMonday(day)) rows.push(day);
  if (plan.reachedDay !== null && !isMonday(plan.reachedDay)) rows.push(plan.reachedDay);
  const createdBetween = (d, from, to) => {
    let n = 0;
    for (let k = from; k <= to; k++) n += d.days[k - 1]?.attempts[-1] ?? 0;
    return n;
  };
  const noteCol = colName(lay.plan.noteCol);
  for (let i = 0; i < lay.plan.mondays; i++) {
    const r = lay.plan.firstMonday + i;
    const day = rows[i];
    if (day === undefined) { assert.strictEqual(ev.get(ps, `B${r}`), "", `${name}: Monday row ${i + 1} stays blank`); continue; }
    assert.strictEqual(ev.get(ps, `B${r}`), day, `${name}: row ${i + 1} of the Monday table`);
    assert.strictEqual(ev.get(ps, `A${r}`), start + day - 1, `${name}: row ${i + 1} date`);
    const finalDelivery = day === plan.reachedDay;
    assert.strictEqual(ev.get(ps, noteCol + r) !== "", finalDelivery, `${name}: final delivery note on day ${day}`);
    const from = i === 0 ? 1 : rows[i - 1] + 1;
    plan.domains.forEach((d, j) => {
      const [cc, dc] = lay.plan.split ? [3 + 2 * j, 4 + 2 * j] : [3, 4];
      near(ev.get(ps, colName(cc) + r), createdBetween(d, from, day), `${d.name} created from day ${from} to ${day}`);
      near(ev.get(ps, colName(dc) + r), doneBy(d, day), `${d.name} done by day ${day}`);
    });
  }
  return { c, plan, wb, ev, mondayRows: rows };
}

// 1. The example: one pool, every layer, the default ramp. Done on Wed Nov 4 (day 12), where the sheets stop.
let x = M.exampleInputs();
let { plan, wb, ev, mondayRows } = compare("example", x);
assert.strictEqual(plan.reachedDay, 12);
assert.strictEqual(wb.layout.days, 12);
assert.deepStrictEqual(mondayRows, [3, 10, 12]);
assert.strictEqual(ev.get("Plan", `${colName(wb.layout.plan.noteCol)}${wb.layout.plan.firstMonday + 2}`), "Final delivery: target reached");
assert.deepStrictEqual(wb.sheets.map((s) => s.name), ["Plan", "How it works", "Inputs", "CB ramp", "Day by day"]);

// 2. Two domains with their own hours, tasks waiting and targets; clears, back moves and repeats;
//    a ramp that changes over time (6 a day, then 1), conversions in two periods, L8 switching from a set number
//    to 15% of L0 and L10 keeping 10% of L0; a Wednesday start.
x = M.exampleInputs();
x.domains = { split: true, list: [{ id: "dcar", name: "Cardiology" }, { id: "dneu", name: "Neuro: adult/child" }] };
x.targets = { dcar: "300", dneu: "120" };
x.backlog = { dcar: { ...M.blankBacklog(), 0: "20", 8: "5" }, dneu: M.blankBacklog() };
x.overrides = { dcar: M.blankOverrides(), dneu: M.blankOverrides() };
x.overrides.dcar.hoursPerDay = "6";
x.overrides.dneu.attemptHours[0] = "0.5";
x.overrides.dneu.attemptHours[8] = "2";
x.startDate = "2026-10-28";
row(x, 0, { "-1": 10, 1: 90 });
row(x, 8, { 4: 25, 10: 75 });
row(x, 10, { 10: 5, 12: 95 });
x.ramp.periods[-1] = [period("add", "6", "5"), period("add", "1")];
x.ramp.periods[0] = [period("convert", "2", "4"), period("convert", "5")];
x.ramp.periods[8] = [period("convert", "2", "6"), period("share", "15")];
x.ramp.periods[10] = [period("share", "10")];
({ plan, wb } = compare("two domains", x, 150)); // run past the goal: finished domains stop working
assert.ok(plan.domains.every((d) => d.reachedDay !== null));
assert.strictEqual(compare("two domains, to the goal", x).wb.layout.days, Math.max(...plan.domains.map((d) => d.reachedDay)));
assert.deepStrictEqual(wb.sheets.slice(4).map((s) => s.name), ["Cardiology", "Neuro adult child"]);
assert.strictEqual(wb.layout.plan.table.tasks.length, 3); // all domains, then each domain

// 3. Evals (L4 and L8), with an eval repeating itself, one eval feeding another and sending tasks back;
//    tasks waiting at an eval on day 1; joins that change twice, with CBs leaving in between; L10 keeping 25% of L0
//    by converting from L1, the human layer below it.
x = M.exampleInputs();
x.evals = { 4: true, 8: true };
row(x, 4, { 4: 10, 8: 30, 10: 60 });
row(x, 8, { "-1": 20, 1: 10, 10: 70 });
x.backlog.all[4] = "30";
x.backlog.all[10] = "4";
x.ramp.start[-1] = "4";
x.ramp.periods[-1] = [period("add", "4", "10"), period("add", "-1", "7"), period("add", "3")];
x.ramp.periods[0] = [period("convert", "4")];
x.ramp.periods[1] = [period("convert", "3")];
x.ramp.periods[10] = [period("share", "25")];
x.targets.all = "400";
({ plan } = compare("evals", x));
assert.deepStrictEqual(plan.human, [-1, 0, 1, 10]);

// 4. A target the plan can't reach in a year: all 365 days, Mondays only, no final delivery.
x = M.exampleInputs();
x.targets.all = "1000000"; // 100,000 would be reached on day 253
({ plan, wb, mondayRows } = compare("not reached", x));
assert.strictEqual(plan.reachedDay, null);
assert.strictEqual(wb.layout.days, 365);
assert.strictEqual(mondayRows.length, 52);
assert.ok(mondayRows.every((day, i) => day === 3 + 7 * i));

// 5. Only L0 and L10, nobody joining for 3 days, then 5 a day; L10 keeps 20% of L0 for 10 days, then converts 1 a day.
x = M.exampleInputs();
for (const k of [1, 4, 8]) x = M.setLayer(x, k, false);
x.ramp.periods[-1] = [period("add", "0", "3"), period("add", "5")];
x.ramp.periods[10] = [period("share", "20", "10"), period("convert", "1")];
x.targets.all = "250";
compare("two layers", x);

// 6. Nobody joins, so conversions drain L−1 to nothing and come up short.
x = M.exampleInputs();
x.ramp.start[-1] = "12";
x.ramp.periods[-1] = [period("add", "0")];
x.targets.all = "60";
({ plan } = compare("drained", x));
assert.ok(Object.values(plan.short[0]).length > 0, "L0 comes up short");

// 7. The target is reached on a Monday: that Monday is the final delivery, with no extra row.
x = M.exampleInputs();
x.startDate = "2026-10-29"; // day 12 is Mon Nov 9
({ plan, mondayRows } = compare("done on a Monday", x));
assert.strictEqual(plan.reachedDay, 12);
assert.deepStrictEqual(mondayRows, [5, 12]);

// 8. Done before the first Monday: the final delivery is the only row.
x = M.exampleInputs();
for (const k of [1, 4, 8]) x = M.setLayer(x, k, false);
x.targets.all = "10";
x.startDate = "2026-10-27"; // a Tuesday, so the first Monday is day 7
({ plan, mondayRows } = compare("done before a Monday", x));
assert.ok(plan.reachedDay < 7, `reached on day ${plan.reachedDay}`);
assert.deepStrictEqual(mondayRows, [plan.reachedDay]);

// 9. Every layer above L0 keeps a % of L0 (50, 30, 20 and 10%), from CBs already at L0 and L1 on day 1, with halves
//    to round (10% of 25) and the at-least-1 floor while L0 is small.
x = M.exampleInputs();
x.ramp.start[0] = "25";
x.ramp.start[1] = "2";
x.ramp.periods[1] = [period("share", "50")];
x.ramp.periods[4] = [period("share", "30")];
x.ramp.periods[8] = [period("share", "20")];
x.ramp.periods[10] = [period("share", "10")];
x.targets.all = "300";
({ plan, wb } = compare("a % of L0", x));
assert.ok(Object.keys(wb.layout.ramp.conv[10]).includes("target"), "L10 has a target row");
assert.strictEqual(plan.curves[1][2], 13); // 50% of 25 is 12.5, so 13: 11 more from L0 on day 2
// The same layers converting set numbers have no target rows.
assert.ok(!("target" in compare("set numbers", M.exampleInputs()).wb.layout.ramp.conv[10]));

// 10. Done on day 1 (CBs already at L10 and tasks waiting there): a one-day sheet.
x = M.exampleInputs();
x.ramp.start[10] = "5";
x.backlog.all[10] = "50";
x.targets.all = "10";
({ plan, wb, mondayRows } = compare("done on day 1", x));
assert.strictEqual(plan.reachedDay, 1);
assert.strictEqual(wb.layout.days, 1);
assert.deepStrictEqual(mondayRows, [1]);

// The file itself: a zip whose parts are all there, deflated or stored, with the CRCs right.
async function files() {
  const c = M.validate(M.exampleInputs(), today);
  const book = E.build(c, M.exampleInputs(), { exportedOn: today, days: 30 });
  for (const deflate of [async (b) => new Uint8Array(zlib.deflateRawSync(b)), null]) {
    const bytes = Buffer.from(await book.bytes({ deflate }));
    const names = [];
    for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50;) {
      const method = bytes.readUInt16LE(at + 8);
      const size = bytes.readUInt32LE(at + 18);
      const nameLength = bytes.readUInt16LE(at + 26);
      const name = bytes.toString("utf8", at + 30, at + 30 + nameLength);
      const body = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
      const data = method === 8 ? zlib.inflateRawSync(body) : body;
      assert.strictEqual(X.crc32(data), bytes.readUInt32LE(at + 14), `CRC of ${name}`);
      names.push(name);
      at += 30 + nameLength + size;
    }
    assert.ok(names.includes("xl/workbook.xml") && names.includes("xl/worksheets/sheet5.xml") && names.includes("xl/sharedStrings.xml"));
  }
  assert.strictEqual(E.fileName(c), "Ramp plan 2026-10-24.xlsx");
}

files().then(() => console.log("export tests ok")).catch((e) => { console.error(e); process.exit(1); });
