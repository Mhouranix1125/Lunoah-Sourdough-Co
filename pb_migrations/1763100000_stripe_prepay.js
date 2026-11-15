/// <reference path="../pb_data/types.d.ts" />

// Online prepay with Stripe. A booking is held while the customer pays, paid once Stripe
// confirms, or "manual" when Nadia adds it herself. Cancelled bookings are kept as history,
// so the one-per-slot rule only counts bookings that aren't cancelled.
// Customers no longer create bookings directly: the server does it (pb_hooks/orders.pb.js).

const BAKER = "@request.auth.collectionName = 'bakers'";
const SLOT_OLD = "CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time)";
const RATE_RULES = [
  { label: "/api/lunoah/checkout", audience: "", duration: 60, maxRequests: 5 },
  { label: "/api/lunoah/order/cancel", audience: "", duration: 60, maxRequests: 10 },
];
const NEW_FIELDS = ["status", "phone", "notes", "lines", "amount_cents", "hold_expires", "paid_at",
  "cancelled_at", "cancelled_by", "refund_status", "email", "stripe_session", "stripe_payment_intent",
  "token", "ip", "emailed"];

function setRateRules(app, add) {
  const s = app.settings();
  const keep = [];
  for (const r of s.rateLimits.rules) {
    if (RATE_RULES.some((x) => x.label === r.label)) continue;
    keep.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
  }
  s.rateLimits.rules = add ? keep.concat(RATE_RULES) : keep;
  if (add) s.rateLimits.enabled = true;
  app.save(s);
}

migrate((app) => {
  const b = app.findCollectionByNameOrId("bookings");
  b.fields.add(new SelectField({ name: "status", required: true, maxSelect: 1, values: ["held", "paid", "manual", "cancelled"] }));
  b.fields.add(new TextField({ name: "phone", max: 20 }));
  b.fields.add(new TextField({ name: "notes", max: 500 }));
  b.fields.add(new JSONField({ name: "lines", maxSize: 20000 }));
  b.fields.add(new NumberField({ name: "amount_cents", min: 0, onlyInt: true }));
  for (const n of ["hold_expires", "paid_at", "cancelled_at"]) b.fields.add(new NumberField({ name: n, min: 0, onlyInt: true }));
  b.fields.add(new SelectField({ name: "cancelled_by", maxSelect: 1, values: ["customer", "nadia", "stripe"] }));
  b.fields.add(new SelectField({ name: "refund_status", maxSelect: 1, values: ["none", "refunded", "failed", "partial"] }));
  b.fields.add(new TextField({ name: "email", max: 200 }));
  b.fields.add(new TextField({ name: "stripe_session", max: 200 }));
  b.fields.add(new TextField({ name: "stripe_payment_intent", max: 200 }));
  b.fields.add(new TextField({ name: "token", max: 64, hidden: true }));
  b.fields.add(new TextField({ name: "ip", max: 64, hidden: true }));
  b.fields.add(new BoolField({ name: "emailed" }));
  b.createRule = BAKER;
  b.indexes = [
    "CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time) WHERE status != 'cancelled'",
    "CREATE UNIQUE INDEX idx_bookings_token ON bookings (token) WHERE token != ''",
    "CREATE INDEX idx_bookings_session ON bookings (stripe_session)",
    "CREATE INDEX idx_bookings_pi ON bookings (stripe_payment_intent)",
  ];
  app.save(b);
  for (const r of app.findAllRecords("bookings")) {
    r.set("status", "manual");
    r.set("refund_status", "none");
    r.set("amount_cents", Math.round((r.getFloat("total") || 0) * 100));
    app.save(r);
  }

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("require_payment");
  shop.fields.add(new EmailField({ name: "notify_email" }));
  app.save(shop);

  setRateRules(app, true);
}, (app) => {
  const b = app.findCollectionByNameOrId("bookings");
  for (const r of app.findRecordsByFilter("bookings", "status = 'cancelled' || status = 'held'", "", 0, 0)) app.delete(r);
  for (const n of NEW_FIELDS) b.fields.removeByName(n);
  b.createRule = "";
  b.indexes = [SLOT_OLD];
  app.save(b);

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("notify_email");
  shop.fields.add(new BoolField({ name: "require_payment" }));
  app.save(shop);

  setRateRules(app, false);
});
