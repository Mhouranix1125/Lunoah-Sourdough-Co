/// <reference path="../pb_data/types.d.ts" />

// Nadia's real menu, shop text and pickup hours, so a brand-new server starts with them
// instead of the placeholder samples from the first migrations.
// It only acts when the database still has exactly those untouched samples, so it never
// changes a site where Nadia has already edited things (this Mac, or the live server).
// Not included on purpose (the repo is public): accounts, orders, the shop phone number,
// the order-notice email and photos. Nadia adds those in the admin.
const SAMPLE_BREADS = ["Classic Country Loaf", "Rosemary & Sea Salt", "Seeded Whole Wheat", "Cinnamon Raisin"];
const SAMPLE_TAGLINE = "Naturally leavened bread, baked in small batches.";

const SHOP = {
  "tagline": "Naturally fermented bread, baked in small batches.",
  "about": "Every loaf starts with a long, slow ferment using our own starter, simple flour, water and salt. Nothing rushed, nothing extra.",
  "hero": "",
  "instagram": "",
  "order_note": "Please order by Wednesday evening for weekend pickup.",
  "pickup_info": "Nadia will text you the exact meeting spot when she confirms your order.",
  "lead_days": 2,
  "slot_minutes": 15,
  "book_ahead_days": 7,
  "pickup_location": "Dearborn Park, Dearborn, MI",
  "order_received": "Your order has been received. Nadia will reach out to you shortly.",
  "allergy_note": "Our breads are baked in a home kitchen that also handles wheat (gluten), sesame, tree nuts, peanuts, milk, eggs and soy. We can't guarantee any bread is free of allergens. If you have a severe allergy, please text Nadia before ordering.",
  "theme": "halloween",
  "nadia_title": "Meet Nadia",
  "nadia_story": "Testing things. Testing things. Testing things. Test Test."
};

const BREADS = [
  {
    "name": "The Original | Traditional Loaf",
    "description": "Simple, timeless, and beautifully crafted. This classic loaf features a crisp golden crust, soft airy interior, and signature tangy flavor. Made with just high quality organic flour, sea salt, and maintained sourdough stater. \r\n\r\nPerfect with whipped butter, homemade jam, or your favorite sandwich fillings.",
    "price": 20,
    "sort": 20,
    "hidden": false,
    "sold_out": false
  },
  {
    "name": "Rosemary & Roasted Garlic Loaf",
    "description": "An aromatic blend of organic earthy rosemary powder and rich, slow-roasted garlic clove pieces folded into our traditional sourdough. Savory, fragrant, and perfectly balanced, with a golden crust and soft, airy interior.\r\n\r\nDelicious dipped in extra-virgin olive oil and balsamic vinegar, or served alongside soups and pasta.",
    "price": 23,
    "sort": 30,
    "hidden": true,
    "sold_out": false
  },
  {
    "name": "Za'atar & Olive Loaf",
    "description": "Inspired by the Mediterranean flavors, this savory loaf combines house-made aromatic za'atar seasoning and briny green olives both harvested from our family olive groves in southern Lebanon. \r\n\r\nPerfectly paired with labneh, extra virgin olive oil, fresh cucumbers, or a Mediterranean mezze spread.",
    "price": 26,
    "sort": 40,
    "hidden": true,
    "sold_out": false
  },
  {
    "name": "Pepperoni & Cheese Loaf",
    "description": "A pizza inspired sourdough loaded with savory pepperoni and delicious melted cheese throughout. Every slice delivers the perfect combination of cheesy goodness, bold flavor, and naturally fermented sourdough.\r\nBest served warm with marinara sauce for dipping.",
    "price": 26,
    "sort": 40,
    "hidden": false,
    "sold_out": false
  }
];

const HOURS = [
  {
    "weekday": 2,
    "start": "09:00",
    "end": "17:00"
  },
  {
    "weekday": 3,
    "start": "09:00",
    "end": "13:00"
  }
];

migrate((app) => {
  const breads = app.findAllRecords("breads");
  const names = breads.map((r) => r.getString("name")).sort();
  const untouched = names.length === SAMPLE_BREADS.length &&
    names.every((n, i) => n === SAMPLE_BREADS.slice().sort()[i]);
  const shops = app.findAllRecords("shop");
  if (!untouched || shops.length !== 1 || shops[0].getString("tagline") !== SAMPLE_TAGLINE) return;

  app.runInTransaction((tx) => {
    const shop = shops[0];
    Object.keys(SHOP).forEach((k) => shop.set(k, SHOP[k]));
    tx.save(shop);

    breads.forEach((r) => tx.delete(r));
    const bc = tx.findCollectionByNameOrId("breads");
    BREADS.forEach((b) => {
      const r = new Record(bc);
      Object.keys(b).forEach((k) => r.set(k, b[k]));
      tx.save(r);
    });

    tx.findAllRecords("pickup_hours").forEach((r) => tx.delete(r));
    const hc = tx.findCollectionByNameOrId("pickup_hours");
    HOURS.forEach((h) => {
      const r = new Record(hc);
      Object.keys(h).forEach((k) => r.set(k, h[k]));
      tx.save(r);
    });
  });
}, (app) => {
  // Nothing to undo: this only fills in starting content.
});
