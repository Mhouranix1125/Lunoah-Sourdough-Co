/// <reference path="../pb_data/types.d.ts" />

// Sets up the Lunoah database: Nadia's login (bakers), her breads, and shop info.
// Only accounts in the "bakers" collection can change anything. Nobody can sign up
// from the website; bakers are created with setup.command.

const BAKER = "@request.auth.collectionName = 'bakers'";

migrate((app) => {
  // --- Who can log in to the admin page ---
  const bakers = new Collection({
    type: "auth",
    name: "bakers",
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: null, // no public sign-ups
    updateRule: "id = @request.auth.id", // can change own password
    deleteRule: null,
    fields: [
      { type: "text", name: "name", max: 100 },
    ],
    passwordAuth: { enabled: true, identityFields: ["email"] },
    authToken: { duration: 60 * 60 * 24 * 30 }, // stay logged in 30 days
  });
  app.save(bakers);

  // --- The breads on the menu ---
  const breads = new Collection({
    type: "base",
    name: "breads",
    listRule: `hidden = false || ${BAKER}`,
    viewRule: `hidden = false || ${BAKER}`,
    createRule: BAKER,
    updateRule: BAKER,
    deleteRule: BAKER,
    fields: [
      { type: "text", name: "name", required: true, max: 120 },
      { type: "text", name: "description", max: 1000 },
      { type: "number", name: "price", min: 0 },
      {
        type: "file",
        name: "photo",
        maxSelect: 1,
        maxSize: 15 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        thumbs: ["800x600", "400x300"],
      },
      { type: "bool", name: "sold_out" },
      { type: "bool", name: "hidden" },
      { type: "number", name: "sort" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  app.save(breads);

  // --- Shop info (a single record) ---
  const shop = new Collection({
    type: "base",
    name: "shop",
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: BAKER,
    deleteRule: null,
    fields: [
      { type: "text", name: "tagline", max: 200 },
      { type: "text", name: "about", max: 2000 },
      { type: "text", name: "phone", max: 30 },
      { type: "text", name: "pickup_info", max: 1000 },
      { type: "text", name: "order_note", max: 500 },
      { type: "text", name: "instagram", max: 100 },
      {
        type: "file",
        name: "hero",
        maxSelect: 1,
        maxSize: 15 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        thumbs: ["1600x0"],
      },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  app.save(shop);

  const shopRec = new Record(shop);
  shopRec.set("tagline", "Naturally leavened bread, baked in small batches.");
  shopRec.set(
    "about",
    "Every loaf starts with a long, slow ferment using our own starter, simple flour, water and salt. Nothing rushed, nothing extra."
  );
  shopRec.set("phone", "");
  shopRec.set("pickup_info", "Pickup Fridays & Saturdays, 9am to 1pm. Address shared when you order.");
  shopRec.set("order_note", "Please order by Wednesday evening for weekend pickup.");
  app.save(shopRec);

  const samples = [
    ["Classic Country Loaf", "Crackly crust, open and chewy crumb, gentle tang. Our everyday loaf.", 10],
    ["Rosemary & Sea Salt", "Fresh rosemary folded into the dough and finished with flaky sea salt.", 12],
    ["Seeded Whole Wheat", "Sunflower, flax, sesame and pumpkin seeds with stone-ground whole wheat.", 12],
    ["Cinnamon Raisin", "Plump raisins and a swirl of cinnamon. Wonderful toasted with butter.", 13],
  ];
  samples.forEach(([name, desc, price], i) => {
    const r = new Record(breads);
    r.set("name", name);
    r.set("description", desc);
    r.set("price", price);
    r.set("sort", (i + 1) * 10);
    app.save(r);
  });

  const settings = app.settings();
  settings.meta.appName = "Lunoah Sourdough Co.";
  app.save(settings);
}, (app) => {
  for (const name of ["shop", "breads", "bakers"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
