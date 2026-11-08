/// <reference path="../pb_data/types.d.ts" />

// "Meet Nadia": a title, a story and a photo Nadia can edit in Shop Info.
migrate((app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new TextField({ name: "nadia_title", max: 80 }));
  shop.fields.add(new TextField({ name: "nadia_story", max: 5000 }));
  shop.fields.add(new FileField({
    name: "nadia_photo", maxSelect: 1, maxSize: 15 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["600x600"],
  }));
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    r.set("nadia_title", "Meet Nadia");
    app.save(r);
  }
}, (app) => {
  const shop = app.findCollectionByNameOrId("shop");
  for (const f of ["nadia_title", "nadia_story", "nadia_photo"]) shop.fields.removeByName(f);
  app.save(shop);
});
