# Lunoah Sourdough Co. Website

A simple bakery website with an easy admin page for Nadia, and ordering by text message.

## Run it on this Mac
1. Double-click **`Start Website.command`**. Keep that window open. It opens the admin page.
2. **First time only:** the admin page shows **"Welcome! Create your login"**. Fill it in.
   (For safety this only works on the computer running the site, and only while no login exists.
   `Setup Accounts.command` can also create or reset logins anytime.)
   - Website: http://localhost:8090
   - Nadia's admin: http://localhost:8090/admin
   - Full database dashboard (technical): http://localhost:8090/_/

If macOS blocks the `.command` file the first time: right-click → **Open** → **Open**.

Requires PocketBase: `brew install pocketbase` (already installed on this Mac).

## What's where
| Path | What it is |
|---|---|
| `pb_public/` | The public website (`index.html`, `styles.css`, `site.js`) and Nadia's admin (`admin/`) |
| `pb_migrations/` | Database layout + sample breads (applied automatically on start) |
| `pb_data/` | The actual data: breads, photos, accounts. **Back this up. Don't commit it.** |
| `deploy/` | Server service file for going live |
| `NADIA-GUIDE.md` | Plain-language guide for Nadia |
| `LAUNCH-PLAN.md` | Domain, hosting and texting number: what to buy and how to go live |

## How it works
- **PocketBase** (single program) stores breads, shop info and photos, handles logins, and
  auto-creates photo thumbnails. No other server software, no build step.
- Public site reads breads/shop info from PocketBase's API. Hidden breads are filtered server-side.
- Only accounts in the `bakers` collection can edit; public sign-up is disabled.
- Photos are shrunk in the browser (max 1600px JPEG) before upload, so huge phone photos are fine.
- Ordering: customers pick quantities → **Text my order** opens their texting app with the order
  pre-filled to the number in Shop Info. Desktop users get a "Copy order" button.
