/// <reference path="../pb_data/types.d.ts" />

// Pickup scheduling: Nadia's weekly pickup hours, her time off (lockouts),
// and three settings on the shop record. Public can read; only bakers can change.

const BAKER = "@request.auth.collectionName = 'bakers'";
const HM = "^([01]\\d|2[0-3]):[0-5]\\d$";
const YMD = "^\\d{4}-\\d{2}-\\d{2}$";

migrate((app) => {
  const rules = { listRule: "", viewRule: "", createRule: BAKER, updateRule: BAKER, deleteRule: BAKER };

  const hours = new Collection({
    type: "base",
    name: "pickup_hours",
    ...rules,
    fields: [
      { type: "number", name: "weekday", min: 0, max: 6, onlyInt: true }, // 0 = Sunday (not "required": 0 must be allowed)
      { type: "text", name: "start", required: true, pattern: HM },
      { type: "text", name: "end", required: true, pattern: HM },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
  });
  app.save(hours);

  const blocks = new Collection({
    type: "base",
    name: "pickup_blocks",
    ...rules,
    fields: [
      { type: "text", name: "start_date", required: true, pattern: YMD },
      { type: "text", name: "end_date", required: true, pattern: YMD },
      { type: "bool", name: "all_day" },
      { type: "text", name: "from", pattern: HM },
      { type: "text", name: "to", pattern: HM },
      { type: "text", name: "note", max: 200 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
  });
  app.save(blocks);

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new NumberField({ name: "lead_days", min: 0, max: 30, onlyInt: true }));
  shop.fields.add(new NumberField({ name: "slot_minutes", min: 15, max: 60, onlyInt: true }));
  shop.fields.add(new NumberField({ name: "book_ahead_days", min: 1, max: 90, onlyInt: true }));
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    r.set("lead_days", 2);
    r.set("slot_minutes", 30);
    r.set("book_ahead_days", 21);
    app.save(r);
  }

  // Start with Fri & Sat 9am–1pm (matches the existing pickup text).
  for (const wd of [5, 6]) {
    const r = new Record(hours);
    r.set("weekday", wd);
    r.set("start", "09:00");
    r.set("end", "13:00");
    app.save(r);
  }
}, (app) => {
  for (const name of ["pickup_blocks", "pickup_hours"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const shop = app.findCollectionByNameOrId("shop");
  for (const f of ["lead_days", "slot_minutes", "book_ahead_days"]) shop.fields.removeByName(f);
  app.save(shop);
});
