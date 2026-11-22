/// <reference path="../pb_data/types.d.ts" />

// Orders view: Nadia ticks each order off once the customer has collected it (or marks a no-show),
// and the server emails her a reminder for pickups whose window has passed without a tick.
//   pickup            "" (not marked yet), "picked_up" or "no_show"
//   pickup_marked_at  when she marked it (ms)
//   reminded          the reminder email for this order has been sent (or wasn't needed)

migrate((app) => {
  const b = app.findCollectionByNameOrId("bookings");
  b.fields.add(new SelectField({ name: "pickup", maxSelect: 1, values: ["picked_up", "no_show"] }));
  b.fields.add(new NumberField({ name: "pickup_marked_at", min: 0, onlyInt: true }));
  b.fields.add(new BoolField({ name: "reminded" }));
  b.indexes = b.indexes.concat(["CREATE INDEX idx_bookings_pickup ON bookings (pickup, status, date)"]);
  app.save(b);

  // Orders whose day has already passed never get a reminder email (they predate this feature).
  // Shop time is US Eastern; using UTC-5 here is close enough for "which day is it".
  const t = new Date(Date.now() - 5 * 3600000);
  const today = t.toISOString().slice(0, 10);
  for (const r of app.findRecordsByFilter("bookings", "date < {:d}", "", 0, 0, { d: today })) {
    r.set("reminded", true);
    app.save(r);
  }
}, (app) => {
  const b = app.findCollectionByNameOrId("bookings");
  for (const n of ["pickup", "pickup_marked_at", "reminded"]) b.fields.removeByName(n);
  b.indexes = b.indexes.filter((i) => !/idx_bookings_pickup/.test(i));
  app.save(b);
});
