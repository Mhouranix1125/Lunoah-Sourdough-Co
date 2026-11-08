/// <reference path="../pb_data/types.d.ts" />

// More seasonal themes: Valentine's Day, Spring and Summer.
migrate((app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.getByName("theme").values = ["basic", "halloween", "thanksgiving", "christmas", "valentines", "spring", "summer"];
  app.save(shop);
}, (app) => {
  for (const r of app.findAllRecords("shop")) {
    if (["valentines", "spring", "summer"].includes(r.get("theme"))) { r.set("theme", "basic"); app.save(r); }
  }
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.getByName("theme").values = ["basic", "halloween", "thanksgiving", "christmas"];
  app.save(shop);
});
