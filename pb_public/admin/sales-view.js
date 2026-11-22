// Sales history and the yearly tax CSV, shared by the admin "Sales" tab and the tests. Pure functions.
//
// Money is dated by when it actually moved (how a tax preparer counts it):
//   card sale    the day Stripe confirmed the payment (paid_at)
//   phone order  its pickup day (that's when she's paid in cash/Venmo/Zelle)
//   refund       the day it was cancelled and refunded (cancelled_at)
// So a December sale refunded in January shows up in both years, correctly.
(function (root) {
  var CAP_CENTS = 5000000; // Michigan cottage food limit: $50,000 in sales per year
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var METHOD = { card: "Card (Stripe)", cash: "Cash", venmo: "Venmo", zelle: "Zelle", other: "Other" };

  function lines(b) {
    var l = b.lines;
    if (typeof l === "string") { try { l = JSON.parse(l); } catch (_) { l = null; } }
    return Array.isArray(l) ? l.filter(function (x) { return x && x.name && x.qty > 0; }) : [];
  }
  function itemsText(b) {
    var ls = lines(b);
    return ls.length ? ls.map(function (l) { return l.qty + " × " + l.name; }).join(", ") : String(b.items || "");
  }
  function cents(b) { return Number(b.amount_cents) || Math.round((Number(b.total) || 0) * 100); }
  // Paid on the website through Stripe (as opposed to a phone order she recorded herself).
  function isStripe(b) { return !!b.stripe_payment_intent || b.status === "paid" || b.status === "held"; }
  function pickupStatus(b) {
    if (b.status === "cancelled") return "Cancelled";
    if (b.pickup === "picked_up") return "Picked up";
    if (b.pickup === "no_show") return "No-show";
    return "Not picked up yet";
  }
  // PocketBase "created" is "2026-11-22 07:43:28.420Z" (UTC).
  function createdMs(b) { var t = Date.parse(String(b.created || "").replace(" ", "T")); return isNaN(t) ? 0 : t; }

  // Every money movement in the orders. localDate(ms) turns a time into the shop's "YYYY-MM-DD".
  function transactions(bookings, localDate) {
    var out = [];
    bookings.forEach(function (b) {
      var amount = cents(b);
      if (!(amount > 0)) return;
      var card = isStripe(b);
      var date;
      if (card) {
        if (b.status === "held") return; // still at the payment page: no money yet
        if (b.status === "cancelled" && !b.stripe_payment_intent && !b.paid_at) return; // never paid
        date = b.paid_at ? localDate(b.paid_at) : (createdMs(b) ? localDate(createdMs(b)) : b.date);
      } else {
        if (!b.paid_via || b.status === "cancelled") return; // phone order not paid, or called off
        date = b.date;
      }
      var base = { id: b.id, name: b.name, items: itemsText(b), method: card ? "card" : b.paid_via, status: pickupStatus(b), pickup_date: b.date };
      out.push(Object.assign({ kind: "sale", date: date, cents: amount,
        note: b.refund_status === "failed" ? "Cancelled; refund didn't go through" : b.refund_status === "partial" ? "Partly refunded (amount in Stripe)" : "" }, base));
      if (b.refund_status === "refunded") {
        var when = b.cancelled_at ? localDate(b.cancelled_at) : date;
        out.push(Object.assign({ kind: "refund", date: when, cents: -amount, note: "Refunded to card" }, base));
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "sale" ? -1 : 1; });
  }

  function years(txns, currentYear) {
    var set = {};
    set[currentYear] = true;
    txns.forEach(function (t) { set[t.date.slice(0, 4)] = true; });
    return Object.keys(set).sort().reverse();
  }

  function emptyTotals() { return { orders: 0, card: 0, other: 0, byMethod: {}, refunds: 0, gross: 0, net: 0, items: 0 }; }
  function add(tot, t) {
    if (t.kind === "sale") {
      tot.orders++;
      tot.gross += t.cents;
      if (t.method === "card") tot.card += t.cents; else tot.other += t.cents;
      tot.byMethod[t.method] = (tot.byMethod[t.method] || 0) + t.cents;
    } else tot.refunds += -t.cents;
    tot.net = tot.gross - tot.refunds;
  }

  // One year: totals, and a row per month (January to December) with its transactions.
  function summarize(txns, year) {
    var months = MONTHS.map(function (label, i) {
      var key = year + "-" + (i < 9 ? "0" : "") + (i + 1);
      return { key: key, label: label, txns: [], totals: emptyTotals() };
    });
    var total = emptyTotals();
    txns.forEach(function (t) {
      if (t.date.slice(0, 4) !== String(year)) return;
      var m = months[Number(t.date.slice(5, 7)) - 1];
      m.txns.push(t);
      add(m.totals, t);
      add(total, t);
    });
    return { year: String(year), months: months, total: total, capCents: CAP_CENTS };
  }

  // ----- CSV -----
  var money = function (c) { return (c / 100).toFixed(2); };
  function cell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // stop spreadsheets running a name as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function row(a) { return a.map(cell).join(","); }

  function toCSV(summary) {
    var out = [];
    out.push(row(["Lunoah Sourdough Co. sales " + summary.year]));
    out.push("");
    out.push(row(["Month", "Date", "Type", "Customer", "Items", "Paid with", "Amount ($)", "Pickup date", "Order status", "Note"]));
    summary.months.forEach(function (m) {
      m.txns.forEach(function (t) {
        out.push(row([m.label, t.date, t.kind === "sale" ? "Sale" : "Refund", t.name, t.items, METHOD[t.method] || t.method,
          money(t.cents), t.pickup_date, t.status, t.note]));
      });
    });
    out.push("");
    out.push(row(["Monthly totals"]));
    out.push(row(["Month", "Orders", "Card sales ($)", "Cash ($)", "Venmo ($)", "Zelle ($)", "Other ($)", "Refunds ($)", "Net sales ($)"]));
    function totalsRow(label, t) {
      var b = t.byMethod;
      return row([label, t.orders, money(b.card || 0), money(b.cash || 0), money(b.venmo || 0), money(b.zelle || 0), money(b.other || 0),
        money(-t.refunds), money(t.net)]);
    }
    summary.months.forEach(function (m) { out.push(totalsRow(m.label, m.totals)); });
    out.push(totalsRow("Year " + summary.year, summary.total));
    out.push("");
    out.push(row(["Card processing fees are not included. Download them from Stripe: Reports → Balance."]));
    return "﻿" + out.join("\r\n") + "\r\n"; // BOM so Excel reads "×" and accents correctly
  }

  var api = { CAP_CENTS: CAP_CENTS, MONTHS: MONTHS, METHOD: METHOD, transactions: transactions, years: years, summarize: summarize, toCSV: toCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LunoahSales = api;
})(this);
