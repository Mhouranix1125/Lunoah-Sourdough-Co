# Site Text, Seasonal Themes & Manual Bookings: Design

**Date:** 2026-11-07
**Status:** Approved in chat, ready for implementation plan

Three related changes:
- **(A)** customer-facing text Nadia can edit
- **(B)** seasonal themes for the customer site and the admin page
- **(C)** Nadia adds a booking herself

## A. Editable site text

New `shop` fields (all editable in **Shop Info**):

| Field | Type | Initial value |
|---|---|---|
| `pickup_location` | text, max 120 | `Dearborn Park, Dearborn, MI` |
| `order_received` | text, max 300 | `Your order has been received. Nadia will reach out to you shortly.` |
| `allergy_note` | text, max 600 | `Our breads are baked in a home kitchen that also handles wheat (gluten), sesame, tree nuts, peanuts, milk, eggs and soy. We can't guarantee any bread is free of allergens. If you have a severe allergy, please text Nadia before ordering.` |

The migration also replaces the existing `pickup_info` text (which still says Fridays & Saturdays 9–1) with:
`Nadia will text you the exact meeting spot when she confirms your order.`
`order_note` is left unchanged. It is Nadia's text, and the guide already tells her to keep it in step.

Where it shows:
- **How to order → Pick up:** a "📍 {pickup_location}" line with a **Map** link to
  `https://www.google.com/maps/search/?api=1&query=<encoded pickup_location>`, followed by `pickup_info`, then
  the fixed line: *"Running late or need to change your pickup? Text Nadia and she'll sort it out with you."*
- **Checkout step 1:** a small line under the pickup summary: *"Pickup at {pickup_location}."*
- **Checkout step 3:** after a successful **Open Messages** or **Copy order**, a highlighted box shows
  `order_received` plus the fixed line *"Make sure you pressed send in Messages."* It is hidden when
  the customer goes back a step or reopens checkout.
- **Allergy note:** a short notice under the bread grid and in the footer. Hidden when empty.
- **Order text message:** adds `Pickup at: {pickup_location}` under the `Pickup:` line.

Empty fields hide their element, and nothing breaks. All values are rendered with `textContent`.

## B. Seasonal themes

`shop.theme`: a select with `basic` (default), `halloween`, `thanksgiving` and `christmas`. In **Shop Info**, a
**Theme** dropdown with a row of 4 small colour previews under it. Saving applies the theme to the
customer website and to the admin page.

**Mechanism:** a new shared `pb_public/themes.css` holds the theme palettes as CSS variable overrides
on `html[data-theme="…"]`. Both pages load it after their own stylesheet. A tiny `pb_public/theme.js`, loaded in
`<head>` on both pages:
- Applies the last-used theme from `localStorage` (key `lunoah_theme`) immediately, so the page doesn't
  flash the basic colours.
- Exposes `window.LunoahTheme.apply(name)`, which sets `document.documentElement.dataset.theme` and stores
  it. Unknown names fall back to `basic`.

`site.js` and `admin.js` call `LunoahTheme.apply(shop.theme)` once the shop record has loaded. The admin
login screen loads the shop record publicly, so it is themed too.

**Colour variables.** Hard-coded colours in `styles.css` and `admin.css` that need to change per theme
become variables, chiefly `#fff` card and input backgrounds → `--card`. Variables used by both files:
`--paper`, `--cream`, `--line`, `--ink`, `--muted`, `--crust`, `--crust-dark`, `--card`, `--accent`, `--on-crust`
(text on buttons), `--pattern-filter`, `--theme-icon`. Status colours (`--danger`, `--ok`) and the
payment-app logo colours stay fixed.

| Theme | paper | card | ink | muted | crust (buttons) | accent | icon | notes |
|---|---|---|---|---|---|---|---|---|
| Basic | #fbf7f0 | #ffffff | #2a1f16 | #7b6a5a | #8a5428 | #8a5428 | — | today's look, pixel-identical |
| Halloween | #1c1a1f | #2a2630 | #f4ece1 | #b8aec4 | #e8731a | #8e5bd6 | 🎃 | dark; sketch pattern inverted (`--pattern-filter: invert(1)`) |
| Thanksgiving | #fbf3e6 | #fffaf2 | #3a2414 | #7d5a3c | #b5541c | #8c2f39 | 🍂 | harvest gold `--cream: #f4e2bf` |
| Christmas | #fbfbf8 | #ffffff | #1f2a24 | #5f6e66 | #1f6b45 | #b3202f | 🎄 | gold line `--line: #e7dcc0` |

Exact secondary values (`--cream`, `--line`, `--crust-dark`, `--on-crust`) are chosen during implementation, with the constraint that
body text and button text meet **WCAG AA contrast (4.5:1)**. The implementer reports the measured ratios.
The icon appears after the logo text ("Lunoah 🎃") on both pages, via `::after { content: var(--theme-icon) }`.
The layout, fonts, sketch background, photos and payment logos don't change.

## C. Nadia adds a pickup

Under **Upcoming pickups**, an **＋ Add pickup** button opens a dialog with these fields:
- **Day:** a select of the next open dates, computed by `slots.js` with `leadDays: 0`, so Nadia can book
  same-day or tomorrow, which customers can't. Existing bookings and time off are removed.
- **Time:** a select of that day's free times. It updates when the day changes.
- **Name:** required, max 100.
- **Note:** optional, e.g. "2 country loaves, phone order". Stored in `items`.

Save creates the booking (`order_code` = `PHONE`, `total` = 0) through the same `bookings` collection as an authenticated baker.
A unique conflict shows "That time was just taken. Please pick another." and refreshes the times. Success shows the toast
"Pickup added." and reloads the list and preview. If there are no open times, the dialog says so.

## Testing

- Unit: none new for themes. If a helper is added to `slots.js` for the admin day list, it gets a test.
- Browser (CDP, 375px, and 320px for overflow), for each theme:
  - storefront home, checkout step 1, admin Pickup Times
  - screenshots saved for the user, and contrast ratios reported
- Basic theme: a before/after screenshot comparison shows no visible change.
- Text: the location and map link, the order-received box after send, and the allergy note in both places. Editing the fields in Shop Info updates the site.
- Manual booking: add a pickup → it appears in the list, disappears from the storefront times, and Cancel works. A duplicate gives the conflict message.
- Live hours and settings (Tue 09:00–17:00, Wed 09:00–13:00, lead 2, slot 15, ahead 7) stay unchanged.
  The theme ends on **basic**. Test bookings and temporary accounts are removed. If removal is blocked by permissions, say so and list what's left.

## Out of scope

Automatic theme switching by date, custom themes, and per-bread allergen tags.
