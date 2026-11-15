// Works out which pickup times customers can choose. Shared by the website and the admin page.
// Dates are "YYYY-MM-DD" and times "HH:MM" in the shop's own time zone, so nothing here
// depends on the time zone a customer's phone is set to.
(function (root) {
  const SHOP_TZ = "America/Detroit";
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (hm) => {
    const [h, m] = String(hm || "").split(":").map(Number);
    return h * 60 + m;
  };
  const toHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const utc = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };

  function localParts(now, tz) {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now)) p[x.type] = x.value;
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }

  function addDays(ymd, n) {
    const t = utc(ymd);
    t.setUTCDate(t.getUTCDate() + n);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }

  const weekday = (ymd) => utc(ymd).getUTCDay();

  function formatDate(ymd, style = "long") {
    return utc(ymd).toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: style === "short" ? "short" : "long", month: "short", day: "numeric",
    });
  }

  function formatTime(hm) {
    const m = toMin(hm);
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`;
  }

  function availableSlots({
    hours = [], blocks = [], leadDays = 2, slotMinutes = 30, bookAheadDays = 21,
    now = new Date(), tz = SHOP_TZ, taken = [], today: todayIn = null,
  } = {}) {
    const today = todayIn || localParts(now, tz); // the server passes today (it has no Intl)
    const len = Number(slotMinutes) || 30;
    const out = [];
    const takenSet = new Set(taken.map((t) => `${t.date} ${t.time}`));
    for (let i = Number(leadDays) || 0; i <= Number(bookAheadDays); i++) {
      const date = addDays(today.date, i);
      const wd = weekday(date);
      const dayBlocks = blocks.filter((b) => b.start_date <= date && date <= (b.end_date || b.start_date));
      if (dayBlocks.some((b) => b.all_day)) continue;
      const starts = new Set();
      for (const h of hours) {
        if (Number(h.weekday) !== wd) continue;
        const end = toMin(h.end);
        for (let s = toMin(h.start); s + len <= end; s += len) {
          if (date === today.date && s < today.minutes) continue;
          if (dayBlocks.some((b) => s < toMin(b.to) && toMin(b.from) < s + len)) continue;
          if (takenSet.has(`${date} ${toHM(s)}`)) continue;
          starts.add(s);
        }
      }
      if (starts.size) out.push({ date, times: [...starts].sort((a, b) => a - b).map(toHM) });
    }
    return out;
  }

  const api = { SHOP_TZ, availableSlots, localParts, addDays, weekday, formatDate, formatTime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LunoahSlots = api;
})(this);
