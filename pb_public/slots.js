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

  const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const isDate = (ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd || "") && addDays(ymd, 0) === ymd; // rejects Feb 30 etc.

  // A time-off entry closes the whole day if it says "all day", or if its hours are missing or
  // backwards. Failing closed means a damaged entry blocks too much, never too little.
  const blockIsAllDay = (b) =>
    !!b.all_day || !HM_RE.test(b.from || "") || !HM_RE.test(b.to || "") || toMin(b.to) <= toMin(b.from);

  // Does time off `b` cover the pickup at `date` `time` (a slot `slotMinutes` long)?
  function blockCoversSlot(b, date, time, slotMinutes) {
    if (!(b.start_date <= date && date <= (b.end_date || b.start_date))) return false;
    if (blockIsAllDay(b)) return true;
    const s = toMin(time);
    return s < toMin(b.to) && toMin(b.from) < s + (Number(slotMinutes) || 30);
  }

  // Checks a time-off entry before it is saved. Returns "" if it's fine, or a message for Nadia.
  // Used by the admin page and by the server, so both apply the same rules.
  function checkBlock(b, today) {
    if (!isDate(b.start_date) || !isDate(b.end_date)) return "Please choose the first and last day.";
    if (b.end_date < b.start_date) return "The last day can't be before the first day.";
    if (b.start_date < today) return "The first day can't be in the past. Please start today or later.";
    if (b.end_date > addDays(b.start_date, 365)) return "Time off can be up to a year at a time.";
    if (!b.all_day) {
      if (!HM_RE.test(b.from || "") || !HM_RE.test(b.to || "")) return "Please choose a start and end time, or tick “All day”.";
      if (toMin(b.to) <= toMin(b.from)) return "The end time must be after the start time.";
    }
    if (String(b.note || "").length > 200) return "Please keep the note under 200 characters.";
    return "";
  }

  // Full days off that are happening now or start within `horizonDays`, merged into ranges
  // (back-to-back or overlapping entries become one). Part-day time off isn't included.
  function awayRanges(blocks, today, horizonDays) {
    const until = addDays(today, Number(horizonDays) || 21);
    const days = blocks
      .filter((b) => blockIsAllDay(b) && (b.end_date || b.start_date) >= today && b.start_date <= until)
      .map((b) => ({ start: b.start_date < today ? today : b.start_date, end: b.end_date || b.start_date }))
      .sort((a, b) => (a.start < b.start ? -1 : 1));
    const out = [];
    for (const r of days) {
      const last = out[out.length - 1];
      if (last && r.start <= addDays(last.end, 1)) { if (r.end > last.end) last.end = r.end; }
      else out.push({ ...r });
    }
    return out;
  }

  // The customer banner for Nadia's time off: { title, text }, or null when she isn't away soon.
  // nextOpen is the first date customers can pick (or "" if none).
  function awayMessage(ranges, today, nextOpen) {
    if (!ranges.length) return null;
    const d = (ymd) => formatDate(ymd, "short");
    const span = (r) => (r.start === r.end ? d(r.start) : `${d(r.start)} through ${d(r.end)}`);
    const list = (rs) => rs.length === 1 ? span(rs[0])
      : `${rs.slice(0, -1).map(span).join(", ")} and ${span(rs[rs.length - 1])}`;
    const [first, ...rest] = ranges;
    if (first.start <= today) {
      const title = first.end === today ? "Nadia is away today." : `Nadia is away until ${d(first.end)}.`;
      let text = "Her ovens are resting, so there are no pickups until she's back.";
      if (nextOpen) text += ` The next pickup day is ${d(nextOpen)}.`;
      if (rest.length) text += ` She'll also be away ${list(rest)}.`;
      return { title, text };
    }
    const many = ranges.length > 1 || first.start !== first.end;
    return {
      title: `Heads up: Nadia will be away ${list(ranges)}.`,
      text: `There are no pickups ${many ? "on those days" : "that day"}, so plan your loaves around it. You can still order for any other day.`,
    };
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
      if (dayBlocks.some(blockIsAllDay)) continue;
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

  const api = {
    SHOP_TZ, availableSlots, localParts, addDays, weekday, formatDate, formatTime,
    checkBlock, blockIsAllDay, blockCoversSlot, awayRanges, awayMessage,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LunoahSlots = api;
})(this);
