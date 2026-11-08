/// <reference path="../pb_data/types.d.ts" />

// Pickup bookings: one customer per pickup time. Anyone can create a booking (at checkout);
// only bakers can see, change or cancel them. The unique index makes double-booking impossible.

const BAKER = "@request.auth.collectionName = 'bakers'";
const HM = "^([01]\\d|2[0-3]):[0-5]\\d$";
const YMD = "^\\d{4}-\\d{2}-\\d{2}$";

migrate((app) => {
  const bookings = new Collection({
    type: "base",
    name: "bookings",
    listRule: BAKER,
    viewRule: BAKER,
    createRule: "",
    updateRule: BAKER,
    deleteRule: BAKER,
    fields: [
      { type: "text", name: "date", required: true, pattern: YMD },
      { type: "text", name: "time", required: true, pattern: HM },
      { type: "text", name: "name", required: true, max: 100 },
      { type: "text", name: "items", max: 1000 },
      { type: "number", name: "total", min: 0 },
      { type: "text", name: "order_code", max: 20 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time)"],
  });
  app.save(bookings);

  // One customer per 15-minute window by default.
  for (const r of app.findAllRecords("shop")) {
    r.set("slot_minutes", 15);
    app.save(r);
  }
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("bookings")); } catch (_) {}
  for (const r of app.findAllRecords("shop")) {
    r.set("slot_minutes", 30);
    app.save(r);
  }
});
