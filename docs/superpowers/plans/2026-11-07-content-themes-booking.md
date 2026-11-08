# Site Text, Seasonal Themes & Manual Bookings: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add text Nadia can edit (pickup location, order-received message, allergy note), seasonal themes for both the customer site and the admin page, and an admin "＋ Add pickup" for phone and in-person orders.

**Architecture:**
- One migration adds four `shop` fields.
- Text is rendered from `shop` with `textContent`.
- Themes are CSS variable overrides in a shared `themes.css`. `html[data-theme]` is set by a tiny `theme.js`, which caches the last theme in localStorage to avoid a flash of the basic colours.
- Manual bookings reuse the `bookings` collection and `slots.js`.

**Tech Stack:** PocketBase v0.41 (JS migrations), vanilla JS/CSS, Node 22 `node --test`, headless Chrome over CDP.

**Spec:** `docs/superpowers/specs/2026-11-07-content-themes-booking-design.md`

## Global Constraints

- New `shop` fields:
  - `pickup_location` (text, max 120)
  - `order_received` (text, max 300)
  - `allergy_note` (text, max 600)
  - `theme` (select, values `basic`, `halloween`, `thanksgiving`, `christmas`, maxSelect 1)
- Initial values are copied exactly from the spec table, `theme` = `basic`, and `pickup_info` = `Nadia will text you the exact meeting spot when she confirms your order.`
- Fixed copy (exact):
  - "Running late or need to change your pickup? Text Nadia and she'll sort it out with you."
  - "Make sure you pressed send in Messages."
  - "That time was just taken. Please pick another."
  - "Pickup added."
- Map link: `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(pickup_location)`, opened with `target="_blank" rel="noopener"`.
- All shop text is rendered with `textContent`, never `innerHTML`. An empty field hides its element.
- Themes:
  - Selected on `html[data-theme="<name>"]`.
  - localStorage key `lunoah_theme`.
  - `window.LunoahTheme.apply(name)`; unknown names → `basic`.
  - The Basic theme must look identical to today.
  - Body and button text must meet WCAG AA (4.5:1) in every theme.
- The admin page follows the theme too, including the login screen.
- Live data that must stay unchanged: pickup_hours Tue(2) 09:00–17:00 and Wed(3) 09:00–13:00, no pickup_blocks, shop lead_days 2 / slot_minutes 15 / book_ahead_days 7. Leave `theme` on `basic` at the end of every task.
- The user's server runs on 127.0.0.1:8090 (started from VS Code) and serves `pb_public` live. **Never stop it.** Adding a migration does not restart it, so apply with `pocketbase migrate up --dir=pb_data --migrationsDir=pb_migrations` (safe while it runs), then touch a hook file (`touch pb_hooks/no_cache.pb.js`) so PocketBase reloads its collection cache.
- No new dependencies and no build step.

---

### Task 1: Shop fields migration

**Files:** Create `pb_migrations/1762800000_site_text_theme.js`

- [ ] **Step 1: Back up the database** (consistent while the server runs):
  `sqlite3 pb_data/data.db ".backup '.superpowers/pb_data-backup-before-themes.db'"`

- [ ] **Step 2: Write the migration**

```js
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
```

- [ ] **Step 3: Apply and verify.** Run `pocketbase migrate up --dir=pb_data --migrationsDir=pb_migrations`, then `touch pb_hooks/no_cache.pb.js`, then wait 3 seconds. Then:
  `curl -s "localhost:8090/api/collections/shop/records?perPage=1" | python3 -m json.tool | grep -E 'pickup_location|order_received|allergy_note|"theme"|pickup_info|lead_days|slot_minutes|book_ahead'`
  Expected: the new values are present, and lead 2 / slot 15 / ahead 7 are unchanged.

- [ ] **Step 4: Commit** with the message "Add editable pickup location, order-received text, allergy note and theme" (and a Co-Authored-By trailer with your model).

---

### Task 2: Customer text + Shop Info fields

**Files:** `pb_public/index.html`, `pb_public/site.js`, `pb_public/styles.css`, `pb_public/admin/index.html`, `pb_public/admin/admin.js`

- [ ] **Step 1: Storefront markup** (`index.html`):
  - In "3. Pick up", before `<p id="pickup"></p>`, add `<p id="pickup-location" class="pickup-location" hidden>📍 <span id="pickup-location-text"></span> · <a id="pickup-map" target="_blank" rel="noopener">Map</a></p>`. After it, add `<p class="muted small">Running late or need to change your pickup? Text Nadia and she'll sort it out with you.</p>`.
  - Under the bread grid (`#grid`), add `<p id="allergy-note" class="allergy-note" hidden></p>`.
  - In the footer, add `<p id="allergy-footer" class="allergy-footer muted small" hidden></p>`.
  - In checkout step 1, directly after `<p id="cal-summary" …>`, add `<p id="pickup-at" class="muted small" hidden></p>`.
  - In step 3, after `#sms-fallback`, add:
    `<div id="order-received" class="order-received" role="status" hidden><strong id="order-received-text"></strong><span>Make sure you pressed send in Messages.</span></div>`
- [ ] **Step 2: `site.js`**:
  - In `renderShop()`: if `shop.pickup_location`, set `#pickup-location-text`, set `#pickup-map.href` to the maps URL (see constraints), and unhide `#pickup-location`. Set `#pickup-at` to `Pickup at ${shop.pickup_location}.` and unhide it.
  - Set `#allergy-note` and `#allergy-footer` from `shop.allergy_note`, each hidden when empty.
  - In `orderText()`, right after the `Pickup:` line, add `if (shop.pickup_location) t += \`Pickup at: ${shop.pickup_location}\n\`;`.
  - In both the `#send-text` and `#copy-order` handlers, after a successful `reserve()`, set `#order-received-text` to `shop.order_received || "Your order has been received. Nadia will reach out to you shortly."` and unhide `#order-received`.
  - In `goStep(n)` and in `openDialog()`, hide `#order-received`.
- [ ] **Step 3: Styles** (`styles.css`): `.order-received` is a box using `--card` (or `#fff` until Task 3), with border `1.5px solid var(--crust)`, radius 12px, padding 12px 14px, flex column, gap 4px. `.allergy-note` uses `font-size: .85rem; color: var(--muted); margin-top: 18px; max-width: 60ch;`. `.pickup-location a` has `font-weight: 600`.
- [ ] **Step 4: Shop Info** (`admin/index.html` and `admin.js` `loadShop` / submit):
  - Add, after "Pickup details":
    - `<label>Pickup location <span class="muted">(shown with a map link)</span><input id="s-location" maxlength="120"></label>`
    - `<label>Message after ordering <textarea id="s-received" rows="2" maxlength="300"></textarea></label>`
    - `<label>Allergy note <span class="muted">(shown under your breads)</span><textarea id="s-allergy" rows="4" maxlength="600"></textarea></label>`
  - Load them from `shop.pickup_location` / `order_received` / `allergy_note`, and append them to the FormData as `pickup_location`, `order_received` and `allergy_note`.
- [ ] **Step 5: Browser check** (CDP, 375px and 320px):
  - Location line with a correct map href.
  - Allergy note under the grid and in the footer.
  - "Pickup at …" in step 1.
  - Order text contains `Pickup at: Dearborn Park, Dearborn, MI`.
  - After Copy order, the order-received box shows. Back then forward hides it.
  - No horizontal overflow.
  - Then edit the allergy note in Shop Info (temporary baker), confirm the storefront shows the change, and restore the original text.
  - Test bookings made: remove them. Temporary accounts: remove them. If permissions block removal, report exactly what remains.
- [ ] **Step 6: Commit** with the message "Site text: pickup location with map, order-received message, allergy note".

---

### Task 3: Seasonal themes (customer site + admin)

**Files:** Create `pb_public/themes.css` and `pb_public/theme.js`. Modify `pb_public/index.html`, `pb_public/admin/index.html`, `pb_public/styles.css`, `pb_public/admin/admin.css`, `pb_public/site.js`, `pb_public/admin/admin.js`.

- [ ] **Step 1: `theme.js`** (loaded in `<head>` of both pages, before the stylesheets apply):

```js
// Seasonal theme: applies the last-used theme immediately (no flash), and lets pages switch it.
(function () {
  const THEMES = ["basic", "halloween", "thanksgiving", "christmas"];
  function apply(name) {
    const t = THEMES.includes(name) ? name : "basic";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("lunoah_theme", t); } catch (_) {}
    return t;
  }
  let saved = "basic";
  try { saved = localStorage.getItem("lunoah_theme") || "basic"; } catch (_) {}
  apply(saved);
  window.LunoahTheme = { apply, THEMES };
})();
```

- [ ] **Step 2: Variables.** In `styles.css` and `admin.css`, replace the hard-coded colours that must follow the theme:
  - card, input and panel `#fff` backgrounds → `var(--card)`
  - text on buttons and dark chips, `color: #fff` → `var(--on-crust)`
  - the sketch pattern gets `filter: var(--pattern-filter, none)`
  - `.brand-name::after` (storefront) and `.logo::after, .login-card h1::after` (admin) get `content: var(--theme-icon, ""); margin-left: .25em;`

  Add `--card: #fff; --accent: var(--crust); --on-crust: #fff;` to both `:root` blocks. Keep the payment-app logo colours, `--danger` and `--ok` fixed. Check for other places where white or near-white is assumed: the toast, `.tab.active`, `.badge`, the switch knob, QR images (keep these white for scanning) and the hero image box.
- [ ] **Step 3: `themes.css`** with `html[data-theme="halloween"] { … }` and similar blocks, using the spec palette table. Choose `--cream`, `--line`, `--crust-dark` and `--on-crust` per theme so that body and button text reach ≥ 4.5:1 contrast. Halloween:
  - dark, with `--pattern-filter: invert(1)`
  - `--pattern-strength` lower if the pattern is too loud
  - `color-scheme: dark` so native inputs and dialogs are dark

  Icons: `--theme-icon: "🎃"` / `"🍂"` / `"🎄"`. Basic needs no block, because `:root` is basic. Link `themes.css` after the page stylesheet on both pages, and add `<script src="/theme.js"></script>` in `<head>` on both.
- [ ] **Step 4: Apply from data.**
  - `site.js`: in `renderShop()`, call `LunoahTheme.apply(shop.theme)`.
  - `admin.js`: in `loadShop()`, call `LunoahTheme.apply(shop.theme)`. On the login and setup screens, fetch `/api/collections/shop/records?perPage=1` and apply it too.
- [ ] **Step 5: Shop Info dropdown.** Add `<label>Website theme <select id="s-theme"><option value="basic">Basic</option><option value="halloween">Halloween 🎃</option><option value="thanksgiving">Thanksgiving 🍂</option><option value="christmas">Christmas 🎄</option></select></label>` near the top of the form. Below it, add a row of 4 swatch chips (`.theme-swatches`). Each is a small rounded box using that theme's paper, crust and accent colours as hard-coded gradients, with its name under it; clicking one sets the select. Load and save the value as `theme` in the FormData. After a successful save, call `LunoahTheme.apply(theme)` so the admin page switches at once.
- [ ] **Step 6: Browser check.**
  - At 375px, screenshot each of the 4 themes on: storefront top, storefront menu, checkout step 1, admin Shop Info and admin Pickup Times. Set the theme by saving through the admin as a temporary baker, or by PATCHing `theme` as that baker.
  - Save the screenshots to `.superpowers/themes-screenshots/<theme>-<page>.png` so the user can view them. View them yourself.
  - Basic: compare with screenshots taken before your change and confirm no visible difference.
  - Measure and report contrast ratios (body text on paper, button text on crust, muted on paper) for each theme.
  - No horizontal overflow at 320px.
  - Finish with `theme` = `basic`.
  - Test bookings made: remove them. Temporary accounts: remove them. If permissions block removal, report exactly what remains.
- [ ] **Step 7: Commit** with the message "Seasonal themes for the website and admin (Basic, Halloween, Thanksgiving, Christmas)".

---

### Task 4: Admin "＋ Add pickup"

**Files:** `pb_public/admin/index.html`, `pb_public/admin/pickup-admin.js`, `pb_public/admin/admin.css`, `NADIA-GUIDE.md`

- [ ] **Step 1: Markup.**
  - Under `#pk-bookings`, add `<button type="button" id="pk-add-booking" class="btn big full">＋ Add pickup</button>`.
  - Add a dialog `#booking-dialog` with `form#booking-form.form` containing:
    - `<h2>Add a pickup</h2>`
    - `<label>Day <select id="bk2-day"></select></label>`
    - `<label>Time <select id="bk2-time"></select></label>`
    - `<label>Name <input id="bk2-name" maxlength="100" required></label>`
    - `<label>Note <span class="muted">(optional, e.g. 2 country loaves, phone order)</span><input id="bk2-note" maxlength="1000"></label>`
    - `<p id="bk2-empty" class="hint" hidden>No open pickup times right now.</p>`
    - Save and Cancel buttons, as in `#block-dialog`.
- [ ] **Step 2: Logic** (`pickup-admin.js`):
  - On open, compute `S.availableSlots({ hours, blocks, leadDays: 0, slotMinutes: shop.slot_minutes || 15, bookAheadDays: shop.book_ahead_days || 21, now: new Date(), tz: S.SHOP_TZ, taken: bookings.map((b) => ({ date: b.date, time: b.time })) })`.
  - Fill `#bk2-day` with `S.formatDate(d.date, "short")` options, and fill `#bk2-time` with `S.formatTime` options for the selected day. Update the times on the day `change`.
  - If there are no days, show `#bk2-empty` and disable Save.
  - On submit, validate the name, then `api("/api/collections/bookings/records", { method: "POST", body: { date, time, name, items: note, total: 0, order_code: "PHONE" } })`.
  - On success: close, toast "Pickup added.", `await reloadBookings()`.
  - On an error whose message or data indicates not unique (`api()` throws `Error` with the field message; detect with `/unique/i`): toast "That time was just taken. Please pick another." (bad), then reload the bookings and recompute the dialog options.
  - Other errors: toast `err.message`.
- [ ] **Step 3: Guide** (`NADIA-GUIDE.md`, in the Upcoming pickups bullet). Add: "Took an order by phone or in person? Tap **＋ Add pickup**, choose the day and time and their name, so nobody else can book that time." Also add a short "Seasonal themes" section: **Shop Info → Website theme**, pick Basic / Halloween / Thanksgiving / Christmas, tap **Save shop info**, and both the website and this admin page change.
- [ ] **Step 4: Browser check** (375px and 320px, temporary baker):
  - Add a pickup on the first open day → it is listed with code PHONE, and that time is gone from the storefront times.
  - Duplicate (book the same time through the API first, then submit) → the conflict toast appears and the times refresh.
  - Cancel works.
  - No overflow.
  - Test bookings made: remove them. Temporary accounts: remove them. If permissions block removal, report exactly what remains and use the admin Cancel button for bookings.
- [ ] **Step 5: Commit** with the message "Admin: add pickups for phone and in-person orders; guide".

### Final check
- [ ] `node --test tests/slots.test.js` passes.
- [ ] The live hours and settings are unchanged, and the theme is `basic`.
- [ ] `git status` is clean.
