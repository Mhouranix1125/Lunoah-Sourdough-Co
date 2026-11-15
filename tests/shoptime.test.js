const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../pb_hooks/lib/shoptime.js");
const S = require("../pb_public/slots.js");

test("shopNow: winter is UTC-5, summer is UTC-4", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 14, 17, 0)), { date: "2026-11-14", minutes: 720 });
  assert.deepEqual(T.shopNow(Date.UTC(2026, 6, 4, 16, 0)), { date: "2026-07-04", minutes: 720 });
});

test("shopNow: DST starts 2nd Sunday of March at 2:00", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 2, 8, 6, 59)), { date: "2026-03-08", minutes: 119 });
  assert.deepEqual(T.shopNow(Date.UTC(2026, 2, 8, 7, 0)), { date: "2026-03-08", minutes: 180 });
});

test("shopNow: DST ends 1st Sunday of November at 2:00", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 1, 5, 59)), { date: "2026-11-01", minutes: 119 });
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 1, 6, 0)), { date: "2026-11-01", minutes: 60 });
});

test("shopNow: just before midnight stays on the shop's date", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 15, 4, 59)), { date: "2026-11-14", minutes: 1439 });
});

test("shopNow matches Intl for every hour of 2026-2028", () => {
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2029, 0, 1); ms += 3600000 + 17 * 60000) {
    assert.deepEqual(T.shopNow(ms), S.localParts(new Date(ms), "America/Detroit"), new Date(ms).toISOString());
  }
});

test("shopToUtc", () => {
  assert.equal(T.shopToUtc("2026-11-13", "09:15"), Date.UTC(2026, 10, 13, 14, 15));
  assert.equal(T.shopToUtc("2026-07-04", "09:00"), Date.UTC(2026, 6, 4, 13, 0));
});

test("label and clock", () => {
  assert.equal(T.label("2026-11-13", "09:15"), "Fri, Nov 13 at 9:15 AM");
  assert.equal(T.label("2026-11-14", "13:00"), "Sat, Nov 14 at 1:00 PM");
  assert.equal(T.clock(Date.UTC(2026, 10, 13, 16, 42)), "11:42 AM");
  assert.equal(T.clock(Date.UTC(2026, 10, 13, 5, 5)), "12:05 AM");
});
