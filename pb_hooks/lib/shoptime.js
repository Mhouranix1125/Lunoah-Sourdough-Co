// The shop's clock (America/Detroit) for server code. PocketBase's JS engine has no Intl,
// so the US daylight-saving rules are written out: DST runs from the 2nd Sunday of March
// at 2:00 to the 1st Sunday of November at 2:00, local time.
var HOUR = 3600000;
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n) { return (n < 10 ? "0" : "") + n; }

function nthSunday(y, m, n) {
  var first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

function isDST(ms) {
  var y = new Date(ms).getUTCFullYear();
  var start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7); // 2:00 EST
  var end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6); // 2:00 EDT
  return ms >= start && ms < end;
}

function wall(ms) { return new Date(ms + (isDST(ms) ? -4 : -5) * HOUR); }

function shopNow(ms) {
  var t = wall(ms);
  return {
    date: t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

function shopToUtc(date, time) {
  var d = date.split("-").map(Number);
  var h = time.split(":").map(Number);
  var naive = Date.UTC(d[0], d[1] - 1, d[2], h[0], h[1]);
  var est = naive + 5 * HOUR;
  return isDST(est) ? naive + 4 * HOUR : est;
}

function hm12(h, m) { return (h % 12 || 12) + ":" + pad(m) + " " + (h < 12 ? "AM" : "PM"); }

function label(date, time) {
  var d = date.split("-").map(Number);
  var h = time.split(":").map(Number);
  var day = new Date(Date.UTC(d[0], d[1] - 1, d[2]));
  return DAYS[day.getUTCDay()] + ", " + MONTHS[d[1] - 1] + " " + d[2] + " at " + hm12(h[0], h[1]);
}

function clock(ms) {
  var t = wall(ms);
  return hm12(t.getUTCHours(), t.getUTCMinutes());
}

module.exports = { shopNow: shopNow, shopToUtc: shopToUtc, label: label, clock: clock };
