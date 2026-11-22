# Lunoah Sourdough Co.: Launch Plan

Everything runs locally right now. This is how to take it live. Nothing here has been
bought or signed up for yet.

| Piece | Recommendation | Cost (approx.) |
|---|---|---|
| Shop phone (customer questions) | **Google Voice** (free, separate number) | $0 |
| Domain | **lunoahsourdoughco.com** at Namecheap ✅ bought | ~$10–15 / year |
| Hosting | Small Linux server (DigitalOcean or Hetzner); it installs the site from GitHub | ~$4–6 / month |
| Card payments | **Stripe** (no monthly fee) | ~2.9% + 30¢ per order |
| **Total** | | **~$60–85 / year** |

---

## 1. Shop phone number: Google Voice (do this first)

**Why:** It's free, gives Nadia a real phone number separate from her personal one, and
texts arrive in the Google Voice app with normal notifications. She can reply from the app.
Her personal number stays private.

**Steps (about 10 minutes, on Nadia's phone):**
1. Install the **Google Voice** app (iPhone or Android) and sign in with a Google account.
   Use the bakery's Gmail account (already created ✅).
2. Pick a local number when prompted.
3. Verify with her existing cell number (Google requires this, but it's never shown to customers).
4. In Google Voice settings: turn **on** text notifications. Optionally turn **off**
   "forward messages to linked numbers" so texts only appear in the Voice app.
5. Log in to `/admin` → **Shop Info** → enter the new number → **Save**.

**If she outgrows it:** **Quo (formerly OpenPhone)**, about $15–20/month, adds auto-replies
("Thanks! Got your order, we'll confirm soon"), business hours, and a shared inbox if someone
helps her. Swap the number in Shop Info, nothing else changes.

## 2. Domain: lunoahsourdoughco.com ✅ bought (Namecheap)

- Make sure **auto-renew** is on and **domain privacy** (Withheld for Privacy, free at Namecheap) is on.
- The account should be in Nadia's name, or transferred to her later, so she owns it.
- After you have a server (step 3): Namecheap → Domain List → **Manage** → **Advanced DNS**.
  Delete the default parking records (the `CNAME www` → parkingpage and the `URL Redirect` for `@`), then add:
  - `A Record`, host `@`, value = server IP, TTL Automatic
  - `A Record`, host `www`, value = server IP, TTL Automatic
  DNS changes usually take a few minutes (up to an hour). PocketBase then gets the HTTPS certificate by itself.

## 3. Hosting: one small server

The whole site is a single program (PocketBase) plus the code on GitHub. PocketBase gets and renews the
HTTPS certificate on its own, so no extra web server is needed. **Everything below is done in a web browser**
(any computer or phone), so no work computer is involved. The server pulls the site from GitHub itself.

1. Create a server: **Ubuntu 24.04, smallest plan** (DigitalOcean "Basic" ~$6/mo, or Hetzner CX22 ~€4/mo).
   For login, choose **password** (or an SSH key from a personal computer, if you have one). Turn on the
   provider's weekly backups (~$1/mo). Note the server's **IP address**.
2. Open the server's **web console** (DigitalOcean: the droplet → **Console**; Hetzner: the server → **>_** icon)
   and paste:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Mhouranix1125/Lunoah-Sourdough-Co/main/deploy/install.sh | sudo bash
   ```
   It installs PocketBase 0.41.1, downloads the site from GitHub, opens the firewall for web traffic and starts
   the site. A brand-new server starts with Nadia's real menu, shop text and pickup hours (from the repo).
3. Still in the console, create your site-admin login (the script prints this line for you):
   ```bash
   sudo /opt/lunoah/pocketbase superuser upsert YOU@example.com 'A-Strong-Password' --dir=/opt/lunoah/pb_data
   ```
4. Point the domain at the server (section 2, Advanced DNS). Once DNS has updated, visit
   `https://lunoahsourdoughco.com`. The first visit can take ~10 seconds while it gets the HTTPS certificate.
5. At `https://lunoahsourdoughco.com/_/` log in → **bakers** → **New record** → Nadia's email and a password.
6. Nadia logs in at `/admin` and fills in what the repo leaves out on purpose (it's public):
   the **shop phone** (Google Voice) and **email for new orders** in Shop Info, her **photo** and story in
   Meet Nadia, and the Venmo/Zelle QR codes in Payment apps if she wants them.

**Backups:** In the dashboard (`/_/` → Settings → Backups) turn on automatic daily backups.

**Updating the site later:** push the change to `main` on GitHub, then paste the **same line from step 2**
into the server's console. It swaps in the new code and restarts; orders, breads and photos are untouched.
If the new version doesn't start cleanly, it puts the previous version back by itself and shows the error.

### Simpler (less control) alternative
**PocketHost.io** is managed PocketBase hosting: no server to look after. Upload `pb_public`, `pb_migrations` and
`pb_hooks` (the pickup calendar needs it) through their dashboard. Check their current pricing and custom-domain support before choosing it.

## 4. Card payments (Stripe) and order emails

Customers pay in full by card, Apple Pay or Google Pay when they order. A pickup time is booked only
after Stripe confirms the payment. Without the steps below, the site shows "Online ordering is paused".

1. **Nadia signs up at stripe.com in her own name.** Business type: Individual / sole proprietor. Add her bank
   account for payouts. Set the statement descriptor to `LUNOAH SOURDOUGH` (what shows on card statements).
   Install the **Stripe** app on her phone to see payments and payouts.
2. **API key:** Developers → API keys → **Create restricted key**. Give it **Write** on *Checkout Sessions* and
   *Refunds*, and nothing else. Copy the key (`rk_live_…`).
3. **Webhook:** Developers → Webhooks → **Add endpoint**
   `https://lunoahsourdoughco.com/api/lunoah/stripe-webhook`, events `checkout.session.completed`,
   `checkout.session.expired`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed` and `charge.refunded`. Copy the signing secret (`whsec_…`).
   **Payment methods:** Settings → Payment methods. Stripe decides which ways to pay appear at checkout from
   here (the site can't). Recommended: keep **Cards** (includes Apple Pay and Google Pay) and **Link**; turn
   **off Bank / ACH** (settles days later) and **Klarna / Affirm** (much higher fees). Cash App Pay and Amazon Pay
   are optional. The site copes safely with any of them (a slow payment holds the time until it clears).
4. **On the server:** create `/opt/lunoah/stripe.env` (see `stripe.env.example`):
   ```bash
   sudo tee /opt/lunoah/stripe.env >/dev/null <<'EOF'
   STRIPE_SECRET_KEY=rk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   SITE_URL=https://lunoahsourdoughco.com
   EOF
   sudo chmod 600 /opt/lunoah/stripe.env
   sudo systemctl daemon-reload && sudo systemctl restart lunoah
   ```
   Admin → **Shop Info** should now say "Online card payments: **On**".
5. **Emails** (order notices to Nadia, confirmations with the cancel link to customers):
   ✅ Done, sent through **Brevo**. `/_/` → Settings → Mail settings holds Brevo's SMTP relay details
   (host `smtp-relay.brevo.com`, port `587`, Brevo SMTP login and key, from the Brevo dashboard → SMTP & API).
   If emails stop, check the Brevo dashboard first (sending limits, sender/domain verification), then
   **Send test email** in the PocketBase dashboard. Admin → **Shop Info** → **Email for new orders** sets where Nadia's notices go.
6. **Real test:** order the cheapest loaf with a real card. Check that both emails arrive, then use the
   **Cancel my order** link in the confirmation email and confirm the refund shows in Stripe.

## 5. Launch checklist
- [ ] Google Voice number set up and entered in Shop Info
- [x] Domain bought (lunoahsourdoughco.com, Namecheap); auto-renew + privacy on
- [x] Server running, `https://` works for both `lunoahsourdoughco.com` and `www`
- [x] Nadia's login created (she still changes her password herself) (Shop Info → Change my password)
- [ ] Sample breads replaced with real ones and real photos
- [x] Stripe account in Nadia's name, live keys + webhook set, "Online card payments: On"
- [x] Order emails set up (SMTP)
- [ ] Real order placed, cancelled and refunded; both emails arrive
- [x] Automatic backups on (daily, keep 7)
- [ ] Off-server copy of backups (S3: Backblaze B2 or Cloudflare R2)

## 6. Leaving this Mac (after launch)

This Mac is never needed for the live site: the code is on GitHub (`Mhouranix1125/Lunoah-Sourdough-Co`),
the server pulls it from there, and the live data lives on the server. Once the live site works:
- [ ] Live site checked: menu, Nadia's login, a real order and refund all work
- [ ] Server backups on (provider weekly + PocketBase daily)
- [ ] `git status` clean and `git push` done
- [ ] `stripe logout` (the Stripe tool's login), then delete `stripe.env` (test keys only)
- [ ] Delete `pb_data/` and `.superpowers/` (local test copies of the database)
- [ ] Delete this folder. To work on the site from another computer: `git clone` the repo and `brew install pocketbase`.

## 7. Michigan cottage food rules (checked 2026-11-15)

From MDARD's Cottage Food FAQ (michigan.gov/mdard → Cottage Food):
- **Sales cap:** $50,000 gross per year since March 24, 2026 (was $25,000). Keep sales records; MDARD can ask for them.
- **Selling online is allowed** if the customer can talk to Nadia before buying. The site shows
  "Questions? Text Nadia at …" on the page and at checkout, so keep a phone number in Shop Info.
- **Only foods that don't need refrigeration.** MDARD lists meat and dairy (cheese) as not allowed.
  **Pepperoni & Cheese Loaf likely doesn't qualify.** Ask MDARD (800-292-3939, MDARD-CottageFood@michigan.gov)
  before selling it, or hide it in the admin until they confirm.
- **Labels:** every loaf needs a printed label (name and address of the business, ingredients by weight, allergens,
  and the "Made in a home kitchen…" statement). Check MDARD's labeling guide for exact wording before printing.
- Local zoning rules may also apply; check with the city/township.

## 8. Backlog (later)

- **Promotional emails to past customers (Brevo).** Don't send them from the Proton inbox: it isn't
  allowed for bulk mail and has no unsubscribe link. Use Brevo, which already sends the order emails
  and has the domain verified (free plan: 300 emails/day, newsletter editor, automatic unsubscribe).
  Site work when we pick this up:
  1. Checkout checkbox: "Email me about new breads and specials" (saved on the order).
  2. Admin "Download mailing list" button: CSV of opted-in customers (name, email, last order date)
     to import into Brevo.
  3. Optional later: add opt-ins to the Brevo list automatically instead of downloading.
  Every promotional email needs an unsubscribe link, the business's postal address and an honest
  subject line (CAN-SPAM); Brevo adds the first two.
- **Shop phone number.** Google Voice wouldn't verify the bakery account; customers reach Nadia by
  email for now. Options: Google Voice on an older Google account, a second line on her phone
  (Tello / US Mobile eSIM), or Quo (formerly OpenPhone).
- **Off-server copy of backups** (PocketBase → Settings → Backups → S3: Backblaze B2 or Cloudflare R2).
- **Update Nadia's PowerPoint guide:** new login (the Proton address), Orders, Sales, Adjust photo,
  the "Fresh from the oven" photo, phone-order payments.
