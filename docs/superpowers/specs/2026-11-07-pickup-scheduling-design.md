# Pickup Scheduling: Design

**Date:** 2026-11-07
**Status:** Approved in chat, ready for implementation plan

## Goal

Replace the free-text "Pickup day" field at checkout with a calendar and time picker that works
well on phones. It only offers times Nadia has opened, at least 2 days after the order, with
her lockouts (vacations, days off, single busy hours) removed. Nadia manages all of this from
a new **Pickup Times** tab in her admin portal.

## Decisions

| Topic | Decision |
|---|---|
| Slot capacity | Unlimited. Any number of customers may choose the same slot. Orders are still texted and not stored, so the site cannot count bookings. Nadia locks out a slot if it gets too busy. A per-slot limit can come later (it would require storing orders). |
| Minimum notice | `lead_days`, default **2**, counted in **calendar dates**. An order placed any time Monday can be picked up from Wednesday. Editable by Nadia. |
| Lockouts | Layered on top of hours and minimum notice. A lockout covers a single date or a date range, either all day or a from–to time window. |
| "Back from vacation, no orders for 3 days" | Covered by extending the lockout range. No separate feature. |
| Booking horizon | `book_ahead_days`, default **21**. Days beyond it are greyed out. |
| Slot length | `slot_minutes`, default **30** (choices: 15, 30, 60). |
| Time zone | All dates and times are the shop's local time (`America/Detroit`). "Today" is computed in that zone, so a customer whose phone is set to another zone still sees correct availability. Dates are stored as `YYYY-MM-DD` and times as `HH:MM` strings, so no timezone conversion happens in storage. |
| Enforcement | Client-side only. Orders are a text message, so nothing exists on the server to validate. Nadia sees the chosen time in the text. |

## Data (new migration `1762600000_pickup.js`)

All new collections follow the existing pattern: public read, write restricted to `bakers`.

**`pickup_hours`**: Nadia's regular weekly hours. One record per open time block.
- `weekday` number 0–6 (0 = Sunday), required
- `start` text `HH:MM`, required
- `end` text `HH:MM`, required, must be after `start`
- Several records may share a weekday (e.g. morning and evening blocks).
- Seed: Fri 09:00–13:00 and Sat 09:00–13:00, matching the current `pickup_info` text.

**`pickup_blocks`**: lockouts.
- `start_date` text `YYYY-MM-DD`, required
- `end_date` text `YYYY-MM-DD`, required (equal to `start_date` for a single day)
- `all_day` bool
- `from` / `to` text `HH:MM`, used only when `all_day` is false; applies on each date in the range
- `note` text, max 200. Shown only in the admin UI.

**`shop`**: new number fields `lead_days` (default 2), `slot_minutes` (default 30) and
`book_ahead_days` (default 21).

## Slot logic: `pb_public/slots.js`

A pure function shared by the storefront and the admin preview, with no DOM and no fetch:

```
availableSlots({ hours, blocks, leadDays, slotMinutes, bookAheadDays, now, tz })
  → [{ date: "2026-11-13", times: ["09:00","09:30",...] }, ...]   // only dates with ≥1 slot
```

Rules, applied in order:
1. Candidate dates run from `today + leadDays` to `today + bookAheadDays`, where today is in `tz`.
2. For each date, build slots from that weekday's hours blocks in `slotMinutes` steps. A slot
   must fit fully inside its block: a 9:00–13:00 block gives 9:00 … 12:30.
3. Drop slots that overlap any lockout covering that date: all day, or `[from, to)` overlapping `[slot, slot+len)`.
4. If `leadDays` is 0, also drop slots that start before the current time on today's date.
5. Leave out dates with no slots remaining.

It is exported for the browser (a `window.LunoahSlots` global) and for Node (`module.exports`), so it can be tested with `node --test`.

## Customer checkout (step 1 of the order dialog)

- Replace `<input id="o-day">` with a **Pickup time** picker:
  - Month calendar: a 7-column grid, prev/next month arrows, today ringed. Dates that are not
    in `availableSlots` are greyed out and can't be tapped. Arrows are disabled outside the bookable range.
  - On first open, it shows the month of the first available date, with that date selected.
  - When a date is selected, its time slots show below the calendar as a wrapping row of
    tap-sized buttons (minimum 44px tall), e.g. "9:00 AM".
  - A summary line under the picker reads: "Saturday, Nov 14 at 10:00 AM".
- "Continue" stays disabled until a date and time are chosen. The name is still checked when it's tapped, as it is today.
- If there are no available dates at all, show: "No pickup times are open right now. Please
  check back soon." and keep Continue disabled.
- The text message line becomes `Pickup: Saturday, Nov 14 at 10:00 AM`.
- Fits without horizontal scroll at 320px. Each calendar cell is at least 40px.
- The public "How to order" section keeps showing `pickup_info` (address and so on) unchanged.

## Admin: new "Pickup Times" tab

Order of tabs: My Breads · Shop Info · **Pickup Times** · Payments.

1. **Regular hours.** One row per weekday with an on/off switch. When on, it shows one or more
   start–end time blocks, a "＋ add hours" link and a remove (×) on each block. Saving replaces that weekday's records.
2. **Time off.** A list of upcoming lockouts, e.g. "Dec 20 – Jan 2 · All day · Vacation", each with Delete.
   "＋ Add time off" opens a dialog with: start date, end date (defaults to the start date), an "All day"
   checkbox (on by default), from/to times when it is off, and a note. Lockouts that have already ended are hidden.
3. **Settings.** Minimum notice (days), slot length (15/30/60), book ahead (days).
4. **Preview.** "Customers can currently pick: Fri Nov 13 (8 times), Sat Nov 14 (8 times)…",
   computed with the same `slots.js`, so Nadia can confirm what customers see.

Admin validation: end time after start time, end date on or after start date, numbers in range
(lead 0–30, ahead 1–90, and ahead ≥ lead).

## Error handling

- If loading hours or blocks fails on the storefront, fall back to the old free-text "Pickup day"
  input, so ordering never breaks.
- Admin save failures use the existing toast pattern.

## Testing

- `node --test` unit tests for `slots.js`:
  - the lead-days boundary, both at the start of a day and late at night
  - block edges (last slot fits, first slot after the end)
  - a single-day lockout, a multi-day range, and a partial-time lockout
  - a range that crosses a month boundary
  - DST weekends
  - a weekday with two blocks
  - an empty result
- Browser check via CDP emulation at 320, 375 and 768px:
  - the calendar has no horizontal overflow
  - greyed-out dates can't be tapped
  - a full checkout produces the correct `Pickup:` line
  - the admin tab works at phone width

## Out of scope

Per-slot booking limits, storing orders, customer reminders, and the PowerPoint guide (that comes
after all current features are finished).
