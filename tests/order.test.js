const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../pb_hooks/lib/order.js");
const S = require("../pb_public/slots.js");

const BREADS = [
  { id: "a", name: "Country Loaf", price: 12, hidden: false, sold_out: false },
  { id: "b", name: "Seeded", price: 9.99, hidden: false, sold_out: false },
  { id: "h", name: "Secret", price: 5, hidden: true, sold_out: false },
  { id: "s", name: "Rye", price: 8, hidden: false, sold_out: true },
  { id: "z", name: "Free", price: 0, hidden: false, sold_out: false },
];

test("priceLines uses server prices, not client ones", () => {
  const r = O.priceLines(BREADS, [{ id: "a", qty: 2, price: 0.01 }, { id: "b", qty: 1 }]);
  assert.deepEqual(r, {
    ok: true,
    amount_cents: 3399,
    lines: [
      { bread: "a", name: "Country Loaf", qty: 2, price_cents: 1200 },
      { bread: "b", name: "Seeded", qty: 1, price_cents: 999 },
    ],
  });
});

test("priceLines rejects bad input", () => {
  assert.equal(O.priceLines(BREADS, []).error, "empty");
  assert.equal(O.priceLines(BREADS, "x").error, "empty");
  assert.equal(O.priceLines(BREADS, [{ id: "nope", qty: 1 }]).error, "unavailable");
  assert.equal(O.priceLines(BREADS, [{ id: "h", qty: 1 }]).error, "unavailable");
  assert.equal(O.priceLines(BREADS, [{ id: "z", qty: 1 }]).error, "unavailable");
  assert.deepEqual(O.priceLines(BREADS, [{ id: "s", qty: 1 }]), { ok: false, error: "sold_out", bread: "Rye" });
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 0 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 1.5 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: "2" }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 13 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 1 }, { id: "a", qty: 1 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 12 }, { id: "b", qty: 12 }]).ok, true);
  assert.equal(O.priceLines(BREADS.concat([{ id: "c", name: "C", price: 1 }]), [{ id: "a", qty: 12 }, { id: "b", qty: 12 }, { id: "c", qty: 1 }]).error, "too_many");
  assert.equal(O.priceLines([{ id: "t", name: "T", price: 0.25 }], [{ id: "t", qty: 1 }]).error, "too_small");
});

test("cleanName and normalizePhone", () => {
  assert.equal(O.cleanName("  Sam   Rivera "), "Sam Rivera");
  assert.equal(O.cleanName("   "), null);
  assert.equal(O.cleanName("x".repeat(101)), null);
  assert.equal(O.normalizePhone("(313) 555-0100"), "313-555-0100");
  assert.equal(O.normalizePhone("+1 313 555 0100"), "313-555-0100");
  assert.equal(O.normalizePhone("555-0100"), null);
  assert.equal(O.normalizePhone("013-555-0100"), null);
});

test("slotIsOpen checks hours, lead days, alignment and taken", () => {
  const o = {
    hours: [{ weekday: 5, start: "09:00", end: "13:00" }], blocks: [],
    shop: { lead_days: 2, slot_minutes: 15, book_ahead_days: 21 },
    taken: [{ date: "2026-11-20", time: "09:15" }],
    today: { date: "2026-11-14", minutes: 600 },
  };
  const at = (over) => O.slotIsOpen(S.availableSlots, Object.assign({}, o, over));
  assert.equal(at({ date: "2026-11-20", time: "09:00" }), true);
  assert.equal(at({ date: "2026-11-20", time: "09:15" }), false); // taken
  assert.equal(at({ date: "2026-11-20", time: "09:05" }), false); // misaligned
  assert.equal(at({ date: "2026-11-20", time: "13:00" }), false); // after close
  assert.equal(at({ date: "2026-11-21", time: "09:00" }), false); // closed day
  assert.equal(at({ today: { date: "2026-11-19", minutes: 600 }, date: "2026-11-20", time: "09:00" }), false); // lead days
  assert.equal(at({ blocks: [{ start_date: "2026-11-20", end_date: "2026-11-20", all_day: true }], date: "2026-11-20", time: "09:00" }), false);
  assert.equal(at({ shop: { lead_days: 0, slot_minutes: 15, book_ahead_days: 21 }, today: { date: "2026-11-20", minutes: 600 }, date: "2026-11-20", time: "09:00" }), false); // already past today
});

test("cancelDeadline is 2 hours after paying or the pickup, whichever is first", () => {
  const paid = Date.UTC(2026, 10, 13, 12, 0);
  assert.equal(O.cancelDeadline(paid, paid + 10 * 3600000), paid + 2 * 3600000);
  assert.equal(O.cancelDeadline(paid, paid + 3600000), paid + 3600000);
});
