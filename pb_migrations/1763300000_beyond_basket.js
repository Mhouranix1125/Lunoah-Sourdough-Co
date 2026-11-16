/// <reference path="../pb_data/types.d.ts" />

// "Beyond the Basket": things besides bread (olive oil, merchandise…). They live in the
// breads collection with kind = "extra", so the basket, server-side pricing, checkout,
// emails and refunds treat them exactly like breads. Breads are kind = "bread".
// Also an optional size ("500 ml bottle") and the section's title and intro in Shop Info.
const INTRO = "A few more good things from our family's table, to enjoy with your bread.";

migrate((app) => {
  const breads = app.findCollectionByNameOrId("breads");
  breads.fields.add(new SelectField({ name: "kind", values: ["bread", "extra"], maxSelect: 1 }));
  breads.fields.add(new TextField({ name: "size", max: 60 }));
  app.save(breads);
  for (const r of app.findAllRecords("breads")) {
    if (!r.getString("kind")) {
      r.set("kind", "bread");
      app.save(r);
    }
  }

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new TextField({ name: "extras_title", max: 80 }));
  shop.fields.add(new TextField({ name: "extras_intro", max: 400 }));
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    r.set("extras_title", "Beyond the Basket");
    r.set("extras_intro", INTRO);
    app.save(r);
  }
}, (app) => {
  const breads = app.findCollectionByNameOrId("breads");
  for (const r of app.findAllRecords("breads", $dbx.hashExp({ kind: "extra" }))) app.delete(r);
  breads.fields.removeByName("kind");
  breads.fields.removeByName("size");
  app.save(breads);
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("extras_title");
  shop.fields.removeByName("extras_intro");
  app.save(shop);
});
