const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../pb_public/admin/sales-view.js");

// Shop-local date for a time (Detroit, EST = UTC-5 in these tests).
const localDate = (ms) => new Date(ms - 5 * 3600000).toISOString().slice(0, 10);
const at = (ymdhm) => Date.parse(ymdhm + ":00-05:00");
const web = (over = {}) => ({ id: "w" + Math.random(), name: "Sam Lee", date: "2026-11-27", time: "10:00", status: "paid", order_code: "WEB",
  stripe_payment_intent: "pi_1", amount_cents: 2400, lines: [{ name: "Country Loaf", qty: 2, price_cents: 1200 }], paid_at: at("2026-11-20T09:00"), pickup: "", refund_status: "none", ...over });
const phone = (over = {}) => ({ id: "p" + Math.random(), name: "Maria Gomez", date: "2026-11-28", time: "09:00", status: "manual", order_code: "PHONE",
  amount_cents: 1500, total: 15, items: "1 rye", paid_via: "cash", pickup: "", refund_status: "none", ...over });

test("a card sale is dated the day it was paid, a phone sale on its pickup day", () => {
  const t = V.transactions([web(), phone()], localDate);
  assert.deepEqual(t.map((x) => [x.kind, x.date, x.method, x.cents]), [["sale", "2026-11-20", "card", 2400], ["sale", "2026-11-28", "cash", 1500]]);
  assert.equal(t[0].items, "2 × Country Loaf");
});

test("late-evening payment counts on the shop's own date, not UTC's", () => {
  const t = V.transactions([web({ paid_at: at("2026-12-31T22:30") })], localDate);
  assert.equal(t[0].date, "2026-12-31");
});

test("refunds are their own dated rows; a December sale refunded in January lands in both years", () => {
  const b = web({ paid_at: at("2026-12-30T10:00"), status: "cancelled", refund_status: "refunded", cancelled_at: at("2027-01-02T08:00") });
  const t = V.transactions([b], localDate);
  assert.deepEqual(t.map((x) => [x.kind, x.date, x.cents]), [["sale", "2026-12-30", 2400], ["refund", "2027-01-02", -2400]]);
  assert.equal(V.summarize(t, 2026).total.net, 2400);
  assert.equal(V.summarize(t, 2027).total.net, -2400);
});

test("not counted: payments in progress, unpaid or cancelled phone orders, zero amounts", () => {
  const t = V.transactions([
    web({ status: "held", stripe_payment_intent: "", paid_at: 0 }),
    phone({ paid_via: "" }),
    phone({ status: "cancelled" }),
    phone({ amount_cents: 0, total: 0 }),
  ], localDate);
  assert.deepEqual(t, []);
});

test("no-shows and cancelled-with-failed-refund still count as income, with a note", () => {
  const t = V.transactions([web({ pickup: "no_show" }), web({ status: "cancelled", refund_status: "failed" })], localDate);
  assert.equal(t.length, 2);
  assert.ok(t.some((x) => x.status === "No-show" && x.cents === 2400));
  assert.match(t.find((x) => x.status === "Cancelled").note, /refund didn't go through/);
});

test("summarize: monthly and yearly totals split by payment method", () => {
  const t = V.transactions([
    web({ paid_at: at("2026-10-05T09:00") }),
    web({ paid_at: at("2026-11-05T09:00"), amount_cents: 1000, status: "cancelled", refund_status: "refunded", cancelled_at: at("2026-11-06T09:00") }),
    phone({ date: "2026-11-10", paid_via: "venmo" }),
    phone({ date: "2026-11-11", paid_via: "cash", amount_cents: 500 }),
  ], localDate);
  const s = V.summarize(t, 2026);
  const nov = s.months[10].totals;
  assert.equal(s.months.length, 12);
  assert.deepEqual([nov.orders, nov.card, nov.other, nov.refunds, nov.net], [3, 1000, 2000, 1000, 2000]);
  assert.deepEqual(nov.byMethod, { card: 1000, venmo: 1500, cash: 500 });
  assert.deepEqual([s.total.orders, s.total.gross, s.total.refunds, s.total.net], [4, 5400, 1000, 4400]);
  assert.equal(s.capCents, 5000000);
});

test("years: every year with money, plus the current year, newest first", () => {
  const t = V.transactions([web({ paid_at: at("2026-11-20T09:00") }), phone({ date: "2028-02-01" })], localDate);
  assert.deepEqual(V.years(t, "2027"), ["2028", "2027", "2026"]);
});

test("CSV: grouped by month, monthly and year totals, safe quoting, opens in Excel", () => {
  const t = V.transactions([
    web({ name: 'Ann "AJ" Smith', paid_at: at("2026-11-20T09:00") }),
    phone({ name: "=HYPERLINK(evil)", items: "2 rye, 1 baguette", date: "2026-12-01" }),
  ], localDate);
  const csv = V.toCSV(V.summarize(t, 2026));
  assert.ok(csv.startsWith("﻿"), "BOM for Excel");
  const rows = csv.slice(1).split("\r\n");
  assert.equal(rows[0], "Lunoah Sourdough Co. sales 2026");
  assert.ok(rows.includes('November,2026-11-20,Sale,"Ann ""AJ"" Smith",2 × Country Loaf,Card (Stripe),24.00,2026-11-27,Not picked up yet,'));
  assert.ok(rows.includes(`December,2026-12-01,Sale,'=HYPERLINK(evil),"2 rye, 1 baguette",Cash,15.00,2026-12-01,Not picked up yet,`));
  assert.ok(rows.includes("November,1,24.00,0.00,0.00,0.00,0.00,0.00,24.00"));
  assert.ok(rows.includes("Year 2026,2,24.00,15.00,0.00,0.00,0.00,0.00,39.00"));
  assert.ok(rows.indexOf("Monthly totals") > rows.findIndex((r) => r.startsWith("December,2026-12-01")));
});
