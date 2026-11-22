const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../pb_public/admin/orders-view.js");

const now = (date, hm) => { const [h, m] = hm.split(":").map(Number); return { date, minutes: h * 60 + m }; };
const order = (over = {}) => ({ id: "abc", name: "Sam Lee", date: "2026-11-27", time: "10:00", status: "paid", pickup: "", reminded: false, ...over });

test("classify: upcoming until the window (one slot) ends, then needs a check", () => {
  assert.equal(V.classify(order(), now("2026-11-27", "10:14"), 15), "upcoming");
  assert.equal(V.classify(order(), now("2026-11-27", "10:15"), 15), "needs_check");
  assert.equal(V.classify(order(), now("2026-11-28", "08:00"), 15), "needs_check", "next day");
  assert.equal(V.classify(order(), now("2026-11-26", "23:59"), 15), "upcoming", "day before");
});

test("classify: cancelled, completed and paying win over time", () => {
  const late = now("2026-12-30", "12:00");
  assert.equal(V.classify(order({ status: "cancelled", pickup: "picked_up" }), late, 15), "cancelled");
  assert.equal(V.classify(order({ pickup: "picked_up" }), late, 15), "completed");
  assert.equal(V.classify(order({ pickup: "no_show" }), late, 15), "completed");
  assert.equal(V.classify(order({ status: "held" }), late, 15), "paying");
  assert.equal(V.classify(order({ status: "manual" }), late, 15), "needs_check");
});

test("reminderDue: 30 minutes after the window, once, only for unticked paid or phone orders", () => {
  assert.equal(V.reminderDue(order(), now("2026-11-27", "10:44"), 15), false);
  assert.equal(V.reminderDue(order(), now("2026-11-27", "10:45"), 15), true);
  assert.equal(V.reminderDue(order({ reminded: true }), now("2026-11-27", "11:00"), 15), false);
  assert.equal(V.reminderDue(order({ pickup: "picked_up" }), now("2026-11-27", "11:00"), 15), false);
  assert.equal(V.reminderDue(order({ status: "cancelled" }), now("2026-11-27", "11:00"), 15), false);
  assert.equal(V.reminderDue(order({ status: "held" }), now("2026-11-27", "11:00"), 15), false);
  assert.equal(V.reminderDue(order({ status: "manual" }), now("2026-11-27", "11:00"), 15), true);
});

test("reminderDue: a late-evening pickup's reminder crosses midnight correctly", () => {
  const o = order({ time: "23:45" });
  assert.equal(V.reminderDue(o, now("2026-11-28", "00:29"), 15), false);
  assert.equal(V.reminderDue(o, now("2026-11-28", "00:30"), 15), true);
});

test("bakeList: adds loaves per bread, keeps phone orders' notes, skips cancelled", () => {
  const r = V.bakeList([
    order({ lines: [{ name: "Country Loaf", qty: 2, price_cents: 1200 }, { name: "Rye", qty: 1, price_cents: 1000 }], amount_cents: 3400 }),
    order({ lines: JSON.stringify([{ name: "Country Loaf", qty: 3, price_cents: 1200 }]), amount_cents: 3600 }),
    order({ status: "manual", lines: null, items: "2 baguettes, paid cash", total: 0 }),
    order({ status: "cancelled", lines: [{ name: "Rye", qty: 9, price_cents: 1000 }], amount_cents: 9000 }),
  ]);
  assert.deepEqual(r.items, [{ name: "Country Loaf", qty: 5 }, { name: "Rye", qty: 1 }]);
  assert.deepEqual(r.other, [{ name: "Sam Lee", items: "2 baguettes, paid cash" }]);
  assert.equal(r.loaves, 6);
  assert.equal(r.cents, 7000);
});

test("matches: name, email, notes, and phone digits in any format", () => {
  const o = order({ phone: "313-555-0199", email: "sam@example.com", notes: "extra crusty" });
  for (const q of ["sam", "LEE", "example.com", "crusty", "3135550199", "(313) 555", "0199", ""]) assert.ok(V.matches(o, q), q);
  assert.ok(!V.matches(o, "maria"));
  assert.ok(!V.matches(o, "99"), "two digits is too short to search phones");
});

test("nudge: uses the first name, and the same order always gets the same wording", () => {
  const a = V.nudge(order());
  assert.match(a, /^(Sam's|Did Sam)/);
  assert.match(a, /check ✓$/);
  assert.equal(V.nudge(order()), a);
});

test("bakeList: an order still at the payment page isn't counted yet", () => {
  const r = V.bakeList([order({ status: "held", lines: [{ name: "Rye", qty: 4, price_cents: 1000 }], amount_cents: 4000 })]);
  assert.deepEqual(r.items, []);
  assert.equal(r.cents, 0);
});
