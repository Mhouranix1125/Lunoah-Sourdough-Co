// Order rules shared by the checkout route. Pure functions: no PocketBase globals.
var MAX_PER_BREAD = 12;
var MAX_LOAVES = 24;
var MIN_CENTS = 50; // Stripe's minimum charge
var CANCEL_WINDOW_MS = 2 * 3600000;

function priceLines(breads, items) {
  if (!Array.isArray(items) || !items.length) return { ok: false, error: "empty" };
  var byId = {};
  breads.forEach(function (b) { byId[b.id] = b; });
  var seen = {};
  var lines = [];
  var loaves = 0;
  var cents = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var b = byId[String(it.id || "")];
    if (!b || b.hidden) return { ok: false, error: "unavailable" };
    if (seen[b.id] || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > MAX_PER_BREAD) {
      return { ok: false, error: "bad_qty", bread: b.name };
    }
    seen[b.id] = true;
    if (b.sold_out) return { ok: false, error: "sold_out", bread: b.name };
    var price = Math.round(Number(b.price) * 100);
    if (!(price > 0)) return { ok: false, error: "unavailable", bread: b.name };
    loaves += it.qty;
    cents += it.qty * price;
    lines.push({ bread: b.id, name: b.name, qty: it.qty, price_cents: price });
  }
  if (loaves > MAX_LOAVES) return { ok: false, error: "too_many" };
  if (cents < MIN_CENTS) return { ok: false, error: "too_small" };
  return { ok: true, lines: lines, amount_cents: cents };
}

function cleanName(s) {
  s = String(s || "").trim().replace(/\s+/g, " ");
  return s.length >= 1 && s.length <= 100 ? s : null;
}

function normalizePhone(s) {
  var d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
}

// availableSlots is slots.js's function, passed in so this file needs no require.
function slotIsOpen(availableSlots, o) {
  var shop = o.shop || {};
  var days = availableSlots({
    hours: o.hours, blocks: o.blocks, taken: o.taken || [], today: o.today,
    leadDays: shop.lead_days == null ? 2 : shop.lead_days,
    slotMinutes: shop.slot_minutes || 15,
    bookAheadDays: shop.book_ahead_days || 21,
  });
  for (var i = 0; i < days.length; i++) {
    if (days[i].date === o.date) return days[i].times.indexOf(o.time) >= 0;
  }
  return false;
}

function cancelDeadline(paidAtMs, pickupUtcMs) {
  return Math.min(paidAtMs + CANCEL_WINDOW_MS, pickupUtcMs);
}

module.exports = {
  MAX_PER_BREAD: MAX_PER_BREAD, MAX_LOAVES: MAX_LOAVES, CANCEL_WINDOW_MS: CANCEL_WINDOW_MS,
  priceLines: priceLines, cleanName: cleanName, normalizePhone: normalizePhone,
  slotIsOpen: slotIsOpen, cancelDeadline: cancelDeadline,
};
