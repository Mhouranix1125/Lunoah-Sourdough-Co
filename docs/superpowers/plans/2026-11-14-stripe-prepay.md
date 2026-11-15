# Stripe Prepay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pickup time is booked only after the customer pays in full through Stripe Checkout and the server has verified the payment with Stripe. Customers can cancel for a full refund within 2 hours, and cancellations by Nadia always refund.

**Architecture:** PocketBase hooks (`pb_hooks/`) own the money flow:
- A *held* booking record reserves the slot.
- A Stripe Checkout Session takes the payment.
- A signed webhook, or a direct session lookup, flips the booking to *paid*.

Pure logic lives in CommonJS files in `pb_hooks/lib/`. They are unit-tested with `node --test` and `require`d from hook handlers. The storefront becomes two steps (order → review & pay), and a new `order.html` shows the booked state and the cancel button.

**Tech Stack:** PocketBase 0.41.1 (JSVM hooks, goja engine: **no `Intl`**, prefer ES2015 syntax, avoid `??`/`?.` in server files), Stripe REST API via `$http.send`, vanilla JS front end, `node --test` (Node 22), Stripe CLI, Mailpit.

**Spec:** `docs/superpowers/specs/2026-11-14-stripe-prepay-design.md`

## Global Constraints

- **Timestamps:** `hold_expires`, `paid_at` and `cancelled_at` are **integer epoch milliseconds** (number fields). This is a deliberate refinement of the spec's "date": the engines handle numbers more simply.
- **Money** is integer **cents** on the server. Stripe currency is `usd`.
- **Limits:**
  - 12 of one bread, 24 loaves per order, minimum charge 50¢
  - 2 active holds per IP
  - Stripe session expires in 31 min, and the hold expires 36 min after creation
- **Cancel window:** `min(paid_at + 2h, pickup time)`.
- **Secrets** come only from the environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` (no trailing slash). Never commit `stripe.env`.
- **Shop time zone:** America/Detroit. On the server use `lib/shoptime.js`, never `Intl`.
- **Server files** `require` libs inside each handler: `require(\`${__hooks}/lib/x.js\`)`. PocketBase runs each handler in its own context, so top-level variables in `*.pb.js` are not visible inside handlers.
- **Stripe payment methods:** `card` and `link` only. Stripe Checkout includes Apple Pay and Google Pay under `card`.
- **Customer-facing copy:**
  - Policy line: *"You can cancel for a full refund within 2 hours of ordering. After that, your bread is being baked just for you."*
  - Paused message: *"Online ordering is paused. Text Nadia at …"*
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Run the site** with `./"Start Website.command"` (port 8090). PocketBase applies new migrations on start. After changing `pb_hooks`, restart it.

## File map

| File | Responsibility |
|---|---|
| `pb_hooks/lib/shoptime.js` (new) | Detroit clock without Intl: `shopNow`, `shopToUtc`, `label`, `clock` |
| `pb_hooks/lib/order.js` (new) | Pure order rules: `priceLines`, `cleanName`, `normalizePhone`, `slotIsOpen`, `cancelDeadline` |
| `pb_hooks/lib/stripe.js` (new) | `encode`, `verifySignature`, `configured`, `api` (Stripe REST) |
| `pb_hooks/lib/mail.js` (new) | Order, cancellation and apology emails |
| `pb_hooks/lib/booking.js` (new) | Record-level operations: `checkout`, `confirmPaid`, `releaseHold`, `sweep`, `cancelBooking`, `summary`, `byToken` |
| `pb_hooks/orders.pb.js` (new) | Routes + cron (thin wrappers around `booking.js`) |
| `pb_hooks/bookings.pb.js` | `taken` endpoint ignores cancelled bookings |
| `pb_migrations/1763100000_stripe_prepay.js` (new) | Booking fields, rules, partial unique index, shop changes, rate limits |
| `pb_public/slots.js` | Accept an injected `today` (server has no Intl) |
| `pb_public/index.html`, `site.js`, `styles.css` | Two-step checkout, Stripe redirect, back-from-Stripe, ordering gate |
| `pb_public/order.html`, `pb_public/order.js` (new) | Booked/confirming/cancelled page with the cancel button |
| `pb_public/admin/pickup-admin.js`, `admin/index.html`, `admin/admin.js` | Badges, cancel+refund, retry, time-off warning, Shop Info changes |
| `tests/shoptime.test.js`, `tests/order.test.js`, `tests/stripe.test.js` (new), `tests/slots.test.js` | Unit tests |
| `Start Website.command`, `.gitignore`, `deploy/lunoah.service`, `LAUNCH-PLAN.md`, `NADIA-GUIDE.md` | Env loading, deploy, docs |

---

### Task 1: Shop clock without Intl, and injectable `today` in slots.js

**Files:**
- Create: `pb_hooks/lib/shoptime.js`
- Modify: `pb_public/slots.js` (the `availableSlots` signature, ~line 46)
- Test: `tests/shoptime.test.js`, `tests/slots.test.js`

**Interfaces:**
- Produces:
  - `shopNow(ms) → { date: "YYYY-MM-DD", minutes: number }`
  - `shopToUtc(date, time) → ms`
  - `label(date, time) → "Fri, Nov 13 at 9:15 AM"`
  - `clock(ms) → "11:42 AM"` (shop time)
  - `availableSlots({ ..., today })`: when `today` (`{date, minutes}`) is given, `Intl` is not used.

- [ ] **Step 1: Write the failing tests** (`tests/shoptime.test.js`)

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../pb_hooks/lib/shoptime.js");
const S = require("../pb_public/slots.js");

test("shopNow: winter is UTC-5, summer is UTC-4", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 14, 17, 0)), { date: "2026-11-14", minutes: 720 });
  assert.deepEqual(T.shopNow(Date.UTC(2026, 6, 4, 16, 0)), { date: "2026-07-04", minutes: 720 });
});

test("shopNow: DST starts 2nd Sunday of March at 2:00", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 2, 8, 6, 59)), { date: "2026-03-08", minutes: 119 });
  assert.deepEqual(T.shopNow(Date.UTC(2026, 2, 8, 7, 0)), { date: "2026-03-08", minutes: 180 });
});

test("shopNow: DST ends 1st Sunday of November at 2:00", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 1, 5, 59)), { date: "2026-11-01", minutes: 119 });
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 1, 6, 0)), { date: "2026-11-01", minutes: 60 });
});

test("shopNow: just before midnight stays on the shop's date", () => {
  assert.deepEqual(T.shopNow(Date.UTC(2026, 10, 15, 4, 59)), { date: "2026-11-14", minutes: 1439 });
});

test("shopNow matches Intl for every hour of 2026-2028", () => {
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2029, 0, 1); ms += 3600000 + 17 * 60000) {
    assert.deepEqual(T.shopNow(ms), S.localParts(new Date(ms), "America/Detroit"), new Date(ms).toISOString());
  }
});

test("shopToUtc", () => {
  assert.equal(T.shopToUtc("2026-11-13", "09:15"), Date.UTC(2026, 10, 13, 14, 15));
  assert.equal(T.shopToUtc("2026-07-04", "09:00"), Date.UTC(2026, 6, 4, 13, 0));
});

test("label and clock", () => {
  assert.equal(T.label("2026-11-13", "09:15"), "Fri, Nov 13 at 9:15 AM");
  assert.equal(T.label("2026-11-14", "13:00"), "Sat, Nov 14 at 1:00 PM");
  assert.equal(T.clock(Date.UTC(2026, 10, 13, 16, 42)), "11:42 AM");
  assert.equal(T.clock(Date.UTC(2026, 10, 13, 5, 5)), "12:05 AM");
});
```

Append to `tests/slots.test.js`:

```js
test("availableSlots: an injected today replaces the clock", () => {
  // 'now' says Monday Nov 9, but today says Thursday Nov 12 at noon (lead 0)
  const r = S.availableSlots(base({ leadDays: 0, now: est("2026-11-09"), today: { date: "2026-11-12", minutes: 720 } }));
  assert.equal(r[0].date, "2026-11-13");
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test`
Expected: FAIL, `Cannot find module '../pb_hooks/lib/shoptime.js'`, and the slots test fails on the date.

- [ ] **Step 3: Implement `pb_hooks/lib/shoptime.js`**

```js
// The shop's clock (America/Detroit) for server code. PocketBase's JS engine has no Intl,
// so the US daylight-saving rules are written out: DST runs from the 2nd Sunday of March
// at 2:00 to the 1st Sunday of November at 2:00, local time.
var HOUR = 3600000;
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n) { return (n < 10 ? "0" : "") + n; }

function nthSunday(y, m, n) {
  var first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

function isDST(ms) {
  var y = new Date(ms).getUTCFullYear();
  var start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7); // 2:00 EST
  var end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6); // 2:00 EDT
  return ms >= start && ms < end;
}

function wall(ms) { return new Date(ms + (isDST(ms) ? -4 : -5) * HOUR); }

function shopNow(ms) {
  var t = wall(ms);
  return {
    date: t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

function shopToUtc(date, time) {
  var d = date.split("-").map(Number);
  var h = time.split(":").map(Number);
  var naive = Date.UTC(d[0], d[1] - 1, d[2], h[0], h[1]);
  var est = naive + 5 * HOUR;
  return isDST(est) ? naive + 4 * HOUR : est;
}

function hm12(h, m) { return (h % 12 || 12) + ":" + pad(m) + " " + (h < 12 ? "AM" : "PM"); }

function label(date, time) {
  var d = date.split("-").map(Number);
  var h = time.split(":").map(Number);
  var day = new Date(Date.UTC(d[0], d[1] - 1, d[2]));
  return DAYS[day.getUTCDay()] + ", " + MONTHS[d[1] - 1] + " " + d[2] + " at " + hm12(h[0], h[1]);
}

function clock(ms) {
  var t = wall(ms);
  return hm12(t.getUTCHours(), t.getUTCMinutes());
}

module.exports = { shopNow: shopNow, shopToUtc: shopToUtc, label: label, clock: clock };
```

In `pb_public/slots.js`, change the `availableSlots` signature and first line:

```js
  function availableSlots({
    hours = [], blocks = [], leadDays = 2, slotMinutes = 30, bookAheadDays = 21,
    now = new Date(), tz = SHOP_TZ, taken = [], today: todayIn = null,
  } = {}) {
    const today = todayIn || localParts(now, tz);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pb_hooks/lib/shoptime.js pb_public/slots.js tests/shoptime.test.js tests/slots.test.js
git commit -m "Shop clock for the server (no Intl) and injectable today for slots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure order rules

**Files:**
- Create: `pb_hooks/lib/order.js`
- Test: `tests/order.test.js`

**Interfaces:**
- Produces:
  - `priceLines(breads, items)`. Input: `breads` = `[{id,name,price,hidden,sold_out}]` and `items` = `[{id,qty}]`. Output: `{ok:true, lines:[{bread,name,qty,price_cents}], amount_cents}` or `{ok:false, error, bread?}`, where `error` is one of `empty`, `unavailable`, `bad_qty`, `sold_out`, `too_many`, `too_small`.
  - `cleanName(s) → string|null`
  - `normalizePhone(s) → "313-555-0100"|null`
  - `slotIsOpen(availableSlots, {hours, blocks, shop, taken, today, date, time}) → boolean`
  - `cancelDeadline(paidAtMs, pickupUtcMs) → ms`
  - Constants `MAX_PER_BREAD = 12`, `MAX_LOAVES = 24`, `CANCEL_WINDOW_MS`

- [ ] **Step 1: Write the failing tests** (`tests/order.test.js`)

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../pb_hooks/lib/order.js");
const S = require("../pb_public/slots.js");

const BREADS = [
  { id: "a", name: "Country Loaf", price: 12, hidden: false, sold_out: false },
  { id: "b", name: "Seeded", price: 9.99, hidden: false, sold_out: false },
  { id: "h", name: "Secret", price: 5, hidden: true, sold_out: false },
  { id: "s", name: "Rye", price: 8, hidden: false, sold_out: true },
  { id: "z", name: "Free", price: 0, hidden: false, sold_out: false },
];

test("priceLines uses server prices, not client ones", () => {
  const r = O.priceLines(BREADS, [{ id: "a", qty: 2, price: 0.01 }, { id: "b", qty: 1 }]);
  assert.deepEqual(r, {
    ok: true,
    amount_cents: 3399,
    lines: [
      { bread: "a", name: "Country Loaf", qty: 2, price_cents: 1200 },
      { bread: "b", name: "Seeded", qty: 1, price_cents: 999 },
    ],
  });
});

test("priceLines rejects bad input", () => {
  assert.equal(O.priceLines(BREADS, []).error, "empty");
  assert.equal(O.priceLines(BREADS, "x").error, "empty");
  assert.equal(O.priceLines(BREADS, [{ id: "nope", qty: 1 }]).error, "unavailable");
  assert.equal(O.priceLines(BREADS, [{ id: "h", qty: 1 }]).error, "unavailable");
  assert.equal(O.priceLines(BREADS, [{ id: "z", qty: 1 }]).error, "unavailable");
  assert.deepEqual(O.priceLines(BREADS, [{ id: "s", qty: 1 }]), { ok: false, error: "sold_out", bread: "Rye" });
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 0 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 1.5 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: "2" }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 13 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 1 }, { id: "a", qty: 1 }]).error, "bad_qty");
  assert.equal(O.priceLines(BREADS, [{ id: "a", qty: 12 }, { id: "b", qty: 12 }]).ok, true);
  assert.equal(O.priceLines(BREADS.concat([{ id: "c", name: "C", price: 1 }]), [{ id: "a", qty: 12 }, { id: "b", qty: 12 }, { id: "c", qty: 1 }]).error, "too_many");
  assert.equal(O.priceLines([{ id: "t", name: "T", price: 0.25 }], [{ id: "t", qty: 1 }]).error, "too_small");
});

test("cleanName and normalizePhone", () => {
  assert.equal(O.cleanName("  Sam   Rivera "), "Sam Rivera");
  assert.equal(O.cleanName("   "), null);
  assert.equal(O.cleanName("x".repeat(101)), null);
  assert.equal(O.normalizePhone("(313) 555-0100"), "313-555-0100");
  assert.equal(O.normalizePhone("+1 313 555 0100"), "313-555-0100");
  assert.equal(O.normalizePhone("555-0100"), null);
  assert.equal(O.normalizePhone("013-555-0100"), null);
});

test("slotIsOpen checks hours, lead days, alignment and taken", () => {
  const o = {
    hours: [{ weekday: 5, start: "09:00", end: "13:00" }], blocks: [],
    shop: { lead_days: 2, slot_minutes: 15, book_ahead_days: 21 },
    taken: [{ date: "2026-11-20", time: "09:15" }],
    today: { date: "2026-11-14", minutes: 600 },
  };
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { date: "2026-11-20", time: "09:00" })), true);
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { date: "2026-11-20", time: "09:15" })), false); // taken
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { date: "2026-11-20", time: "09:05" })), false); // misaligned
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { date: "2026-11-20", time: "13:00" })), false); // after close
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { date: "2026-11-21", time: "09:00" })), false); // closed day
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { today: { date: "2026-11-19", minutes: 600 }, date: "2026-11-20", time: "09:00" })), false); // lead days
  assert.equal(O.slotIsOpen(S.availableSlots, Object.assign({}, o, { blocks: [{ start_date: "2026-11-20", end_date: "2026-11-20", all_day: true }], date: "2026-11-20", time: "09:00" })), false);
});

test("cancelDeadline is 2 hours after paying or the pickup, whichever is first", () => {
  const paid = Date.UTC(2026, 10, 13, 12, 0);
  assert.equal(O.cancelDeadline(paid, paid + 10 * 3600000), paid + 2 * 3600000);
  assert.equal(O.cancelDeadline(paid, paid + 3600000), paid + 3600000);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implement `pb_hooks/lib/order.js`**

```js
// Order rules shared by the checkout route. Pure functions: no PocketBase globals.
var MAX_PER_BREAD = 12;
var MAX_LOAVES = 24;
var MIN_CENTS = 50; // Stripe's minimum charge
var CANCEL_WINDOW_MS = 2 * 3600000;

function priceLines(breads, items) {
  if (!Array.isArray(items) || !items.length) return { ok: false, error: "empty" };
  var byId = {};
  breads.forEach(function (b) { byId[b.id] = b; });
  var seen = {};
  var lines = [];
  var loaves = 0;
  var cents = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var b = byId[String(it.id || "")];
    if (!b || b.hidden) return { ok: false, error: "unavailable" };
    if (seen[b.id] || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > MAX_PER_BREAD) {
      return { ok: false, error: "bad_qty", bread: b.name };
    }
    seen[b.id] = true;
    if (b.sold_out) return { ok: false, error: "sold_out", bread: b.name };
    var price = Math.round(Number(b.price) * 100);
    if (!(price > 0)) return { ok: false, error: "unavailable", bread: b.name };
    loaves += it.qty;
    cents += it.qty * price;
    lines.push({ bread: b.id, name: b.name, qty: it.qty, price_cents: price });
  }
  if (loaves > MAX_LOAVES) return { ok: false, error: "too_many" };
  if (cents < MIN_CENTS) return { ok: false, error: "too_small" };
  return { ok: true, lines: lines, amount_cents: cents };
}

function cleanName(s) {
  s = String(s || "").trim().replace(/\s+/g, " ");
  return s.length >= 1 && s.length <= 100 ? s : null;
}

function normalizePhone(s) {
  var d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
}

// availableSlots is slots.js's function, passed in so this file needs no require.
function slotIsOpen(availableSlots, o) {
  var shop = o.shop || {};
  var days = availableSlots({
    hours: o.hours, blocks: o.blocks, taken: o.taken || [], today: o.today,
    leadDays: shop.lead_days == null ? 2 : shop.lead_days,
    slotMinutes: shop.slot_minutes || 15,
    bookAheadDays: shop.book_ahead_days || 21,
  });
  for (var i = 0; i < days.length; i++) {
    if (days[i].date === o.date) return days[i].times.indexOf(o.time) >= 0;
  }
  return false;
}

function cancelDeadline(paidAtMs, pickupUtcMs) {
  return Math.min(paidAtMs + CANCEL_WINDOW_MS, pickupUtcMs);
}

module.exports = {
  MAX_PER_BREAD: MAX_PER_BREAD, MAX_LOAVES: MAX_LOAVES, CANCEL_WINDOW_MS: CANCEL_WINDOW_MS,
  priceLines: priceLines, cleanName: cleanName, normalizePhone: normalizePhone,
  slotIsOpen: slotIsOpen, cancelDeadline: cancelDeadline,
};
```

- [ ] **Step 4: Run all tests and confirm they pass**

Run: `node --test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pb_hooks/lib/order.js tests/order.test.js
git commit -m "Order rules: server-side pricing, limits, phone, slot check, cancel deadline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stripe helpers

**Files:**
- Create: `pb_hooks/lib/stripe.js`
- Test: `tests/stripe.test.js`

**Interfaces:**
- Produces:
  - `encode(obj) → "a=1&b%5Bc%5D=2"`, Stripe's nested form encoding; arrays become `[0]`, `[1]`, …
  - `verifySignature(raw, header, secret, nowSec, hmacHex, equal) → boolean`. `hmacHex(text, secret)` returns lowercase hex. On the server, pass `$security.hs256` and `$security.equal`.
  - `configured(getenv) → boolean`
  - `api(method, path, params, idemKey) → {status, json}`. Server only. `status` is `0` on a network error.

- [ ] **Step 1: Write the failing tests** (`tests/stripe.test.js`)

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const X = require("../pb_hooks/lib/stripe.js");

const hmac = (text, secret) => crypto.createHmac("sha256", secret).update(text).digest("hex");
const eq = (a, b) => a === b;
const SECRET = "whsec_test";
const RAW = '{"id":"evt_1","type":"checkout.session.completed"}';
const sign = (t, raw = RAW, secret = SECRET) => `t=${t},v1=${hmac(`${t}.${raw}`, secret)}`;

test("encode nests objects and arrays the way Stripe expects", () => {
  assert.equal(
    X.encode({ mode: "payment", metadata: { booking: "ab c" }, line_items: [{ quantity: 2 }], skip: null, n: 0 }),
    "mode=payment&metadata%5Bbooking%5D=ab%20c&line_items%5B0%5D%5Bquantity%5D=2&n=0"
  );
});

test("verifySignature accepts a valid signature", () => {
  assert.equal(X.verifySignature(RAW, sign(1000), SECRET, 1000, hmac, eq), true);
  assert.equal(X.verifySignature(RAW, `${sign(1000)},v1=deadbeef`, SECRET, 1100, hmac, eq), true);
});

test("verifySignature rejects tampering, staleness and a wrong secret", () => {
  assert.equal(X.verifySignature(RAW + " ", sign(1000), SECRET, 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, sign(1000), SECRET, 1301, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, sign(1000, RAW, "whsec_other"), SECRET, 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, "", SECRET, 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, sign(1000), "", 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, "t=1000", SECRET, 1000, hmac, eq), false);
});

test("configured needs all three settings", () => {
  const env = { STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh", SITE_URL: "http://x" };
  assert.equal(X.configured((k) => env[k] || ""), true);
  assert.equal(X.configured((k) => (k === "SITE_URL" ? "" : env[k])), false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implement `pb_hooks/lib/stripe.js`**

```js
// Stripe helpers. encode/verifySignature/configured are pure (unit-tested with node);
// api() uses PocketBase's $http and $os and only runs on the server.
function encode(obj) {
  var out = [];
  (function walk(v, key) {
    if (v === undefined || v === null) return;
    if (typeof v === "object") {
      Object.keys(v).forEach(function (k) { walk(v[k], key ? key + "[" + k + "]" : k); });
    } else {
      out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
    }
  })(obj, "");
  return out.join("&");
}

// Stripe-Signature: "t=<unix>,v1=<hex hmac of `${t}.${raw}`>[,v1=...]". 5-minute tolerance.
function verifySignature(raw, header, secret, nowSec, hmacHex, equal) {
  if (!header || !secret) return false;
  var t = 0;
  var sigs = [];
  String(header).split(",").forEach(function (part) {
    var i = part.indexOf("=");
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") sigs.push(v);
  });
  if (!t || !sigs.length || Math.abs(nowSec - t) > 300) return false;
  var expected = hmacHex(t + "." + raw, secret);
  return sigs.some(function (s) { return equal(s, expected); });
}

function configured(getenv) {
  return !!(getenv("STRIPE_SECRET_KEY") && getenv("STRIPE_WEBHOOK_SECRET") && getenv("SITE_URL"));
}

function api(method, path, params, idemKey) {
  var headers = { Authorization: "Bearer " + $os.getenv("STRIPE_SECRET_KEY") };
  if (idemKey) headers["Idempotency-Key"] = idemKey;
  var url = "https://api.stripe.com" + path;
  var body = "";
  if (method === "GET") {
    var q = params ? encode(params) : "";
    if (q) url += "?" + q;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = params ? encode(params) : "";
  }
  try {
    var r = $http.send({ method: method, url: url, body: body, headers: headers, timeout: 20 });
    return { status: r.statusCode, json: r.json || {} };
  } catch (err) {
    return { status: 0, json: { error: { message: String(err) } } };
  }
}

module.exports = { encode: encode, verifySignature: verifySignature, configured: configured, api: api };
```

- [ ] **Step 4: Run all tests and confirm they pass**

Run: `node --test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pb_hooks/lib/stripe.js tests/stripe.test.js
git commit -m "Stripe helpers: form encoding, webhook signature check, API call

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Local Stripe + email setup, and env loading

**Files:**
- Create: `stripe.env.example`
- Modify: `.gitignore`, `Start Website.command`, `deploy/lunoah.service`

**Interfaces:**
- Produces: when the site is started with `Start Website.command`, the environment variables `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SITE_URL` are set.

- [ ] **Step 1: Install the tools**

Run: `brew install stripe/stripe-cli/stripe mailpit`
Expected: both install. `stripe version` and `mailpit version` print versions.

- [ ] **Step 2: Log the Stripe CLI in to a test-mode account**

The **user** runs `stripe login` in their own terminal: it prints a pairing URL to open in the browser. A free Stripe account in test mode is fine.
Then run `stripe listen --print-secret`
Expected: prints `whsec_…`.
Get the test secret key from the Stripe dashboard → Developers → API keys (`sk_test_…`), or run `stripe config --list` to see `test_mode_api_key`.

- [ ] **Step 3: Create `stripe.env.example`, git-ignore `stripe.env`, and load it on start**

`stripe.env.example`:
```bash
# Copy to stripe.env (never commit stripe.env). Use test keys locally, live keys on the server.
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
SITE_URL=http://localhost:8090
```

Append to `.gitignore`:
```
# Stripe keys (see stripe.env.example)
stripe.env
```

In `Start Website.command`, add before the `PORT=8090` line:
```bash
# Online card payments: keys live in stripe.env (not in git). Without it, online ordering is paused.
if [ -f stripe.env ]; then set -a; . ./stripe.env; set +a; fi
```

In `deploy/lunoah.service`, add under `[Service]` after `WorkingDirectory=/opt/lunoah`:
```
EnvironmentFile=-/opt/lunoah/stripe.env
```

Create the real `stripe.env` locally from the example, using the `sk_test_` key and the `whsec_` value from Step 2.

- [ ] **Step 4: Verify that git ignores it**

Run: `git status --porcelain stripe.env; git check-ignore stripe.env`
Expected: the first command prints nothing, and the second prints `stripe.env`.

- [ ] **Step 5: Point PocketBase email at Mailpit (local only)**

1. Start Mailpit in the background: `mailpit` (SMTP on `127.0.0.1:1025`, inbox UI at http://localhost:8025).
2. Start the site.
3. Create a temporary superuser: `pocketbase superuser upsert test-admin@example.com 'TempPass123!' --dir=pb_data`.
4. Log in at http://localhost:8090/_/ → Settings → Mail settings:
   - Use SMTP: on
   - Host: `127.0.0.1`, port `1025`, no TLS
   - Sender address: `orders@lunoah.test`, sender name: `Lunoah Sourdough Co.`
5. Save, then click **Send test email** to any address.

Expected: the test email shows up in the Mailpit UI.

- [ ] **Step 6: Commit**

```bash
git add stripe.env.example .gitignore "Start Website.command" deploy/lunoah.service
git commit -m "Load Stripe keys from git-ignored stripe.env (local and server)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Migration (booking lifecycle fields, rules, partial index, shop, rate limits)

**Files:**
- Create: `pb_migrations/1763100000_stripe_prepay.js`
- Modify: `pb_hooks/bookings.pb.js` (taken filter), `pb_public/admin/pickup-admin.js` (manual add body, ~line 313)

**Interfaces:**
- Produces:
  - **`bookings` fields:** `status` (`held|paid|manual|cancelled`), `phone`, `notes`, `lines` (json), `amount_cents`, `hold_expires`, `paid_at`, `cancelled_at` (ms numbers), `cancelled_by` (`customer|nadia|stripe`), `refund_status` (`none|refunded|failed|partial`), `email`, `stripe_session`, `stripe_payment_intent`, `token` (hidden), `ip` (hidden), `emailed` (bool).
  - **`shop.notify_email`**. The `shop.require_payment` field is removed.
  - **`GET /api/lunoah/taken`** ignores cancelled bookings.

- [ ] **Step 1: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />

// Online prepay with Stripe. A booking is held while the customer pays, paid once Stripe
// confirms, or "manual" when Nadia adds it herself. Cancelled bookings are kept as history,
// so the one-per-slot rule only counts bookings that aren't cancelled.
// Customers no longer create bookings directly: the server does it (pb_hooks/orders.pb.js).

const BAKER = "@request.auth.collectionName = 'bakers'";
const SLOT_OLD = "CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time)";
const RATE_RULES = [
  { label: "/api/lunoah/checkout", audience: "", duration: 60, maxRequests: 5 },
  { label: "/api/lunoah/order/cancel", audience: "", duration: 60, maxRequests: 10 },
];
const NEW_FIELDS = ["status", "phone", "notes", "lines", "amount_cents", "hold_expires", "paid_at",
  "cancelled_at", "cancelled_by", "refund_status", "email", "stripe_session", "stripe_payment_intent",
  "token", "ip", "emailed"];

function setRateRules(app, add) {
  const s = app.settings();
  const keep = [];
  for (const r of s.rateLimits.rules) {
    if (RATE_RULES.some((x) => x.label === r.label)) continue;
    keep.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
  }
  s.rateLimits.rules = add ? keep.concat(RATE_RULES) : keep;
  if (add) s.rateLimits.enabled = true;
  app.save(s);
}

migrate((app) => {
  const b = app.findCollectionByNameOrId("bookings");
  b.fields.add(new SelectField({ name: "status", required: true, maxSelect: 1, values: ["held", "paid", "manual", "cancelled"] }));
  b.fields.add(new TextField({ name: "phone", max: 20 }));
  b.fields.add(new TextField({ name: "notes", max: 500 }));
  b.fields.add(new JSONField({ name: "lines", maxSize: 20000 }));
  b.fields.add(new NumberField({ name: "amount_cents", min: 0, onlyInt: true }));
  for (const n of ["hold_expires", "paid_at", "cancelled_at"]) b.fields.add(new NumberField({ name: n, min: 0, onlyInt: true }));
  b.fields.add(new SelectField({ name: "cancelled_by", maxSelect: 1, values: ["customer", "nadia", "stripe"] }));
  b.fields.add(new SelectField({ name: "refund_status", maxSelect: 1, values: ["none", "refunded", "failed", "partial"] }));
  b.fields.add(new TextField({ name: "email", max: 200 }));
  b.fields.add(new TextField({ name: "stripe_session", max: 200 }));
  b.fields.add(new TextField({ name: "stripe_payment_intent", max: 200 }));
  b.fields.add(new TextField({ name: "token", max: 64, hidden: true }));
  b.fields.add(new TextField({ name: "ip", max: 64, hidden: true }));
  b.fields.add(new BoolField({ name: "emailed" }));
  b.createRule = BAKER;
  b.indexes = [
    "CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time) WHERE status != 'cancelled'",
    "CREATE UNIQUE INDEX idx_bookings_token ON bookings (token) WHERE token != ''",
    "CREATE INDEX idx_bookings_session ON bookings (stripe_session)",
    "CREATE INDEX idx_bookings_pi ON bookings (stripe_payment_intent)",
  ];
  app.save(b);
  for (const r of app.findAllRecords("bookings")) {
    r.set("status", "manual");
    r.set("refund_status", "none");
    r.set("amount_cents", Math.round((r.getFloat("total") || 0) * 100));
    app.save(r);
  }

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("require_payment");
  shop.fields.add(new EmailField({ name: "notify_email" }));
  app.save(shop);

  setRateRules(app, true);
}, (app) => {
  const b = app.findCollectionByNameOrId("bookings");
  for (const r of app.findRecordsByFilter("bookings", "status = 'cancelled' || status = 'held'", "", 0, 0)) app.delete(r);
  for (const n of NEW_FIELDS) b.fields.removeByName(n);
  b.createRule = "";
  b.indexes = [SLOT_OLD];
  app.save(b);

  const shop = app.findCollectionByNameOrId("shop");
  shop.fields.removeByName("notify_email");
  shop.fields.add(new BoolField({ name: "require_payment" }));
  app.save(shop);

  setRateRules(app, false);
});
```

- [ ] **Step 2: Update the `taken` endpoint** (`pb_hooks/bookings.pb.js`)

Replace the `findRecordsByFilter` line with:
```js
  const recs = $app.findRecordsByFilter("bookings", "date >= {:from} && status != 'cancelled'", "date,time", 5000, 0, { from: from });
```

- [ ] **Step 3: Mark admin-added pickups as manual** (`pb_public/admin/pickup-admin.js`, in the `#booking-form` submit handler)

Change the POST body to:
```js
        body: { date, time, name, items: $("#bk2-note").value.trim(), total: 0, order_code: "PHONE", status: "manual", refund_status: "none" },
```

- [ ] **Step 4: Back up the data, start the site, and verify**

1. Run: `cp -R pb_data .superpowers/pb_data-backup-$(date +%Y%m%d%H%M)`, then start the site.

2. Check the terminal output. Expected: no migration error.

3. Check that a public create on `bookings` is now denied:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8090/api/collections/bookings/records \
     -H 'Content-Type: application/json' -d '{"date":"2026-12-04","time":"09:00","name":"x","status":"paid"}'
   ```
   Expected: `400` or `403`. PocketBase answers a failing create rule with 400 "Failed to create record."

4. Check the `taken` endpoint: `curl -s 'localhost:8090/api/lunoah/taken?from=2026-01-01'`
   Expected: `{"taken":[...]}`, with any pre-existing bookings listed. The migration made them `manual`.

5. Check the rate limits: open `/_/` → Settings → Rate limits.
   Expected: enabled, and the two `/api/lunoah/...` rules are listed.
   **If they're missing** (the JS → Go slice assignment didn't take), replace `setRateRules`'s body with a PATCH to `/api/settings` sent from the migration via `app.settings()` + `unmarshal` (see `$app.settings()` typings), and re-run. Don't continue until the rules show.

6. Check the partial index in the dashboard: bookings → (gear) → Indexes shows `WHERE status != 'cancelled'`.

- [ ] **Step 5: Commit**

```bash
git add pb_migrations/1763100000_stripe_prepay.js pb_hooks/bookings.pb.js pb_public/admin/pickup-admin.js
git commit -m "Bookings: held/paid/manual/cancelled lifecycle, server-only creates, rate limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server checkout, payment confirmation, holds, emails, webhook

**Files:**
- Create: `pb_hooks/lib/mail.js`, `pb_hooks/lib/booking.js`, `pb_hooks/orders.pb.js`

**Interfaces:**
- Consumes: Tasks 1–3 libs, Task 5 fields.
- Produces (`booking.js`):
  - `checkout(e)`: handles `POST /api/lunoah/checkout`
  - `confirmPaid(id, session) → Record|null`
  - `releaseHold(rec) → "paid"|"kept"|"released"`
  - `sweep()`
  - `byToken(k) → Record|null`
  - `summary(rec) → object`
  - `refundPayment(pi, key) → {status, json}`
  - `syncRefund(charge)`
  - `shopRecord()`
- Produces (`mail.js`): `orderEmails(rec)`, `cancelledEmail(rec, by)`, `apologyEmail(to, cents)`.
- Routes:
  - `GET /api/lunoah/checkout-config` → `{online}`
  - `POST /api/lunoah/checkout` → `{url, token}`, or an error `{code, message, bread?}`. `code` is one of `offline`, `name`, `phone`, `empty`, `unavailable`, `bad_qty`, `sold_out`, `too_many`, `too_small`, `taken`, `holds`, `stripe`.
  - `POST /api/lunoah/release` `{token}` → `{ok:true}`
  - `GET /api/lunoah/order?k=` → summary, or 404
  - `POST /api/lunoah/stripe-webhook`
  - cron `lunoah_holds` every 5 minutes

- [ ] **Step 1: Write `pb_hooks/lib/mail.js`**

```js
// Emails sent with PocketBase's mailer (SMTP set in /_/ → Settings → Mail settings).
// A failed email is logged and never undoes an order.
function money(c) { return "$" + (c / 100).toFixed(2); }
function lineText(lines) {
  return lines.map(function (l) { return "• " + l.qty + " × " + l.name + " (" + money(l.qty * l.price_cents) + ")"; }).join("\n");
}
function parseLines(rec) {
  try { return JSON.parse(toString(rec.get("lines")) || "[]"); } catch (_) { return []; }
}
function site() { return $os.getenv("SITE_URL"); }
function shop() { return $app.findFirstRecordByFilter("shop", "id != ''"); }

function nadiaAddresses() {
  var s = shop().getString("notify_email");
  if (s) return [s];
  return $app.findAllRecords("bakers").map(function (r) { return r.getString("email"); }).filter(Boolean);
}

function send(to, subject, text) {
  if (!to || !to.length) return false;
  try {
    var meta = $app.settings().meta;
    $app.newMailClient().send(new MailerMessage({
      from: { address: meta.senderAddress, name: meta.senderName },
      to: to.map(function (a) { return { address: a }; }),
      subject: subject,
      text: text,
    }));
    return true;
  } catch (err) {
    $app.logger().error("lunoah mail failed", "subject", subject, "error", String(err));
    return false;
  }
}

function orderEmails(rec) {
  var T = require(__hooks + "/lib/shoptime.js");
  var O = require(__hooks + "/lib/order.js");
  var s = shop();
  var when = T.label(rec.getString("date"), rec.getString("time"));
  var lines = parseLines(rec);
  var total = money(rec.getInt("amount_cents"));
  var name = rec.getString("name");
  var notes = rec.getString("notes");

  send(nadiaAddresses(), "New order: " + name + ", " + when,
    "New paid order\n\n" + name + " · " + rec.getString("phone") + "\nPickup: " + when + "\n\n" +
    lineText(lines) + "\nTotal paid: " + total + (notes ? "\n\nNotes: " + notes : "") +
    "\n\nSee all pickups: " + site() + "/admin");

  var email = rec.getString("email");
  if (!email) return;
  var deadline = O.cancelDeadline(rec.getInt("paid_at"), T.shopToUtc(rec.getString("date"), rec.getString("time")));
  var loc = s.getString("pickup_location");
  var allergy = s.getString("allergy_note");
  send([email], "You're booked for " + when,
    "Hi " + name + ",\n\nThank you! Your order is paid and your pickup is booked.\n\nPickup: " + when + "\n" +
    (loc ? "Where: " + loc + "\nMap: https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(loc) + "\n" : "") +
    "\n" + lineText(lines) + "\nTotal paid: " + total + "\n\n" +
    "Need to cancel? You can cancel for a full refund until " + T.clock(deadline) + ":\n" +
    site() + "/order.html?k=" + rec.getString("token") + "\n\n" +
    (allergy ? allergy + "\n\n" : "") + "Questions? Text Nadia at " + s.getString("phone") + ".\n\nLunoah Sourdough Co.");
}

function cancelledEmail(rec, by) {
  var T = require(__hooks + "/lib/shoptime.js");
  var when = T.label(rec.getString("date"), rec.getString("time"));
  var cents = rec.getInt("amount_cents");
  var refunded = rec.getString("refund_status") === "refunded";
  if (by === "customer") {
    send(nadiaAddresses(), "Cancelled: " + rec.getString("name") + ", " + when,
      rec.getString("name") + " cancelled their " + when + " pickup. " +
      (refunded ? money(cents) + " was refunded automatically." : "The refund didn't go through. Open the admin to retry it.") +
      "\nThat time is open again.");
  } else if (by === "nadia" && rec.getString("email")) {
    send([rec.getString("email")], "Your Lunoah order for " + when + " was cancelled",
      "Hi " + rec.getString("name") + ",\n\nSorry, we had to cancel your pickup on " + when + ". " +
      (cents ? "Your " + money(cents) + " is being refunded to your card (it usually arrives in 5–10 days). " : "") +
      "\n\nQuestions? Text Nadia at " + shop().getString("phone") + ".\n\nLunoah Sourdough Co.");
  }
}

function apologyEmail(to, cents) {
  if (!to) return;
  send([to], "Your Lunoah payment was refunded",
    "Sorry! Your pickup time was no longer available when your payment came through, so we refunded the full " +
    money(cents) + " to your card (5–10 days). Please pick another time on " + site() + ".\n\nLunoah Sourdough Co.");
}

module.exports = { orderEmails: orderEmails, cancelledEmail: cancelledEmail, apologyEmail: apologyEmail, parseLines: parseLines };
```

- [ ] **Step 2: Write `pb_hooks/lib/booking.js`**

```js
// Booking operations that touch the database and Stripe. Every function that may free a
// slot asks Stripe first, so a payment is never lost because a webhook was missed.
var HOLD_MS = 36 * 60000;
var SESSION_SEC = 31 * 60;
var MAX_HOLDS_PER_IP = 2;
var FORCE_RELEASE_MS = 24 * 3600000;

function lib(n) { return require(__hooks + "/lib/" + n + ".js"); }
function slotsLib() { return require(__hooks + "/../pb_public/slots.js"); }
function shopRecord() { return $app.findFirstRecordByFilter("shop", "id != ''"); }
function fail(e, status, code, message, extra) {
  var body = { code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return e.json(status, body);
}

function byToken(k) {
  if (!/^[A-Za-z0-9]{32}$/.test(String(k || ""))) return null;
  try { return $app.findFirstRecordByData("bookings", "token", k); } catch (_) { return null; }
}

function findById(id) {
  try { return $app.findRecordById("bookings", id); } catch (_) { return null; }
}

function refundPayment(pi, key) {
  var r = lib("stripe").api("POST", "/v1/refunds", { payment_intent: pi }, key);
  var code = r.json && r.json.error && r.json.error.code;
  if (code === "charge_already_refunded") return { status: 200, json: {} };
  return r;
}

// Called by the webhook and by the order/sweep checks with a session fetched from Stripe.
function confirmPaid(id, s) {
  if (!s || s.payment_status !== "paid" || s.currency !== "usd" || !s.metadata || s.metadata.booking !== id) return null;
  var rec = findById(id);
  if (rec && rec.getString("status") !== "held") return rec; // already handled
  if (rec && rec.getInt("amount_cents") === s.amount_total) {
    rec.set("status", "paid");
    rec.set("paid_at", Date.now());
    rec.set("email", (s.customer_details && s.customer_details.email) || "");
    rec.set("stripe_payment_intent", s.payment_intent || "");
    $app.save(rec);
    if (!rec.getBool("emailed")) {
      lib("mail").orderEmails(rec);
      rec.set("emailed", true);
      $app.save(rec);
    }
    return rec;
  }
  // The hold is gone or the amount doesn't match: we can't honour this payment. Refund it.
  if (s.payment_intent) refundPayment(s.payment_intent, "orphan-" + id);
  if (rec) $app.delete(rec);
  lib("mail").apologyEmail(s.customer_details && s.customer_details.email, s.amount_total);
  return null;
}

// Frees a hold, unless Stripe says it was paid (then it is confirmed instead).
function releaseHold(rec) {
  if (rec.getString("status") !== "held") return "kept";
  var X = lib("stripe");
  var sid = rec.getString("stripe_session");
  if (sid) {
    var exp = X.api("POST", "/v1/checkout/sessions/" + sid + "/expire", null, null);
    if (exp.status !== 200) {
      var g = X.api("GET", "/v1/checkout/sessions/" + sid, null, null);
      if (g.status === 200 && g.json.status === "complete") {
        return confirmPaid(rec.id, g.json) ? "paid" : "released";
      }
      var stuck = g.status !== 200 || g.json.status === "open";
      if (stuck && Date.now() < rec.getInt("hold_expires") + FORCE_RELEASE_MS) return "kept";
    }
  }
  $app.delete(rec);
  return "released";
}

function sweep() {
  var stale = $app.findRecordsByFilter("bookings", "status = 'held' && hold_expires < {:now}", "", 200, 0, { now: Date.now() });
  stale.forEach(function (r) {
    try { releaseHold(r); } catch (err) { $app.logger().error("lunoah sweep", "id", r.id, "error", String(err)); }
  });
}

function breadList() {
  return $app.findAllRecords("breads").map(function (r) {
    return { id: r.id, name: r.getString("name"), price: r.getFloat("price"), hidden: r.getBool("hidden"), sold_out: r.getBool("sold_out") };
  });
}

function pickupState(today) {
  var hours = $app.findAllRecords("pickup_hours").map(function (r) {
    return { weekday: r.getInt("weekday"), start: r.getString("start"), end: r.getString("end") };
  });
  var blocks = $app.findRecordsByFilter("pickup_blocks", "end_date >= {:d}", "", 1000, 0, { d: today.date }).map(function (r) {
    return { start_date: r.getString("start_date"), end_date: r.getString("end_date"), all_day: r.getBool("all_day"), from: r.getString("from"), to: r.getString("to") };
  });
  var taken = $app.findRecordsByFilter("bookings", "date >= {:d} && status != 'cancelled'", "", 5000, 0, { d: today.date }).map(function (r) {
    return { date: r.getString("date"), time: r.getString("time") };
  });
  return { hours: hours, blocks: blocks, taken: taken };
}

function checkout(e) {
  var X = lib("stripe"), O = lib("order"), T = lib("shoptime");
  if (!X.configured($os.getenv)) return fail(e, 503, "offline", "Online ordering is paused.");
  var body = e.requestInfo().body || {};

  if (body.previous) {
    var prev = byToken(body.previous);
    if (prev && prev.getString("status") === "held") releaseHold(prev);
  }

  var name = O.cleanName(body.name);
  if (!name) return fail(e, 400, "name", "Please enter your name.");
  var phone = O.normalizePhone(body.phone);
  if (!phone) return fail(e, 400, "phone", "Please enter a 10-digit phone number.");
  var notes = String(body.notes || "").trim().slice(0, 500);
  var date = String(body.date || ""), time = String(body.time || "");

  var priced = O.priceLines(breadList(), body.items);
  if (!priced.ok) {
    var msgs = {
      empty: "Your basket is empty.",
      unavailable: "One of your breads is no longer available. Please refresh the page.",
      bad_qty: "Please check the quantities in your order.",
      sold_out: (priced.bread || "A bread") + " just sold out. We've updated your basket.",
      too_many: "Online orders are limited to " + O.MAX_LOAVES + " loaves. For bigger orders, please text Nadia.",
      too_small: "Your order is too small to pay online.",
    };
    return fail(e, 400, priced.error, msgs[priced.error], { bread: priced.bread || "" });
  }

  sweep(); // clear expired holds (asks Stripe first)

  var now = Date.now();
  var today = T.shopNow(now);
  var st = pickupState(today);
  var s = shopRecord();
  var shop = { lead_days: s.getInt("lead_days"), slot_minutes: s.getInt("slot_minutes"), book_ahead_days: s.getInt("book_ahead_days") };
  var open = O.slotIsOpen(slotsLib().availableSlots, { hours: st.hours, blocks: st.blocks, taken: st.taken, shop: shop, today: today, date: date, time: time });
  if (!open) return fail(e, 409, "taken", "That pickup time isn't available any more.");

  var ip = e.remoteIP();
  var mine = $app.findRecordsByFilter("bookings", "status = 'held' && ip = {:ip} && hold_expires > {:now}", "", 10, 0, { ip: ip, now: now });
  if (mine.length >= MAX_HOLDS_PER_IP) return fail(e, 429, "holds", "You already have a payment in progress. Finish it or wait a few minutes.");

  var token = $security.randomString(32);
  var rec = new Record($app.findCollectionByNameOrId("bookings"));
  rec.set("date", date); rec.set("time", time); rec.set("name", name); rec.set("phone", phone); rec.set("notes", notes);
  rec.set("lines", priced.lines); rec.set("amount_cents", priced.amount_cents); rec.set("total", priced.amount_cents / 100);
  rec.set("items", priced.lines.map(function (l) { return l.qty + " × " + l.name; }).join(", ").slice(0, 1000));
  rec.set("order_code", "WEB"); rec.set("status", "held"); rec.set("refund_status", "none");
  rec.set("hold_expires", now + HOLD_MS); rec.set("token", token); rec.set("ip", ip);
  try {
    $app.save(rec);
  } catch (err) {
    return fail(e, 409, "taken", "That pickup time was just taken.");
  }

  var site = $os.getenv("SITE_URL");
  var r = X.api("POST", "/v1/checkout/sessions", {
    mode: "payment",
    payment_method_types: ["card", "link"],
    client_reference_id: rec.id,
    metadata: { booking: rec.id },
    expires_at: Math.floor(now / 1000) + SESSION_SEC,
    line_items: priced.lines.map(function (l) {
      return { quantity: l.qty, price_data: { currency: "usd", unit_amount: l.price_cents, product_data: { name: l.name } } };
    }),
    payment_intent_data: { description: "Lunoah pickup " + T.label(date, time) + " (" + name + ")", metadata: { booking: rec.id } },
    custom_text: { submit: { message: "Pickup " + T.label(date, time) + ". You can cancel for a full refund within 2 hours of ordering." } },
    success_url: site + "/order.html?k=" + token,
    cancel_url: site + "/?back=" + token,
  }, "session-" + rec.id);
  if (r.status !== 200 || !r.json.url) {
    $app.logger().error("lunoah stripe session", "status", r.status, "error", JSON.stringify(r.json.error || {}));
    $app.delete(rec);
    return fail(e, 503, "stripe", "Payments are unavailable right now. Please try again in a few minutes.");
  }
  rec.set("stripe_session", r.json.id);
  $app.save(rec);
  return e.json(200, { url: r.json.url, token: token });
}

// If still held, ask Stripe directly (covers a missed or late webhook).
function refreshHeld(rec) {
  if (rec.getString("status") !== "held" || !rec.getString("stripe_session")) return rec;
  var g = lib("stripe").api("GET", "/v1/checkout/sessions/" + rec.getString("stripe_session"), null, null);
  if (g.status === 200 && g.json.status === "complete") confirmPaid(rec.id, g.json);
  return findById(rec.id);
}

function summary(rec) {
  var T = lib("shoptime"), O = lib("order");
  var s = shopRecord();
  var date = rec.getString("date"), time = rec.getString("time");
  var status = rec.getString("status");
  var paidAt = rec.getInt("paid_at");
  var deadline = status === "paid" && paidAt && rec.getString("stripe_payment_intent") ? O.cancelDeadline(paidAt, T.shopToUtc(date, time)) : 0;
  return {
    status: status, name: rec.getString("name"), date: date, time: time, when: T.label(date, time),
    lines: lib("mail").parseLines(rec), amount_cents: rec.getInt("amount_cents"),
    refund_status: rec.getString("refund_status"),
    cancel_until: deadline || null, cancel_until_label: deadline ? T.clock(deadline) : "",
    can_cancel: !!deadline && Date.now() < deadline,
    location: s.getString("pickup_location"), phone: s.getString("phone"),
  };
}

// Stripe told us a charge was refunded (possibly from the Stripe dashboard).
function syncRefund(charge) {
  if (!charge || !charge.payment_intent) return;
  var rec;
  try { rec = $app.findFirstRecordByData("bookings", "stripe_payment_intent", charge.payment_intent); } catch (_) { return; }
  if (charge.refunded) {
    if (rec.getString("status") !== "cancelled") {
      rec.set("status", "cancelled");
      rec.set("cancelled_at", Date.now());
      rec.set("cancelled_by", "stripe");
    }
    rec.set("refund_status", "refunded");
  } else if (charge.amount_refunded > 0 && rec.getString("status") === "paid") {
    rec.set("refund_status", "partial");
  }
  $app.save(rec);
}

module.exports = {
  checkout: checkout, confirmPaid: confirmPaid, releaseHold: releaseHold, sweep: sweep, byToken: byToken,
  findById: findById, refreshHeld: refreshHeld, summary: summary, refundPayment: refundPayment,
  syncRefund: syncRefund, shopRecord: shopRecord, fail: fail,
};
```

- [ ] **Step 3: Write `pb_hooks/orders.pb.js`**

```js
/// <reference path="../pb_data/types.d.ts" />

// Online orders paid with Stripe. Logic lives in pb_hooks/lib/booking.js.

routerAdd("GET", "/api/lunoah/checkout-config", (e) => {
  const X = require(`${__hooks}/lib/stripe.js`);
  return e.json(200, { online: X.configured($os.getenv) });
});

routerAdd("POST", "/api/lunoah/checkout", (e) => {
  return require(`${__hooks}/lib/booking.js`).checkout(e);
});

routerAdd("POST", "/api/lunoah/release", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  const rec = B.byToken((e.requestInfo().body || {}).token);
  if (rec && rec.getString("status") === "held") B.releaseHold(rec);
  return e.json(200, { ok: true });
});

routerAdd("GET", "/api/lunoah/order", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  let rec = B.byToken(e.request.url.query().get("k"));
  if (rec) rec = B.refreshHeld(rec);
  if (!rec) return B.fail(e, 404, "not_found", "We couldn't find that order.");
  return e.json(200, B.summary(rec));
});

routerAdd("POST", "/api/lunoah/stripe-webhook", (e) => {
  const X = require(`${__hooks}/lib/stripe.js`);
  const B = require(`${__hooks}/lib/booking.js`);
  const raw = toString(e.request.body);
  const ok = X.verifySignature(raw, e.request.header.get("Stripe-Signature"), $os.getenv("STRIPE_WEBHOOK_SECRET"),
    Math.floor(Date.now() / 1000), $security.hs256, $security.equal);
  if (!ok) return e.json(400, { message: "bad signature" });
  const ev = JSON.parse(raw);
  const o = (ev.data && ev.data.object) || {};
  if (ev.type === "checkout.session.completed") {
    if (o.metadata && o.metadata.booking) B.confirmPaid(o.metadata.booking, o);
  } else if (ev.type === "checkout.session.expired") {
    const rec = o.metadata && o.metadata.booking ? B.findById(o.metadata.booking) : null;
    if (rec && rec.getString("status") === "held") $app.delete(rec);
  } else if (ev.type === "charge.refunded") {
    B.syncRefund(o);
  }
  return e.json(200, { received: true });
});

cronAdd("lunoah_holds", "*/5 * * * *", () => {
  require(`${__hooks}/lib/booking.js`).sweep();
});
```

- [ ] **Step 4: Restart the site with Stripe forwarding, and check the parts that work without a browser**

1. Terminal A: `stripe listen --forward-to localhost:8090/api/lunoah/stripe-webhook --events checkout.session.completed,checkout.session.expired,charge.refunded`
2. Terminal B: restart the site.
3. Then run (replace `<BREAD_ID>` with one from `curl -s localhost:8090/api/collections/breads/records | jq -r '.items[0].id'`, and pick an open slot from the storefront calendar):

```bash
curl -s localhost:8090/api/lunoah/checkout-config                      # {"online":true}
curl -s -X POST localhost:8090/api/lunoah/checkout -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"<BREAD_ID>","qty":1,"price":0.01}],"date":"<DATE>","time":"<TIME>","name":"Test One","phone":"313-555-0100"}'
# → {"url":"https://checkout.stripe.com/...","token":"..."}; the Stripe session shows the DB price, not 0.01
curl -s "localhost:8090/api/lunoah/taken?from=2026-01-01"             # includes <DATE> <TIME> (held)
curl -s -X POST localhost:8090/api/lunoah/checkout -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"<BREAD_ID>","qty":1}],"date":"<DATE>","time":"<TIME>","name":"Test Two","phone":"313-555-0101"}'
# → 409 {"code":"taken",...}
curl -s -X POST localhost:8090/api/lunoah/checkout -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"<BREAD_ID>","qty":1}],"date":"<DATE>","time":"03:00","name":"x","phone":"3135550100"}'
# → 409 taken (outside hours)
curl -s -X POST localhost:8090/api/lunoah/stripe-webhook -H 'Stripe-Signature: t=1,v1=00' -d '{}'
# → 400 bad signature
curl -s "localhost:8090/api/lunoah/order?k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"   # → 404
```

4. Open the first `url` in a browser and pay with card `4242 4242 4242 4242`, any future date, any CVC.

Expected:
- Terminal A shows `checkout.session.completed` → `[200]`.
- `curl -s "localhost:8090/api/lunoah/order?k=<token>"` shows `"status":"paid"` and `"can_cancel":true`.
- Mailpit has two emails: one to Nadia (or the baker login) and one to the customer, with the cancel link.

This also confirms that `$security.hs256` returns lowercase hex the same way Stripe signs: a 400 for real Stripe events would mean it doesn't.

5. Third-hold check: create two holds on two other open slots from the same machine, then a third.
   Expected: the third returns 429 `holds`. Release them with `curl -X POST localhost:8090/api/lunoah/release -H 'Content-Type: application/json' -d '{"token":"<t>"}'` and confirm they're gone from `taken`.

- [ ] **Step 5: Commit**

```bash
git add pb_hooks/lib/mail.js pb_hooks/lib/booking.js pb_hooks/orders.pb.js
git commit -m "Server checkout with Stripe: holds, verified payment, webhook, emails, hold sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cancelling and refunds (customer and Nadia)

**Files:**
- Modify: `pb_hooks/lib/booking.js` (add `cancelBooking`), `pb_hooks/orders.pb.js` (add routes)

**Interfaces:**
- Produces:
  - `cancelBooking(rec, by) → rec`, where `by` is `customer|nadia`
  - `POST /api/lunoah/order/cancel {token}` → summary. Returns 409 `{code:"closed", phone}` after the window, or 409 `{code:"not_paid"}`.
  - `POST /api/lunoah/admin/cancel {id}` (bakers) → `{status, refund_status}`
  - `POST /api/lunoah/admin/retry-refund {id}` (bakers) → `{refund_status}`

- [ ] **Step 1: Add `cancelBooking` to `pb_hooks/lib/booking.js`** (above `module.exports`, and add `cancelBooking: cancelBooking` to the exports)

```js
// Cancels a paid or manual booking. Stripe-paid bookings are refunded in full. The slot is
// freed even if the refund fails (refund_status = failed, Nadia can retry from the admin).
function cancelBooking(rec, by) {
  var st = rec.getString("status");
  if (st === "cancelled") return rec;
  var pi = rec.getString("stripe_payment_intent");
  var refund = "none";
  if (st === "paid" && pi) {
    var r = refundPayment(pi, "refund-" + rec.id);
    refund = r.status === 200 ? "refunded" : "failed";
    if (refund === "failed") $app.logger().error("lunoah refund failed", "id", rec.id, "error", JSON.stringify(r.json.error || {}));
  }
  rec.set("status", "cancelled");
  rec.set("cancelled_at", Date.now());
  rec.set("cancelled_by", by);
  rec.set("refund_status", refund);
  $app.save(rec);
  lib("mail").cancelledEmail(rec, by);
  return rec;
}
```

- [ ] **Step 2: Add the routes to `pb_hooks/orders.pb.js`**

```js
routerAdd("POST", "/api/lunoah/order/cancel", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  let rec = B.byToken((e.requestInfo().body || {}).token);
  if (!rec) return B.fail(e, 404, "not_found", "We couldn't find that order.");
  rec = B.refreshHeld(rec);
  const s = B.summary(rec);
  if (s.status === "cancelled") return e.json(200, s);
  if (s.status !== "paid") return B.fail(e, 409, "not_paid", "This order isn't paid yet.");
  if (!s.can_cancel) return B.fail(e, 409, "closed", "This order can no longer be cancelled online.", { phone: s.phone });
  B.cancelBooking(rec, "customer");
  return e.json(200, B.summary(B.findById(rec.id)));
});

routerAdd("POST", "/api/lunoah/admin/cancel", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  const rec = B.findById(String((e.requestInfo().body || {}).id || ""));
  if (!rec) return B.fail(e, 404, "not_found", "That pickup no longer exists.");
  if (rec.getString("status") === "held") return B.fail(e, 409, "held", "This customer is paying right now. The time frees itself if they don't finish.");
  B.cancelBooking(rec, "nadia");
  return e.json(200, { status: rec.getString("status"), refund_status: rec.getString("refund_status") });
}, $apis.requireAuth("bakers"));

routerAdd("POST", "/api/lunoah/admin/retry-refund", (e) => {
  const B = require(`${__hooks}/lib/booking.js`);
  const rec = B.findById(String((e.requestInfo().body || {}).id || ""));
  if (!rec || rec.getString("refund_status") !== "failed") return B.fail(e, 409, "no_refund", "There's no failed refund to retry.");
  const r = B.refundPayment(rec.getString("stripe_payment_intent"), "refund-" + rec.id + "-" + Date.now());
  rec.set("refund_status", r.status === 200 ? "refunded" : "failed");
  $app.save(rec);
  return e.json(200, { refund_status: rec.getString("refund_status") });
}, $apis.requireAuth("bakers"));
```

- [ ] **Step 3: Restart and verify** (keep `stripe listen` running)

1. Customer cancel: using the paid token from Task 6, run
   `curl -s -X POST localhost:8090/api/lunoah/order/cancel -H 'Content-Type: application/json' -d '{"token":"<token>"}'`
   Expected: `"status":"cancelled","refund_status":"refunded"`. The Stripe CLI shows `charge.refunded` → 200. The slot is gone from `taken`. Mailpit has a "Cancelled:" email to Nadia.
2. Run the same command again. Expected: the same 200 summary, with no second refund.
3. Closed window: pay a new test order, then back-date it:
   `sqlite3 pb_data/data.db "update bookings set paid_at = paid_at - 3*3600000 where token='<t2>'"`.
   Cancel. Expected: 409 `closed` with `phone`.
4. Admin cancel: log in as a baker (`curl -s -X POST localhost:8090/api/collections/bakers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"<baker email>","password":"<pw>"}' | jq -r .token`). Then:
   - POST `/api/lunoah/admin/cancel` with `{"id":"<id of t2>"}` and `Authorization: <token>`. Expected: `refund_status: refunded`, and Mailpit has the "was cancelled" email to the customer.
   - The same request without the Authorization header. Expected: 401.
5. Dashboard refund: pay a third order, then refund it in the Stripe test dashboard (Payments → refund in full).
   Expected: the booking becomes `cancelled` / `cancelled_by=stripe` within seconds (check with `/api/lunoah/order?k=`).

- [ ] **Step 4: Commit**

```bash
git add pb_hooks/lib/booking.js pb_hooks/orders.pb.js
git commit -m "Cancelling: customer 2-hour refund link, Nadia cancel+refund, retry failed refunds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Storefront checkout (two steps, Stripe redirect, back-from-Stripe, ordering gate)

**Files:**
- Modify: `pb_public/index.html`, `pb_public/site.js`, `pb_public/styles.css`

**Interfaces:**
- Consumes: `/api/lunoah/checkout-config`, `/api/lunoah/checkout`, `/api/lunoah/release`.
- sessionStorage key `lunoah_checkout` = `{ token, cart, name, phone, notes, date, time }`.

- [ ] **Step 1: Update the page markup** (`pb_public/index.html`)

1. Delete the `<a href="#pay" id="nav-pay" hidden>Pay</a>` nav link, the whole `<section id="pay" …>…</section>`, and `<script src="/pay-apps.js"></script>`.

2. In "How to order", change `<h3>2. Pay &amp; text us</h3>` to `<h3>2. Pay online</h3>`, and its paragraph to:
```html
          <p>Choose a pickup time and pay securely by card, Apple Pay or Google Pay. Your time is booked once you've paid.</p>
          <p id="phone-line" class="muted small"></p>
```

3. Replace the whole `<form method="dialog" id="order-form" novalidate>…</form>` contents (keep the form element and the close button) with:
```html
      <ol class="steps" id="steps">
        <li data-step="1" class="current">Your order</li>
        <li data-step="2">Review &amp; pay</li>
      </ol>

      <section class="step" data-step="1">
        <h2>Your order</h2>
        <ul id="order-lines" class="order-lines"></ul>
        <p id="checkout-notice" class="pickup-notice" role="alert" hidden></p>
        <label>Your name <input id="o-name" maxlength="100" required autocomplete="name"></label>
        <label>Phone <span class="muted">(so Nadia can reach you about your pickup)</span>
          <input id="o-phone" type="tel" maxlength="20" required autocomplete="tel" placeholder="(313) 555-0100"></label>
        <p id="pickup-notice" class="pickup-notice" role="alert" hidden></p>
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
          <p id="pickup-at" class="muted small" hidden></p>
        </div>
        <p id="pickup-error" class="send-error" role="alert" hidden>Couldn't load pickup times. Please refresh the page.</p>
        <label>Anything else? <textarea id="o-notes" rows="2" maxlength="500"></textarea></label>
        <div class="dialog-actions">
          <button type="button" id="to-step-2" class="btn">Continue →</button>
        </div>
      </section>

      <section class="step" data-step="2" hidden>
        <h2>Review &amp; pay</h2>
        <ul id="review-lines" class="order-lines"></ul>
        <p id="review-pickup" class="review-pickup"></p>
        <p id="review-contact" class="muted small"></p>
        <p class="policy">You can cancel for a full refund within 2 hours of ordering. After that, your bread is being baked just for you.</p>
        <p id="pay-error" class="send-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-back="1">← Back</button>
          <button type="button" id="pay-btn" class="btn">Pay securely →</button>
        </div>
        <p class="muted small">You'll pay on Stripe's secure page: card, Apple Pay or Google Pay.</p>
      </section>
```

- [ ] **Step 2: Replace the payment code in `site.js`**

1. Remove `let payMethods = [];`.
2. Remove the whole `// ---------- How to pay ----------` block: `svg`, `copyBtn`, `payDetails`, `renderPay` and the pay-logo click code, down to just before `function renderShop()`.
3. In `load()`, replace the `payment_methods` fetch `try { … renderPay … } catch (_) {}` with:
```js
    try {
      online = !!(await fetch("/api/lunoah/checkout-config").then((r) => r.json())).online;
    } catch (_) { online = false; }
    renderGrid();
    await pickupReady;
    resumeFromStripe();
```
   Also delete the earlier `renderGrid();` call in `load()`, so the grid renders once, after `online` is known. Add `let online = false;` next to `let shop = {};`.

4. In `renderShop()`, replace the `if (phone) { $("#phone-line").replaceChildren(…) … }` block with:
```js
    const phone = digits(shop.phone);
    if (phone) {
      $("#phone-line").replaceChildren("Questions? Text Nadia at ", el("a", { href: "sms:" + phone }, shop.phone), ".");
    }
```

5. In `renderGrid()`, replace `const canOrder = !!digits(shop.phone);` with:
```js
    const canOrder = online;
    $("#ordering-paused").hidden = online;
    if (!online) $("#ordering-paused").textContent = `Online ordering is paused. Text Nadia at ${shop.phone || "the number below"}.`;
```
   Add `<p id="ordering-paused" class="pickup-notice" hidden></p>` in `index.html`, directly under `<h2>Our Bread Selection</h2>`.

6. Delete everything from `const myBookings = new Set();` through the end of the file, **except** these, which stay unchanged: `computeSlots` (edit below), `refreshTaken`, `shiftMonth`, `pickupLabel`, `renderCal` and the `#cal-prev`/`#cal-next` listeners. In `computeSlots`, change the `taken:` line to `taken: pickupData.taken,`.

7. In `loadPickup()`'s catch, keep `pickupData = null;` and change the comment to `// checkout shows "Couldn't load pickup times"`.

8. Append the new checkout code before the final `load();`:

```js
  // ---------- Checkout: 1 your order → 2 review & pay (Stripe) ----------
  const SAVED = "lunoah_checkout";
  let step = 1;
  const save = (v) => { try { sessionStorage.setItem(SAVED, JSON.stringify(v)); } catch (_) {} };
  const saved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) || "null"); } catch (_) { return null; } };
  const phoneOk = (p) => { let d = p.replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10; };

  function goStep(n) {
    step = n;
    document.querySelectorAll("#order-form .step").forEach((sec) => (sec.hidden = Number(sec.dataset.step) !== n));
    document.querySelectorAll("#steps li").forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle("current", k === n);
      li.classList.toggle("done", k < n);
    });
    if (n === 2) renderReview();
    $("#order-form").scrollTop = 0;
  }

  function renderLines(ul) {
    ul.replaceChildren(
      ...lines().map(({ b, q }) => el("li", {}, el("span", {}, `${q} × ${b.name}`), el("span", {}, money(q * b.price)))),
      el("li", { class: "total" }, el("span", {}, "Total"), el("span", {}, money(total())))
    );
  }

  function renderReview() {
    renderLines($("#review-lines"));
    $("#review-pickup").textContent = `Pickup: ${pickupLabel()}` + (shop.pickup_location ? ` · ${shop.pickup_location}` : "");
    $("#review-contact").textContent = `${$("#o-name").value.trim()} · ${$("#o-phone").value.trim()}`;
    $("#pay-btn").textContent = `Pay ${money(total())} securely →`;
    $("#pay-btn").disabled = false;
  }

  function openDialog(notice) {
    renderLines($("#order-lines"));
    const usable = !!pickupData;
    $("#pickup-picker").hidden = !usable;
    $("#pickup-error").hidden = usable;
    if (usable) { computeSlots(); renderCal(); }
    $("#pickup-notice").hidden = true;
    $("#pay-error").hidden = true;
    $("#checkout-notice").hidden = !notice;
    if (notice) $("#checkout-notice").textContent = notice;
    goStep(1);
    if (!$("#order-dialog").open) $("#order-dialog").showModal();
    refreshTaken();
  }

  $("#bar-btn").addEventListener("click", () => openDialog(""));
  $("#close-dialog").addEventListener("click", () => $("#order-dialog").close());
  $("#to-step-2").addEventListener("click", () => {
    if (!$("#o-name").value.trim()) { $("#o-name").focus(); $("#o-name").reportValidity(); return; }
    if (!phoneOk($("#o-phone").value)) {
      $("#o-phone").setCustomValidity("Please enter a 10-digit phone number.");
      $("#o-phone").reportValidity();
      return;
    }
    if (!pickupData || !pickupLabel()) return;
    goStep(2);
  });
  $("#o-phone").addEventListener("input", () => $("#o-phone").setCustomValidity(""));
  document.querySelectorAll("#order-form [data-back]").forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.back))));

  function backToTimes(msg) {
    pick.time = "";
    goStep(1);
    refreshTaken().then(() => { computeSlots(); renderCal(); });
    $("#pickup-notice").textContent = msg;
    $("#pickup-notice").hidden = false;
  }

  $("#pay-btn").addEventListener("click", async () => {
    const btn = $("#pay-btn");
    btn.disabled = true;
    btn.textContent = "Holding your pickup time…";
    $("#pay-error").hidden = true;
    const prev = saved();
    const body = {
      items: lines().map(({ b, q }) => ({ id: b.id, qty: q })),
      date: pick.date, time: pick.time,
      name: $("#o-name").value.trim(), phone: $("#o-phone").value.trim(), notes: $("#o-notes").value.trim(),
      previous: prev && prev.token ? prev.token : "",
    };
    let res, data;
    try {
      res = await fetch("/api/lunoah/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      data = await res.json().catch(() => ({}));
    } catch (_) {
      data = { code: "network" };
    }
    if (res && res.ok && data.url) {
      save({ token: data.token, cart: { ...cart }, name: body.name, phone: body.phone, notes: body.notes, date: body.date, time: body.time });
      location.href = data.url;
      return;
    }
    renderReview();
    if (data.code === "taken") return backToTimes(`Sorry, ${S.formatTime(body.time)} was just taken. Please pick another time.`);
    if (data.code === "sold_out" || data.code === "unavailable") {
      const b = breads.find((x) => x.name === data.bread);
      if (b) { delete cart[b.id]; b.sold_out = true; renderGrid(); updateBar(); }
      $("#order-dialog").close();
      if (lines().length) openDialog(data.message);
      return;
    }
    $("#pay-error").textContent = data.code === "network"
      ? "We couldn't reach the bakery. Please check your connection and try again."
      : data.message || "Something went wrong. Please try again.";
    $("#pay-error").hidden = false;
  });

  // Came back from Stripe without paying (?back=<token>): free the hold and reopen checkout.
  async function resumeFromStripe() {
    const u = new URL(location.href);
    const back = u.searchParams.get("back");
    if (!back) return;
    history.replaceState(null, "", u.pathname + u.hash);
    const s = saved();
    try {
      await fetch("/api/lunoah/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: back }) });
    } catch (_) {}
    try { sessionStorage.removeItem(SAVED); } catch (_) {}
    if (!s || s.token !== back) return;
    for (const [id, q] of Object.entries(s.cart || {})) if (breads.some((b) => b.id === id && !b.sold_out)) cart[id] = q;
    renderGrid(); updateBar();
    if (!lines().length) return;
    $("#o-name").value = s.name || ""; $("#o-phone").value = s.phone || ""; $("#o-notes").value = s.notes || "";
    pick = { date: s.date || "", time: s.time || "" };
    await refreshTaken();
    openDialog("Payment not completed. Your pickup time was released.");
    if (pickupData && slots.some((d) => d.date === pick.date && d.times.includes(pick.time))) goStep(2);
  }
```

   Also: `refreshTaken` must return its promise (it's already `async`). Remove its `if (usingPicker && step === 1)` guard, replacing it with `if (step === 1) { computeSlots(); renderCal(); }`. Then delete `let usingPicker` and every remaining `usingPicker` reference.

- [ ] **Step 3: Styles** (`pb_public/styles.css`, after the `.send-error` rule)

```css
.policy { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--paper); border: 1px solid var(--line); font-size: .9rem; }
.review-pickup { margin: 0; font-weight: 600; }
```

Delete the now-unused rules `.order-preview`, `.order-received` and their children only if a `grep` across `pb_public` finds no other use.

- [ ] **Step 4: Check it in the browser at 375px** (site + `stripe listen` running)

- The menu shows the + buttons. Removing `stripe.env` and restarting shows "Online ordering is paused…" with no + buttons. Restore it afterwards.
- Checkout step 1 needs a name, a 10-digit phone and a time. Step 2 shows the review, the policy and "Pay $X securely →".
- Pay → Stripe page → "← back" link → lands on `/?back=` → the dialog shows "Payment not completed…" on step 2 with everything filled in, and `taken` no longer lists the slot.
- Pay with `4000 0000 0000 0002` → declined on Stripe's page → then pay with `4242…` → lands on `/order.html?k=…`. That page doesn't exist until Task 9, so a 404 here is expected.
- Race: hold slot X with curl (Task 6 command), then try to pay for X in the browser → "Sorry, 9:15 AM was just taken" and back on step 1.
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add pb_public/index.html pb_public/site.js pb_public/styles.css
git commit -m "Checkout: two steps and pay with Stripe; resume after leaving Stripe; pause without keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Order page (booked / confirming / cancel)

**Files:**
- Create: `pb_public/order.html`, `pb_public/order.js`
- Modify: `pb_public/styles.css`

**Interfaces:**
- Consumes: `GET /api/lunoah/order?k=` and `POST /api/lunoah/order/cancel`, from Tasks 6 and 7.

- [ ] **Step 1: Create `pb_public/order.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Your order · Lunoah Sourdough Co.</title>
  <link rel="icon" href="/img/logo/lunoah-logo-192.png">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/themes.css">
  <script src="/theme.js"></script>
</head>
<body>
  <header class="site-header">
   <div class="header-inner">
    <a href="/" class="brand">
      <img class="brand-logo" src="/img/logo/lunoah-logo-192.png" width="44" height="44" alt="">
      <span class="brand-name">Lunoah Sourdough Co.</span>
    </a>
   </div>
  </header>
  <main class="order-page">
    <section class="order-card" aria-live="polite">
      <h1 id="op-title">Loading your order…</h1>
      <p id="op-lead" class="lead"></p>
      <div id="op-details" hidden>
        <p class="review-pickup" id="op-when"></p>
        <p id="op-where" class="muted"></p>
        <ul id="op-lines" class="order-lines"></ul>
      </div>
      <div id="op-cancel-box" hidden>
        <p class="policy" id="op-cancel-note"></p>
        <button type="button" id="op-cancel" class="btn btn-ghost danger-text">Cancel my order</button>
      </div>
      <p id="op-msg" class="pickup-notice" role="status" hidden></p>
      <p><a href="/" class="btn">Back to the bakery</a></p>
    </section>
  </main>
  <script src="/order.js"></script>
</body>
</html>
```

Check the header markup against `index.html` (class names `site-header`, `header-inner`) and copy them exactly as they appear there.

- [ ] **Step 2: Create `pb_public/order.js`**

```js
(function () {
  const $ = (s) => document.querySelector(s);
  const k = new URLSearchParams(location.search).get("k") || "";
  const money = (c) => "$" + (c / 100).toFixed(2);
  let polls = 0;

  function el(tag, text, cls) { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; }

  function show(o) {
    $("#op-details").hidden = false;
    $("#op-when").textContent = `Pickup: ${o.when}`;
    $("#op-where").replaceChildren();
    if (o.location) {
      const a = document.createElement("a");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.location);
      a.target = "_blank"; a.rel = "noopener"; a.textContent = "Map";
      $("#op-where").append(`📍 ${o.location} · `, a);
    }
    $("#op-lines").replaceChildren(
      ...o.lines.map((l) => { const li = document.createElement("li"); li.append(el("span", `${l.qty} × ${l.name}`), el("span", money(l.qty * l.price_cents))); return li; }),
      (() => { const li = el("li", "", "total"); li.append(el("span", "Total"), el("span", money(o.amount_cents))); return li; })()
    );
    $("#op-cancel-box").hidden = true;
    $("#op-msg").hidden = true;

    if (o.status === "paid") {
      $("#op-title").textContent = "You're booked!";
      $("#op-lead").textContent = `Thank you, ${o.name}. A confirmation email is on its way.`;
      if (o.can_cancel) {
        $("#op-cancel-box").hidden = false;
        $("#op-cancel-note").textContent = `Changed your mind? You can cancel for a full refund until ${o.cancel_until_label}.`;
      } else {
        $("#op-msg").textContent = `This order can no longer be cancelled online. Please text Nadia at ${o.phone}.`;
        $("#op-msg").hidden = false;
      }
    } else if (o.status === "held") {
      $("#op-title").textContent = "Confirming your payment…";
      $("#op-lead").textContent = "This usually takes a few seconds.";
      if (polls++ < 15) setTimeout(load, 2000);
      else $("#op-lead").textContent = "Still confirming. You'll get an email shortly. If you don't, text Nadia at " + o.phone + ".";
    } else if (o.status === "cancelled") {
      $("#op-title").textContent = "Order cancelled";
      $("#op-lead").textContent = o.refund_status === "refunded"
        ? `${money(o.amount_cents)} is on its way back to your card (5–10 days).`
        : `Your refund is being processed. Questions? Text Nadia at ${o.phone}.`;
    } else {
      $("#op-title").textContent = "Your pickup is booked";
      $("#op-lead").textContent = "";
    }
  }

  async function load() {
    if (!/^[A-Za-z0-9]{32}$/.test(k)) return notFound();
    try {
      const r = await fetch("/api/lunoah/order?k=" + encodeURIComponent(k));
      if (r.status === 404) return notFound();
      show(await r.json());
    } catch (_) {
      $("#op-title").textContent = "We couldn't load your order";
      $("#op-lead").textContent = "Please check your connection and refresh.";
    }
  }

  function notFound() {
    $("#op-title").textContent = "Order not found";
    $("#op-lead").textContent = "Please use the link from your confirmation email.";
  }

  $("#op-cancel").addEventListener("click", async () => {
    if (!confirm("Cancel your order and get a full refund?")) return;
    const btn = $("#op-cancel");
    btn.disabled = true; btn.textContent = "Cancelling…";
    try {
      const r = await fetch("/api/lunoah/order/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: k }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) return show(d);
      $("#op-cancel-box").hidden = true;
      $("#op-msg").textContent = d.code === "closed"
        ? `This order can no longer be cancelled online. Please text Nadia at ${d.phone}.`
        : d.message || "Something went wrong. Please try again.";
      $("#op-msg").hidden = false;
    } catch (_) {
      $("#op-msg").textContent = "We couldn't reach the bakery. Please try again.";
      $("#op-msg").hidden = false;
    } finally { btn.disabled = false; btn.textContent = "Cancel my order"; }
  });

  fetch("/api/collections/shop/records?perPage=1").then((r) => r.json())
    .then((s) => window.LunoahTheme && s.items && s.items[0] && window.LunoahTheme.apply(s.items[0].theme)).catch(() => {});
  load();
})();
```

- [ ] **Step 3: Styles** (append to `pb_public/styles.css`)

```css
.order-page { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
.order-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.order-card h1 { margin: 0; }
```

- [ ] **Step 4: Browser check at 375px**

- Pay `4242` → `order.html` shows "You're booked!", the time, the map link, the lines and "cancel … until H:MM".
- **Cancel** → confirm → "Order cancelled · $X is on its way back".
- Reloading the page shows the cancelled state.
- A bad `k` shows "Order not found".
- Stop `stripe listen`, pay a new order → the page polls "Confirming…" and then shows "You're booked!", because `refreshHeld` asks Stripe directly. Restart `stripe listen` afterwards.
- Back-date `paid_at` (Task 7 sqlite command) → the page shows the "no longer be cancelled online" message.
- The Halloween theme applies on this page too.

- [ ] **Step 5: Commit**

```bash
git add pb_public/order.html pb_public/order.js pb_public/styles.css
git commit -m "Order page: booked confirmation, 2-hour cancel button, confirming fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin (badges, cancel + refund, retry, time-off warning, Shop Info)

**Files:**
- Modify: `pb_public/admin/pickup-admin.js`, `pb_public/admin/index.html`, `pb_public/admin/admin.js`, `pb_public/admin/admin.css`

**Interfaces:**
- Consumes: `/api/lunoah/admin/cancel`, `/api/lunoah/admin/retry-refund` and `/api/lunoah/checkout-config`.

- [ ] **Step 1: Load the bookings Nadia needs** (`pickup-admin.js`)

Replace `getBookings`:
```js
  const getBookings = () => api(`/api/collections/bookings/records?perPage=500&sort=date,time&filter=${encodeURIComponent(
    `(date >= '${today()}' && status != 'cancelled') || refund_status = 'failed'`)}`);
```

In both preview calls (`taken: bookings.map(...)`, ~lines 282 and 362), only count live bookings:
```js
      taken: bookings.filter((b) => b.status !== "cancelled").map((b) => ({ date: b.date, time: b.time })),
```

- [ ] **Step 2: Badges, cancel+refund and retry in `renderBookings`**

Replace the body of the `for (const b of bookings)` loop, after the day-heading block, with:
```js
      const li = h("li", "pk-block pk-booking");
      const info = h("div");
      info.append(h("div", "name", `${S.formatTime(b.time)} · ${b.name}`));
      const cents = b.amount_cents || Math.round((Number(b.total) || 0) * 100);
      const amount = `$${(cents / 100).toFixed(2)}`;
      const badge =
        b.refund_status === "failed" ? h("span", "badge-pill bad", "Refund failed")
        : b.status === "paid" ? h("span", "badge-pill ok", `Paid ${amount}`)
        : b.status === "held" ? h("span", "badge-pill", "Paying now…")
        : h("span", "badge-pill", "Paid outside the site");
      info.append(badge);
      const meta = [b.items, b.phone, b.notes ? `“${b.notes}”` : ""].filter(Boolean).join(" · ");
      if (meta) info.append(h("div", "muted small-print", meta));
      li.append(info);

      if (b.refund_status === "failed") {
        const retry = h("button", "btn ghost small", "Retry refund");
        retry.type = "button";
        retry.addEventListener("click", async () => {
          busy(retry, true);
          try {
            const r = await api("/api/lunoah/admin/retry-refund", { method: "POST", body: { id: b.id } });
            toast(r.refund_status === "refunded" ? `Refunded ${amount} to ${b.name}.` : "The refund still didn't go through. Please try again later.", r.refund_status === "refunded" ? "ok" : "bad");
            await reloadBookings();
          } catch (err) { toast(err.message, "bad"); } finally { busy(retry, false); }
        });
        li.append(retry);
      } else if (b.status !== "held") {
        const cancel = h("button", "btn ghost small danger-text", "Cancel");
        cancel.type = "button";
        cancel.setAttribute("aria-label", `Cancel ${b.name}'s ${S.formatTime(b.time)} pickup`);
        cancel.addEventListener("click", async () => {
          const when = `${S.formatTime(b.time)} pickup on ${S.formatDate(b.date, "short")}`;
          const q = b.status === "paid"
            ? `Cancel ${b.name}'s ${when} and refund ${amount} to their card?`
            : `Cancel ${b.name}'s ${when}? That time will open up for other customers.`;
          if (!confirm(q)) return;
          try {
            const r = await api("/api/lunoah/admin/cancel", { method: "POST", body: { id: b.id } });
            if (r.refund_status === "failed") toast("Cancelled, but the refund didn't go through. Tap “Retry refund”.", "bad");
            else toast(`Pickup cancelled${r.refund_status === "refunded" ? ` and ${amount} refunded` : ""}. ${S.formatTime(b.time)} is open again.`);
            await reloadBookings();
          } catch (err) { toast(err.message, "bad"); }
        });
        li.append(cancel);
      }
      ul.append(li);
```

- [ ] **Step 3: Time-off warning** (`#block-form` submit handler, before `busy(btn, true)`)

```js
    const toMin = (t) => { const [hh, mm] = t.split(":").map(Number); return hh * 60 + mm; };
    const hit = bookings.filter((b) => (b.status === "paid" || b.status === "manual") && b.date >= start && b.date <= end &&
      (allDay || (toMin(b.time) < toMin(to) && toMin(from) < toMin(b.time) + (shop.slot_minutes || 15))));
    if (hit.length) {
      const list = hit.map((b) => `• ${S.formatDate(b.date, "short")} ${S.formatTime(b.time)}: ${b.name}`).join("\n");
      if (!confirm(`${hit.length} booked ${hit.length === 1 ? "pickup falls" : "pickups fall"} in this time off:\n${list}\n\nCancel ${hit.length === 1 ? "it" : "them"} (and refund paid ones) and save the time off?`)) return;
    }
```
Then, after the POST that creates the block succeeds and before `$("#block-dialog").close();`, add:
```js
      let failed = 0;
      for (const b of hit) {
        try {
          const r = await api("/api/lunoah/admin/cancel", { method: "POST", body: { id: b.id } });
          if (r.refund_status === "failed") failed++;
        } catch (_) { failed++; }
      }
      if (hit.length) await reloadBookings();
      if (failed) toast(`${failed} refund${failed === 1 ? "" : "s"} didn't go through. See “Refund failed” under Upcoming pickups.`, "bad");
```
Change the existing success toast to `if (!failed) toast("Time off added");`. `hit` lives in the handler scope; `failed` and both toasts sit in the same `try` block.

- [ ] **Step 4: Shop Info** (`admin/index.html`, `admin/admin.js`)

1. In `index.html`, replace the whole `<div class="setting-box">…s-reqpay…</div>` with:
```html
        <div class="setting-box">
          <p><strong>Online card payments:</strong> <span id="s-stripe">checking…</span></p>
          <label>Email for new orders <span class="muted">(each paid order is emailed here)</span>
            <input id="s-notify" type="email" maxlength="200" placeholder="you@example.com"></label>
        </div>
```
2. Change the `s-phone` label text to `Shop phone number <span class="muted">(shown to customers for questions)</span>`.
3. Find the payment apps section heading near `#pay-list` and add the hint `<p class="hint">These are for orders you take yourself (phone or in person). Website orders are paid by card.</p>` directly above `<ul id="pay-list"`.

In `admin.js`:
- `loadShop()`: replace the `s-reqpay` line with
```js
    $("#s-notify").value = shop.notify_email || "";
    fetch("/api/lunoah/checkout-config").then((r) => r.json())
      .then((c) => ($("#s-stripe").textContent = c.online ? "On" : "Not set up yet"))
      .catch(() => ($("#s-stripe").textContent = "Unknown"));
```
- Shop form submit: replace the `require_payment` append with `fd.append("notify_email", $("#s-notify").value.trim());`.

- [ ] **Step 5: Styles** (`admin/admin.css`)

```css
.badge-pill { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 999px; font-size: .78rem; font-weight: 700; background: var(--line, #eee); }
.badge-pill.ok { background: #e3f3e6; color: #1f6b3a; }
.badge-pill.bad { background: #fde3e3; color: #a32020; }
```
Check these colors against the admin's existing tokens. If `admin.css` defines theme variables, use them, so the Halloween dark theme stays readable.

- [ ] **Step 6: Browser check at 375px** (logged in as a baker)

- A paid web order shows "Paid $X"; a phone pickup shows "Paid outside the site"; a curl hold shows "Paying now…" with no Cancel button.
- Cancel on a paid order → confirm text mentions the refund → toast → it disappears, and Stripe shows the refund.
- Simulate a failed refund:
  ```bash
  sqlite3 pb_data/data.db "update bookings set status='cancelled', refund_status='failed' where id='<id>'"
  ```
  The order shows in red with **Retry refund**. Retry → "Refunded…". Since that order was already refunded, Stripe answers `charge_already_refunded`, which counts as success.
- Time off over a paid order → the confirm lists it → OK → the block is saved and the order is refunded.
- Shop Info shows "Online card payments: On", and saving the notify email persists.
- Halloween theme: badges are readable.

- [ ] **Step 7: Commit**

```bash
git add pb_public/admin/
git commit -m "Admin: payment badges, cancel with refund, retry refund, time-off warning, order email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs (launch plan, Nadia's guide)

**Files:**
- Modify: `LAUNCH-PLAN.md`, `NADIA-GUIDE.md`

- [ ] **Step 1: LAUNCH-PLAN.md**

1. Add `| Card payments | **Stripe** (no monthly fee) | ~2.9% + 30¢ per order |` to the table.
2. Add a section **"4. Card payments (Stripe)"** before the checklist, and renumber the checklist to 5. The section covers:
   1. Nadia signs up at stripe.com in her own name: business type "Individual / sole proprietor", her bank account for payouts, and statement descriptor `LUNOAH SOURDOUGH`.
   2. Developers → API keys → create a **restricted key** with write access to *Checkout Sessions* and *Refunds* (everything else: none).
   3. Developers → Webhooks → Add endpoint `https://lunoahsourdough.com/api/lunoah/stripe-webhook` with the events `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`. Copy the signing secret.
   4. On the server, create `/opt/lunoah/stripe.env` (chmod 600) with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SITE_URL=https://lunoahsourdough.com`, then `sudo systemctl daemon-reload && sudo systemctl restart lunoah`.
   5. Email: in `/_/` → Settings → Mail settings, use the bakery Gmail with an **app password** (smtp.gmail.com, port 587). Set the sender name to "Lunoah Sourdough Co.". Then click **Send test email**.
   6. Place a real $1-ish order with a real card, cancel it from the email link, and confirm the refund in Stripe.
   7. Copy `pb_hooks` and `pb_migrations` as well as `pb_public` when deploying (the scp line).
3. In the checklist, replace the spam line with: `- [ ] Stripe live keys + webhook set, a real test order placed and refunded` and `- [ ] Order emails arrive (Nadia + customer)`.

- [ ] **Step 2: NADIA-GUIDE.md**

Add a section "Orders and payments", in plain language:
- Customers pay by card when they order. A time is booked only after they've paid.
- You get an email for every order, and orders also show under **Pickup Times → Upcoming pickups**.
- **Badges:** *Paid $X*, *Paid outside the site* (pickups you added), *Paying now…* (someone is at the payment page; the time frees itself if they don't finish), *Refund failed* (tap **Retry refund**).
- Customers can cancel themselves for a full refund within 2 hours of ordering. After that, they have to text you.
- **Cancel** on a paid order refunds the full amount to their card, and they get an email.
- Adding time off over booked pickups warns you and can cancel and refund them for you.
- Money arrives in your bank from Stripe (usually 2 business days). The Stripe app shows payments and payouts.
- The Payment apps list is now only for orders you take yourself.

Remove or rewrite any guide text about "Customers must pay before sending their order" and the order texts.

- [ ] **Step 3: Commit**

```bash
git add LAUNCH-PLAN.md NADIA-GUIDE.md
git commit -m "Docs: Stripe launch steps and Nadia's guide to orders and refunds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Full end-to-end pass and cleanup

**Files:** none new. Fix any bugs found in their own commits.

- [ ] **Step 1: Unit tests**

Run: `node --test`
Expected: all pass.

- [ ] **Step 2: Walk the spec's end-to-end list in a 375px browser**, with `stripe listen` and Mailpit running

1. Pay with `4242` → booked page, both emails, admin "Paid".
2. A declined card, then a retry.
3. Back from Stripe → the hold is released and the cart restored.
4. Abandon: temporarily set `HOLD_MS` to 1 min and `SESSION_SEC` to 31 min. Expire the session with `stripe checkout sessions expire <cs_id>` → the webhook deletes the hold. Then revert.
5. Webhook forwarding stopped → the booked page still confirms.
6. Two browsers on one slot → the second gets "just taken".
7. Customer cancel inside the window → refunded. Outside the window → blocked.
8. Nadia cancels → refunded, and the customer gets the email.
9. Full refund in the Stripe dashboard → cancelled.
10. Time off over a paid booking.
11. `stripe.env` removed → "Online ordering is paused".
12. At 320px, nothing scrolls sideways on the storefront, `order.html` or the admin.

- [ ] **Step 3: Clean up**

1. Cancel or delete every test booking:
   ```bash
   sqlite3 pb_data/data.db "delete from bookings where order_code='WEB' and name like 'Test%'"
   ```
   plus any that were created through the UI.
2. Delete the temporary superuser `test-admin@example.com`:
   ```bash
   pocketbase superuser delete test-admin@example.com --dir=pb_data
   ```
3. Leave Mailpit's SMTP settings in place locally. They're local only, and live settings are a launch step.

- [ ] **Step 4: Final commit if anything changed, then report**

Report:
- what was verified
- anything that could not be verified (for example, real Apple Pay needs a live domain)
- the launch steps that remain
