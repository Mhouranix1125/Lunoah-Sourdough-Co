/// <reference path="../pb_data/types.d.ts" />

// Sales records: phone/in-person orders can record how they were paid, so the Sales tab and the
// yearly tax CSV include them. Website orders are always "card" (paid through Stripe).
//   paid_via  "" (not paid yet) · "card" · "cash" · "venmo" · "zelle" · "other"
// (The amount uses the existing amount_cents / total fields.)

migrate((app) => {
  const b = app.findCollectionByNameOrId("bookings");
  b.fields.add(new SelectField({ name: "paid_via", maxSelect: 1, values: ["card", "cash", "venmo", "zelle", "other"] }));
  app.save(b);
}, (app) => {
  const b = app.findCollectionByNameOrId("bookings");
  b.fields.removeByName("paid_via");
  app.save(b);
});
