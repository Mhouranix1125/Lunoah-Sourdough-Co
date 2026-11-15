/// <reference path="../pb_data/types.d.ts" />

// Online orders paid with Stripe. Logic lives in pb_hooks/lib/booking.js.

routerAdd("GET", "/api/lunoah/checkout-config", (e) => {
  const X = require(`${__hooks}/lib/stripe.js`);
  return e.json(200, { online: X.configured($os.getenv) });
});

routerAdd("POST", "/api/lunoah/checkout", (e) => {
  return require(`${__hooks}/lib/booking.js`).checkout(e);
});

routerAdd("POST", "/api/lunoah/release", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  const rec = B.byToken((e.requestInfo().body || {}).token);
  if (rec && rec.getString("status") === "held") B.releaseHold(rec);
  return e.json(200, { ok: true });
});

routerAdd("GET", "/api/lunoah/order", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  let rec = B.byToken(e.request.url.query().get("k"));
  if (rec) rec = B.refreshHeld(rec);
  if (!rec) return B.fail(e, 404, "not_found", "We couldn't find that order.");
  return e.json(200, B.summary(rec));
});

routerAdd("POST", "/api/lunoah/stripe-webhook", (e) => {
  const X = require(`${__hooks}/lib/stripe.js`);
  const B = require(`${__hooks}/lib/booking.js`);
  const raw = toString(e.request.body);
  const ok = X.verifySignature(raw, e.request.header.get("Stripe-Signature"), $os.getenv("STRIPE_WEBHOOK_SECRET"),
    Math.floor(Date.now() / 1000), $security.hs256, $security.equal);
  if (!ok) return e.json(400, { message: "bad signature" });
  const ev = JSON.parse(raw);
  const o = (ev.data && ev.data.object) || {};
  if (ev.type === "checkout.session.completed") {
    if (o.metadata && o.metadata.booking) B.confirmPaid(o.metadata.booking, o);
  } else if (ev.type === "checkout.session.expired") {
    const rec = o.metadata && o.metadata.booking ? B.findById(o.metadata.booking) : null;
    if (rec && rec.getString("status") === "held") $app.delete(rec);
  } else if (ev.type === "charge.refunded") {
    B.syncRefund(o);
  }
  return e.json(200, { received: true });
});

cronAdd("lunoah_holds", "*/5 * * * *", () => {
  require(`${__hooks}/lib/booking.js`).sweep();
});

routerAdd("POST", "/api/lunoah/order/cancel", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  let rec = B.byToken((e.requestInfo().body || {}).token);
  if (!rec) return B.fail(e, 404, "not_found", "We couldn't find that order.");
  rec = B.refreshHeld(rec);
  const s = B.summary(rec);
  if (s.status === "cancelled") return e.json(200, s);
  if (s.status !== "paid") return B.fail(e, 409, "not_paid", "This order isn't paid yet.");
  if (!s.can_cancel) return B.fail(e, 409, "closed", "This order can no longer be cancelled online.", { phone: s.phone });
  B.cancelBooking(rec, "customer");
  return e.json(200, B.summary(B.findById(rec.id)));
});

routerAdd("POST", "/api/lunoah/admin/cancel", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  const rec = B.findById(String((e.requestInfo().body || {}).id || ""));
  if (!rec) return B.fail(e, 404, "not_found", "That pickup no longer exists.");
  if (rec.getString("status") === "held") return B.fail(e, 409, "held", "This customer is paying right now. The time frees itself if they don't finish.");
  B.cancelBooking(rec, "nadia");
  return e.json(200, { status: rec.getString("status"), refund_status: rec.getString("refund_status") });
}, $apis.requireAuth("bakers"));

routerAdd("POST", "/api/lunoah/admin/retry-refund", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  const rec = B.findById(String((e.requestInfo().body || {}).id || ""));
  if (!rec || rec.getString("refund_status") !== "failed") return B.fail(e, 409, "no_refund", "There's no failed refund to retry.");
  const r = B.refundPayment(rec.getString("stripe_payment_intent"), "refund-" + rec.id + "-" + Date.now());
  rec.set("refund_status", r.status === 200 ? "refunded" : "failed");
  $app.save(rec);
  return e.json(200, { refund_status: rec.getString("refund_status") });
}, $apis.requireAuth("bakers"));
