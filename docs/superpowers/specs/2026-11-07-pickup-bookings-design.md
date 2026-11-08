# Pickup Bookings (one customer per slot): Design

**Date:** 2026-11-07
**Status:** Approved in chat, ready for implementation plan
**Builds on:** `docs/superpowers/specs/2026-11-07-pickup-scheduling-design.md` (calendar, hours, time off)

## Goal

Each pickup time can be booked by **one customer only**. Slots are **15 minutes** by default,
and Nadia can never set them shorter. A booked time disappears for everyone else. Nadia sees
upcoming bookings in her portal and can **cancel** any of them, which frees the time.

## Decisions

| Topic | Decision |
|---|---|
| Capacity | One booking per (date, time). The **database enforces this** with a unique index, so two customers tapping at the same moment can't both get the slot. |
| Slot length | Default **15** minutes. Choices stay 15 / 30 / 60, so the minimum is 15. The existing shop record changes from 30 to 15. |
| When a slot is reserved | When the customer taps **Open Messages** or **Copy order** in step 3 (send). The booking is saved *before* Messages opens or the text is copied. |
| Lost race | The server rejects a duplicate. The customer sees "Sorry, 9:15 AM was just taken. Please pick another time." and returns to step 1 with the calendar refreshed. Their name, notes and payment confirmation stay filled in. |
| Other save failure | "We couldn't save your pickup time. Please check your connection and try again." Messages does not open. |
| Same customer taps twice | The site remembers the slot it booked for this order code in this checkout session and doesn't book it again. If they change the time after booking, a new booking is made. The old one stays until Nadia cancels it, which is acceptable at this scale. |
| Privacy | The public can **create** bookings but can't list or read them. Customers learn only which date and time pairs are taken, through a small read-only endpoint. Names and items are visible only to bakers. |
| Free-text fallback | When the calendar isn't in use (pickup data failed to load), no booking is created. That's the existing behaviour. |
| Nadia cancels | Cancel = delete the booking record, after a confirm prompt. The slot reappears for customers the next time they open checkout. |
| Abuse | Not handled now (local only). Before going public, add rate limiting or a captcha. Noted for the launch plan. |

## Data (new migration `1762700000_bookings.js`)

**`bookings`** collection:
- `date` text `YYYY-MM-DD`, required (same pattern as `pickup_blocks`)
- `time` text `HH:MM`, required
- `name` text, required, max 100
- `items` text, max 1000 (e.g. "2 × Seeded Whole Wheat, 1 × Country Loaf")
- `total` number, min 0
- `order_code` text, max 20
- `created` autodate
- Unique index: `CREATE UNIQUE INDEX idx_bookings_slot ON bookings (date, time)`
- Rules: `createRule: ""` (anyone); list, view, update and delete are bakers only.

The migration also sets the existing shop record's `slot_minutes` to 15. The down migration deletes the collection and sets `slot_minutes` back to 30.

## Server endpoint (new `pb_hooks/bookings.pb.js`)

`GET /api/lunoah/taken?from=YYYY-MM-DD` → `{ "taken": [{ "date": "2026-11-13", "time": "09:15" }, ...] }`
- `from` must match `^\d{4}-\d{2}-\d{2}$`, otherwise 400. It returns bookings with `date >= from`, sorted, with no other fields.
- The client passes the shop's "today" (from `slots.js`).

## Slot logic (`slots.js`)

`availableSlots({ ..., taken = [] })` takes a new optional input, `taken`: an array of `{date, time}`. Any slot whose
date and time match a taken pair is removed. Dates left with no slots disappear, as before.
New unit tests:
- a taken slot is removed
- all slots taken removes the date
- taken pairs on other dates don't affect a day
- the default (no `taken`) behaves as before

## Customer checkout (`site.js`)

- Load taken slots together with hours and blocks: `/api/lunoah/taken?from=<today>`. Pass them as `taken`.
  If that request fails, treat the picker as unavailable and fall back to the free-text box, so customers
  are never offered times that might be taken.
- Re-fetch taken slots every time checkout opens, so a reopened dialog is current.
- On **Open Messages** / **Copy order**, when the calendar is in use and this slot isn't already booked for this order:
  POST to `/api/collections/bookings/records` with `{date, time, name, items, total, order_code}`.
  - Any 2xx response means booked: remember `bookedKey = date + " " + time` and continue to Messages or copy.
  - A 400 whose error data flags `date` or `time` as not unique means the slot was taken: show the "just taken"
    message, refresh the taken slots, clear the chosen time, and go to step 1.
  - Any other failure shows the connection message and stays on step 3.
- While the save is in progress, disable both send buttons ("Saving your pickup time…").

## Admin (`pickup-admin.js`, Pickup Times tab)

New first section, **Upcoming pickups**:
- Lists bookings with `date >= today`, sorted by date and time, grouped by day under headings like "Fri, Nov 13".
- Each row shows the time, the name, the items, the total and the order code, plus a **Cancel** button.
- Cancel asks to confirm with "Cancel Sam Rivera's 9:15 AM pickup on Fri, Nov 13? That time will open up for other customers.", then deletes the booking and shows the toast "Pickup cancelled. 9:15 AM is open again."
- With no bookings, it shows: "No upcoming pickups yet."
- The "What customers can pick now" preview also excludes booked times.
- Bookings reload together with the rest of the tab, and after each cancel.

## Guide (`NADIA-GUIDE.md`)

Add a short "Upcoming pickups & cancelling" part to the pickup section: each time can be booked by one customer, bookings appear under **Upcoming pickups**, and **Cancel** frees the time (for example if someone never texted).

## Testing

- `node --test` for the new `slots.js` cases.
- Hook and rules, checked with curl:
  - an anonymous create succeeds
  - a duplicate create returns 400 (not unique)
  - an anonymous list or view is denied
  - `/api/lunoah/taken` returns only dates and times
  - a bad `from` returns 400
- Browser checks (CDP) at 320 and 375px:
  - book Fri 9:15, then reopen checkout: 9:15 is gone
  - race: book a slot through the API while a second checkout still shows it, then send from that checkout. The "just taken" message appears and the customer returns to step 1 with their details kept
  - admin shows the booking; Cancel frees it and it reappears on the storefront
- Clean up all test bookings and temporary accounts afterwards.

## Out of scope

Customer confirmations or reminders, letting customers cancel their own booking, spam protection, and booking history or reports.
