// Pickup check-off reminders. Every few minutes (cron in orders.pb.js) this finds paid or phone
// orders whose pickup window ended at least 30 minutes ago and that Nadia hasn't ticked off, and
// emails her ONE message listing them. Each order is included in at most one reminder.
function view() { return require(__hooks + "/../pb_public/admin/orders-view.js"); }

function run(nowMs) {
  var T = require(__hooks + "/lib/shoptime.js");
  var S = require(__hooks + "/../pb_public/slots.js");
  var V = view();
  var now = T.shopNow(nowMs || Date.now());
  var shop = $app.findFirstRecordByFilter("shop", "id != ''");
  var len = shop.getInt("slot_minutes") || 15;
  // Only today and the last two days: an old order never triggers a surprise email.
  var since = S.addDays(now.date, -2);
  var recs = $app.findRecordsByFilter("bookings",
    "(status = 'paid' || status = 'manual') && pickup = '' && reminded = false && date >= {:since} && date <= {:today}",
    "date,time", 200, 0, { since: since, today: now.date });
  var due = recs.filter(function (r) {
    return V.reminderDue({ status: r.getString("status"), pickup: "", reminded: false, date: r.getString("date"), time: r.getString("time") }, now, len);
  });
  if (!due.length) return 0;
  require(__hooks + "/lib/mail.js").pickupReminder(due);
  due.forEach(function (r) { r.set("reminded", true); $app.save(r); });
  return due.length;
}

module.exports = { run: run };
