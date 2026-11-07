# Pickup Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At checkout, customers choose a pickup day and time from a phone-friendly calendar. It offers only the hours Nadia has opened, at least `lead_days` after the order, with her lockouts removed. Nadia manages all of this in a new admin tab.

**Architecture:** One shared, dependency-free module (`pb_public/slots.js`) works out the available slots from weekly hours, lockouts and settings. It is unit-tested with `node --test`. The storefront (`site.js`) and the new admin module (`admin/pickup-admin.js`) both call it. Data lives in two new PocketBase collections plus three new `shop` fields, all added by one migration.

**Tech Stack:** PocketBase v0.41 (JS migrations), vanilla JS (classic scripts, no build step), Node 22 built-in test runner, headless Chrome via CDP for browser checks.

**Spec:** `docs/superpowers/specs/2026-11-07-pickup-scheduling-design.md`

## Global Constraints

- Shop time zone: `America/Detroit`. Dates are stored as `YYYY-MM-DD` strings and times as `HH:MM` (24h) strings, with no timezone conversion in storage.
- Defaults: `lead_days` = 2 (calendar dates), `slot_minutes` = 30 (allowed 15/30/60), `book_ahead_days` = 21.
- Validation ranges: lead 0–30, ahead 1–90, ahead ≥ lead.
- Slot capacity is unlimited, and nothing is stored per order.
- New collections: public read, write only for `@request.auth.collectionName = 'bakers'`.
- PocketBase `number` fields marked `required` reject `0`, so never mark `weekday` or `lead_days` required.
- Pages must not scroll sideways at 320px. Tap targets must be at least 40px (calendar cells) or 44px (time buttons).
- No new dependencies and no build step. Scripts are plain `<script src>` tags.
- Text the customer sees for a chosen slot: `Saturday, Nov 14 at 10:00 AM`.
- If pickup data fails to load, fall back to the old free-text `#o-day` input.

## File Structure

| File | Responsibility |
|---|---|
| `pb_public/slots.js` (new) | Pure slot calculation and date/time formatting. Browser global `LunoahSlots` plus CommonJS export. |
| `tests/slots.test.js` (new) | Unit tests for `slots.js`. |
| `pb_migrations/1762600000_pickup.js` (new) | `pickup_hours` and `pickup_blocks` collections, `shop` fields, seed hours. |
| `pb_public/index.html` | Picker markup in checkout step 1; load `slots.js`. |
| `pb_public/site.js` | Load pickup data, render the calendar and times, gate Continue, `Pickup:` line. |
| `pb_public/styles.css` | Calendar and time-button styles. |
| `pb_public/admin/pickup-admin.js` (new) | The "Pickup Times" tab: weekly hours, time off, settings, preview. |
| `pb_public/admin/index.html` | Tab button, tab panel, time-off dialog, script tags. |
| `pb_public/admin/admin.js` | Register the `pickup` tab and call `PickupAdmin` from `showApp`. |
| `pb_public/admin/admin.css` | Styles for the Pickup Times tab. |
| `NADIA-GUIDE.md` | Short "Pickup times & time off" section. |

---

### Task 0: Commit the pending header fix

The 320px header fix in `pb_public/styles.css` from earlier in the session is uncommitted. Commit it on its own so it doesn't mix with this feature.

- [ ] **Step 1: Commit**

```bash
git add pb_public/styles.css
git commit -m "Keep header nav on one line on small phones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Slot calculation module (`slots.js`)

**Files:**
- Create: `pb_public/slots.js`
- Test: `tests/slots.test.js`

**Interfaces:**
- Produces (on `window.LunoahSlots` in the browser, `module.exports` in Node):
  - `SHOP_TZ: "America/Detroit"`
  - `availableSlots({ hours, blocks, leadDays, slotMinutes, bookAheadDays, now, tz }) → Array<{ date: "YYYY-MM-DD", times: ["HH:MM", ...] }>`
    - `hours`: `[{ weekday: 0-6, start: "HH:MM", end: "HH:MM" }]`
    - `blocks`: `[{ start_date, end_date, all_day: bool, from: "HH:MM", to: "HH:MM" }]`
  - `localParts(now: Date, tz: string) → { date: "YYYY-MM-DD", minutes: number }`
  - `addDays(ymd: string, n: number) → "YYYY-MM-DD"`
  - `weekday(ymd: string) → 0-6`
  - `formatDate(ymd: string, style?: "long" | "short") → "Saturday, Nov 14"` / `"Sat, Nov 14"`
  - `formatTime(hm: string) → "9:00 AM"`

- [ ] **Step 1: Write the failing tests**

Create `tests/slots.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../pb_public/slots.js");

const TZ = "America/Detroit";
// Helper: a Date for a wall-clock moment in Detroit (EST = UTC-5 in Nov/Dec/Jan).
const est = (ymd, hm = "12:00") => new Date(`${ymd}T${hm}:00-05:00`);
const FRI_SAT = [
  { weekday: 5, start: "09:00", end: "13:00" },
  { weekday: 6, start: "09:00", end: "13:00" },
];
const base = (over = {}) => ({ hours: FRI_SAT, blocks: [], leadDays: 2, slotMinutes: 30, bookAheadDays: 21, tz: TZ, ...over });
const dates = (r) => r.map((d) => d.date);

test("helpers: addDays crosses month and year", () => {
  assert.equal(S.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(S.addDays("2026-12-31", 1), "2027-01-01");
});

test("helpers: weekday", () => {
  assert.equal(S.weekday("2026-11-13"), 5); // Friday
  assert.equal(S.weekday("2026-11-15"), 0); // Sunday
});

test("helpers: localParts uses the shop time zone, not UTC", () => {
  // 11:30 PM Wed Nov 11 in Detroit is already Thu Nov 12 in UTC.
  const p = S.localParts(est("2026-11-11", "23:30"), TZ);
  assert.deepEqual(p, { date: "2026-11-11", minutes: 23 * 60 + 30 });
});

test("helpers: formatting", () => {
  assert.equal(S.formatDate("2026-11-14"), "Saturday, Nov 14");
  assert.equal(S.formatDate("2026-11-14", "short"), "Sat, Nov 14");
  assert.equal(S.formatTime("09:00"), "9:00 AM");
  assert.equal(S.formatTime("12:30"), "12:30 PM");
  assert.equal(S.formatTime("00:15"), "12:15 AM");
});

test("slots fill each block in steps and the last slot must fit", () => {
  const r = S.availableSlots(base({ now: est("2026-11-09") })); // Monday
  assert.equal(r[0].date, "2026-11-13");
  assert.deepEqual(r[0].times, ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("lead days: Wednesday order cannot pick up Thursday, first is Friday", () => {
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "10:00" }));
  const r = S.availableSlots(base({ hours, now: est("2026-11-11", "08:00") }));
  assert.equal(r[0].date, "2026-11-13");
});

test("lead days counts calendar dates even late at night", () => {
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "10:00" }));
  const r = S.availableSlots(base({ hours, now: est("2026-11-11", "23:59") }));
  assert.equal(r[0].date, "2026-11-13");
});

test("lead days 0 drops slots that already passed today", () => {
  const r = S.availableSlots(base({ leadDays: 0, now: est("2026-11-13", "10:10") }));
  assert.equal(r[0].date, "2026-11-13");
  assert.equal(r[0].times[0], "10:30");
});

test("book-ahead window is inclusive and stops after it", () => {
  const r = S.availableSlots(base({ bookAheadDays: 5, now: est("2026-11-09") })); // Mon → Sat 14 is day 5
  assert.deepEqual(dates(r), ["2026-11-13", "2026-11-14"]);
  const r2 = S.availableSlots(base({ bookAheadDays: 4, now: est("2026-11-09") }));
  assert.deepEqual(dates(r2), ["2026-11-13"]);
});

test("all-day single-date lockout removes that date", () => {
  const blocks = [{ start_date: "2026-11-13", end_date: "2026-11-13", all_day: true }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-14");
});

test("vacation range across a month boundary removes every date in it", () => {
  const blocks = [{ start_date: "2026-11-27", end_date: "2026-12-05", all_day: true }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-23") }));
  assert.deepEqual(dates(r).slice(0, 2), ["2026-12-11", "2026-12-12"]);
});

test("partial lockout removes only overlapping slots", () => {
  const blocks = [{ start_date: "2026-11-14", end_date: "2026-11-14", all_day: false, from: "10:15", to: "11:00" }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-09") }));
  const sat = r.find((d) => d.date === "2026-11-14");
  assert.deepEqual(sat.times, ["09:00", "09:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("partial lockout covering every slot removes the date", () => {
  const blocks = [{ start_date: "2026-11-13", end_date: "2026-11-13", all_day: false, from: "08:00", to: "14:00" }];
  const r = S.availableSlots(base({ blocks, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-14");
});

test("two blocks on one weekday are merged in time order", () => {
  const hours = [
    { weekday: 5, start: "16:00", end: "17:00" },
    { weekday: 5, start: "09:00", end: "10:00" },
  ];
  const r = S.availableSlots(base({ hours, now: est("2026-11-09") }));
  assert.deepEqual(r[0].times, ["09:00", "09:30", "16:00", "16:30"]);
});

test("60-minute slots", () => {
  const r = S.availableSlots(base({ slotMinutes: 60, now: est("2026-11-09") }));
  assert.deepEqual(r[0].times, ["09:00", "10:00", "11:00", "12:00"]);
});

test("DST: the Saturday after clocks fall back still has normal slots", () => {
  // DST ends Sun Nov 1 2026. Ordering Thu Oct 29 (EDT) → Sat Oct 31 and Fri Nov 6 both normal.
  const now = new Date("2026-10-29T12:00:00-04:00");
  const r = S.availableSlots(base({ now }));
  assert.deepEqual(dates(r).slice(0, 3), ["2026-10-31", "2026-11-06", "2026-11-07"]);
  assert.equal(r[1].times.length, 8);
});

test("no hours means no dates", () => {
  assert.deepEqual(S.availableSlots(base({ hours: [], now: est("2026-11-09") })), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/slots.test.js`
Expected: FAIL with `Cannot find module '../pb_public/slots.js'`

- [ ] **Step 3: Write the implementation**

Create `pb_public/slots.js`:

```js
// Works out which pickup times customers can choose. Shared by the website and the admin page.
// Dates are "YYYY-MM-DD" and times "HH:MM" in the shop's own time zone, so nothing here
// depends on the time zone a customer's phone is set to.
(function (root) {
  const SHOP_TZ = "America/Detroit";
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (hm) => {
    const [h, m] = String(hm || "").split(":").map(Number);
    return h * 60 + m;
  };
  const toHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const utc = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };

  function localParts(now, tz) {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now)) p[x.type] = x.value;
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }

  function addDays(ymd, n) {
    const t = utc(ymd);
    t.setUTCDate(t.getUTCDate() + n);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }

  const weekday = (ymd) => utc(ymd).getUTCDay();

  function formatDate(ymd, style = "long") {
    return utc(ymd).toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: style === "short" ? "short" : "long", month: "short", day: "numeric",
    });
  }

  function formatTime(hm) {
    const m = toMin(hm);
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`;
  }

  function availableSlots({
    hours = [], blocks = [], leadDays = 2, slotMinutes = 30, bookAheadDays = 21,
    now = new Date(), tz = SHOP_TZ,
  } = {}) {
    const today = localParts(now, tz);
    const len = Number(slotMinutes) || 30;
    const out = [];
    for (let i = Number(leadDays) || 0; i <= Number(bookAheadDays); i++) {
      const date = addDays(today.date, i);
      const wd = weekday(date);
      const dayBlocks = blocks.filter((b) => b.start_date <= date && date <= (b.end_date || b.start_date));
      if (dayBlocks.some((b) => b.all_day)) continue;
      const starts = new Set();
      for (const h of hours) {
        if (Number(h.weekday) !== wd) continue;
        const end = toMin(h.end);
        for (let s = toMin(h.start); s + len <= end; s += len) {
          if (date === today.date && s < today.minutes) continue;
          if (dayBlocks.some((b) => s < toMin(b.to) && toMin(b.from) < s + len)) continue;
          starts.add(s);
        }
      }
      if (starts.size) out.push({ date, times: [...starts].sort((a, b) => a - b).map(toHM) });
    }
    return out;
  }

  const api = { SHOP_TZ, availableSlots, localParts, addDays, weekday, formatDate, formatTime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LunoahSlots = api;
})(this);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/slots.test.js`
Expected: all tests pass, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add pb_public/slots.js tests/slots.test.js
git commit -m "Add pickup slot calculation with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database migration

**Files:**
- Create: `pb_migrations/1762600000_pickup.js`

**Interfaces:**
- Produces collections `pickup_hours` {weekday, start, end} and `pickup_blocks` {start_date, end_date, all_day, from, to, note}, plus `shop` fields `lead_days`, `slot_minutes` and `book_ahead_days`. Field names match the `slots.js` input shapes exactly.

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />

// Pickup scheduling: Nadia's weekly pickup hours, her time off (lockouts),
// and three settings on the shop record. Public can read; only bakers can change.

const BAKER = "@request.auth.collectionName = 'bakers'";
const HM = "^([01]\\d|2[0-3]):[0-5]\\d$";
const YMD = "^\\d{4}-\\d{2}-\\d{2}$";

migrate((app) => {
  const rules = { listRule: "", viewRule: "", createRule: BAKER, updateRule: BAKER, deleteRule: BAKER };

  const hours = new Collection({
    type: "base",
    name: "pickup_hours",
    ...rules,
    fields: [
      { type: "number", name: "weekday", min: 0, max: 6, onlyInt: true }, // 0 = Sunday (not "required": 0 must be allowed)
      { type: "text", name: "start", required: true, pattern: HM },
      { type: "text", name: "end", required: true, pattern: HM },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
  });
  app.save(hours);

  const blocks = new Collection({
    type: "base",
    name: "pickup_blocks",
    ...rules,
    fields: [
      { type: "text", name: "start_date", required: true, pattern: YMD },
      { type: "text", name: "end_date", required: true, pattern: YMD },
      { type: "bool", name: "all_day" },
      { type: "text", name: "from", pattern: HM },
      { type: "text", name: "to", pattern: HM },
      { type: "text", name: "note", max: 200 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
  });
  app.save(blocks);

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.add(new NumberField({ name: "lead_days", min: 0, max: 30, onlyInt: true }));
  shop.fields.add(new NumberField({ name: "slot_minutes", min: 15, max: 60, onlyInt: true }));
  shop.fields.add(new NumberField({ name: "book_ahead_days", min: 1, max: 90, onlyInt: true }));
  app.save(shop);
  for (const r of app.findAllRecords("shop")) {
    r.set("lead_days", 2);
    r.set("slot_minutes", 30);
    r.set("book_ahead_days", 21);
    app.save(r);
  }

  // Start with Fri & Sat 9am–1pm (matches the existing pickup text).
  for (const wd of [5, 6]) {
    const r = new Record(hours);
    r.set("weekday", wd);
    r.set("start", "09:00");
    r.set("end", "13:00");
    app.save(r);
  }
}, (app) => {
  for (const name of ["pickup_blocks", "pickup_hours"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const shop = app.findCollectionByNameOrId("shop");
  for (const f of ["lead_days", "slot_minutes", "book_ahead_days"]) shop.fields.removeByName(f);
  app.save(shop);
});
```

- [ ] **Step 2: Apply it and restart the local site**

The local site normally runs from `Start Website.command` on port 8090. Stop it, apply the migration, then start it again in the background:

```bash
cd /Users/mhourani/Desktop/Lunoah-Sourdough-Co
pkill -f "pocketbase serve --http=127.0.0.1:8090" ; sleep 1
pocketbase migrate up --dir=pb_data --migrationsDir=pb_migrations
nohup pocketbase serve --http=127.0.0.1:8090 --dir=pb_data --migrationsDir=pb_migrations --publicDir=pb_public --hooksDir=pb_hooks > /tmp/lunoah-pb.log 2>&1 &
sleep 2
```

Expected: `migrate up` prints `Applied 1762600000_pickup.js`.

- [ ] **Step 3: Verify the data and access rules**

```bash
curl -s localhost:8090/api/collections/pickup_hours/records | python3 -m json.tool | grep -E '"(weekday|start|end)"'
curl -s "localhost:8090/api/collections/shop/records?perPage=1" | python3 -m json.tool | grep -E 'lead_days|slot_minutes|book_ahead_days'
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8090/api/collections/pickup_blocks/records -H 'Content-Type: application/json' -d '{"start_date":"2026-12-01","end_date":"2026-12-01","all_day":true}'
```

Expected: two hours rows (weekday 5 and 6, 09:00–13:00), shop shows `2`, `30` and `21`, and the anonymous POST returns `400` or `403` (not `200`).

- [ ] **Step 4: Commit**

```bash
git add pb_migrations/1762600000_pickup.js
git commit -m "Add pickup hours, time off, and scheduling settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Customer calendar and time picker

**Files:**
- Modify: `pb_public/index.html` (checkout step 1, around line 93; script tags around line 132)
- Modify: `pb_public/site.js` (state near line 6, `load()`, `orderText()`, `openDialog()`, `#to-step-2` handler)
- Modify: `pb_public/styles.css` (append)

**Interfaces:**
- Consumes: `window.LunoahSlots.{SHOP_TZ, availableSlots, localParts, weekday, formatDate, formatTime}` from Task 1, and collections and shop fields from Task 2.

- [ ] **Step 1: Markup.** In `pb_public/index.html`, replace
`<label>Pickup day <input id="o-day" placeholder="e.g. Saturday morning"></label>` with:

```html
        <div id="pickup-picker" class="pickup-picker" hidden>
          <span class="field-label">Pickup time</span>
          <div class="cal">
            <div class="cal-head">
              <button type="button" class="cal-nav" id="cal-prev" aria-label="Previous month">‹</button>
              <strong id="cal-title"></strong>
              <button type="button" class="cal-nav" id="cal-next" aria-label="Next month">›</button>
            </div>
            <div class="cal-grid cal-dow" aria-hidden="true"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
            <div class="cal-grid" id="cal-days"></div>
          </div>
          <div id="cal-times" class="cal-times"></div>
          <p id="cal-summary" class="cal-summary" aria-live="polite"></p>
        </div>
        <label id="o-day-wrap">Pickup day <input id="o-day" placeholder="e.g. Saturday morning"></label>
```

and add `<script src="/slots.js"></script>` immediately before `<script src="/site.js"></script>`.

- [ ] **Step 2: State and loading.** In `pb_public/site.js`, after `let payMethods = [];` add:

```js
  const S = window.LunoahSlots;
  let pickupData = null; // { hours, blocks } or null when the picker can't be used
  let slots = [];         // [{ date, times }] from slots.js
  let pick = { date: "", time: "" };
  let calMonth = "";      // "YYYY-MM" shown in the calendar
```

At the end of `load()` (after the payment-methods try block) add:

```js
    await loadPickup();
```

- [ ] **Step 3: Picker logic.** Add this block in `site.js` just above `// ---------- Checkout: 1 order → 2 pay → 3 send ----------`:

```js
  // ---------- Pickup time picker ----------
  async function loadPickup() {
    try {
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [h, b] = await Promise.all([
        get("/api/collections/pickup_hours/records?perPage=200"),
        get("/api/collections/pickup_blocks/records?perPage=500"),
      ]);
      pickupData = { hours: h.items || [], blocks: b.items || [] };
    } catch (_) {
      pickupData = null; // fall back to the free-text box
    }
    $("#pickup-picker").hidden = !pickupData;
    $("#o-day-wrap").hidden = !!pickupData;
  }

  function computeSlots() {
    if (!pickupData) return;
    slots = S.availableSlots({
      hours: pickupData.hours,
      blocks: pickupData.blocks,
      leadDays: shop.lead_days ?? 2,
      slotMinutes: shop.slot_minutes || 30,
      bookAheadDays: shop.book_ahead_days || 21,
      now: new Date(),
      tz: S.SHOP_TZ,
    });
    const day = slots.find((d) => d.date === pick.date);
    if (!day) pick = { date: slots[0] ? slots[0].date : "", time: "" };
    else if (!day.times.includes(pick.time)) pick.time = "";
    calMonth = (pick.date || S.localParts(new Date(), S.SHOP_TZ).date).slice(0, 7);
  }

  function shiftMonth(n) {
    const [y, m] = calMonth.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    calMonth = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    renderCal();
  }

  const pickupLabel = () => (pick.date && pick.time ? `${S.formatDate(pick.date)} at ${S.formatTime(pick.time)}` : "");

  function renderCal() {
    const avail = new Map(slots.map((d) => [d.date, d.times]));
    const [y, m] = calMonth.split("-").map(Number);
    $("#cal-title").textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
    const today = S.localParts(new Date(), S.SHOP_TZ).date;
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < S.weekday(`${calMonth}-01`); i++) cells.push(el("span", { class: "cal-day empty" }));
    for (let d = 1; d <= daysIn; d++) {
      const date = `${calMonth}-${String(d).padStart(2, "0")}`;
      const open = avail.has(date);
      const cls = "cal-day" + (date === today ? " today" : "") + (date === pick.date ? " selected" : "");
      const b = el("button", { type: "button", class: cls, "aria-label": S.formatDate(date) + (open ? "" : ", not available") }, String(d));
      if (open) b.addEventListener("click", () => { pick = { date, time: "" }; renderCal(); });
      else b.disabled = true;
      cells.push(b);
    }
    $("#cal-days").replaceChildren(...cells);

    const first = slots.length ? slots[0].date.slice(0, 7) : calMonth;
    const last = slots.length ? slots[slots.length - 1].date.slice(0, 7) : calMonth;
    $("#cal-prev").disabled = calMonth <= first;
    $("#cal-next").disabled = calMonth >= last;

    const times = avail.get(pick.date) || [];
    $("#cal-times").replaceChildren(...times.map((t) => {
      const b = el("button", { type: "button", class: "time-btn" + (t === pick.time ? " selected" : "") }, S.formatTime(t));
      b.addEventListener("click", () => { pick.time = t; renderCal(); });
      return b;
    }));

    $("#cal-summary").textContent = !slots.length
      ? "No pickup times are open right now. Please check back soon."
      : pickupLabel() || (pick.date ? `${S.formatDate(pick.date)}: now choose a time.` : "Choose a day.");
    $("#cal-summary").classList.toggle("chosen", !!pickupLabel());
    $("#to-step-2").disabled = !pickupLabel();
  }

  $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("#cal-next").addEventListener("click", () => shiftMonth(1));
```

- [ ] **Step 4: Wire it into checkout.** In `orderText()` replace
`const day = $("#o-day").value.trim();` with:

```js
    const day = pickupData ? pickupLabel() : $("#o-day").value.trim();
```

In `openDialog()`, immediately before `goStep(1);` add:

```js
    if (pickupData) { computeSlots(); renderCal(); }
```

In the `#to-step-2` click handler, after the name check line, add:

```js
    if (pickupData && !pickupLabel()) return;
```

- [ ] **Step 5: Styles.** Append to `pb_public/styles.css`:

```css
/* ---------- Pickup calendar ---------- */
.pickup-picker { display: flex; flex-direction: column; gap: 10px; }
.field-label { font-weight: 500; font-size: .9rem; }
.cal { background: var(--paper); border: 1.5px solid var(--line); border-radius: 14px; padding: 10px; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.cal-head strong { font-family: var(--serif); font-weight: 600; font-size: 1.05rem; }
.cal-nav { width: 40px; height: 40px; border-radius: 50%; border: 1.5px solid var(--line); background: #fff; font-size: 1.3rem; line-height: 1; color: var(--ink); cursor: pointer; }
.cal-nav:disabled { opacity: .3; cursor: default; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-dow span { text-align: center; font-size: .72rem; font-weight: 600; color: var(--muted); padding: 2px 0; }
.cal-day { min-height: 40px; border: 0; border-radius: 10px; background: #fff; font: 600 .95rem var(--sans); color: var(--ink); cursor: pointer; }
.cal-day.empty { background: none; }
.cal-day:disabled { background: none; color: #c9bba8; font-weight: 400; cursor: default; }
.cal-day.today { box-shadow: inset 0 0 0 1.5px var(--line); }
.cal-day:not(:disabled):hover { box-shadow: inset 0 0 0 1.5px var(--crust); }
.cal-day.selected, .cal-day.selected:hover { background: var(--crust); color: #fff; box-shadow: none; }
.cal-times { display: flex; flex-wrap: wrap; gap: 8px; }
.cal-times:empty { display: none; }
.time-btn { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1.5px solid var(--line); background: #fff; font: 600 .92rem var(--sans); color: var(--ink); cursor: pointer; }
.time-btn:hover { border-color: var(--crust); }
.time-btn.selected { background: var(--crust); border-color: var(--crust); color: #fff; }
.cal-summary { margin: 0; font-size: .92rem; color: var(--muted); }
.cal-summary.chosen { color: var(--ink); font-weight: 600; }
```

- [ ] **Step 6: Browser check at 320/375/768px.** With the site running, use headless Chrome over CDP (the same approach as the earlier mobile check; scripts live in the session scratchpad and are not committed). For each width:
  1. Add a loaf and open Checkout.
  2. Assert that `document.documentElement.scrollWidth === innerWidth` and that nothing inside `dialog[open]` extends past the dialog's right edge.
  3. Assert that `#to-step-2` is disabled and that the first open Friday at least 2 days out is selected.
  4. Assert that disabled `.cal-day` buttons exist for the dates before it.
  5. Tap the `9:30 AM` time button and assert that `#cal-summary` reads `<Weekday>, <Mon> <D> at 9:30 AM` and `#to-step-2` is enabled.
  6. Fill the name, continue to step 3 (choose a payment app and confirm if `require_payment` is on), and assert that `#order-preview` contains `Pickup: <same label>`.

  Take a screenshot at 375px and look at it.

- [ ] **Step 7: Fallback check.** Temporarily break the hours URL in the browser console run (or stop the server, load the page, then restart it). Confirm the "Pickup day" text box appears instead of the calendar and that ordering still works.

- [ ] **Step 8: Commit**

```bash
git add pb_public/index.html pb_public/site.js pb_public/styles.css
git commit -m "Checkout: pick pickup day and time from a calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin "Pickup Times" tab

**Files:**
- Create: `pb_public/admin/pickup-admin.js`
- Modify: `pb_public/admin/index.html` (tab nav around line 57, new panel before `<!-- PAYMENTS -->`, new dialog, script tags at the end)
- Modify: `pb_public/admin/admin.js:161` (tab list) and `:166-171` (`showApp`)
- Modify: `pb_public/admin/admin.css` (append)

**Interfaces:**
- Consumes: `window.LunoahSlots` (Task 1), the collections and shop fields (Task 2), and the `admin.js` helpers `api(path, {method, body})`, `toast(msg, kind)` and `busy(btn, on)`.
- Produces: `window.PickupAdmin({ api, toast, busy }) → { load(): Promise<void> }`

- [ ] **Step 1: Markup.** In `pb_public/admin/index.html`:

Add a tab button between Shop Info and Payments:

```html
      <button class="tab" data-tab="pickup">Pickup Times</button>
```

Insert before `<!-- PAYMENTS -->`:

```html
    <!-- PICKUP TIMES -->
    <main id="tab-pickup" class="panel" hidden>
      <p class="hint top-hint">Customers choose a pickup day and time from these hours, at least <strong id="pk-lead-echo">2</strong> days after they order.</p>

      <section class="pk-section">
        <h2>Regular hours</h2>
        <ul id="pk-week" class="pk-week"></ul>
        <button type="button" id="pk-save-hours" class="btn big full">Save regular hours</button>
      </section>

      <section class="pk-section">
        <h2>Time off</h2>
        <p class="muted small-print">Vacations, days off, or a busy hour. Customers can't pick these times.</p>
        <ul id="pk-blocks" class="pk-blocks"></ul>
        <button type="button" id="pk-add-block" class="btn big full">＋ Add time off</button>
      </section>

      <section class="pk-section">
        <h2>Settings</h2>
        <form id="pk-settings" class="form">
          <label>Minimum notice <span class="muted">(days between ordering and pickup)</span>
            <input id="pk-lead" type="number" inputmode="numeric" min="0" max="30" required></label>
          <label>Time slots every
            <select id="pk-slot"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select></label>
          <label>Customers can book up to <span class="muted">(days ahead)</span>
            <input id="pk-ahead" type="number" inputmode="numeric" min="1" max="90" required></label>
          <button class="btn big full" type="submit">Save settings</button>
        </form>
      </section>

      <section class="pk-section">
        <h2>What customers can pick now</h2>
        <ul id="pk-preview" class="pk-preview"></ul>
      </section>
    </main>
```

Add before `<div id="toast"`:

```html
  <!-- ADD TIME OFF -->
  <dialog id="block-dialog">
    <form id="block-form" class="form">
      <h2>Add time off</h2>
      <label>First day <input type="date" id="bk-start" required></label>
      <label>Last day <input type="date" id="bk-end" required></label>
      <label class="check"><input type="checkbox" id="bk-allday" checked> All day</label>
      <div id="bk-times" class="pk-range" hidden>
        <label>From <input type="time" id="bk-from" step="900"></label>
        <label>To <input type="time" id="bk-to" step="900"></label>
      </div>
      <label>Note <span class="muted">(optional, e.g. Vacation)</span><input id="bk-note" maxlength="200"></label>
      <div class="dialog-actions">
        <button class="btn big" type="submit">Save</button>
        <button class="btn ghost big" type="button" id="bk-cancel">Cancel</button>
      </div>
    </form>
  </dialog>
```

Change the script tags at the end to:

```html
  <script src="/pay-apps.js"></script>
  <script src="/slots.js"></script>
  <script src="/admin/pickup-admin.js"></script>
  <script src="/admin/admin.js"></script>
```

- [ ] **Step 2: Hook into `admin.js`.** At `pb_public/admin/admin.js:161` change
`for (const name of ["breads", "shop", "pay"])` to `for (const name of ["breads", "shop", "pickup", "pay"])`.

Just above `async function showApp()` add:

```js
  const pickupAdmin = window.PickupAdmin({ api, toast, busy });
```

In `showApp()` change the `Promise.all` line to:

```js
    await Promise.all([loadBreads(), loadShop(), loadPay(), pickupAdmin.load().catch((err) => toast(err.message, "bad"))]);
```

- [ ] **Step 3: Write `pb_public/admin/pickup-admin.js`.**

```js
// "Pickup Times" tab: regular weekly hours, time off, scheduling settings, and a live preview.
window.PickupAdmin = function ({ api, toast, busy }) {
  const $ = (s) => document.querySelector(s);
  const S = window.LunoahSlots;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let hours = [];
  let blocks = [];
  let shop = null;
  let week = []; // 7 × { on, ranges: [{ start, end }] } — what Nadia is editing

  const today = () => S.localParts(new Date(), S.SHOP_TZ).date;
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  async function load() {
    const [hr, br, sr] = await Promise.all([
      api("/api/collections/pickup_hours/records?perPage=200&sort=weekday,start"),
      api(`/api/collections/pickup_blocks/records?perPage=500&sort=start_date&filter=${encodeURIComponent(`end_date >= '${today()}'`)}`),
      api("/api/collections/shop/records?perPage=1"),
    ]);
    hours = hr.items;
    blocks = br.items;
    shop = sr.items[0];
    week = DAYS.map((_, wd) => {
      const ranges = hours.filter((x) => x.weekday === wd).map((x) => ({ start: x.start, end: x.end }));
      return { on: ranges.length > 0, ranges: ranges.length ? ranges : [{ start: "09:00", end: "13:00" }] };
    });
    $("#pk-lead").value = shop.lead_days ?? 2;
    $("#pk-slot").value = String(shop.slot_minutes || 30);
    $("#pk-ahead").value = shop.book_ahead_days || 21;
    $("#pk-lead-echo").textContent = shop.lead_days ?? 2;
    renderWeek();
    renderBlocks();
    renderPreview();
  }

  // ----- Regular hours -----
  function timeInput(value, onChange) {
    const i = document.createElement("input");
    i.type = "time";
    i.step = 900;
    i.value = value;
    i.addEventListener("change", () => onChange(i.value));
    return i;
  }

  function renderWeek() {
    $("#pk-week").replaceChildren(...week.map((day, wd) => {
      const li = h("li", "pk-day" + (day.on ? " on" : ""));
      const sw = h("label", "switch");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = day.on;
      cb.addEventListener("change", () => { day.on = cb.checked; renderWeek(); });
      sw.append(cb, h("span", "pk-dayname", DAYS[wd]));
      li.append(sw);
      if (!day.on) { li.append(h("span", "muted pk-closed", "Closed")); return li; }

      const list = h("div", "pk-ranges");
      day.ranges.forEach((r, ri) => {
        const row = h("div", "pk-range");
        row.append(
          timeInput(r.start, (v) => (r.start = v)),
          h("span", "muted", "to"),
          timeInput(r.end, (v) => (r.end = v)),
        );
        if (day.ranges.length > 1) {
          const x = h("button", "pk-x", "×");
          x.type = "button";
          x.title = "Remove these hours";
          x.addEventListener("click", () => { day.ranges.splice(ri, 1); renderWeek(); });
          row.append(x);
        }
        list.append(row);
      });
      const add = h("button", "pk-add", "＋ add hours");
      add.type = "button";
      add.addEventListener("click", () => { day.ranges.push({ start: "16:00", end: "18:00" }); renderWeek(); });
      list.append(add);
      li.append(list);
      return li;
    }));
  }

  $("#pk-save-hours").addEventListener("click", async (e) => {
    for (const [wd, day] of week.entries()) {
      if (!day.on) continue;
      for (const r of day.ranges) {
        if (!r.start || !r.end || r.end <= r.start) {
          return toast(`${DAYS[wd]}: the end time must be after the start time.`, "bad");
        }
      }
    }
    const btn = e.currentTarget;
    busy(btn, true);
    try {
      for (const x of hours) await api(`/api/collections/pickup_hours/records/${x.id}`, { method: "DELETE" });
      for (const [wd, day] of week.entries()) {
        if (!day.on) continue;
        for (const r of day.ranges) {
          await api("/api/collections/pickup_hours/records", { method: "POST", body: { weekday: wd, start: r.start, end: r.end } });
        }
      }
      toast("Pickup hours saved!");
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); await load().catch(() => {}); }
  });

  // ----- Time off -----
  function blockLabel(b) {
    const d = b.start_date === b.end_date
      ? S.formatDate(b.start_date, "short")
      : `${S.formatDate(b.start_date, "short")} – ${S.formatDate(b.end_date, "short")}`;
    return `${d} · ${b.all_day ? "All day" : `${S.formatTime(b.from)}–${S.formatTime(b.to)}`}`;
  }

  function renderBlocks() {
    const ul = $("#pk-blocks");
    if (!blocks.length) {
      ul.replaceChildren(h("li", "hint", "No time off planned."));
      return;
    }
    ul.replaceChildren(...blocks.map((b) => {
      const li = h("li", "pk-block");
      const info = h("div");
      info.append(h("div", "name", blockLabel(b)));
      if (b.note) info.append(h("div", "muted small-print", b.note));
      const del = h("button", "btn ghost small danger-text", "Delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm(`Delete time off: ${blockLabel(b)}?`)) return;
        try {
          await api(`/api/collections/pickup_blocks/records/${b.id}`, { method: "DELETE" });
          toast("Time off deleted");
          await load();
        } catch (err) { toast(err.message, "bad"); }
      });
      li.append(info, del);
      return li;
    }));
  }

  $("#pk-add-block").addEventListener("click", () => {
    $("#block-form").reset();
    $("#bk-start").value = today();
    $("#bk-end").value = today();
    $("#bk-start").min = today();
    $("#bk-end").min = today();
    $("#bk-times").hidden = true;
    $("#block-dialog").showModal();
  });
  $("#bk-start").addEventListener("change", () => {
    $("#bk-end").min = $("#bk-start").value;
    if ($("#bk-end").value < $("#bk-start").value) $("#bk-end").value = $("#bk-start").value;
  });
  $("#bk-allday").addEventListener("change", () => ($("#bk-times").hidden = $("#bk-allday").checked));
  $("#bk-cancel").addEventListener("click", () => $("#block-dialog").close());

  $("#block-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const start = $("#bk-start").value;
    const end = $("#bk-end").value;
    const allDay = $("#bk-allday").checked;
    const from = $("#bk-from").value;
    const to = $("#bk-to").value;
    if (!start || !end) return toast("Please choose the first and last day.", "bad");
    if (end < start) return toast("The last day can't be before the first day.", "bad");
    if (!allDay && (!from || !to || to <= from)) return toast("Please choose a start and end time (end after start).", "bad");
    const btn = e.submitter;
    busy(btn, true);
    try {
      await api("/api/collections/pickup_blocks/records", {
        method: "POST",
        body: { start_date: start, end_date: end, all_day: allDay, from: allDay ? "" : from, to: allDay ? "" : to, note: $("#bk-note").value.trim() },
      });
      $("#block-dialog").close();
      toast("Time off added");
      await load();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  // ----- Settings -----
  $("#pk-settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lead = Number($("#pk-lead").value);
    const ahead = Number($("#pk-ahead").value);
    if (!Number.isInteger(lead) || lead < 0 || lead > 30) return toast("Minimum notice must be 0 to 30 days.", "bad");
    if (!Number.isInteger(ahead) || ahead < 1 || ahead > 90) return toast("Booking ahead must be 1 to 90 days.", "bad");
    if (ahead < lead) return toast("Booking ahead must be at least the minimum notice.", "bad");
    const btn = e.submitter;
    busy(btn, true);
    try {
      await api(`/api/collections/shop/records/${shop.id}`, {
        method: "PATCH",
        body: { lead_days: lead, slot_minutes: Number($("#pk-slot").value), book_ahead_days: ahead },
      });
      toast("Settings saved!");
      await load();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  // ----- Preview -----
  function renderPreview() {
    const days = S.availableSlots({
      hours, blocks,
      leadDays: shop.lead_days ?? 2,
      slotMinutes: shop.slot_minutes || 30,
      bookAheadDays: shop.book_ahead_days || 21,
      now: new Date(),
      tz: S.SHOP_TZ,
    });
    const ul = $("#pk-preview");
    if (!days.length) {
      ul.replaceChildren(h("li", "pk-empty", "No pickup times are open. Customers can't choose a pickup time right now."));
      return;
    }
    ul.replaceChildren(...days.slice(0, 10).map((d) =>
      h("li", null, `${S.formatDate(d.date, "short")}: ${d.times.length} times, ${S.formatTime(d.times[0])} to ${S.formatTime(d.times[d.times.length - 1])}`)));
    if (days.length > 10) ul.append(h("li", "muted", `…and ${days.length - 10} more days`));
  }

  return { load };
};
```

- [ ] **Step 4: Styles.** Append to `pb_public/admin/admin.css`:

```css
/* Pickup Times */
.pk-section { margin-top: 28px; }
.pk-section:first-of-type { margin-top: 12px; }
.pk-week, .pk-blocks, .pk-preview { list-style: none; padding: 0; margin: 0 0 14px; display: flex; flex-direction: column; gap: 8px; }
.pk-day { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.pk-dayname { color: var(--ink); font-weight: 600; font-size: 1rem; min-width: 6.5em; }
.pk-closed { font-size: .9rem; }
.pk-ranges { display: flex; flex-direction: column; gap: 8px; flex: 1 1 100%; }
.pk-range { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pk-range input[type=time], .form select {
  font: 400 1rem "Inter", sans-serif; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 12px; background: #fff; color: var(--ink);
}
.pk-range input[type=time] { flex: 1 1 120px; min-width: 0; }
.pk-range label { flex: 1 1 120px; }
.pk-x { width: 40px; height: 40px; border-radius: 10px; border: 1.5px solid var(--line); background: #fff; color: var(--danger); font-size: 1.3rem; cursor: pointer; }
.pk-add { align-self: flex-start; background: none; border: 0; color: var(--crust); font: 600 .95rem "Inter", sans-serif; cursor: pointer; padding: 4px 0; }
.pk-block { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pk-block .name { font-weight: 600; }
.pk-preview li { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: .95rem; }
.pk-preview li.pk-empty { color: var(--danger); font-weight: 600; }
```

- [ ] **Step 5: Browser check of the admin page.** Logging in needs a baker account. Create a temporary one, test, then remove it:

```bash
cd /Users/mhourani/Desktop/Lunoah-Sourdough-Co
pocketbase superuser upsert claude-test@local.test 'TempPass-12345' --dir=pb_data
TOKEN=$(curl -s -X POST localhost:8090/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"claude-test@local.test","password":"TempPass-12345"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST localhost:8090/api/collections/bakers/records -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"claude-test-baker@local.test","password":"TempPass-12345","passwordConfirm":"TempPass-12345","name":"Test"}'
```

Over CDP at 375px and 320px, log in at `/admin/` as `claude-test-baker@local.test`, open **Pickup Times**, and check each of the following:
1. Friday and Saturday are on, 9:00 AM to 1:00 PM, and the other days show "Closed".
2. There is no sideways scroll at 320px.
3. Turn on Sunday, set 10:00 to 12:00, and save. The success toast appears, and the preview now lists Sunday dates.
4. Add a time-off range across the next Friday and Saturday. They disappear from the preview and from the storefront calendar.
5. Add a partial time off of 10:00 to 11:00 on a Saturday. The storefront shows that Saturday without 10:00 and 10:30.
6. Set minimum notice to 3 and save. The first available date on the storefront moves out by a day.

Afterwards, restore Friday and Saturday hours only and notice back to 2, delete the test time off, then remove the temporary accounts:

```bash
curl -s -X DELETE "localhost:8090/api/collections/bakers/records/$(curl -s "localhost:8090/api/collections/bakers/records?filter=email%3D'claude-test-baker%40local.test'" -H "Authorization: $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["items"][0]["id"])')" -H "Authorization: $TOKEN"
pocketbase superuser delete claude-test@local.test --dir=pb_data
```

- [ ] **Step 6: Commit**

```bash
git add pb_public/admin/pickup-admin.js pb_public/admin/index.html pb_public/admin/admin.js pb_public/admin/admin.css
git commit -m "Admin: Pickup Times tab for hours, time off, and settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Update Nadia's guide

**Files:**
- Modify: `NADIA-GUIDE.md`

- [ ] **Step 1: Add a section** after "Change your phone number, pickup times, or the words on the front page". Also change line 50, "their name and pickup day", to "their name and pickup day & time".

```markdown
## Set your pickup times and time off

Open **Pickup Times**.

- **Regular hours:** switch on the days you do pickups and set the hours. Tap **＋ add hours**
  for a second window that day. Tap **Save regular hours**.
- **Time off:** going away, or need a few days after a trip? Tap **＋ Add time off**, pick the first
  and last day, and save. For a single busy hour, turn off **All day** and pick the times.
- **Settings:** *Minimum notice* is how many days ahead people must order (2 = an order on
  Monday can be picked up Wednesday at the earliest).
- **What customers can pick now** shows exactly what the website is offering.

Customers pick a day and time on a calendar when they check out. Their text to you says, for example,
`Pickup: Saturday, Nov 14 at 10:00 AM`.
```

- [ ] **Step 2: Commit**

```bash
git add NADIA-GUIDE.md
git commit -m "Guide: pickup times and time off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Final check

- [ ] `node --test tests/slots.test.js` passes.
- [ ] Full storefront checkout at 320px and 375px shows the right `Pickup:` line.
- [ ] Admin tab works at 320px, and the temporary accounts are removed.
- [ ] `git status` is clean.
