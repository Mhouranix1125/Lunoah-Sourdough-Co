/// <reference path="../pb_data/types.d.ts" />

// Customers reach Nadia by email, not phone. Adds a public contact email to the shop record
// (shown on the site, at checkout and in customer emails), starting from the "email for new orders".
// The old phone field becomes hidden, so it is no longer sent to the public site at all.

migrate((app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new EmailField({ name: "contact_email" }));
  const phone = shop.fields.getByName("phone");
  if (phone) phone.hidden = true;
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    if (!r.getString("contact_email") && r.getString("notify_email")) {
      r.set("contact_email", r.getString("notify_email"));
    }
    // The default allergy note asked customers to text her; there's no number to text any more.
    const allergy = r.getString("allergy_note");
    if (allergy.indexOf("please text Nadia before ordering") >= 0) {
      r.set("allergy_note", allergy.replace("please text Nadia before ordering", "please email Nadia before ordering"));
    }
    app.save(r);
  }
}, (app) => {
  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("contact_email");
  const phone = shop.fields.getByName("phone");
  if (phone) phone.hidden = false;
  app.save(shop);
});
