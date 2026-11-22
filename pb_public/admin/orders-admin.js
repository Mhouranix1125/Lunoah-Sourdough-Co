// "Orders" tab: upcoming orders by day with a bake list, orders whose pickup window has passed
// and still need a tick ("Needs a check"), and the completed and cancelled history.
window.OrdersAdmin = function ({ api, toast, busy }) {
  const $ = (s) => document.querySelector(s);
  const S = window.LunoahSlots;
  const V = window.LunoahOrders;
  const PAGE = 25;
  const COL = "/api/collections/bookings/records";

  let view = "upcoming";
  let active = []; // not cancelled and not ticked off, plus cancelled orders whose refund failed
  let slotMinutes = 15;
  const past = { completed: { items: [], page: 0, total: 0 }, cancelled: { items: [], page: 0, total: 0 } };
  let query = "";
  let loaded = false;

  const now = () => S.localParts(new Date(), S.SHOP_TZ);
  const money = (c) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
  const cents = (b) => b.amount_cents || Math.round((Number(b.total) || 0) * 100);
  const changed = () => document.dispatchEvent(new CustomEvent("lunoah:orders-changed", { detail: { from: "orders" } }));

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(label, cls, onClick) {
    const b = h("button", "btn small " + cls, label);
    b.type = "button";
    b.addEventListener("click", () => onClick(b));
    return b;
  }

  // ----- loading -----
  // PocketBase filter values can't contain quotes; strip them from what Nadia types.
  const clean = (q) => q.replace(/['"\\]/g, "").trim();
  function searchFilter() {
    const q = clean(query);
    if (!q) return "";
    const d = q.replace(/\D/g, "");
    const dashed = d.length >= 3 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join("-") : "";
    const parts = [`name ~ '${q}'`, `email ~ '${q}'`, `items ~ '${q}'`, `phone ~ '${q}'`];
    if (dashed) parts.push(`phone ~ '${dashed}'`);
    return ` && (${parts.join(" || ")})`;
  }
  const historyFilter = {
    completed: () => `pickup != '' && status != 'cancelled'`,
    cancelled: () => `status = 'cancelled'`,
  };
  const historySort = { completed: "-date,-time", cancelled: "-cancelled_at,-date,-time" };

  async function loadActive() {
    const f = `(status != 'cancelled' && pickup = '') || (status = 'cancelled' && refund_status = 'failed')`;
    const [r, shop] = await Promise.all([
      api(`${COL}?perPage=500&sort=date,time&filter=${encodeURIComponent(f)}`),
      api("/api/collections/shop/records?perPage=1"),
    ]);
    active = r.items;
    slotMinutes = (shop.items[0] && shop.items[0].slot_minutes) || 15;
  }

  async function loadHistory(kind, more) {
    const st = past[kind];
    const page = more ? st.page + 1 : 1;
    const f = historyFilter[kind]() + searchFilter();
    const r = await api(`${COL}?perPage=${PAGE}&page=${page}&sort=${historySort[kind]}&filter=${encodeURIComponent(f)}`);
    st.items = more ? st.items.concat(r.items) : r.items;
    st.page = page;
    st.total = r.totalItems;
  }

  async function load() {
    await Promise.all([loadActive(), loadHistory("completed"), loadHistory("cancelled")]);
    loaded = true;
    render();
  }

  // ----- the list of orders -----
  function itemsBlock(b) {
    const ls = V.lines(b);
    if (ls.length) {
      const ul = h("ul", "or-items");
      for (const l of ls) ul.append(h("li", null, `${l.qty} × ${l.name}`));
      return ul;
    }
    return h("p", "or-items-text", b.items || "No items noted");
  }

  function statusBadge(b, kind) {
    if (kind === "cancelled") {
      const who = { customer: "by the customer", nadia: "by you", stripe: "in Stripe" }[b.cancelled_by] || "";
      return h("span", "badge-pill", `Cancelled ${who}`.trim());
    }
    if (kind === "paying") return h("span", "badge-pill", "Paying now…");
    if (kind === "completed") {
      return b.pickup === "no_show" ? h("span", "badge-pill bad-soft", "No-show") : h("span", "badge-pill ok", "Picked up ✓");
    }
    if (b.status === "paid") return h("span", "badge-pill ok", `Paid ${money(cents(b))}`);
    const VIA = { cash: "cash", venmo: "Venmo", zelle: "Zelle", other: "other", card: "card" };
    return b.paid_via
      ? h("span", "badge-pill ok", `Phone order · ${money(cents(b))} ${VIA[b.paid_via] || ""}`.trim())
      : h("span", "badge-pill", cents(b) ? `Phone order · ${money(cents(b))} not paid yet` : "Phone order · not paid yet");
  }

  function refundBadge(b) {
    if (b.refund_status === "refunded") return h("span", "badge-pill ok", `Refunded ${money(cents(b))}`);
    if (b.refund_status === "failed") return h("span", "badge-pill bad", "Refund failed");
    if (b.refund_status === "partial") return h("span", "badge-pill", "Partly refunded");
    return null;
  }

  function card(b, kind, { showDate = false } = {}) {
    const li = h("li", "or-card or-" + kind);
    if (kind === "needs_check") li.append(h("p", "or-nudge", V.nudge(b)));

    const head = h("div", "or-head");
    const when = (showDate || kind === "needs_check" ? S.formatDate(b.date, "short") + " · " : "") + S.formatTime(b.time);
    head.append(h("span", "or-time", when), h("span", "or-name", b.name));
    li.append(head);

    const badges = h("div", "or-badges");
    badges.append(statusBadge(b, kind));
    const rb = (kind === "cancelled" || b.refund_status === "failed") && refundBadge(b);
    if (rb) badges.append(rb);
    li.append(badges);

    li.append(itemsBlock(b));

    const contact = h("p", "or-contact");
    if (kind === "completed" || kind === "cancelled") {
      if (b.status === "paid" || b.amount_cents) contact.append(h("span", null, money(cents(b))));
    }
    if (b.phone) {
      const a = h("a", null, b.phone);
      a.href = "sms:" + b.phone.replace(/[^\d+]/g, "");
      contact.append(a);
    }
    if (b.email) {
      const a = h("a", null, b.email);
      a.href = "mailto:" + b.email;
      contact.append(a);
    }
    if (contact.childNodes.length) li.append(contact);
    if (b.notes) li.append(h("p", "or-notes", `“${b.notes}”`));

    const actions = h("div", "or-actions");
    const today = now().date;
    if (kind === "needs_check") {
      actions.append(
        button("✓ Picked up", "or-check", (btn) => mark(b, "picked_up", btn)),
        button("Didn't show", "ghost", (btn) => mark(b, "no_show", btn)),
      );
    } else if (kind === "upcoming" && b.date === today) {
      actions.append(button("✓ Picked up", "ghost or-check-early", (btn) => mark(b, "picked_up", btn)));
    } else if (kind === "completed") {
      actions.append(button("Undo", "ghost", (btn) => mark(b, "", btn)));
    }
    if (b.status === "manual") actions.append(button(b.paid_via ? "Payment" : "Add payment", "ghost", () => openPayment(b)));
    if (b.refund_status === "failed") {
      actions.append(button("Retry refund", "ghost", (btn) => retryRefund(b, btn)));
    } else if ((kind === "upcoming" || kind === "needs_check" || (kind === "completed" && b.pickup === "no_show")) && b.status !== "held") {
      actions.append(button(b.status === "paid" ? "Cancel & refund" : "Cancel", "ghost danger-text", (btn) => cancel(b, btn)));
    }
    if (actions.childNodes.length) li.append(actions);
    return li;
  }

  function dayHead(date, orders) {
    const t = now().date;
    const label = date === t ? "Today" : date === S.addDays(t, 1) ? "Tomorrow" : "";
    const box = h("section", "or-day");
    const head = h("h3", "or-day-head");
    head.append(h("span", null, (label ? label + " · " : "") + S.formatDate(date, "short")));
    const bake = V.bakeList(orders);
    const paying = orders.filter((b) => b.status === "held").length;
    const n = orders.length - paying;
    const sum = [`${n} order${n === 1 ? "" : "s"}`];
    if (bake.loaves) sum.push(`${bake.loaves} item${bake.loaves === 1 ? "" : "s"}`);
    if (bake.cents) sum.push(money(bake.cents));
    if (paying) sum.push(`${paying} paying now`);
    head.append(h("span", "or-day-sum", sum.join(" · ")));
    box.append(head);
    if (bake.items.length || bake.other.length) {
      const list = h("div", "or-bake");
      list.append(h("span", "or-bake-title", "To bake"));
      for (const it of bake.items) list.append(h("span", "or-chip", `${it.qty} × ${it.name}`));
      for (const o of bake.other) list.append(h("span", "or-chip or-chip-phone", `${o.name}: ${o.items}`));
      box.append(list);
    }
    return box;
  }

  function emptyState(text) {
    return h("p", "or-empty", text);
  }

  function render() {
    if (!loaded) return;
    const n = now();
    const mine = active.filter((b) => V.matches(b, query));
    const sorted = { needs_check: [], upcoming: [], refund: [] };
    for (const b of mine) {
      if (b.status === "cancelled") { sorted.refund.push(b); continue; }
      const k = V.classify(b, n, slotMinutes);
      (k === "needs_check" ? sorted.needs_check : sorted.upcoming).push(b);
    }

    // Counts and the red badge on the Orders tab (needs a tick, or a refund to retry).
    const attention = active.filter((b) => b.status === "cancelled" || V.classify(b, n, slotMinutes) === "needs_check").length;
    $("#or-tab-count").textContent = attention;
    $("#or-tab-count").hidden = !attention;
    $("#or-count-upcoming").textContent = sorted.upcoming.length + sorted.needs_check.length || "";
    $("#or-count-upcoming").classList.toggle("alert", attention > 0);
    $("#or-count-completed").textContent = past.completed.total || "";
    $("#or-count-cancelled").textContent = past.cancelled.total || "";

    const box = $("#or-list");
    const parts = [];
    if (view === "upcoming") {
      if (sorted.refund.length) {
        parts.push(h("h3", "or-section-head bad", "Refund didn't go through"));
        const ul = h("ul", "or-cards");
        sorted.refund.forEach((b) => ul.append(card(b, "cancelled", { showDate: true })));
        parts.push(ul);
      }
      if (sorted.needs_check.length) {
        parts.push(h("h3", "or-section-head attention", `Needs a check (${sorted.needs_check.length})`));
        const ul = h("ul", "or-cards");
        sorted.needs_check.forEach((b) => ul.append(card(b, "needs_check")));
        parts.push(ul);
      }
      const byDay = new Map();
      for (const b of sorted.upcoming) {
        if (!byDay.has(b.date)) byDay.set(b.date, []);
        byDay.get(b.date).push(b);
      }
      for (const [date, orders] of byDay) {
        const sec = dayHead(date, orders);
        const ul = h("ul", "or-cards");
        orders.forEach((b) => ul.append(card(b, V.classify(b, n, slotMinutes))));
        sec.append(ul);
        parts.push(sec);
      }
      if (!parts.length) parts.push(emptyState(query ? "No upcoming orders match your search." : "No upcoming orders yet. New ones show up here as soon as they're paid."));
    } else {
      const st = past[view];
      const ul = h("ul", "or-cards");
      st.items.forEach((b) => ul.append(card(b, view, { showDate: true })));
      if (st.items.length) parts.push(ul);
      else parts.push(emptyState(query ? "No orders match your search." :
        view === "completed" ? "Orders you tick off as picked up appear here." : "No cancelled orders."));
    }
    box.replaceChildren(...parts);
    const st = past[view];
    $("#or-more").hidden = view === "upcoming" || !st || st.items.length >= st.total;
    $("#pk-add-booking").hidden = view !== "upcoming";
  }

  // ----- actions -----
  async function after(msg) {
    toast(msg);
    await load();
    changed();
  }

  async function mark(b, result, btn) {
    busy(btn, true, "…");
    try {
      await api("/api/lunoah/admin/pickup", { method: "POST", body: { id: b.id, result } });
      const first = String(b.name).split(" ")[0];
      await after(result === "picked_up" ? `Nice! ${first}'s order is complete.` : result === "no_show" ? `Marked ${first} as a no-show.` : "Moved back to Upcoming.");
    } catch (err) { toast(err.message, "bad"); busy(btn, false); }
  }

  async function cancel(b, btn) {
    const when = `${S.formatTime(b.time)} pickup on ${S.formatDate(b.date, "short")}`;
    const q = b.status === "paid"
      ? `Cancel ${b.name}'s ${when} and refund ${money(cents(b))} to their card?`
      : `Cancel ${b.name}'s ${when}? That time will open up for other customers.`;
    if (!confirm(q)) return;
    busy(btn, true, "…");
    try {
      const r = await api("/api/lunoah/admin/cancel", { method: "POST", body: { id: b.id } });
      if (r.refund_status === "failed") { toast("Cancelled, but the refund didn't go through. Tap “Retry refund”.", "bad"); await load(); changed(); }
      else await after(`Cancelled${r.refund_status === "refunded" ? ` and ${money(cents(b))} refunded` : ""}.`);
    } catch (err) { toast(err.message, "bad"); busy(btn, false); }
  }

  async function retryRefund(b, btn) {
    busy(btn, true, "…");
    try {
      const r = await api("/api/lunoah/admin/retry-refund", { method: "POST", body: { id: b.id } });
      if (r.refund_status === "refunded") await after(`Refunded ${money(cents(b))} to ${b.name}.`);
      else { toast("The refund still didn't go through. Please try again later.", "bad"); busy(btn, false); }
    } catch (err) { toast(err.message, "bad"); busy(btn, false); }
  }

  // Phone orders: record or change what they paid and how (for the Sales tab and taxes).
  let paying = null;
  function openPayment(b) {
    paying = b;
    $("#pmt-who").textContent = `${b.name} · ${S.formatDate(b.date, "short")} ${S.formatTime(b.time)}`;
    $("#pmt-amount").value = cents(b) ? (cents(b) / 100).toFixed(2) : "";
    $("#pmt-via").value = b.paid_via || "";
    $("#pmt-error").hidden = true;
    $("#payment-dialog").showModal();
  }
  $("#pmt-cancel").addEventListener("click", () => $("#payment-dialog").close());
  $("#payment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pay = window.LunoahMoney.readPayment($("#pmt-amount").value, $("#pmt-via").value);
    if (pay.error) { $("#pmt-error").textContent = pay.error; $("#pmt-error").hidden = false; return; }
    const btn = e.submitter || e.target.querySelector("[type=submit]");
    busy(btn, true);
    try {
      await api(`${COL}/${paying.id}`, { method: "PATCH", body: { amount_cents: pay.cents, total: pay.cents / 100, paid_via: pay.via } });
      $("#payment-dialog").close();
      await after(pay.via ? `Saved: ${money(pay.cents)} paid.` : "Saved as not paid yet.");
    } catch (err) { $("#pmt-error").textContent = err.message; $("#pmt-error").hidden = false; }
    finally { busy(btn, false); }
  });

  // ----- controls -----
  document.querySelectorAll(".or-view").forEach((t) => t.addEventListener("click", () => {
    view = t.dataset.view;
    document.querySelectorAll(".or-view").forEach((x) => {
      x.classList.toggle("active", x === t);
      x.setAttribute("aria-selected", String(x === t));
    });
    render();
  }));

  let searchTimer = null;
  $("#or-search").addEventListener("input", () => {
    query = $("#or-search").value;
    render(); // upcoming filters instantly
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => Promise.all([loadHistory("completed"), loadHistory("cancelled")]).then(render).catch(() => {}), 300);
  });

  $("#or-more").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, "Loading…");
    try { await loadHistory(view, true); render(); } catch (err) { toast(err.message, "bad"); } finally { busy(btn, false); }
  });

  // Keep it current: re-sort every minute (windows pass), reload when she comes back to the page.
  setInterval(render, 60000);
  setInterval(() => { if (loaded && document.visibilityState === "visible") load().catch(() => {}); }, 180000);
  document.addEventListener("visibilitychange", () => {
    if (loaded && document.visibilityState === "visible") load().catch(() => {});
  });
  document.addEventListener("lunoah:orders-changed", (e) => {
    if (!(e.detail && e.detail.from === "orders")) load().catch(() => {});
  });

  return { load };
};
