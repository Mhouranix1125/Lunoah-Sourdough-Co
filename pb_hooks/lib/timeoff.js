// Time off (pickup_blocks): checks a new or changed entry with the same rules as the admin page
// (pb_public/slots.js checkBlock). Throws a 400 with a message Nadia can read if it's not valid.
function check(record) {
  var S = require(__hooks + "/../pb_public/slots.js");
  var T = require(__hooks + "/lib/shoptime.js");
  if (record.getBool("all_day")) { record.set("from", ""); record.set("to", ""); }
  record.set("note", record.getString("note").trim());
  var msg = S.checkBlock({
    start_date: record.getString("start_date"), end_date: record.getString("end_date"), all_day: record.getBool("all_day"),
    from: record.getString("from"), to: record.getString("to"), note: record.getString("note"),
  }, T.shopNow(Date.now()).date);
  if (msg) throw new BadRequestError(msg);
}

module.exports = { check: check };
