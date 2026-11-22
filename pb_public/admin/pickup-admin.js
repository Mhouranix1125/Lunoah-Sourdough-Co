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
  // Upcoming pickups (they take up pickup times). The Orders tab shows and manages them.
  const getBookings = () => api(`/api/collections/bookings/records?perPage=500&sort=date,time&filter=${encodeURIComponent(
    `date >= '${today()}' && status != 'cancelled'`)}`);
  // Tell the Orders tab that orders changed (a phone order was added, or time off cancelled some).
  const ordersChanged = () => document.dispatchEvent(new CustomEvent("lunoah:orders-changed"));
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
    renderPreview();
  }

  // Orders changed: refresh the bookings behind the preview (keeps unsaved hours edits).
  async function reloadBookings() {
    bookings = (await getBookings()).items;
    renderPreview();
  }
  document.addEventListener("lunoah:orders-changed", () => reloadBookings().catch(() => {}));

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
    const t = today();
    ul.replaceChildren(...blocks.map((b) => {
      const li = h("li", "pk-block");
      const info = h("div");
      info.append(h("div", "name", blockLabel(b)));
      if (b.start_date <= t) info.append(h("span", "badge-pill ok", "On now"));
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

  const blockError = (msg) => {
    $("#bk-error").textContent = msg;
    $("#bk-error").hidden = !msg; // shown inside the box (a toast would sit behind it)
  };

  $("#pk-add-block").addEventListener("click", () => {
    $("#block-form").reset();
    blockError("");
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
  $("#bk-allday").addEventListener("change", () => {
    $("#bk-times").hidden = $("#bk-allday").checked;
    // Start with real times. Empty time boxes on an iPhone show a grey "12:30 PM" that looks
    // filled in but isn't. Use that day's pickup hours when there are some.
    if (!$("#bk-allday").checked && !$("#bk-from").value && !$("#bk-to").value) {
      const day = $("#bk-start").value ? hours.filter((x) => x.weekday === S.weekday($("#bk-start").value)) : [];
      const first = day.slice().sort((a, b) => (a.start < b.start ? -1 : 1))[0];
      $("#bk-from").value = first ? first.start : "09:00";
      $("#bk-to").value = first ? first.end : "13:00";
    }
    blockError("");
  });
  $("#bk-end").addEventListener("change", () => blockError(""));
  $("#bk-cancel").addEventListener("click", () => $("#block-dialog").close());

  // Is the new time off already fully covered by one she has? (Saves a pointless duplicate.)
  const alreadyCovered = (n) => blocks.some((b) =>
    b.start_date <= n.start_date && n.end_date <= b.end_date &&
    (S.blockIsAllDay(b) || (!n.all_day && b.from <= n.from && n.to <= b.to)));

  const pickupLine = (b) => `• ${S.formatDate(b.date, "short")} ${S.formatTime(b.time)}: ${b.name}`;

  let savingBlock = false;
  $("#block-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (savingBlock) return; // a double tap must not save it twice
    const allDay = $("#bk-allday").checked;
    const block = {
      start_date: $("#bk-start").value,
      end_date: $("#bk-end").value,
      all_day: allDay,
      from: allDay ? "" : $("#bk-from").value,
      to: allDay ? "" : $("#bk-to").value,
      note: $("#bk-note").value.trim(),
    };
    const problem = S.checkBlock(block, today());
    if (problem) return blockError(problem);
    if (alreadyCovered(block)) return blockError("You already have time off that covers this.");
    blockError("");

    const btn = e.submitter || e.target.querySelector("[type=submit]");
    savingBlock = true;
    busy(btn, true);
    try {
      // Check against the latest pickups, not the ones loaded when the page opened.
      bookings = (await getBookings()).items;
      const len = (shop && shop.slot_minutes) || 15;
      const inside = bookings.filter((b) => b.status !== "cancelled" && !b.pickup && S.blockCoversSlot(block, b.date, b.time, len));
      const hit = inside.filter((b) => b.status === "paid" || b.status === "manual");
      const paying = inside.filter((b) => b.status === "held");

      if (hit.length || paying.length) {
        const parts = [];
        if (hit.length) {
          const one = hit.length === 1;
          parts.push(`${hit.length} booked ${one ? "pickup falls" : "pickups fall"} in this time off:\n${hit.map(pickupLine).join("\n")}\n\n` +
            `${one ? "It" : "They"} will be cancelled, and paid orders refunded in full.`);
        }
        if (paying.length) {
          parts.push(`Someone is paying right now for:\n${paying.map(pickupLine).join("\n")}\n\n` +
            "If they finish, it will show in Orders. You can cancel it there for a full refund.");
        }
        if (!confirm(`${parts.join("\n\n")}\n\nSave the time off?`)) return;
      }

      // Save the time off first, so no new customer can book these times while we cancel.
      await api("/api/collections/pickup_blocks/records", { method: "POST", body: block });
      let failed = 0;
      for (const b of hit) {
        try {
          const r = await api("/api/lunoah/admin/cancel", { method: "POST", body: { id: b.id } });
          if (r.refund_status === "failed") failed++;
        } catch (_) { failed++; }
      }
      $("#block-dialog").close();
      const when = blockLabel(block);
      if (failed) toast(`Time off saved, but ${failed} refund${failed === 1 ? "" : "s"} didn't go through. See Orders to retry.`, "bad");
      else toast(hit.length ? `Time off saved (${when}). ${hit.length} pickup${hit.length === 1 ? "" : "s"} cancelled.` : `Time off saved: ${when}. Customers can't pick these times.`);
      await reloadBlocks();
      await reloadBookings();
      if (hit.length) ordersChanged();
    } catch (err) {
      blockError(err.message || "The time off didn't save. Please try again.");
    } finally {
      savingBlock = false;
      busy(btn, false);
    }
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
    const prevTime = $("#bk2-time").value;
    openDays = S.availableSlots({
      hours, blocks, leadDays: 0,
      slotMinutes: shop.slot_minutes || 15,
      bookAheadDays: shop.book_ahead_days || 21,
      now: new Date(), tz: S.SHOP_TZ,
      taken: bookings.filter((b) => b.status !== "cancelled").map((b) => ({ date: b.date, time: b.time })),
    });
    $("#bk2-day").replaceChildren(...openDays.map((d) => {
      const o = h("option", null, S.formatDate(d.date, "short"));
      o.value = d.date;
      return o;
    }));
    if (openDays.some((d) => d.date === prevDay)) $("#bk2-day").value = prevDay;
    fillTimes();
    if (prevTime && [...$("#bk2-time").options].some((o) => o.value === prevTime)) $("#bk2-time").value = prevTime;
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
    const pay = window.LunoahMoney.readPayment($("#bk2-amount").value, $("#bk2-via").value);
    if (pay.error) return toast(pay.error, "bad");
    const btn = e.submitter || $("#bk2-save");
    busy(btn, true);
    try {
      await api("/api/collections/bookings/records", {
        method: "POST",
        body: { date, time, name, phone: $("#bk2-phone").value.trim().slice(0, 20), items: $("#bk2-note").value.trim(),
          amount_cents: pay.cents, total: pay.cents / 100, paid_via: pay.via, order_code: "PHONE", status: "manual", refund_status: "none" },
      });
      $("#booking-dialog").close();
      toast("Phone order added.");
      await reloadBookings();
      ordersChanged();
    } catch (err) {
      if (/unique/i.test(err.message || "")) {
        toast("That time was just taken. Please pick another.", "bad");
        try { await reloadBookings(); refreshAddOptions(); } catch (e2) { toast(e2.message, "bad"); }
      } else toast(err.message, "bad");
    } finally {
      busy(btn, false);
      $("#bk2-save").disabled = openDays.length === 0;
    }
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
      taken: bookings.filter((b) => b.status !== "cancelled").map((b) => ({ date: b.date, time: b.time })),
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
