# Pickup Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each pickup time can be booked by one customer only (15-minute slots by default). Booked times disappear for others, and Nadia sees and cancels bookings in her portal.

**Architecture:** A new `bookings` collection with a database unique index on (date, time) enforces one booking per slot. The public can create bookings but not read them. A small hook endpoint (`/api/lunoah/taken`) exposes only the taken date/time pairs. `slots.js` gains a `taken` input. The storefront saves the booking when the customer taps Open Messages or Copy order. The admin Pickup Times tab gains an "Upcoming pickups" list with Cancel.

**Tech Stack:** PocketBase v0.41 (JS migrations + `pb_hooks` JSVM), vanilla JS, Node 22 `node --test`, headless Chrome via CDP for browser checks.

**Spec:** `docs/superpowers/specs/2026-11-07-pickup-bookings-design.md` (builds on `docs/superpowers/specs/2026-11-07-pickup-scheduling-design.md`)

## Global Constraints

- One booking per (date, time), enforced by `CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time)`.
- Default slot length 15 minutes. Choices stay 15 / 30 / 60. Code fallbacks for a missing `slot_minutes` become `15` (not `30`).
- `bookings` rules: `createRule: ""`, while list, view, update and delete use `@request.auth.collectionName = 'bakers'`.
- The public learns only taken `{date, time}` pairs, through `GET /api/lunoah/taken?from=YYYY-MM-DD`. Names and items never reach the storefront.
- Dates are `YYYY-MM-DD` and times `HH:MM` (24h) strings in shop time (`America/Detroit`), with no timezone conversion.
- No new dependencies and no build step. Plain `<script src>`.
- No horizontal scroll at 320px. Tap targets as in the existing UI.
- Customer copy (exact): "Sorry, {9:15 AM} was just taken. Please pick another time." / "We couldn't save your pickup time. Please check your connection and try again." / "Saving your pickup time…"
- Nadia copy (exact): confirm "Cancel {Sam Rivera}'s {9:15 AM} pickup on {Fri, Nov 13}? That time will open up for other customers." / toast "Pickup cancelled. {9:15 AM} is open again." / empty "No upcoming pickups yet."
- Server: the user may already be running the site from VS Code (Cmd+Shift+B → "Start Website" task, `pocketbase serve --http=127.0.0.1:8090 …` in `/Users/mhourani/Desktop/Lunoah-Sourdough-Co`). Never kill a server you didn't start. If none is running, start one in the background for your checks and stop it when done.

## File Structure

| File | Responsibility |
|---|---|
| `pb_public/slots.js` | Add an optional `taken` input to `availableSlots`. |
| `tests/slots.test.js` | Tests for `taken`. |
| `pb_migrations/1762700000_bookings.js` (new) | `bookings` collection, unique index, `slot_minutes` → 15. |
| `pb_hooks/bookings.pb.js` (new) | `GET /api/lunoah/taken`. |
| `pb_public/index.html` | Notice and error elements in checkout, plus a Messages fallback link. |
| `pb_public/site.js` | Load taken slots, refresh on open, reserve on send, handle a lost race. |
| `pb_public/styles.css` | Notice and error styles. |
| `pb_public/admin/index.html` | "Upcoming pickups" section. |
| `pb_public/admin/pickup-admin.js` | Load, render and cancel bookings. The preview excludes booked times. |
| `pb_public/admin/admin.css` | Bookings list styles. |
| `NADIA-GUIDE.md` | "Upcoming pickups & cancelling". |

---

### Task 1: `taken` input in slot calculation

**Files:**
- Modify: `pb_public/slots.js` (`availableSlots`)
- Test: `tests/slots.test.js`

**Interfaces:**
- Produces: `availableSlots({ hours, blocks, leadDays, slotMinutes, bookAheadDays, now, tz, taken })`. `taken` is optional, defaults to `[]`, and has the shape `[{ date: "YYYY-MM-DD", time: "HH:MM" }]`. A slot whose `date` and `time` equal a taken pair is excluded. Everything else is unchanged.

- [ ] **Step 1: Write the failing tests.** Append to `tests/slots.test.js` (the helpers `S`, `est`, `base` and `FRI_SAT` already exist at the top; `base()` uses `slotMinutes: 30`):

```js
test("taken: a booked slot is removed", () => {
  const taken = [{ date: "2026-11-13", time: "09:30" }];
  const r = S.availableSlots(base({ taken, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-13");
  assert.deepEqual(r[0].times, ["09:00", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
});

test("taken: a fully booked day disappears", () => {
  const times = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"];
  const taken = times.map((time) => ({ date: "2026-11-13", time }));
  const r = S.availableSlots(base({ taken, now: est("2026-11-09") }));
  assert.equal(r[0].date, "2026-11-14");
});

test("taken: bookings on another date don't affect a day", () => {
  const taken = [{ date: "2026-11-14", time: "09:00" }];
  const r = S.availableSlots(base({ taken, now: est("2026-11-09") }));
  assert.equal(r[0].times.length, 8);
  assert.equal(r[1].times[0], "09:30");
});

test("taken: works with 15-minute slots", () => {
  const taken = [{ date: "2026-11-13", time: "09:15" }];
  const r = S.availableSlots(base({ slotMinutes: 15, taken, now: est("2026-11-09") }));
  assert.deepEqual(r[0].times.slice(0, 3), ["09:00", "09:30", "09:45"]);
  assert.equal(r[0].times.length, 15);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/slots.test.js`
Expected: the 4 new tests FAIL (taken slots are still present), and the 17 existing tests pass.

- [ ] **Step 3: Implement.** In `pb_public/slots.js`:
  - Add `taken = []` to the destructured parameters of `availableSlots`, after `tz = SHOP_TZ`.
  - After `const out = [];`, add:

```js
    const takenSet = new Set(taken.map((t) => `${t.date} ${t.time}`));
```

  - Inside the inner slot loop, after the line that skips slots overlapping a lockout (`if (dayBlocks.some(...)) continue;`), add:

```js
          if (takenSet.has(`${date} ${toHM(s)}`)) continue;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/slots.test.js`
Expected: `# pass 21`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add pb_public/slots.js tests/slots.test.js
git commit -m "Slots: exclude already-booked pickup times

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Bookings collection and "taken" endpoint

**Files:**
- Create: `pb_migrations/1762700000_bookings.js`
- Create: `pb_hooks/bookings.pb.js`

**Interfaces:**
- Produces the `bookings` collection {date, time, name, items, total, order_code, created}. Create is public; everything else is bakers only. Unique on (date, time).
- Produces `GET /api/lunoah/taken?from=YYYY-MM-DD` → `200 {"taken":[{"date","time"}]}` sorted by date, time; a bad `from` gives `400 {"message": "..."}`.
- A duplicate create returns HTTP 400 with JSON `data` containing `date` and/or `time` entries whose `code` is `validation_not_unique`. Record the exact shape you observe in your report, because Task 3 relies on it.

- [ ] **Step 1: Write the migration** `pb_migrations/1762700000_bookings.js`:

```js
/// <reference path="../pb_data/types.d.ts" />

// Pickup bookings: one customer per pickup time. Anyone can create a booking (at checkout);
// only bakers can see, change or cancel them. The unique index makes double-booking impossible.

const BAKER = "@request.auth.collectionName = 'bakers'";
const HM = "^([01]\\d|2[0-3]):[0-5]\\d$";
const YMD = "^\\d{4}-\\d{2}-\\d{2}$";

migrate((app) => {
  const bookings = new Collection({
    type: "base",
    name: "bookings",
    listRule: BAKER,
    viewRule: BAKER,
    createRule: "",
    updateRule: BAKER,
    deleteRule: BAKER,
    fields: [
      { type: "text", name: "date", required: true, pattern: YMD },
      { type: "text", name: "time", required: true, pattern: HM },
      { type: "text", name: "name", required: true, max: 100 },
      { type: "text", name: "items", max: 1000 },
      { type: "number", name: "total", min: 0 },
      { type: "text", name: "order_code", max: 20 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time)"],
  });
  app.save(bookings);

  // One customer per 15-minute window by default.
  for (const r of app.findAllRecords("shop")) {
    r.set("slot_minutes", 15);
    app.save(r);
  }
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("bookings")); } catch (_) {}
  for (const r of app.findAllRecords("shop")) {
    r.set("slot_minutes", 30);
    app.save(r);
  }
});
```

- [ ] **Step 2: Write the hook** `pb_hooks/bookings.pb.js`:

```js
/// <reference path="../pb_data/types.d.ts" />

// Which pickup times are already booked, from a given date on. Returns only dates and times,
// never names or orders, so customers can't see who booked what.
routerAdd("GET", "/api/lunoah/taken", (e) => {
  const from = e.request.url.query().get("from") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return e.json(400, { message: "from must be a date like 2026-11-13" });
  }
  const recs = $app.findRecordsByFilter("bookings", "date >= {:from}", "date,time", 5000, 0, { from: from });
  return e.json(200, {
    taken: recs.map((r) => ({ date: r.getString("date"), time: r.getString("time") })),
  });
});
```

- [ ] **Step 3: Apply.** Check whether a server is listening: `lsof -iTCP:8090 -sTCP:LISTEN`.
  - **If one is running** (the user's), creating a file in `pb_hooks/` makes PocketBase restart itself, and pending migrations apply on restart. Wait about 3 seconds, then continue.
  - **If none is running**, run `pocketbase migrate up --dir=pb_data --migrationsDir=pb_migrations`, then start a temporary server in the background: `pocketbase serve --http=127.0.0.1:8090 --dir=pb_data --migrationsDir=pb_migrations --publicDir=pb_public --hooksDir=pb_hooks > /tmp/lunoah-pb-bookings.log 2>&1 &`. Stop it at the end of the task.

  Confirm the collection exists: `curl -s localhost:8090/api/lunoah/taken?from=2026-11-01` → `{"taken":[]}`.

- [ ] **Step 4: Verify with curl** (paste the actual outputs in your report):

```bash
B=localhost:8090/api/collections/bookings/records
J='Content-Type: application/json'
# anonymous create succeeds (2xx)
curl -s -o /dev/null -w "create %{http_code}\n" -X POST $B -H "$J" -d '{"date":"2099-01-02","time":"09:15","name":"Test A","items":"1 × Test","total":10,"order_code":"LUN-TEST1"}'
# duplicate is rejected (400) — print the body to see the exact error shape
curl -s -w "\ndup %{http_code}\n" -X POST $B -H "$J" -d '{"date":"2099-01-02","time":"09:15","name":"Test B","items":"","total":0,"order_code":"LUN-TEST2"}'
# anonymous list/view are denied or empty (must not show names)
curl -s "$B" ; echo
# taken endpoint shows only date/time
curl -s "localhost:8090/api/lunoah/taken?from=2099-01-01"; echo
# bad from → 400
curl -s -o /dev/null -w "badfrom %{http_code}\n" "localhost:8090/api/lunoah/taken?from=nope"
# shop slot_minutes is now 15
curl -s "localhost:8090/api/collections/shop/records?perPage=1" | python3 -c 'import sys,json;print("slot_minutes", json.load(sys.stdin)["items"][0]["slot_minutes"])'
```

  Expected:
  - `create 200` (or 204)
  - `dup 400`, with `validation_not_unique` in the body
  - the anonymous list shows no `name` values (empty items, or a 403)
  - `{"taken":[{"date":"2099-01-02","time":"09:15"}]}`
  - `badfrom 400`
  - `slot_minutes 15`

- [ ] **Step 5: Remove the test booking.** It can't be deleted anonymously, so use a temporary superuser and remove it afterwards:

```bash
pocketbase superuser upsert claude-test@local.test 'TempPass-12345' --dir=pb_data >/dev/null
T=$(curl -s -X POST localhost:8090/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"claude-test@local.test","password":"TempPass-12345"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
for id in $(curl -s "localhost:8090/api/collections/bookings/records?perPage=500" -H "Authorization: $T" | python3 -c 'import sys,json;print(" ".join(r["id"] for r in json.load(sys.stdin)["items"]))'); do curl -s -o /dev/null -X DELETE "localhost:8090/api/collections/bookings/records/$id" -H "Authorization: $T"; done
pocketbase superuser delete claude-test@local.test --dir=pb_data
curl -s "localhost:8090/api/lunoah/taken?from=2000-01-01"   # → {"taken":[]}
```

- [ ] **Step 6: Commit**

```bash
git add pb_migrations/1762700000_bookings.js pb_hooks/bookings.pb.js
git commit -m "Add pickup bookings (one per slot) and taken-times endpoint

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Storefront books the slot on send

**Files:**
- Modify: `pb_public/index.html` (checkout step 1 and step 3)
- Modify: `pb_public/site.js` (`loadPickup`, `computeSlots`, `renderCal` time click, `openDialog`, send and copy handlers)
- Modify: `pb_public/styles.css` (append)

**Interfaces:**
- Consumes: `LunoahSlots.availableSlots({ ..., taken })` (Task 1); `GET /api/lunoah/taken?from=` and `POST /api/collections/bookings/records` (Task 2, including the observed duplicate-error shape).
- Existing site.js names to use: `pickupData`, `usingPicker`, `pick {date,time}`, `slots`, `step`, `orderCode`, `lines()`, `total()`, `computeSlots()`, `renderCal()`, `pickupLabel()`, `goStep(n)`, `orderText()`, `needsPay()`, `chosen`, `el()`, `digits()`, `shop`, `S` (LunoahSlots).

- [ ] **Step 1: Markup** in `pb_public/index.html`.
  - In step 1, directly above `<div id="pickup-picker" …>`, add:

```html
        <p id="pickup-notice" class="pickup-notice" role="alert" hidden></p>
```

  - In step 3, directly after the `<div class="dialog-actions">` that holds `#send-text` and `#copy-order`, add:

```html
        <p id="send-error" class="send-error" role="alert" hidden></p>
        <p id="sms-fallback" class="muted small" hidden>Messages didn't open? <a id="sms-link" href="#">Tap here to open it</a>.</p>
```

- [ ] **Step 2: Load taken slots** in `site.js`.
  - Add a helper next to `loadPickup`:

```js
  const takenUrl = () => `/api/lunoah/taken?from=${S.localParts(new Date(), S.SHOP_TZ).date}`;
```

  - In `loadPickup`, add a third request to the `Promise.all` (`get(takenUrl())`), and store it:
    `pickupData = { hours: h.items || [], blocks: b.items || [], taken: t.taken || [] };`. The destructuring becomes `const [h, b, t] = …`. A failure of any of the three still sets `pickupData = null`, which gives the free-text fallback.
  - In `computeSlots`, pass `taken: pickupData.taken`, and change `slotMinutes: shop.slot_minutes || 30` to `shop.slot_minutes || 15`.
  - Add a refresh used when checkout opens:

```js
  // Re-check which times are booked each time checkout opens (another customer may have just booked).
  async function refreshTaken() {
    if (!pickupData) return;
    try {
      const r = await fetch(takenUrl());
      if (!r.ok) return;
      pickupData.taken = (await r.json()).taken || [];
    } catch (_) { return; } // keep the last known list
    if (usingPicker && step === 1) { computeSlots(); renderCal(); }
  }
```

  - In `openDialog()`, after `$("#order-dialog").showModal();`, add `refreshTaken();`. Before `goStep(1);`, also hide the notices: `$("#pickup-notice").hidden = true; $("#send-error").hidden = true; $("#sms-fallback").hidden = true;`.
  - In `renderCal`, in the time button's click handler, hide the notice when a new time is picked: `b.addEventListener("click", () => { pick.time = t; $("#pickup-notice").hidden = true; renderCal(); });`.

- [ ] **Step 3: Reserve on send.** Add above the `#send-text` handler:

```js
  // ---------- Booking the pickup time ----------
  let bookedKey = ""; // "<orderCode> <date> <time>" already booked during this visit
  const BTN_SEND = "Open Messages";

  function setSending(on) {
    $("#send-text").disabled = on;
    $("#copy-order").disabled = on;
    $("#send-text").textContent = on ? "Saving your pickup time…" : BTN_SEND;
  }

  // Saves the booking. Returns true when the order may be sent.
  async function reserve() {
    if (!usingPicker) return true; // free-text fallback: nothing to book
    const key = `${orderCode} ${pick.date} ${pick.time}`;
    if (bookedKey === key) return true;
    $("#send-error").hidden = true;
    setSending(true);
    try {
      const res = await fetch("/api/collections/bookings/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: pick.date,
          time: pick.time,
          name: $("#o-name").value.trim(),
          items: lines().map(({ b, q }) => `${q} × ${b.name}`).join(", "),
          total: total(),
          order_code: orderCode,
        }),
      });
      if (res.ok) { bookedKey = key; return true; }
      const body = await res.json().catch(() => ({}));
      const d = body.data || {};
      const isTaken = res.status === 400 && [d.date, d.time].some((x) => x && /not_unique/.test(x.code || ""));
      if (isTaken) {
        const lost = S.formatTime(pick.time);
        pickupData.taken.push({ date: pick.date, time: pick.time });
        pick.time = "";
        goStep(1);
        computeSlots();
        renderCal();
        $("#pickup-notice").textContent = `Sorry, ${lost} was just taken. Please pick another time.`;
        $("#pickup-notice").hidden = false;
        refreshTaken();
        return false;
      }
      throw new Error(String(res.status));
    } catch (_) {
      $("#send-error").textContent = "We couldn't save your pickup time. Please check your connection and try again.";
      $("#send-error").hidden = false;
      return false;
    } finally {
      setSending(false);
    }
  }
```

  Adjust the `isTaken` test to the exact duplicate-error shape Task 2 recorded.

- [ ] **Step 4: Use it in the send and copy handlers.** Replace both handlers:

```js
  $("#send-text").addEventListener("click", async () => {
    if (needsPay() && !(chosen && $("#co-paid").checked)) return goStep(2); // can't skip paying
    if (!(await reserve())) return;
    // "?&body=" works on both iPhone and Android. A real link click is more reliable than
    // setting location.href (which can leave the page stuck on desktop browsers).
    const href = `sms:${digits(shop.phone)}?&body=${encodeURIComponent(orderText())}`;
    const a = el("a", { href, hidden: "" });
    document.body.append(a);
    a.click();
    a.remove();
    // Saving the booking took a moment, and some phones then refuse to open Messages
    // automatically, so offer a real link the customer can tap.
    $("#sms-link").href = href;
    $("#sms-fallback").hidden = false;
  });
  $("#copy-order").addEventListener("click", async (e) => {
    if (needsPay() && !(chosen && $("#co-paid").checked)) return goStep(2);
    if (!(await reserve())) return;
    try {
      await navigator.clipboard.writeText(orderText());
      e.target.textContent = "Copied!";
      setTimeout(() => (e.target.textContent = "Copy order"), 2000);
    } catch (_) {
      prompt("Copy your order:", orderText());
    }
  });
```

- [ ] **Step 5: Styles.** Append to `pb_public/styles.css`:

```css
/* ---------- Booking notices ---------- */
.pickup-notice, .send-error { margin: 0; padding: 10px 12px; border-radius: 10px; font-size: .92rem; font-weight: 600; }
.pickup-notice { background: #fff4e5; color: #7a4a00; border: 1px solid #f0d2a8; }
.send-error { background: #fdecea; color: #b3261e; border: 1px solid #f3c7c3; }
#send-text:disabled, #copy-order:disabled { opacity: .6; cursor: wait; }
```

- [ ] **Step 6: Browser checks** over CDP with headless Chrome. Use a fresh `--user-data-dir` per run, `Emulation.setDeviceMetricsOverride {mobile:true}` and no `--window-size`. Put scripts and screenshots in `.superpowers/sdd/2026-11-07-pickup-bookings/task-3-browser/` and don't commit them.

  Checkout reminder: "+" on a bread → `#bar-btn` → `#o-name` → pick a date and time → `#to-step-2` → click "Venmo", tick `#co-paid` → `#to-step-3` → step 3.
  1. At 320 and 375px, there's no horizontal overflow at step 1 or step 3.
  2. Book Fri Nov 13 9:15 AM through the UI (click `#copy-order`; in headless the clipboard may fail and fall back to `prompt`, so answer `Page.javascriptDialogOpening` with accept). Then `curl localhost:8090/api/lunoah/taken?from=2026-11-01` shows `{"date":"2026-11-13","time":"09:15"}`. Reopen checkout: 9:15 AM is not among `#cal-times` for Nov 13.
  3. Race. Open checkout and choose Nov 13 9:30 AM, then advance to step 3. Before clicking send, book 09:30 directly through the API with curl (anonymous POST). Now click `#copy-order`. Expect step 1, `#pickup-notice` reading "Sorry, 9:30 AM was just taken. Please pick another time.", 9:30 gone from the times, and `#o-name` still filled.
  4. Same order, same slot, clicked twice: only one booking is created (check with the taken endpoint).
  5. Error path: use `Fetch.enable` to fail `*bookings/records*` requests. Clicking send shows `#send-error` with the connection message, and you stay on step 3.
  6. Take a 375px screenshot of the race notice, look at it yourself and describe it.

  **Cleanup:** delete every booking you created, using the temporary-superuser approach from Task 2 Step 5 (create, delete bookings, delete the superuser), and confirm `/api/lunoah/taken?from=2000-01-01` → `{"taken":[]}`.

- [ ] **Step 7: Commit**

```bash
git add pb_public/index.html pb_public/site.js pb_public/styles.css
git commit -m "Checkout: book the pickup time when sending; handle taken slots

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: Admin "Upcoming pickups" with Cancel, plus guide

**Files:**
- Modify: `pb_public/admin/index.html` (Pickup Times tab)
- Modify: `pb_public/admin/pickup-admin.js`
- Modify: `pb_public/admin/admin.css` (append)
- Modify: `NADIA-GUIDE.md`

**Interfaces:**
- Consumes: the `bookings` collection (Task 2) and `availableSlots({ ..., taken })` (Task 1).
- Existing pickup-admin.js names: `api(path, {method})`, `toast(msg, kind)`, `h(tag, cls, text)`, `today()`, `S`, `load()`, `renderPreview()`, `showShop()`, `shop`, `hours`, `blocks`.

- [ ] **Step 1: Markup.** In `pb_public/admin/index.html`, inside `<main id="tab-pickup">`, insert this as the first `pk-section` (after the `top-hint` paragraph and before "Regular hours"):

```html
      <section class="pk-section">
        <h2>Upcoming pickups</h2>
        <div id="pk-bookings" class="pk-bookings"></div>
      </section>
```

- [ ] **Step 2: State and loading** in `pickup-admin.js`.
  - Add `let bookings = [];` beside the other state.
  - Add:

```js
  const getBookings = () => api(`/api/collections/bookings/records?perPage=500&sort=date,time&filter=${encodeURIComponent(`date >= '${today()}'`)}`);

  // A booking was cancelled: refresh the list and the preview (keeps unsaved hours edits).
  async function reloadBookings() {
    bookings = (await getBookings()).items;
    renderBookings();
    renderPreview();
  }
```

  - In `load()`, add `getBookings()` as a fourth `Promise.all` entry. Set `bookings = bk.items;` and call `renderBookings();` before `renderPreview();`.
  - In `showShop()` and `renderPreview()`, change `shop.slot_minutes || 30` to `shop.slot_minutes || 15`.
  - In `renderPreview()`, pass `taken: bookings.map((b) => ({ date: b.date, time: b.time }))` to `availableSlots`.

- [ ] **Step 3: Render and cancel.** Add:

```js
  // ----- Upcoming pickups -----
  function renderBookings() {
    const box = $("#pk-bookings");
    if (!bookings.length) {
      box.replaceChildren(h("p", "hint", "No upcoming pickups yet."));
      return;
    }
    const parts = [];
    let day = "";
    let ul = null;
    for (const b of bookings) {
      if (b.date !== day) {
        day = b.date;
        parts.push(h("h3", "pk-day-head", S.formatDate(b.date, "short")));
        ul = h("ul", "pk-blocks");
        parts.push(ul);
      }
      const li = h("li", "pk-block pk-booking");
      const info = h("div");
      info.append(h("div", "name", `${S.formatTime(b.time)} · ${b.name}`));
      const meta = [b.items, b.total ? `$${Number(b.total).toFixed(2).replace(/\.00$/, "")}` : "", b.order_code].filter(Boolean).join(" · ");
      if (meta) info.append(h("div", "muted small-print", meta));
      const cancel = h("button", "btn ghost small danger-text", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", async () => {
        const when = `${S.formatTime(b.time)} pickup on ${S.formatDate(b.date, "short")}`;
        if (!confirm(`Cancel ${b.name}'s ${when}? That time will open up for other customers.`)) return;
        try {
          await api(`/api/collections/bookings/records/${b.id}`, { method: "DELETE" });
          toast(`Pickup cancelled. ${S.formatTime(b.time)} is open again.`);
          await reloadBookings();
        } catch (err) { toast(err.message, "bad"); }
      });
      li.append(info, cancel);
      ul.append(li);
    }
    box.replaceChildren(...parts);
  }
```

- [ ] **Step 4: Styles.** Append to `pb_public/admin/admin.css`:

```css
.pk-day-head { font-family: "Inter", sans-serif; font-size: .95rem; font-weight: 700; margin: 14px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.pk-bookings .pk-day-head:first-child { margin-top: 0; }
.pk-booking .name { font-weight: 600; }
```

- [ ] **Step 5: Guide.** In `NADIA-GUIDE.md`, inside "Set your pickup times and time off", add after the **Time off** bullet:

```markdown
- **Upcoming pickups:** each pickup time can be booked by **one** customer. When someone sends
  their order, their time is saved here and disappears from the website for everyone else.
  Tap **Cancel** to free a time (for example if they never texted you, or changed their mind).
```

- [ ] **Step 6: Browser check of the admin page.** Create a temporary superuser and a temporary baker (the same approach as Task 2 Step 5, plus a bakers record `claude-test-baker@local.test` / `TempPass-12345`). Create two bookings through the anonymous API: Nov 13 09:15 "Sam Rivera" and Nov 14 10:00 "Ana Lopez". Then, over CDP at 320 and 375px, log in at `/admin/` and open **Pickup Times**:
  1. "Upcoming pickups" shows two day groups (FRI, NOV 13 and SAT, NOV 14) with the correct rows, and there's no horizontal overflow.
  2. The preview's count for Fri Nov 13 is one less than for an unbooked Friday (15 versus 16 with 15-minute slots).
  3. Cancel Sam's booking, accepting the confirm through `Page.handleJavaScriptDialog`. The toast reads "Pickup cancelled. 9:15 AM is open again.", the row disappears, and `/api/lunoah/taken` no longer lists it.
  4. Screenshot at 320px, view it and describe it.

  **Cleanup:** delete the remaining test bookings, the temporary baker and the temporary superuser, then prove it: `/api/lunoah/taken?from=2000-01-01` → `{"taken":[]}`, and both temporary logins return 400.

- [ ] **Step 7: Commit**

```bash
git add pb_public/admin/index.html pb_public/admin/pickup-admin.js pb_public/admin/admin.css NADIA-GUIDE.md
git commit -m "Admin: upcoming pickups list with cancel; guide

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Final check
- [ ] `node --test tests/slots.test.js`: 21 pass.
- [ ] No test bookings or temporary accounts are left. Nadia's account (`Nadia@Sourdough.com`) is untouched.
- [ ] `git status` is clean.
