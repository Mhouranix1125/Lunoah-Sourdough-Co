/// <reference path="../pb_data/types.d.ts" />

// Shop setting: customers must pay (and confirm) before they can send their order.
migrate((app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new BoolField({ name: "require_payment" }));
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    r.set("require_payment", true);
    app.save(r);
  }
}, (app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("require_payment");
  app.save(shop);
});
