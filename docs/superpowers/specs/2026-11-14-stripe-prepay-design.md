# Stripe Prepay for Pickup Bookings: Design

**Date:** 2026-11-14
**Status:** Edge cases approved in chat. Awaiting spec review.
**Builds on:** `2026-11-07-pickup-bookings-design.md`, `2026-11-07-content-themes-booking-design.md`

## Goal

A pickup time is booked only after the customer has **paid in full online through Stripe**, and
the server has confirmed the payment with Stripe itself. The honor-system "I've sent the payment"
step (Venmo/Zelle) and the "text your order" step go away for online orders. Customers can cancel
for a full refund **within 2 hours** of paying. When Nadia cancels, the customer always gets a full refund.

## Decisions

| Topic | Decision |
|---|---|
| Processor | **Stripe Checkout**, the hosted payment page. Payment methods are cards (which includes Apple Pay and Google Pay) and Link. Methods that settle later, like bank transfers, are off. |
| Venmo / Zelle | Removed from online checkout. The public "How to pay" section is hidden. Nadia's saved payment apps stay in the admin, renamed "Payment apps (for orders you take yourself)". |
| Holding a slot | Tapping **Pay** creates a *held* booking, then a Stripe Checkout Session that expires in 30 min. The hold expires after 35 min, so it always outlasts the Stripe session. |
| What counts as paid | Only the server can mark a booking paid. It does that after Stripe's signed webhook arrives **or** after the server fetches the session from Stripe, and in both cases the session's amount, currency, `payment_status` and booking id must all match. |
| Price | The server recalculates the total from the `breads` prices. The browser sends only bread ids and quantities. |
| Limits | At most **12 of one bread** and **24 loaves** per order. At most **2 active holds per IP address**. Rate limits apply to checkout and cancel. |
| Customer cancel | Full refund through a private link, valid until **paid time + 2 h** or the pickup time, whichever comes first. After that the link shows Nadia's number instead. |
| Nadia cancel | Always a full refund for Stripe-paid bookings. "Paid outside the site" bookings are just cancelled. |
| Cancelled bookings | Kept as history with `status = cancelled`. The one-per-slot rule ignores them. |
| Notifications | Email Nadia for each paid order. Email the customer a confirmation with the pickup details and the cancel link. Stripe sends its own receipt. No texting step. |
| Contact | Name and US phone number (10 digits) are required on the site. Stripe collects the email. |
| Stripe not configured | Checkout is replaced by "Online ordering is paused. Text Nadia at …". It **never** falls back to the honor system. |
| Secrets | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SITE_URL` are environment variables, kept only on the server. They are never in git, the database or the admin. |

## Booking lifecycle

```
             Pay tapped                webhook / sync: paid
  (none) ───────────────► held ─────────────────────────────► paid ──► cancelled
                           │  Stripe session expired / released           ▲ (customer ≤2h, Nadia, or
                           └──────────► (record deleted)                  │  full refund in Stripe dashboard)
  Nadia adds pickup ───────────────────────────────────────► manual ─────┘
```

Status only ever moves forward. A held record is deleted, never cancelled, because an unpaid hold isn't worth keeping.
**Before deleting any hold, the server asks Stripe for the session.** If Stripe reports it paid, the hold is confirmed instead of deleted.

## Data (migration `1763100000_stripe_prepay.js`)

**`bookings`**: new fields
- `status` select: `held`, `paid`, `manual`, `cancelled` (required)
- `phone` text, max 20
- `notes` text, max 500
- `lines` json: snapshot `[{ bread, name, qty, price_cents }]`
- `amount_cents` number (integer)
- `hold_expires` date, `paid_at` date, `cancelled_at` date
- `cancelled_by` select: `customer`, `nadia`, `stripe`
- `refund_status` select: `none`, `refunded`, `failed`, `partial`
- `email` text (from Stripe), `stripe_session` text, `stripe_payment_intent` text
- `token` text, **hidden**: 32 random characters. Used for the customer's order and cancel link.
- `ip` text, **hidden**: used to cap active holds per visitor
- `emailed` bool: notification emails sent

Other changes to `bookings`:
- **Rules:** create is **bakers only**, because customers book only through the server route. List, view, update and delete stay bakers only.
- **Index:** the unique index is replaced by a partial one:
  `CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time) WHERE status != 'cancelled'`.
- **Existing rows** get `status = manual`.

**`shop`**:
- Remove `require_payment`.
- Add `notify_email` (email). This is where new-order emails go. If it's empty, they go to every baker's login email.

**Settings** (in the same migration): turn on rate limiting, with rules for `/api/lunoah/checkout` (5 per minute per IP) and `/api/lunoah/order/cancel` (10 per minute per IP).

The down migration restores the previous index, rules and `require_payment`, and drops the new fields.

## Server (pb_hooks)

PocketBase runs each hook handler on its own, so every handler `require`s what it needs from `pb_hooks/lib/`.
Library code is plain CommonJS with no PocketBase globals wherever possible, so `node --test` can unit-test it.

- **`lib/shoptime.js`**: the current date and minute in America/Detroit, done in plain JS. The PocketBase JS engine has no `Intl`, so this encodes the US daylight-saving rules directly (2nd Sunday of March to 1st Sunday of November, at 2:00).
- **`lib/order.js`**: pure checks and math.
  - `priceLines(breads, items)` validates each id: it must exist, not be hidden and not be sold out. It also checks quantities (whole numbers 1–12, total ≤ 24) and returns the lines plus `amount_cents`, rounding each price to whole cents.
  - `validPhone`, `validName`.
  - `slotIsOpen({hours, blocks, shop, taken, today, date, time})` reuses `slots.js` `availableSlots`. The function gets an optional `today` input so it doesn't need `Intl` on the server.
  - `cancelDeadline(paidAt, date, time)` returns the earlier of paid time + 2 h and the pickup time (in Detroit time, as UTC).
- **`lib/stripe.js`**:
  - `api(method, path, params, idemKey)` calls Stripe with `$http.send`, form-encoding nested params.
  - `verifySignature(rawBody, header, secret, nowSec)` checks Stripe's `t=…,v1=…` header with HMAC-SHA256 over `t.rawBody`, with a 5-minute tolerance. It uses `$security.hs256` and a constant-time compare.
  - `configured()` returns whether the keys are set.
- **`lib/booking.js`**:
  - `confirmPaid(bookingId, session)`, idempotent, runs in a transaction:
    1. Check that `session.payment_status === "paid"`, the amount and currency match, and `metadata.booking` matches.
    2. If the booking is still `held`, mark it `paid` and fill in `paid_at`, `email` and the payment intent.
    3. If the booking record is gone, or saving it hits the slot index, the payment can't keep a slot: **refund automatically** and email the customer an apology. This is defensive; it shouldn't happen.
    4. Send the emails once (`emailed` flag). An email failure is logged and never undoes the payment.
  - `releaseHold(booking)`:
    1. Ask Stripe to expire the session.
    2. If Stripe says the session is already complete, fetch it and call `confirmPaid`.
    3. Otherwise delete the hold.
  - `refund(booking, by)`: refund with Idempotency-Key `refund-<id>`, then set status `cancelled`, `cancelled_at`, `cancelled_by` and `refund_status`. If the refund fails, the status is still `cancelled` (the slot is freed) with `refund_status = failed`.
- **`lib/mail.js`**: the two emails, sent with `$app.newMailClient()` (SMTP settings live in the dashboard).
  - **To Nadia:** "New order: Sam Rivera, Fri Nov 13 9:15 AM". It includes the loaves, the total, the phone number, the notes and a link to the admin.
  - **To the customer:** "You're booked for Fri, Nov 13 at 9:15 AM". It includes the items, the total, the pickup location with a map link, the allergy note, and "Cancel for a full refund until 11:42 AM" with their link.

### Routes (`pb_hooks/orders.pb.js`)

| Route | Who | Does |
|---|---|---|
| `GET /api/lunoah/checkout-config` | anyone | `{ online: bool }`, true when Stripe is configured |
| `POST /api/lunoah/checkout` | anyone | Body `{ items:[{id,qty}], date, time, name, phone, notes, previous? }`. Releases `previous` (a token from this browser) if it's still held. Validates the items, name, phone and slot (server-side `slotIsOpen`). Clears expired holds on that slot through `releaseHold`, which asks Stripe first. Refuses if the IP already has 2 active holds. Creates the `held` booking. Creates the Stripe session (Idempotency-Key = booking id), with `expires_at` = now + 30 min, `client_reference_id` and `metadata.booking` set, and `success_url` = `SITE_URL/order.html?k=<token>` and `cancel_url` = `SITE_URL/?back=<token>`. Returns `{ url, token }`. If Stripe fails, it deletes the hold and returns 503. |
| `POST /api/lunoah/release` | token holder | Releases that hold, used when the customer comes back from Stripe without paying. |
| `GET /api/lunoah/order?k=` | token holder | Returns the order summary. If the order is still `held`, it fetches the session from Stripe and confirms on the spot. Returns `{ status, date, time, lines, amount_cents, cancel_until, can_cancel, refund_status }`. |
| `POST /api/lunoah/order/cancel` | token holder | Cancels and refunds if before the deadline. Otherwise returns 409 with Nadia's phone number. Doing it twice is safe. |
| `POST /api/lunoah/stripe-webhook` | Stripe | Verifies the signature against the raw body. `checkout.session.completed` → `confirmPaid`. `checkout.session.expired` → `releaseHold`. `charge.refunded` → a full refund marks the booking `cancelled_by = stripe`, `refund_status = refunded`; a partial one sets `partial` only. Other events → 200. |
| `POST /api/lunoah/admin/cancel` | bakers | Cancel: refund when Stripe-paid, plain cancel when `manual`. |
| `POST /api/lunoah/admin/retry-refund` | bakers | Tries the refund again for `refund_status = failed`. |
| `GET /api/lunoah/taken` | anyone | Now covers every booking with `status != cancelled`, including active holds. |

**Cron** (`cronAdd`, every 5 min): `releaseHold` for every hold past `hold_expires`. Stripe is asked first, so a payment whose webhook was missed is confirmed, not lost.

## Customer site

**Checkout** (`index.html`, `site.js`) becomes two steps:

1. **Your order.** Shows the lines, name, **phone**, pickup calendar and notes.
2. **Review & pay.** Shows the summary, the pickup time and location, and the policy line *"You can cancel for a full refund within 2 hours of ordering. After that, your bread is being baked just for you."* The button reads **Pay $24.00 securely →**.

Tapping **Pay**:
- disables the button ("Holding your pickup time…") and POSTs `/api/lunoah/checkout`
- saves the token and cart in `sessionStorage`
- redirects to Stripe

Failure messages:
- **Slot taken:** "Sorry, 9:15 AM was just taken." The calendar refreshes and the customer goes back to step 1.
- **Bread sold out:** the cart is updated and the message names the bread.
- **Too many holds:** "You already have a payment in progress. Finish it or wait a few minutes."
- **503:** "Payments are unavailable right now. Please try again in a few minutes."

**Back from Stripe** (`/?back=<token>`): calls `/release`, restores the cart and reopens checkout on step 2, with the note "Payment not completed. Your pickup time was released."

**`order.html`** (new page, success and cancel link): loads `/api/lunoah/order?k=`.
- **paid:** "You're booked!" with the pickup time and location (map link), the items and total, and a confirmation email note.
  - While the cancel window is open: a **Cancel my order** button with "until 11:42 AM". It asks to confirm, then shows "Cancelled. $24.00 is on its way back to your card (5–10 days)."
- **held:** shows "Confirming your payment…" and polls every 2 s for up to 30 s. After that it says "Still confirming. You'll get an email shortly."
- **cancelled:** shows the cancelled state, with the refund status.
- **Window closed:** "This order can no longer be cancelled online. Please text Nadia at …"

**Other storefront changes:**
- Ordering is turned on by `checkout-config.online` instead of whether a phone number is set.
- The hero line "Text your order to" becomes "Questions? Text Nadia at".
- The "How to pay" section is hidden.
- The free-text pickup box goes away. If pickup times fail to load, the customer sees "Couldn't load pickup times. Please refresh."

## Admin

**Upcoming pickups** shows each booking with a badge:
- **Paid $24.00**
- **Paid outside the site**
- **Paying now…** (until the hold expires). There's no Cancel button; it frees itself.
- **Refund failed**, in red, with a **Retry refund** button. It stays listed until it's resolved, even after the pickup date.

The Cancel confirm says "Cancel Sam Rivera's 9:15 AM pickup on Fri, Nov 13 and refund $24.00 to their card?". For manual pickups, it uses the existing message.

**Time off:** saving a block that overlaps paid or manual bookings shows them in a confirm: "2 paid pickups fall in this time off: … Cancel and refund them?"
- **OK** saves the block and cancels each booking through `admin/cancel`.
- **Cancel** saves nothing.

**Shop Info:**
- The require-payment switch is removed.
- Adds **Email for new orders** (`notify_email`).
- Adds a read-only line: "Online card payments: **On**" or "**Not set up yet**".

## Deploy and local setup

- **`stripe.env`** (git-ignored) holds the keys and URL:
  ```
  STRIPE_SECRET_KEY=…
  STRIPE_WEBHOOK_SECRET=…
  SITE_URL=…
  ```
  The secret key should be a Stripe **restricted key** with write access to Checkout Sessions and Refunds only.
- **`Start Website.command`** sources `stripe.env` if it's there.
- **`deploy/lunoah.service`** adds `EnvironmentFile=/opt/lunoah/stripe.env`.
- **LAUNCH-PLAN.md** gets a new section:
  - Nadia creates a Stripe account in her name with her bank for payouts.
  - Add the live webhook endpoint `https://lunoahsourdough.com/api/lunoah/stripe-webhook` with the events `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`.
  - Put the keys in `stripe.env`.
  - Set up SMTP in `/_/` (Gmail app password).
  - Place a real $1 test order and refund it.
- **NADIA-GUIDE.md**: how payments work, badges, cancelling and refunds, time off with paid orders, and where to see payouts (Stripe app).

## Testing

**Unit tests** (`node --test`):
- `shoptime`: the DST start and end days, the hours around 2 AM, and midnight.
- `order.priceLines`: price tampering is ignored, the caps apply, unknown, hidden and sold-out breads are rejected, and cents rounding is right.
- `slotIsOpen`: the hours, blocks, lead days, book-ahead and alignment checks, plus taken slots.
- `cancelDeadline`.
- `stripe.verifySignature`: a valid signature, a tampered body, a stale timestamp and a wrong secret.

**API checks** (curl):
- forged prices
- a slot outside the hours
- a third hold from the same IP
- a public create on `bookings` is denied
- a webhook with a bad signature gets 400
- calling `order` and `cancel` with a wrong token gets 404
- cancelling after the window gets 409

**End-to-end in Stripe test mode**, using the Stripe CLI `listen --forward-to` and a local Mailpit inbox for email, in a browser at 375px:
- pay with 4242 → booked page; both emails arrive; the admin shows it as paid
- a declined card, then a retry
- go back from Stripe → the hold is released and the cart is restored
- abandon → the cron releases it after it expires (tested by shortening the hold)
- webhook forwarding stopped → the booked page still confirms through a direct Stripe check
- a race: two browsers on one slot
- customer cancel inside the window → refunded; outside the window (by back-dating `paid_at`) → blocked
- Nadia cancels → refunded
- a full refund in the Stripe dashboard → the booking shows cancelled
- time off over a paid booking
- keys removed → "Online ordering is paused"

All test bookings are cleaned up afterwards.

## Out of scope

- Sales tax. Michigan generally exempts food bought to eat at home; confirm this together with the cottage food law check.
- Tracking the cottage-food sales cap.
- Chargebacks or disputes (Stripe emails Nadia).
- Customers moving their pickup time themselves.
- Partial refunds from the admin.
- Tips.
- Square or other processors.
