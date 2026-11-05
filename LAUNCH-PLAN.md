# Lunoah Sourdough Co.: Launch Plan

Everything runs locally right now. This is how to take it live. Nothing here has been
bought or signed up for yet.

| Piece | Recommendation | Cost (approx.) |
|---|---|---|
| Order texting number | **Google Voice** (free, separate number) | $0 |
| Domain | **lunoahsourdough.com** at Cloudflare Registrar or Porkbun | ~$10–12 / year |
| Hosting | Small Linux server (DigitalOcean or Hetzner) running this folder | ~$4–6 / month |
| **Total** | | **~$60–85 / year** |

---

## 1. Order texting number: Google Voice (do this first)

**Why:** It's free, gives Nadia a real phone number separate from her personal one, and
texts arrive in the Google Voice app with normal notifications. She can reply from the app.
Her personal number stays private.

**Steps (about 10 minutes, on Nadia's phone):**
1. Install the **Google Voice** app (iPhone or Android) and sign in with a Google account.
   Ideally use a new one just for the bakery, e.g. `lunoahsourdough@gmail.com`.
2. Pick a local number when prompted.
3. Verify with her existing cell number (Google requires this, but it's never shown to customers).
4. In Google Voice settings: turn **on** text notifications. Optionally turn **off**
   "forward messages to linked numbers" so texts only appear in the Voice app.
5. Log in to `/admin` → **Shop Info** → enter the new number → **Save**.

**If she outgrows it:** **Quo (formerly OpenPhone)**, about $15–20/month, adds auto-replies
("Thanks! Got your order, we'll confirm soon"), business hours, and a shared inbox if someone
helps her. Swap the number in Shop Info, nothing else changes.

## 2. Domain: lunoahsourdough.com

Available as of Nov 5, 2026 (checked via public registry lookup). `lunoah.com` is taken.
- Buy at **Cloudflare Registrar** (at-cost pricing, free privacy) or **Porkbun**.
- Register it under Nadia's name/email so she owns it. Turn on auto-renew.
- After you have a server (step 3), add DNS records:
  - `A` record `@` → server IP
  - `A` record `www` → server IP
  - If using Cloudflare: set both to **DNS only** (grey cloud) so PocketBase can get its HTTPS certificate.

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
   *Optional:* also copy `pb_data/` if you want to bring over the breads/photos Nadia already entered locally.
4. On the server: `sudo systemctl enable --now lunoah`
5. Create accounts on the server (the local ones don't carry over unless you copied `pb_data`):
   ```bash
   cd /opt/lunoah && ./pocketbase superuser upsert YOU@email.com 'StrongPassword' --dir=pb_data
   ```
   Then open `https://lunoahsourdough.com/_/` → log in → **bakers** → **New record** → Nadia's email + password.
6. Visit `https://lunoahsourdough.com` and `https://lunoahsourdough.com/admin`. Done.

**Backups:** In the dashboard (`/_/` → Settings → Backups) turn on automatic daily backups.

**Updating the site design later:** edit files in `pb_public/` locally, then `scp -r pb_public root@SERVER_IP:/opt/lunoah/`. No restart needed.

### Simpler (less control) alternative
**PocketHost.io** is managed PocketBase hosting: no server to look after. Upload `pb_public` and
`pb_migrations` through their dashboard. Check their current pricing and custom-domain support before choosing it.

## 4. Launch checklist
- [ ] Google Voice number set up and entered in Shop Info
- [ ] Domain bought in Nadia's name, auto-renew on
- [ ] Server running, `https://` works for both `lunoahsourdough.com` and `www`
- [ ] Nadia's login created, she's changed her password (Shop Info → Change my password)
- [ ] Sample breads replaced with real ones and real photos
- [ ] Test order: add loaves on your phone → Text my order → arrives in Google Voice
- [ ] Automatic backups on
