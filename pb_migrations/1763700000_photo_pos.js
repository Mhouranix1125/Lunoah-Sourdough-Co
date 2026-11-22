/// <reference path="../pb_data/types.d.ts" />

// Photo positioning: Nadia chooses which part of each photo shows (pb_public/photo-pos.js).
// Adds a position to every uploaded photo, and whole-photo sizes ("800x0" = 800 wide, height to match)
// so the server no longer cuts photos to a centred square or 4:3 before the site shows them.

const JSONF = (name) => new JSONField({ name, maxSize: 200 });

function addThumbs(collection, field, thumbs) {
  const f = collection.fields.getByName(field);
  if (!f) return;
  f.thumbs = Array.from(new Set((f.thumbs || []).concat(thumbs)));
}

migrate((app) => {
  const breads = app.findCollectionByNameOrId("breads");
  breads.fields.add(JSONF("photo_pos"));
  addThumbs(breads, "photo", ["800x0", "400x0"]);
  app.save(breads);

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(JSONF("hero_pos"));
  shop.fields.add(JSONF("nadia_pos"));
  addThumbs(shop, "nadia_photo", ["800x0"]);
  app.save(shop);
}, (app) => {
  const breads = app.findCollectionByNameOrId("breads");
  breads.fields.removeByName("photo_pos");
  app.save(breads);
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("hero_pos");
  shop.fields.removeByName("nadia_pos");
  app.save(shop);
});
