# Lunoah Sourdough Co.: Launch Plan

Everything runs locally right now. This is how to take it live. Nothing here has been
bought or signed up for yet.

| Piece | Recommendation | Cost (approx.) |
|---|---|---|
| Shop phone (customer questions) | **Google Voice** (free, separate number) | $0 |
| Domain | **lunoahsourdoughco.com** at Namecheap ✅ bought | ~$10–15 / year |
| Hosting | Small Linux server (DigitalOcean or Hetzner) running this folder | ~$4–6 / month |
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

The whole site is a single program (PocketBase) plus this folder. PocketBase gets and renews the
HTTPS certificate on its own, so no extra web server is needed.

1. Create a server: **Ubuntu 24.04, smallest plan** (DigitalOcean "Basic" ~$6/mo, or Hetzner CX22 ~€4/mo).
   When it asks how to log in, choose **SSH key** and add this Mac's key (`cat ~/.ssh/id_ed25519.pub`;
   if that file doesn't exist, run `ssh-keygen -t ed25519` first). Turn on the provider's weekly backups (~$1/mo).
   Note the server's **IP address**.
2. Check you can log in: `ssh root@SERVER_IP` (type `yes` the first time, then `exit`).
3. From this folder on the Mac, put the site up, **including** the breads, photos and Nadia's login:
   ```bash
   deploy/deploy.sh SERVER_IP --with-data
   ```
   The script runs the tests, installs PocketBase 0.41.1 (the same version as the Mac), opens the
   firewall for web traffic, copies everything up and starts the site. It never uploads `stripe.env`.
   Online ordering stays **paused** until the live Stripe keys are on the server (section 4).
4. Point the domain at the server (section 2, Advanced DNS). Once DNS has updated, visit
   `https://lunoahsourdoughco.com`. The first visit can take ~10 seconds while it gets the HTTPS certificate.
5. Log in at `https://lunoahsourdoughco.com/_/` with the site-admin account and **change its password**
   (the local one was only for testing). Nadia logs in at `/admin` and changes hers (Shop Info → Change my password).

**Backups:** In the dashboard (`/_/` → Settings → Backups) turn on automatic daily backups.

**Updating the site later:** commit the change, then from this folder run `deploy/deploy.sh SERVER_IP`
(without `--with-data`). It replaces the site files and restarts; orders, breads and photos on the server are
untouched. It refuses `--with-data` once the server has its own database, so live orders can't be overwritten.

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
   `/_/` → Settings → Mail settings → turn on SMTP. With the bakery Gmail: host `smtp.gmail.com`, port `587`,
   username = the Gmail address, password = a Google **app password** (Google Account → Security → App passwords).
   Sender name `Lunoah Sourdough Co.`, sender address = the Gmail address. Click **Send test email**.
   Then in Admin → **Shop Info**, set **Email for new orders**.
6. **Real test:** order the cheapest loaf with a real card. Check that both emails arrive, then use the
   **Cancel my order** link in the confirmation email and confirm the refund shows in Stripe.

## 5. Launch checklist
- [ ] Google Voice number set up and entered in Shop Info
- [x] Domain bought (lunoahsourdoughco.com, Namecheap); auto-renew + privacy on
- [ ] Server running, `https://` works for both `lunoahsourdoughco.com` and `www`
- [ ] Nadia's login created, she's changed her password (Shop Info → Change my password)
- [ ] Sample breads replaced with real ones and real photos
- [ ] Stripe account in Nadia's name, live keys + webhook set, "Online card payments: On"
- [ ] Order emails arrive (Nadia + customer); a real order placed, cancelled and refunded
- [ ] Automatic backups on
- [ ] Pepperoni & Cheese settled with MDARD (or hidden); loaf labels printed (section 7)

## 6. Leaving this Mac (after launch)

Once the live site works, nothing important should live only on this Mac. The code is on GitHub
(`Mhouranix1125/Lunoah-Sourdough-Co`); the live data is on the server.
- [ ] Live site checked: breads, photos, Nadia's login, a real order and refund all work
- [ ] Server backups on (provider weekly + PocketBase daily)
- [ ] `git status` clean and `git push` done
- [ ] `stripe logout` (the Stripe tool's login), then delete `stripe.env` (test keys only)
- [ ] Delete `pb_data/` and `.superpowers/` (old local copies of the database; the server has the real one)
- [ ] Delete this folder, or keep a fresh `git clone` wherever development continues.
      To work on the site from another computer: `git clone`, `brew install pocketbase`, add that computer's SSH key to the server.

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
