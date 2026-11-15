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
   Turn on the provider's weekly backups (~$1/mo). Worth it.
2. On the server:
   ```bash
   sudo mkdir -p /opt/lunoah && cd /opt/lunoah
   # use the SAME version you run locally (check with: pocketbase --version)
   curl -LO https://github.com/pocketbase/pocketbase/releases/download/v0.41.1/pocketbase_0.41.1_linux_amd64.zip
   sudo apt install -y unzip && unzip pocketbase_0.41.1_linux_amd64.zip pocketbase
   ```
3. From your Mac, copy the site up (from this folder):
   ```bash
   scp -r pb_public pb_migrations pb_hooks root@SERVER_IP:/opt/lunoah/
   scp deploy/lunoah.service root@SERVER_IP:/etc/systemd/system/
   ```
   Online ordering stays **paused** until the Stripe keys are in place (section 4).
   ```bash
   ```
   *Optional:* also copy `pb_data/` if you want to bring over the breads/photos Nadia already entered locally.
4. On the server: `sudo systemctl enable --now lunoah`
5. Create accounts on the server (the local ones don't carry over unless you copied `pb_data`):
   ```bash
   cd /opt/lunoah && ./pocketbase superuser upsert YOU@email.com 'StrongPassword' --dir=pb_data
   ```
   Then open `https://lunoahsourdoughco.com/_/` → log in → **bakers** → **New record** → Nadia's email + password.
6. Visit `https://lunoahsourdoughco.com` and `https://lunoahsourdoughco.com/admin`. Done.

**Backups:** In the dashboard (`/_/` → Settings → Backups) turn on automatic daily backups.

**Updating the site design later:** edit files in `pb_public/` locally, then `scp -r pb_public root@SERVER_IP:/opt/lunoah/`. No restart needed. If `pb_migrations` (or `pb_hooks`) changed too, copy those folders as well and restart: `sudo systemctl restart lunoah`.

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
   `checkout.session.expired` and `charge.refunded`. Copy the signing secret (`whsec_…`).
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
