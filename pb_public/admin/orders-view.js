// Order rules shared by the admin Orders tab and the server's reminder email (pb_hooks/lib/reminders.js).
// Pure functions. "now" is the shop's own clock: { date: "YYYY-MM-DD", minutes: minutes since midnight }.
(function (root) {
  var toMin = function (hm) { var p = String(hm || "").split(":").map(Number); return p[0] * 60 + p[1]; };
  var absMin = function (date, minutes) {
    var d = String(date).split("-").map(Number);
    return Date.UTC(d[0], d[1] - 1, d[2]) / 60000 + minutes;
  };

  // Has this order's pickup window ended (plus `grace` minutes)? The window is one slot long.
  function windowEnded(b, now, slotMinutes, grace) {
    var len = Number(slotMinutes) || 15;
    return absMin(now.date, now.minutes) >= absMin(b.date, toMin(b.time)) + len + (grace || 0);
  }

  // Which list an order belongs in:
  //   cancelled · completed (picked up or no-show) · paying (customer at the Stripe page right now)
  //   needs_check (window passed, not ticked yet) · upcoming
  function classify(b, now, slotMinutes) {
    if (b.status === "cancelled") return "cancelled";
    if (b.pickup === "picked_up" || b.pickup === "no_show") return "completed";
    if (b.status === "held") return "paying";
    if (windowEnded(b, now, slotMinutes, 0)) return "needs_check";
    return "upcoming";
  }

  // The reminder email goes out once per order, `grace` minutes after its window ends.
  var REMINDER_GRACE = 30;
  function reminderDue(b, now, slotMinutes) {
    return (b.status === "paid" || b.status === "manual") && !b.pickup && !b.reminded &&
      windowEnded(b, now, slotMinutes, REMINDER_GRACE);
  }

  function lines(b) {
    var l = b.lines;
    if (typeof l === "string") { try { l = JSON.parse(l); } catch (_) { l = null; } }
    return Array.isArray(l) ? l.filter(function (x) { return x && x.name && x.qty > 0; }) : [];
  }

  // What to bake for a set of orders: loaves per bread, plus phone orders whose items are free text.
  // Only confirmed orders count: not cancelled ones, and not ones still at the payment page.
  function bakeList(orders) {
    var byName = {}, other = [], loaves = 0, cents = 0;
    orders.forEach(function (b) {
      if (b.status === "cancelled" || b.status === "held") return;
      cents += Number(b.amount_cents) || Math.round((Number(b.total) || 0) * 100);
      var ls = lines(b);
      if (!ls.length) { if (b.items) other.push({ name: b.name, items: b.items }); return; }
      ls.forEach(function (l) { byName[l.name] = (byName[l.name] || 0) + l.qty; loaves += l.qty; });
    });
    var items = Object.keys(byName).map(function (n) { return { name: n, qty: byName[n] }; })
      .sort(function (a, b) { return b.qty - a.qty || (a.name < b.name ? -1 : 1); });
    return { items: items, other: other, loaves: loaves, cents: cents };
  }

  // Search by name, email, or phone digits.
  function matches(b, q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return true;
    var digits = q.replace(/\D/g, "");
    if (digits.length >= 3 && String(b.phone || "").replace(/\D/g, "").indexOf(digits) >= 0) return true;
    return [b.name, b.email, b.items, b.notes].some(function (s) { return String(s || "").toLowerCase().indexOf(q) >= 0; });
  }

  // The friendly nudge on an order whose window has passed. Same order, same wording.
  var NUDGES = [
    "{n}'s pickup window has come and gone! Did they get their bread, and did you get yours? 😉 Hit that check ✓",
    "{n}'s pickup time has passed. Bread in their hands, dough in yours? 😉 Hit that check ✓",
    "Did {n} swing by? Their window has closed. If the bread found its home, hit that check ✓",
  ];
  function nudge(b) {
    var h = 0, s = String(b.id || b.name || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var first = String(b.name || "Your customer").split(" ")[0];
    return NUDGES[h % NUDGES.length].replace("{n}", first);
  }

  var api = { windowEnded: windowEnded, classify: classify, reminderDue: reminderDue, REMINDER_GRACE: REMINDER_GRACE,
    lines: lines, bakeList: bakeList, matches: matches, nudge: nudge };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LunoahOrders = api;
})(this);
