/// <reference path="../pb_data/types.d.ts" />

// Text Nadia can edit (pickup location, order-received message, allergy note) and the seasonal theme.
migrate((app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new TextField({ name: "pickup_location", max: 120 }));
  shop.fields.add(new TextField({ name: "order_received", max: 300 }));
  shop.fields.add(new TextField({ name: "allergy_note", max: 600 }));
  shop.fields.add(new SelectField({ name: "theme", maxSelect: 1, values: ["basic", "halloween", "thanksgiving", "christmas"] }));
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    r.set("pickup_location", "Dearborn Park, Dearborn, MI");
    r.set("order_received", "Your order has been received. Nadia will reach out to you shortly.");
    r.set("allergy_note", "Our breads are baked in a home kitchen that also handles wheat (gluten), sesame, tree nuts, peanuts, milk, eggs and soy. We can't guarantee any bread is free of allergens. If you have a severe allergy, please text Nadia before ordering.");
    r.set("theme", "basic");
    r.set("pickup_info", "Nadia will text you the exact meeting spot when she confirms your order.");
    app.save(r);
  }
}, (app) => {
  const shop = app.findCollectionByNameOrId("shop");
  for (const f of ["pickup_location", "order_received", "allergy_note", "theme"]) shop.fields.removeByName(f);
  app.save(shop);
});
