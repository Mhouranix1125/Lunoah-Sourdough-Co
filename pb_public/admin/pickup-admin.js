// "Pickup Times" tab: regular weekly hours, time off, scheduling settings, and a live preview.
window.PickupAdmin = function ({ api, toast, busy }) {
  const $ = (s) => document.querySelector(s);
  const S = window.LunoahSlots;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let hours = [];
  let blocks = [];
  let bookings = [];
  let shop = null;
  let week = []; // 7 × { on, ranges: [{ start, end }] } — what Nadia is editing

  const today = () => S.localParts(new Date(), S.SHOP_TZ).date;
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const getBlocks = () => api(`/api/collections/pickup_blocks/records?perPage=500&sort=start_date&filter=${encodeURIComponent(`end_date >= '${today()}'`)}`);
  const getBookings = () => api(`/api/collections/bookings/records?perPage=500&sort=date,time&filter=${encodeURIComponent(`date >= '${today()}'`)}`);
  const getShop = () => api("/api/collections/shop/records?perPage=1");

  function showShop() {
    $("#pk-lead").value = shop.lead_days ?? 2;
    $("#pk-slot").value = String(shop.slot_minutes || 15);
    $("#pk-ahead").value = shop.book_ahead_days || 21;
    const n = shop.lead_days ?? 2;
    $("#pk-lead-echo").textContent = `${n} ${n === 1 ? "day" : "days"}`;
  }

  // Full load: rebuilds the editable week from the server (initial load and after saving hours).
  async function load() {
    const [hr, br, sr, bk] = await Promise.all([
      api("/api/collections/pickup_hours/records?perPage=200&sort=weekday,start"),
      getBlocks(),
      getShop(),
      getBookings(),
    ]);
    hours = hr.items;
    blocks = br.items;
    shop = sr.items[0];
    bookings = bk.items;
    week = DAYS.map((_, wd) => {
      const ranges = hours.filter((x) => x.weekday === wd).map((x) => ({ start: x.start, end: x.end }));
      return { on: ranges.length > 0, ranges: ranges.length ? ranges : [{ start: "09:00", end: "13:00" }] };
    });
    showShop();
    renderWeek();
    renderBlocks();
    renderBookings();
    renderPreview();
  }

  // A booking was cancelled: refresh the list and the preview (keeps unsaved hours edits).
  async function reloadBookings() {
    bookings = (await getBookings()).items;
    renderBookings();
    renderPreview();
  }

  // Time off changed: refresh only the time-off list (keeps unsaved hours edits).
  async function reloadBlocks() {
    blocks = (await getBlocks()).items;
    renderBlocks();
    renderPreview();
  }

  // Settings changed: refresh only the settings (keeps unsaved hours edits).
  async function reloadShop() {
    shop = (await getShop()).items[0];
    showShop();
    renderPreview();
  }

  // ----- Upcoming pickups -----
  function renderBookings() {
    const box = $("#pk-bookings");
    if (!bookings.length) {
      box.replaceChildren(h("p", "hint", "No upcoming pickups yet."));
      return;
    }
    const parts = [];
    let day = "";
    let ul = null;
    for (const b of bookings) {
      if (b.date !== day) {
        day = b.date;
        parts.push(h("h3", "pk-day-head", S.formatDate(b.date, "short")));
        ul = h("ul", "pk-blocks");
        parts.push(ul);
      }
      const li = h("li", "pk-block pk-booking");
      const info = h("div");
      info.append(h("div", "name", `${S.formatTime(b.time)} · ${b.name}`));
      const meta = [b.items, b.total ? `$${Number(b.total).toFixed(2).replace(/\.00$/, "")}` : "", b.order_code].filter(Boolean).join(" · ");
      if (meta) info.append(h("div", "muted small-print", meta));
      const cancel = h("button", "btn ghost small danger-text", "Cancel");
      cancel.type = "button";
      cancel.setAttribute("aria-label", `Cancel ${b.name}'s ${S.formatTime(b.time)} pickup`);
      cancel.addEventListener("click", async () => {
        const when = `${S.formatTime(b.time)} pickup on ${S.formatDate(b.date, "short")}`;
        if (!confirm(`Cancel ${b.name}'s ${when}? That time will open up for other customers.`)) return;
        try {
          await api(`/api/collections/bookings/records/${b.id}`, { method: "DELETE" });
          toast(`Pickup cancelled. ${S.formatTime(b.time)} is open again.`);
          await reloadBookings();
        } catch (err) { toast(err.message, "bad"); }
      });
      li.append(info, cancel);
      ul.append(li);
    }
    box.replaceChildren(...parts);
  }

  // ----- Regular hours -----
  function timeInput(value, onChange) {
    const i = document.createElement("input");
    i.type = "time";
    i.step = 900;
    i.value = value;
    i.addEventListener("input", () => onChange(i.value));
    i.addEventListener("change", () => onChange(i.value));
    return i;
  }

  function renderWeek() {
    $("#pk-week").replaceChildren(...week.map((day, wd) => {
      const li = h("li", "pk-day" + (day.on ? " on" : ""));
      const sw = h("label", "switch");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = day.on;
      cb.addEventListener("change", () => { day.on = cb.checked; renderWeek(); });
      sw.append(cb, h("span", "pk-dayname", DAYS[wd]));
      li.append(sw);
      if (!day.on) { li.append(h("span", "muted pk-closed", "Closed")); return li; }

      const list = h("div", "pk-ranges");
      day.ranges.forEach((r, ri) => {
        const row = h("div", "pk-range");
        row.append(
          timeInput(r.start, (v) => (r.start = v)),
          h("span", "muted", "to"),
          timeInput(r.end, (v) => (r.end = v)),
        );
        if (day.ranges.length > 1) {
          const x = h("button", "pk-x", "×");
          x.type = "button";
          x.title = "Remove these hours";
          x.addEventListener("click", () => { day.ranges.splice(ri, 1); renderWeek(); });
          row.append(x);
        }
        list.append(row);
      });
      const add = h("button", "pk-add", "＋ add hours");
      add.type = "button";
      add.addEventListener("click", () => { day.ranges.push({ start: "16:00", end: "18:00" }); renderWeek(); });
      list.append(add);
      li.append(list);
      return li;
    }));
  }

  $("#pk-save-hours").addEventListener("click", async (e) => {
    for (const [wd, day] of week.entries()) {
      if (!day.on) continue;
      for (const r of day.ranges) {
        if (!r.start || !r.end || r.end <= r.start) {
          return toast(`${DAYS[wd]}: the end time must be after the start time.`, "bad");
        }
      }
    }
    const btn = e.currentTarget;
    busy(btn, true);
    try {
      const old = hours.slice();
      for (const [wd, day] of week.entries()) {
        if (!day.on) continue;
        for (const r of day.ranges) {
          await api("/api/collections/pickup_hours/records", { method: "POST", body: { weekday: wd, start: r.start, end: r.end } });
        }
      }
      for (const x of old) await api(`/api/collections/pickup_hours/records/${x.id}`, { method: "DELETE" });
      toast("Pickup hours saved!");
    } catch (err) { toast("Some hours may not have saved. Please check them and tap Save again.", "bad"); }
    finally { busy(btn, false); await load().catch((err) => toast(err.message, "bad")); }
  });

  // ----- Time off -----
  function blockLabel(b) {
    const d = b.start_date === b.end_date
      ? S.formatDate(b.start_date, "short")
      : `${S.formatDate(b.start_date, "short")} – ${S.formatDate(b.end_date, "short")}`;
    return `${d} · ${b.all_day ? "All day" : `${S.formatTime(b.from)}–${S.formatTime(b.to)}`}`;
  }

  function renderBlocks() {
    const ul = $("#pk-blocks");
    if (!blocks.length) {
      ul.replaceChildren(h("li", "hint", "No time off planned."));
      return;
    }
    ul.replaceChildren(...blocks.map((b) => {
      const li = h("li", "pk-block");
      const info = h("div");
      info.append(h("div", "name", blockLabel(b)));
      if (b.note) info.append(h("div", "muted small-print", b.note));
      const del = h("button", "btn ghost small danger-text", "Delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm(`Delete time off: ${blockLabel(b)}?`)) return;
        try {
          await api(`/api/collections/pickup_blocks/records/${b.id}`, { method: "DELETE" });
          toast("Time off deleted");
          await reloadBlocks();
        } catch (err) { toast(err.message, "bad"); }
      });
      li.append(info, del);
      return li;
    }));
  }

  $("#pk-add-block").addEventListener("click", () => {
    $("#block-form").reset();
    $("#bk-start").value = today();
    $("#bk-end").value = today();
    $("#bk-start").min = today();
    $("#bk-end").min = today();
    $("#bk-times").hidden = true;
    $("#block-dialog").showModal();
  });
  $("#bk-start").addEventListener("change", () => {
    $("#bk-end").min = $("#bk-start").value;
    if ($("#bk-end").value < $("#bk-start").value) $("#bk-end").value = $("#bk-start").value;
  });
  $("#bk-allday").addEventListener("change", () => ($("#bk-times").hidden = $("#bk-allday").checked));
  $("#bk-cancel").addEventListener("click", () => $("#block-dialog").close());

  $("#block-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const start = $("#bk-start").value;
    const end = $("#bk-end").value;
    const allDay = $("#bk-allday").checked;
    const from = $("#bk-from").value;
    const to = $("#bk-to").value;
    if (!start || !end) return toast("Please choose the first and last day.", "bad");
    if (end < start) return toast("The last day can't be before the first day.", "bad");
    if (!allDay && (!from || !to || to <= from)) return toast("Please choose a start and end time (end after start).", "bad");
    const btn = e.submitter || e.target.querySelector('[type=submit]');
    busy(btn, true);
    try {
      await api("/api/collections/pickup_blocks/records", {
        method: "POST",
        body: { start_date: start, end_date: end, all_day: allDay, from: allDay ? "" : from, to: allDay ? "" : to, note: $("#bk-note").value.trim() },
      });
      $("#block-dialog").close();
      toast("Time off added");
      await reloadBlocks();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  // ----- Add a pickup (phone / in-person orders) -----
  let openDays = [];
  function fillTimes() {
    const d = openDays.find((x) => x.date === $("#bk2-day").value);
    $("#bk2-time").replaceChildren(...(d ? d.times : []).map((t) => {
      const o = h("option", null, S.formatTime(t));
      o.value = t;
      return o;
    }));
  }
  function refreshAddOptions() {
    const prevDay = $("#bk2-day").value;
    openDays = S.availableSlots({
      hours, blocks, leadDays: 0,
      slotMinutes: shop.slot_minutes || 15,
      bookAheadDays: shop.book_ahead_days || 21,
      now: new Date(), tz: S.SHOP_TZ,
      taken: bookings.map((b) => ({ date: b.date, time: b.time })),
    });
    $("#bk2-day").replaceChildren(...openDays.map((d) => {
      const o = h("option", null, S.formatDate(d.date, "short"));
      o.value = d.date;
      return o;
    }));
    if (openDays.some((d) => d.date === prevDay)) $("#bk2-day").value = prevDay;
    fillTimes();
    $("#bk2-empty").hidden = openDays.length > 0;
    $("#bk2-save").disabled = openDays.length === 0;
  }
  $("#pk-add-booking").addEventListener("click", () => {
    if (!shop) return toast("Pickup settings didn't load. Please refresh the page.", "bad");
    $("#booking-form").reset();
    refreshAddOptions();
    $("#booking-dialog").showModal();
  });
  $("#bk2-day").addEventListener("change", fillTimes);
  $("#bk2-cancel").addEventListener("click", () => $("#booking-dialog").close());
  $("#booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = $("#bk2-day").value;
    const time = $("#bk2-time").value;
    const name = $("#bk2-name").value.trim();
    if (!date || !time) return toast("Please choose a day and time.", "bad");
    if (!name) return toast("Please enter a name.", "bad");
    const btn = e.submitter || $("#bk2-save");
    busy(btn, true);
    try {
      await api("/api/collections/bookings/records", {
        method: "POST",
        body: { date, time, name, items: $("#bk2-note").value.trim(), total: 0, order_code: "PHONE" },
      });
      $("#booking-dialog").close();
      toast("Pickup added.");
      await reloadBookings();
    } catch (err) {
      if (/unique/i.test(err.message || "")) {
        toast("That time was just taken. Please pick another.", "bad");
        try { await reloadBookings(); refreshAddOptions(); } catch (e2) { toast(e2.message, "bad"); }
      } else toast(err.message, "bad");
    } finally { busy(btn, false); }
  });

  // ----- Settings -----
  $("#pk-settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!shop) return toast("Pickup settings didn't load. Please refresh the page.", "bad");
    const lead = Number($("#pk-lead").value);
    const ahead = Number($("#pk-ahead").value);
    if (!Number.isInteger(lead) || lead < 0 || lead > 30) return toast("Minimum notice must be 0 to 30 days.", "bad");
    if (!Number.isInteger(ahead) || ahead < 1 || ahead > 90) return toast("Booking ahead must be 1 to 90 days.", "bad");
    if (ahead < lead) return toast("Booking ahead must be at least the minimum notice.", "bad");
    const btn = e.submitter || e.target.querySelector('[type=submit]');
    busy(btn, true);
    try {
      await api(`/api/collections/shop/records/${shop.id}`, {
        method: "PATCH",
        body: { lead_days: lead, slot_minutes: Number($("#pk-slot").value), book_ahead_days: ahead },
      });
      toast("Settings saved!");
      await reloadShop();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  // ----- Preview -----
  function renderPreview() {
    if (!shop) return;
    const days = S.availableSlots({
      hours, blocks,
      leadDays: shop.lead_days ?? 2,
      slotMinutes: shop.slot_minutes || 15,
      bookAheadDays: shop.book_ahead_days || 21,
      now: new Date(),
      taken: bookings.map((b) => ({ date: b.date, time: b.time })),
      tz: S.SHOP_TZ,
    });
    const ul = $("#pk-preview");
    if (!days.length) {
      ul.replaceChildren(h("li", "pk-empty", "No pickup times are open. Customers can't choose a pickup time right now."));
      return;
    }
    ul.replaceChildren(...days.slice(0, 10).map((d) =>
      h("li", null, `${S.formatDate(d.date, "short")}: ${d.times.length} times, ${S.formatTime(d.times[0])} to ${S.formatTime(d.times[d.times.length - 1])}`)));
    if (days.length > 10) ul.append(h("li", "muted", `…and ${days.length - 10} more days`));
  }

  return { load };
};
