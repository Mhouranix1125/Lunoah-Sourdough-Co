// Emails sent with PocketBase's mailer (SMTP set in /_/ → Settings → Mail settings).
// A failed email is logged and never undoes an order.
function money(c) { return "$" + (c / 100).toFixed(2); }
function lineText(lines) {
  return lines.map(function (l) { return "• " + l.qty + " × " + l.name + " (" + money(l.qty * l.price_cents) + ")"; }).join("\n");
}
function parseLines(rec) {
  try { return JSON.parse(toString(rec.get("lines")) || "[]") || []; } catch (_) { return []; }
}
function site() { return $os.getenv("SITE_URL"); }
function shop() { return $app.findFirstRecordByFilter("shop", "id != ''"); }

function nadiaAddresses() {
  var s = shop().getString("notify_email");
  if (s) return [s];
  return $app.findAllRecords("bakers").map(function (r) { return r.getString("email"); }).filter(Boolean);
}

// How customers reach Nadia: by email (her phone number is never shared).
function askLine(s) {
  var mail = s.getString("contact_email");
  return mail ? "Questions? Email Nadia at " + mail + " or just reply to this email." : "Questions? Just reply to this email.";
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
    "\n\nSee all your orders: " + site() + "/admin#orders");

  var email = rec.getString("email");
  if (!email) return;
  var deadline = O.cancelDeadline(rec.getInt("paid_at"), T.shopToUtc(rec.getString("date"), rec.getString("time")));
  var loc = s.getString("pickup_location");
  var allergy = s.getString("allergy_note");
  send([email], "You're booked for " + when,
    "Hi " + name + ",\n\nThank you! Your order is paid and your pickup is booked.\n\nPickup: " + when + "\n" +
    (loc ? "Where: " + loc + " (Nadia will send you the exact address)\n" : "") +
    "\n" + lineText(lines) + "\nTotal paid: " + total + "\n\n" +
    "Need to cancel? You can cancel for a full refund until " + T.clock(deadline) + ":\n" +
    site() + "/order.html?k=" + rec.getString("token") + "\n\n" +
    (allergy ? allergy + "\n\n" : "") + askLine(s) + "\n\nLunoah Sourdough Co.");
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
      (refunded ? "Your " + money(cents) + " is being refunded to your card (it usually arrives in 5–10 days). " : "") +
      "\n\n" + askLine(shop()) + "\n\nLunoah Sourdough Co.");
  }
}

function apologyEmail(to, cents) {
  if (!to) return;
  send([to], "Your Lunoah payment was refunded",
    "Sorry! Your pickup time was no longer available when your payment came through, so we refunded the full " +
    money(cents) + " to your card (5–10 days). Please pick another time on " + site() + ".\n\nLunoah Sourdough Co.");
}

// Reminds Nadia to tick off pickups whose window has passed. One email for all of them.
function pickupReminder(recs) {
  var T = require(__hooks + "/lib/shoptime.js");
  var V = require(__hooks + "/../pb_public/admin/orders-view.js");
  if (!recs.length) return;
  var one = recs.length === 1;
  var first = recs[0].getString("name").split(" ")[0];
  var subject = one
    ? "Did " + first + " get their bread? Tick it off ✓"
    : recs.length + " pickups to tick off ✓";
  var list = recs.map(function (r) {
    var lines = parseLines(r);
    var what = lines.length
      ? lines.map(function (l) { return l.qty + " × " + l.name; }).join(", ")
      : (r.getString("items") || "phone order");
    return "• " + T.label(r.getString("date"), r.getString("time")) + ": " + r.getString("name") + " (" + what + ")";
  }).join("\n");
  var intro = one
    ? V.nudge({ id: recs[0].id, name: recs[0].getString("name") })
    : "These pickup windows have come and gone! Did they get their bread, and did you get yours? 😉";
  send(nadiaAddresses(), subject,
    intro + "\n\n" + list + "\n\n" +
    "Open your Orders and tap ✓ Picked up (or “Didn't show”) on each one:\n" + site() + "/admin#orders\n\nLunoah");
}

module.exports = {
  orderEmails: orderEmails, cancelledEmail: cancelledEmail, apologyEmail: apologyEmail, parseLines: parseLines,
  pickupReminder: pickupReminder,
};
