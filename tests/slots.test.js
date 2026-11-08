const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../pb_public/slots.js");

const TZ = "America/Detroit";
// Helper: a Date for a wall-clock moment in Detroit (EST = UTC-5 in Nov/Dec/Jan).
const est = (ymd, hm = "12:00") => new Date(`${ymd}T${hm}:00-05:00`);
const FRI_SAT = [
  { weekday: 5, start: "09:00", end: "13:00" },
  { weekday: 6, start: "09:00", end: "13:00" },
];
const base = (over = {}) => ({ hours: FRI_SAT, blocks: [], leadDays: 2, slotMinutes: 30, bookAheadDays: 21, tz: TZ, ...over });
const dates = (r) => r.map((d) => d.date);

test("helpers: addDays crosses month and year", () => {
  assert.equal(S.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(S.addDays("2026-12-31", 1), "2027-01-01");
});

test("helpers: weekday", () => {
  assert.equal(S.weekday("2026-11-13"), 5); // Friday
  assert.equal(S.weekday("2026-11-15"), 0); // Sunday
});

test("helpers: localParts uses the shop time zone, not UTC", () => {
  // 11:30 PM Wed Nov 11 in Detroit is already Thu Nov 12 in UTC.
  const p = S.localParts(est("2026-11-11", "23:30"), TZ);
  assert.deepEqual(p, { date: "2026-11-11", minutes: 23 * 60 + 30 });
});

test("helpers: formatting", () => {
  assert.equal(S.formatDate("2026-11-14"), "Saturday, Nov 14");
  assert.equal(S.formatDate("2026-11-14", "short"), "Sat, Nov 14");
  assert.equal(S.formatTime("09:00"), "9:00 AM");
  assert.equal(S.formatTime("12:30"), "12:30 PM");
  assert.equal(S.formatTime("00:15"), "12:15 AM");
});

test("slots fill each block in steps and the last slot must fit", () => {
  const r = S.availableSlots(base({ now: est("2026-11-09") })); // Monday
  assert.equal(r[0].date, "2026-11-13");
  assert.deepEqual(r[0].times, ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("lead days: Wednesday order cannot pick up Thursday, first is Friday", () => {
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "10:00" }));
  const r = S.availableSlots(base({ hours, now: est("2026-11-11", "08:00") }));
  assert.equal(r[0].date, "2026-11-13");
});

test("lead days counts calendar dates even late at night", () => {
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "10:00" }));
  const r = S.availableSlots(base({ hours, now: est("2026-11-11", "23:59") }));
  assert.equal(r[0].date, "2026-11-13");
});

test("lead days 0 drops slots that already passed today", () => {
  const r = S.availableSlots(base({ leadDays: 0, now: est("2026-11-13", "10:10") }));
  assert.equal(r[0].date, "2026-11-13");
  assert.equal(r[0].times[0], "10:30");
});

test("book-ahead window is inclusive and stops after it", () => {
  const r = S.availableSlots(base({ bookAheadDays: 5, now: est("2026-11-09") })); // Mon → Sat 14 is day 5
  assert.deepEqual(dates(r), ["2026-11-13", "2026-11-14"]);
  const r2 = S.availableSlots(base({ bookAheadDays: 4, now: est("2026-11-09") }));
  assert.deepEqual(dates(r2), ["2026-11-13"]);
});

test("all-day single-date lockout removes that date", () => {
  const blocks = [{ start_date: "2026-11-13", end_date: "2026-11-13", all_day: true }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-14");
});

test("vacation range across a month boundary removes every date in it", () => {
  const blocks = [{ start_date: "2026-11-27", end_date: "2026-12-05", all_day: true }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-23") }));
  assert.deepEqual(dates(r).slice(0, 2), ["2026-12-11", "2026-12-12"]);
});

test("partial lockout removes only overlapping slots", () => {
  const blocks = [{ start_date: "2026-11-14", end_date: "2026-11-14", all_day: false, from: "10:15", to: "11:00" }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-09") }));
  const sat = r.find((d) => d.date === "2026-11-14");
  assert.deepEqual(sat.times, ["09:00", "09:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("partial lockout covering every slot removes the date", () => {
  const blocks = [{ start_date: "2026-11-13", end_date: "2026-11-13", all_day: false, from: "08:00", to: "14:00" }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-14");
});

test("two blocks on one weekday are merged in time order", () => {
  const hours = [
    { weekday: 5, start: "16:00", end: "17:00" },
    { weekday: 5, start: "09:00", end: "10:00" },
  ];
  const r = S.availableSlots(base({ hours, now: est("2026-11-09") }));
  assert.deepEqual(r[0].times, ["09:00", "09:30", "16:00", "16:30"]);
});

test("60-minute slots", () => {
  const r = S.availableSlots(base({ slotMinutes: 60, now: est("2026-11-09") }));
  assert.deepEqual(r[0].times, ["09:00", "10:00", "11:00", "12:00"]);
});

test("DST: the Saturday after clocks fall back still has normal slots", () => {
  // DST ends Sun Nov 1 2026. Ordering Thu Oct 29 (EDT) → Sat Oct 31 and Fri Nov 6 both normal.
  const now = new Date("2026-10-29T12:00:00-04:00");
  const r = S.availableSlots(base({ now }));
  assert.deepEqual(dates(r).slice(0, 3), ["2026-10-31", "2026-11-06", "2026-11-07"]);
  assert.equal(r[1].times.length, 8);
});

test("no hours means no dates", () => {
  assert.deepEqual(S.availableSlots(base({ hours: [], now: est("2026-11-09") })), []);
});

test("taken: a booked slot is removed", () => {
  const taken = [{ date: "2026-11-13", time: "09:30" }];
  const r = S.availableSlots(base({ taken, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-13");
  assert.deepEqual(r[0].times, ["09:00", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("taken: a fully booked day disappears", () => {
  const times = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"];
  const taken = times.map((time) => ({ date: "2026-11-13", time }));
  const r = S.availableSlots(base({ taken, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-14");
});

test("taken: bookings on another date don't affect a day", () => {
  const taken = [{ date: "2026-11-14", time: "09:00" }];
  const r = S.availableSlots(base({ taken, now: est("2026-11-09") }));
  assert.equal(r[0].times.length, 8);
  assert.equal(r[1].times[0], "09:30");
});

test("taken: works with 15-minute slots", () => {
  const taken = [{ date: "2026-11-13", time: "09:15" }];
  const r = S.availableSlots(base({ slotMinutes: 15, taken, now: est("2026-11-09") }));
  assert.deepEqual(r[0].times.slice(0, 3), ["09:00", "09:30", "09:45"]);
  assert.equal(r[0].times.length, 15);
});
