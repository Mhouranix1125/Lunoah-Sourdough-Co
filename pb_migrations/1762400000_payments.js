/// <reference path="../pb_data/types.d.ts" />

// Payment methods Nadia accepts (Venmo, Zelle, Cash App...). Shown on the website's
// "How to pay" section. Only bakers can change them; the public sees enabled ones only.

const BAKER = "@request.auth.collectionName = 'bakers'";

migrate((app) => {
  const pm = new Collection({
    type: "base",
    name: "payment_methods",
    listRule: `enabled = true || ${BAKER}`,
    viewRule: `enabled = true || ${BAKER}`,
    createRule: BAKER,
    updateRule: BAKER,
    deleteRule: BAKER,
    fields: [
      {
        type: "select",
        name: "kind",
        required: true,
        maxSelect: 1,
        values: ["venmo", "zelle", "cashapp", "paypal", "applecash", "other"],
      },
      { type: "text", name: "label", max: 60 }, // custom name, used for "other"
      { type: "text", name: "handle", max: 100 }, // @username / $cashtag / paypal.me name
      { type: "text", name: "phone", max: 30 },
      { type: "text", name: "email", max: 120 },
      {
        type: "file",
        name: "qr",
        maxSelect: 1,
        maxSize: 10 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        thumbs: ["600x600"],
      },
      { type: "text", name: "note", max: 300 },
      { type: "bool", name: "enabled" },
      { type: "number", name: "sort" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  });
  app.save(pm);

  const venmo = new Record(pm);
  venmo.set("kind", "venmo");
  venmo.set("handle", "nadia-majed-1");
  venmo.set("enabled", true);
  venmo.set("sort", 10);
  app.save(venmo);

  const zelle = new Record(pm);
  zelle.set("kind", "zelle");
  zelle.set("phone", "313-384-0304");
  zelle.set("note", "Shows as NADIA in your bank's app.");
  zelle.set("enabled", true);
  zelle.set("sort", 20);
  app.save(zelle);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("payment_methods")); } catch (_) {}
});
