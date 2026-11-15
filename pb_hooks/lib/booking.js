// Booking operations that touch the database and Stripe. Every function that may free a
// slot asks Stripe first, so a payment is never lost because a webhook was missed.
var HOLD_MS = 36 * 60000;
var SESSION_SEC = 31 * 60;
var MAX_HOLDS_PER_IP = 2;
var FORCE_RELEASE_MS = 24 * 3600000;

function lib(n) { return require(__hooks + "/lib/" + n + ".js"); }
function slotsLib() { return require(__hooks + "/../pb_public/slots.js"); }
function shopRecord() { return $app.findFirstRecordByFilter("shop", "id != ''"); }
function fail(e, status, code, message, extra) {
  var body = { code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return e.json(status, body);
}

function byToken(k) {
  if (!/^[A-Za-z0-9]{32}$/.test(String(k || ""))) return null;
  try { return $app.findFirstRecordByData("bookings", "token", k); } catch (_) { return null; }
}

function findById(id) {
  try { return $app.findRecordById("bookings", id); } catch (_) { return null; }
}

function refundPayment(pi, key) {
  var r = lib("stripe").api("POST", "/v1/refunds", { payment_intent: pi }, key);
  var code = r.json && r.json.error && r.json.error.code;
  if (code === "charge_already_refunded") return { status: 200, json: {} };
  return r;
}

// Called by the webhook and by the order/sweep checks with a session fetched from Stripe.
function confirmPaid(id, s) {
  if (!s || s.payment_status !== "paid" || s.currency !== "usd" || !s.metadata || s.metadata.booking !== id) return null;
  var rec = findById(id);
  if (rec && rec.getString("status") !== "held") return rec; // already handled
  if (rec && rec.getInt("amount_cents") === s.amount_total) {
    rec.set("status", "paid");
    rec.set("paid_at", Date.now());
    rec.set("email", (s.customer_details && s.customer_details.email) || "");
    rec.set("stripe_payment_intent", s.payment_intent || "");
    $app.save(rec);
    if (!rec.getBool("emailed")) {
      lib("mail").orderEmails(rec);
      rec.set("emailed", true);
      $app.save(rec);
    }
    return rec;
  }
  // The hold is gone or the amount doesn't match: we can't honour this payment. Refund it.
  if (s.payment_intent) refundPayment(s.payment_intent, "orphan-" + id);
  if (rec) $app.delete(rec);
  lib("mail").apologyEmail(s.customer_details && s.customer_details.email, s.amount_total);
  return null;
}

// Frees a hold, unless Stripe says it was paid (then it is confirmed instead).
function releaseHold(rec) {
  if (rec.getString("status") !== "held") return "kept";
  var X = lib("stripe");
  var sid = rec.getString("stripe_session");
  if (sid) {
    var exp = X.api("POST", "/v1/checkout/sessions/" + sid + "/expire", null, null);
    if (exp.status !== 200) {
      var g = X.api("GET", "/v1/checkout/sessions/" + sid, null, null);
      if (g.status === 200 && g.json.status === "complete") {
        return confirmPaid(rec.id, g.json) ? "paid" : "released";
      }
      var stuck = g.status !== 200 || g.json.status === "open";
      if (stuck && Date.now() < rec.getInt("hold_expires") + FORCE_RELEASE_MS) return "kept";
    }
  }
  $app.delete(rec);
  return "released";
}

function sweep() {
  var stale = $app.findRecordsByFilter("bookings", "status = 'held' && hold_expires < {:now}", "", 200, 0, { now: Date.now() });
  stale.forEach(function (r) {
    try { releaseHold(r); } catch (err) { $app.logger().error("lunoah sweep", "id", r.id, "error", String(err)); }
  });
}

function breadList() {
  return $app.findAllRecords("breads").map(function (r) {
    return { id: r.id, name: r.getString("name"), price: r.getFloat("price"), hidden: r.getBool("hidden"), sold_out: r.getBool("sold_out") };
  });
}

function pickupState(today) {
  var hours = $app.findAllRecords("pickup_hours").map(function (r) {
    return { weekday: r.getInt("weekday"), start: r.getString("start"), end: r.getString("end") };
  });
  var blocks = $app.findRecordsByFilter("pickup_blocks", "end_date >= {:d}", "", 1000, 0, { d: today.date }).map(function (r) {
    return { start_date: r.getString("start_date"), end_date: r.getString("end_date"), all_day: r.getBool("all_day"), from: r.getString("from"), to: r.getString("to") };
  });
  var taken = $app.findRecordsByFilter("bookings", "date >= {:d} && status != 'cancelled'", "", 5000, 0, { d: today.date }).map(function (r) {
    return { date: r.getString("date"), time: r.getString("time") };
  });
  return { hours: hours, blocks: blocks, taken: taken };
}

function checkout(e) {
  var X = lib("stripe"), O = lib("order"), T = lib("shoptime");
  if (!X.configured($os.getenv)) return fail(e, 503, "offline", "Online ordering is paused.");
  var body = e.requestInfo().body || {};

  if (body.previous) {
    var prev = byToken(body.previous);
    if (prev && prev.getString("status") === "held") releaseHold(prev);
  }

  var name = O.cleanName(body.name);
  if (!name) return fail(e, 400, "name", "Please enter your name.");
  var phone = O.normalizePhone(body.phone);
  if (!phone) return fail(e, 400, "phone", "Please enter a 10-digit phone number.");
  var notes = String(body.notes || "").trim().slice(0, 500);
  var date = String(body.date || ""), time = String(body.time || "");

  var priced = O.priceLines(breadList(), body.items);
  if (!priced.ok) {
    var msgs = {
      empty: "Your basket is empty.",
      unavailable: "One of your breads is no longer available. Please refresh the page.",
      bad_qty: "Please check the quantities in your order.",
      sold_out: (priced.bread || "A bread") + " just sold out. We've updated your basket.",
      too_many: "Online orders are limited to " + O.MAX_LOAVES + " loaves. For bigger orders, please text Nadia.",
      too_small: "Your order is too small to pay online.",
    };
    return fail(e, 400, priced.error, msgs[priced.error], { bread: priced.bread || "" });
  }

  sweep(); // clear expired holds (asks Stripe first)

  var now = Date.now();
  var today = T.shopNow(now);
  var st = pickupState(today);
  var s = shopRecord();
  var shop = { lead_days: s.getInt("lead_days"), slot_minutes: s.getInt("slot_minutes"), book_ahead_days: s.getInt("book_ahead_days") };
  var open = O.slotIsOpen(slotsLib().availableSlots, { hours: st.hours, blocks: st.blocks, taken: st.taken, shop: shop, today: today, date: date, time: time });
  if (!open) return fail(e, 409, "taken", "That pickup time isn't available any more.");

  var ip = e.remoteIP();
  var mine = $app.findRecordsByFilter("bookings", "status = 'held' && ip = {:ip} && hold_expires > {:now}", "", 10, 0, { ip: ip, now: now });
  if (mine.length >= MAX_HOLDS_PER_IP) return fail(e, 429, "holds", "You already have a payment in progress. Finish it or wait a few minutes.");

  var token = $security.randomString(32);
  var rec = new Record($app.findCollectionByNameOrId("bookings"));
  rec.set("date", date); rec.set("time", time); rec.set("name", name); rec.set("phone", phone); rec.set("notes", notes);
  rec.set("lines", priced.lines); rec.set("amount_cents", priced.amount_cents); rec.set("total", priced.amount_cents / 100);
  rec.set("items", priced.lines.map(function (l) { return l.qty + " × " + l.name; }).join(", ").slice(0, 1000));
  rec.set("order_code", "WEB"); rec.set("status", "held"); rec.set("refund_status", "none");
  rec.set("hold_expires", now + HOLD_MS); rec.set("token", token); rec.set("ip", ip);
  try {
    $app.save(rec);
  } catch (err) {
    return fail(e, 409, "taken", "That pickup time was just taken.");
  }

  var site = $os.getenv("SITE_URL");
  var r = X.api("POST", "/v1/checkout/sessions", {
    mode: "payment",
    payment_method_types: ["card", "link"],
    client_reference_id: rec.id,
    metadata: { booking: rec.id },
    expires_at: Math.floor(now / 1000) + SESSION_SEC,
    line_items: priced.lines.map(function (l) {
      return { quantity: l.qty, price_data: { currency: "usd", unit_amount: l.price_cents, product_data: { name: l.name } } };
    }),
    payment_intent_data: { description: "Lunoah pickup " + T.label(date, time) + " (" + name + ")", metadata: { booking: rec.id } },
    custom_text: { submit: { message: "Pickup " + T.label(date, time) + ". You can cancel for a full refund within 2 hours of ordering." } },
    success_url: site + "/order.html?k=" + token,
    cancel_url: site + "/?back=" + token,
  }, "session-" + rec.id);
  if (r.status !== 200 || !r.json.url) {
    $app.logger().error("lunoah stripe session", "status", r.status, "error", JSON.stringify(r.json.error || {}));
    $app.delete(rec);
    return fail(e, 503, "stripe", "Payments are unavailable right now. Please try again in a few minutes.");
  }
  rec.set("stripe_session", r.json.id);
  $app.save(rec);
  return e.json(200, { url: r.json.url, token: token });
}

// If still held, ask Stripe directly (covers a missed or late webhook).
function refreshHeld(rec) {
  if (rec.getString("status") !== "held" || !rec.getString("stripe_session")) return rec;
  var g = lib("stripe").api("GET", "/v1/checkout/sessions/" + rec.getString("stripe_session"), null, null);
  if (g.status === 200 && g.json.status === "complete") confirmPaid(rec.id, g.json);
  return findById(rec.id);
}

function summary(rec) {
  var T = lib("shoptime"), O = lib("order");
  var s = shopRecord();
  var date = rec.getString("date"), time = rec.getString("time");
  var status = rec.getString("status");
  var paidAt = rec.getInt("paid_at");
  var deadline = status === "paid" && paidAt && rec.getString("stripe_payment_intent") ? O.cancelDeadline(paidAt, T.shopToUtc(date, time)) : 0;
  return {
    status: status, name: rec.getString("name"), date: date, time: time, when: T.label(date, time),
    lines: lib("mail").parseLines(rec), amount_cents: rec.getInt("amount_cents"),
    refund_status: rec.getString("refund_status"),
    cancel_until: deadline || null, cancel_until_label: deadline ? T.clock(deadline) : "",
    can_cancel: !!deadline && Date.now() < deadline,
    location: s.getString("pickup_location"), phone: s.getString("phone"), message: s.getString("order_received"),
  };
}

// Stripe told us a charge was refunded (possibly from the Stripe dashboard).
function syncRefund(charge) {
  if (!charge || !charge.payment_intent) return;
  var rec;
  try { rec = $app.findFirstRecordByData("bookings", "stripe_payment_intent", charge.payment_intent); } catch (_) { return; }
  if (charge.refunded) {
    if (rec.getString("status") !== "cancelled") {
      rec.set("status", "cancelled");
      rec.set("cancelled_at", Date.now());
      rec.set("cancelled_by", "stripe");
    }
    rec.set("refund_status", "refunded");
  } else if (charge.amount_refunded > 0 && rec.getString("status") === "paid") {
    rec.set("refund_status", "partial");
  }
  $app.save(rec);
}

// Cancels a paid or manual booking. Stripe-paid bookings are refunded in full. The slot is
// freed even if the refund fails (refund_status = failed, Nadia can retry from the admin).
function cancelBooking(rec, by) {
  var st = rec.getString("status");
  if (st === "cancelled") return rec;
  var pi = rec.getString("stripe_payment_intent");
  var refund = "none";
  if (st === "paid" && pi) {
    var r = refundPayment(pi, "refund-" + rec.id);
    refund = r.status === 200 ? "refunded" : "failed";
    if (refund === "failed") $app.logger().error("lunoah refund failed", "id", rec.id, "error", JSON.stringify(r.json.error || {}));
  }
  rec.set("status", "cancelled");
  rec.set("cancelled_at", Date.now());
  rec.set("cancelled_by", by);
  rec.set("refund_status", refund);
  $app.save(rec);
  lib("mail").cancelledEmail(rec, by);
  return rec;
}

module.exports = {
  cancelBooking: cancelBooking,
  checkout: checkout, confirmPaid: confirmPaid, releaseHold: releaseHold, sweep: sweep, byToken: byToken,
  findById: findById, refreshHeld: refreshHeld, summary: summary, refundPayment: refundPayment,
  syncRefund: syncRefund, shopRecord: shopRecord, fail: fail,
};
