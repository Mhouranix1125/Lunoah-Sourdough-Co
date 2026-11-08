(function () {
  const $ = (s) => document.querySelector(s);
  const cart = {}; // id -> qty
  let breads = [];
  let shop = {};
  let payMethods = [];
  const S = window.LunoahSlots;
  let pickupData = null; // { hours, blocks } or null when the picker can't be used
  let slots = [];         // [{ date, times }] from slots.js
  let pick = { date: "", time: "" };
  let calMonth = "";      // "YYYY-MM" shown in the calendar

  const money = (n) => {
    n = Number(n) || 0;
    return "$" + (Number.isInteger(n) ? n : n.toFixed(2));
  };
  const fileUrl = (rec, field, thumb) =>
    `/api/files/${rec.collectionName}/${rec.id}/${encodeURIComponent(rec[field])}` + (thumb ? `?thumb=${thumb}` : "");
  const digits = (p) => (p || "").replace(/[^\d+]/g, "");

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) e.append(kid);
    return e;
  }

  let pickupReady = null; // promise for the pickup fetch, started in parallel with the rest
  let usingPicker = false; // which pickup input the current checkout session shows

  async function load() {
    $("#year").textContent = new Date().getFullYear();
    pickupReady = loadPickup();
    try {
      const [s, b] = await Promise.all([
        fetch("/api/collections/shop/records?perPage=1").then((r) => r.json()),
        fetch("/api/collections/breads/records?perPage=200&sort=sort,created").then((r) => r.json()),
      ]);
      shop = (s.items && s.items[0]) || {};
      breads = b.items || [];
    } catch (e) {
      $("#grid").innerHTML = '<p class="muted">Menu could not load. Please refresh.</p>';
      return;
    }
    renderShop();
    renderGrid();
    try {
      const p = await fetch("/api/collections/payment_methods/records?perPage=50&sort=sort,created").then((r) => r.json());
      renderPay(p.items || []);
    } catch (_) {}
    await pickupReady;
  }

  // ---------- How to pay ----------
  function svg(html) {
    const s = document.createElement("span");
    s.className = "pay-logo";
    s.innerHTML = html; // static SVG from pay-apps.js (no user content)
    return s;
  }

  function copyBtn(text) {
    return el("button", {
      type: "button", class: "copy",
      onclick: async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(text); } catch (_) { prompt("Copy:", text); return; }
        b.textContent = "Copied!";
        setTimeout(() => (b.textContent = "Copy"), 1800);
      },
    }, "Copy");
  }

  function payDetails(m) {
    const app = PAY_APPS[m.kind] || PAY_APPS.other;
    const rows = [];
    const row = (label, value) => rows.push(el("div", { class: "pay-row" }, el("span", { class: "pay-label" }, label), el("strong", { class: "pay-value" }, value), copyBtn(value)));
    if (m.handle && app.handle) row(app.handle.label.replace(/^\$Cashtag$/, "Cashtag"), (app.handle.prefix || "") + m.handle);
    if (m.phone) row("Phone", m.phone);
    if (m.email) row("Email", m.email);

    const info = el("div", { class: "pay-info" },
      el("h3", {}, svg(app.logo), payName(m)),
      ...rows
    );
    const link = app.link && app.link(m);
    if (link) info.append(el("a", { class: "btn", href: link, target: "_blank", rel: "noopener" }, app.linkLabel + " ↗"));
    if (app.tip) info.append(el("p", { class: "muted small" }, app.tip));
    if (m.note) info.append(el("p", { class: "pay-note" }, m.note));
    info.append(el("p", { class: "muted small" }, "Please include your name so we can match your payment to your order."));

    const parts = [info];
    if (m.qr) {
      parts.unshift(el("figure", { class: "pay-qr" },
        el("img", { src: fileUrl(m, "qr"), alt: payName(m) + " QR code" }),
        el("figcaption", {}, "Scan with your phone's camera")
      ));
    }
    return parts;
  }

  function renderPay(methods) {
    payMethods = methods;
    if (!methods.length) return;
    $("#pay").hidden = false;
    $("#nav-pay").hidden = false;
    const logos = $("#pay-logos");
    const panel = $("#pay-panel");
    let open = null;
    logos.replaceChildren(...methods.map((m) => {
      const btn = el("button", { type: "button", class: "pay-btn", "aria-expanded": "false", "aria-controls": "pay-panel" },
        svg((PAY_APPS[m.kind] || PAY_APPS.other).logo), el("span", {}, payName(m)));
      btn.addEventListener("click", () => {
        logos.querySelectorAll(".pay-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-expanded", "false"); });
        if (open === m.id) { open = null; panel.hidden = true; return; }
        open = m.id;
        btn.classList.add("active");
        btn.setAttribute("aria-expanded", "true");
        panel.replaceChildren(...payDetails(m));
        panel.hidden = false;
      });
      return btn;
    }));

  }

  function renderShop() {
    window.LunoahTheme && window.LunoahTheme.apply(shop.theme);
    if (shop.tagline) $("#tagline").textContent = shop.tagline;
    $("#about").textContent = shop.about || "";
    $("#pickup").textContent = shop.pickup_info || "";
    $("#order-note").textContent = shop.order_note || "";
    const loc = shop.pickup_location || "";
    $("#pickup-location-text").textContent = loc;
    if (loc) $("#pickup-map").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(loc);
    $("#pickup-location").hidden = !loc;
    $("#pickup-at").textContent = loc ? `Pickup at ${loc}.` : "";
    $("#pickup-at").hidden = !loc;
    for (const id of ["#allergy-note", "#allergy-footer"]) {
      $(id).textContent = shop.allergy_note || "";
      $(id).hidden = !shop.allergy_note;
    }
    // Nadia's own top photo, if she added one; otherwise the hero text stands alone
    $("#hero-wrap").hidden = !shop.hero;
    document.querySelector(".hero").classList.toggle("no-photo", !shop.hero);
    if (shop.hero) $("#hero-img").src = fileUrl(shop, "hero", "1600x0");

    // "Meet Nadia" section: only when she has written a story
    const story = (shop.nadia_story || "").trim();
    $("#nadia").hidden = !story;
    if (story) {
      $("#nadia-title").textContent = (shop.nadia_title || "").trim() || "Meet Nadia";
      $("#nadia-story").replaceChildren(...story.split(/\n\s*\n/).filter((t) => t.trim()).map((para) => {
        const p = el("p");
        para.trim().split("\n").forEach((line, i) => { if (i) p.append(el("br")); p.append(line); });
        return p;
      }));
      const ph = $("#nadia-photo");
      ph.hidden = !shop.nadia_photo;
      if (shop.nadia_photo) ph.src = fileUrl(shop, "nadia_photo", "600x600");
      $(".nadia-photo-wrap").hidden = !shop.nadia_photo;
    }

    const phone = digits(shop.phone);
    if (phone) {
      $("#phone-line").replaceChildren(
        "Text your order to ",
        el("br"),
        el("a", { class: "phone-big", href: "sms:" + phone }, shop.phone)
      );
      document.querySelectorAll(".phone-text").forEach((n) => (n.textContent = shop.phone));
    }
    if (shop.instagram) {
      const handle = shop.instagram.replace(/^@/, "");
      $("#insta").replaceChildren(" · ", el("a", { href: "https://instagram.com/" + encodeURIComponent(handle), target: "_blank", rel: "noopener" }, "@" + handle));
    }
  }

  function renderGrid() {
    const grid = $("#grid");
    if (!breads.length) {
      grid.innerHTML = '<p class="muted">Fresh bread is coming soon. Check back shortly!</p>';
      return;
    }
    const canOrder = !!digits(shop.phone);
    grid.replaceChildren(
      ...breads.map((b) => {
        const qtyEl = el("span", {}, String(cart[b.id] || 0));
        const change = (d) => {
          cart[b.id] = Math.max(0, (cart[b.id] || 0) + d);
          qtyEl.textContent = cart[b.id];
          updateBar();
        };
        return el(
          "article",
          { class: "card" + (b.sold_out ? " sold" : "") },
          el(
            "div",
            { class: "card-img" },
            el("img", { src: b.photo ? fileUrl(b, "photo", "800x600") : "/img/placeholder-loaf.webp", alt: b.name, loading: "lazy" }),
            b.sold_out ? el("span", { class: "badge" }, "Sold out") : null
          ),
          el(
            "div",
            { class: "card-body" },
            el("div", { class: "card-top" }, el("h3", {}, b.name), el("span", { class: "price" }, money(b.price))),
            b.description ? el("p", {}, b.description) : null,
            canOrder && !b.sold_out
              ? el(
                  "div",
                  { class: "qty" },
                  el("button", { type: "button", "aria-label": "Remove one " + b.name, onclick: () => change(-1) }, "−"),
                  qtyEl,
                  el("button", { type: "button", "aria-label": "Add one " + b.name, onclick: () => change(1) }, "+")
                )
              : null
          )
        );
      })
    );
  }

  function lines() {
    return breads.filter((b) => cart[b.id] > 0).map((b) => ({ b, q: cart[b.id] }));
  }
  function total() {
    return lines().reduce((s, { b, q }) => s + q * (Number(b.price) || 0), 0);
  }

  function updateBar() {
    const ls = lines();
    const count = ls.reduce((s, l) => s + l.q, 0);
    $("#bar").hidden = count === 0;
    $("#bar-summary").textContent = `${count} ${count === 1 ? "loaf" : "loaves"} · ${money(total())}`;
  }

  // ---------- Pickup time picker ----------
  const takenUrl = () => `/api/lunoah/taken?from=${S.localParts(new Date(), S.SHOP_TZ).date}`;

  async function loadPickup() {
    const today = S.localParts(new Date(), S.SHOP_TZ).date;
    const blocksUrl = "/api/collections/pickup_blocks/records?perPage=500&sort=start_date" +
      `&fields=start_date,end_date,all_day,from,to&filter=${encodeURIComponent(`end_date >= '${today}'`)}`;
    try {
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [h, b, t] = await Promise.all([
        get("/api/collections/pickup_hours/records?perPage=200"),
        get(blocksUrl),
        get(takenUrl()),
      ]);
      pickupData = { hours: h.items || [], blocks: b.items || [], taken: t.taken || [] };
    } catch (_) {
      pickupData = null; // fall back to the free-text box
    }
  }

  const myBookings = new Set(); // "date time" pairs this page has booked (orderCode is fixed per page)

  function computeSlots() {
    if (!pickupData) return;
    slots = S.availableSlots({
      hours: pickupData.hours,
      blocks: pickupData.blocks,
      leadDays: shop.lead_days ?? 2,
      taken: pickupData.taken.filter((t) => !myBookings.has(`${t.date} ${t.time}`)),
      slotMinutes: shop.slot_minutes || 15,
      bookAheadDays: shop.book_ahead_days || 21,
      now: new Date(),
      tz: S.SHOP_TZ,
    });
    const day = slots.find((d) => d.date === pick.date);
    if (!day) pick = { date: slots[0] ? slots[0].date : "", time: "" };
    else if (!day.times.includes(pick.time)) pick.time = "";
    calMonth = (pick.date || S.localParts(new Date(), S.SHOP_TZ).date).slice(0, 7);
  }

  // Re-check which times are booked each time checkout opens (another customer may have just booked).
  async function refreshTaken() {
    if (!pickupData) return;
    try {
      const r = await fetch(takenUrl());
      if (!r.ok) return;
      pickupData.taken = (await r.json()).taken || [];
    } catch (_) { return; } // keep the last known list
    if (usingPicker && step === 1) { computeSlots(); renderCal(); }
  }

  function shiftMonth(n) {
    const [y, m] = calMonth.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    calMonth = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    renderCal();
  }

  const pickupLabel = () => (pick.date && pick.time ? `${S.formatDate(pick.date)} at ${S.formatTime(pick.time)}` : "");

  function renderCal() {
    const avail = new Map(slots.map((d) => [d.date, d.times]));
    const [y, m] = calMonth.split("-").map(Number);
    $("#cal-title").textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
    const today = S.localParts(new Date(), S.SHOP_TZ).date;
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < S.weekday(`${calMonth}-01`); i++) cells.push(el("span", { class: "cal-day empty" }));
    for (let d = 1; d <= daysIn; d++) {
      const date = `${calMonth}-${String(d).padStart(2, "0")}`;
      const open = avail.has(date);
      const cls = "cal-day" + (date === today ? " today" : "") + (date === pick.date ? " selected" : "");
      const b = el("button", { type: "button", class: cls, "aria-label": S.formatDate(date) + (open ? "" : ", not available") }, String(d));
      if (open) b.addEventListener("click", () => { pick = { date, time: "" }; renderCal(); });
      else b.disabled = true;
      cells.push(b);
    }
    $("#cal-days").replaceChildren(...cells);

    const first = slots.length ? slots[0].date.slice(0, 7) : calMonth;
    const last = slots.length ? slots[slots.length - 1].date.slice(0, 7) : calMonth;
    $("#cal-prev").disabled = calMonth <= first;
    $("#cal-next").disabled = calMonth >= last;

    const times = avail.get(pick.date) || [];
    $("#cal-times").replaceChildren(...times.map((t) => {
      const b = el("button", { type: "button", class: "time-btn" + (t === pick.time ? " selected" : "") }, S.formatTime(t));
      b.addEventListener("click", () => { pick.time = t; $("#pickup-notice").hidden = true; renderCal(); });
      return b;
    }));

    $("#cal-summary").textContent = !slots.length
      ? "No pickup times are open right now. Please check back soon."
      : pickupLabel() || (pick.date ? `${S.formatDate(pick.date)}: now choose a time.` : "Choose a day.");
    $("#cal-summary").classList.toggle("chosen", !!pickupLabel());
    $("#to-step-2").disabled = !pickupLabel();
  }

  $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("#cal-next").addEventListener("click", () => shiftMonth(1));

  // ---------- Checkout: 1 order → 2 pay → 3 send ----------
  let step = 1;
  let chosen = null; // payment method picked in step 2
  let orderCode = "";
  const needsPay = () => !!shop.require_payment && payMethods.length > 0;
  const amt = () => total().toFixed(2);

  function orderText() {
    const name = $("#o-name").value.trim();
    const day = usingPicker ? pickupLabel() : $("#o-day").value.trim();
    const notes = $("#o-notes").value.trim();
    let t = `Hi Lunoah! Order ${orderCode}\n`;
    for (const { b, q } of lines()) t += `• ${q} × ${b.name} (${money(q * b.price)})\n`;
    t += `Total: ${money(total())}\n`;
    if (needsPay() && chosen) {
      const payer = $("#co-payer").value.trim();
      t += `Paid: ${money(total())} via ${payName(chosen)}${payer ? ` (from ${payer})` : ""}\n`;
    }
    if (name) t += `Name: ${name}\n`;
    if (day) t += `Pickup: ${day}\n`;
    if (day && shop.pickup_location) t += `Pickup at: ${shop.pickup_location}\n`;
    if (notes) t += `Notes: ${notes}\n`;
    return t.trim();
  }

  function goStep(n) {
    if (n === 2 && !needsPay()) n = step < 2 ? 3 : 1; // skip paying when it's turned off
    step = n;
    $("#sms-fallback").hidden = true;
    $("#order-received").hidden = true;
    document.querySelectorAll("#order-form .step").forEach((sec) => (sec.hidden = Number(sec.dataset.step) !== n));
    $("#steps-pay").hidden = !needsPay();
    document.querySelectorAll("#steps li").forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle("current", k === n);
      li.classList.toggle("done", k < n);
    });
    $("#back-to-pay").textContent = "← Back";
    $("#back-to-pay").dataset.back = needsPay() ? "2" : "1";
    if (n === 2) renderCheckoutApps();
    if (n === 3) $("#order-preview").textContent = orderText();
    $("#order-form").scrollTop = 0;
  }

  function infoRow(label, value, copyValue) {
    return el("div", { class: "pay-row" }, el("span", { class: "pay-label" }, label), el("strong", { class: "pay-value" }, value), copyBtn(copyValue || value));
  }

  function renderCheckoutApps() {
    $("#pay-total").textContent = money(total());
    const box = $("#co-apps");
    box.replaceChildren(...payMethods.map((m) => {
      const b = el("button", { type: "button", class: "pay-btn" + (chosen && chosen.id === m.id ? " active" : "") },
        svg((PAY_APPS[m.kind] || PAY_APPS.other).logo), el("span", {}, payName(m)));
      b.addEventListener("click", () => { chosen = m; $("#co-paid").checked = false; renderCheckoutApps(); });
      return b;
    }));
    const panel = $("#co-panel");
    $("#co-confirm").hidden = panel.hidden = !chosen;
    if (!chosen) return updateContinue();

    const m = chosen;
    const app = PAY_APPS[m.kind] || PAY_APPS.other;
    const note = `Lunoah order ${orderCode}`;
    const info = el("div", { class: "pay-info" },
      infoRow("Amount", money(total()), amt()));
    if (m.handle && app.handle) info.append(infoRow(app.handle.label.replace(/^\$Cashtag$/, "Cashtag"), (app.handle.prefix || "") + m.handle));
    if (m.phone) info.append(infoRow("Phone", m.phone));
    if (m.email) info.append(infoRow("Email", m.email));
    info.append(infoRow("Payment note", note.replace("-", "‑"), note)); // non-breaking hyphen on screen only
    const link = (app.payLink && app.payLink(m, amt(), note)) || (app.link && app.link(m));
    if (link) info.append(el("a", { class: "btn", href: link, target: "_blank", rel: "noopener" },
      app.payLink ? `${app.linkLabel}: ${money(total())} filled in ↗` : `${app.linkLabel} ↗`));
    if (app.tip) info.append(el("p", { class: "muted small" }, app.tip));
    if (m.note) info.append(el("p", { class: "pay-note" }, m.note));
    const parts = [info];
    if (m.qr) parts.push(el("figure", { class: "pay-qr" },
      el("img", { src: fileUrl(m, "qr"), alt: payName(m) + " QR code" }),
      el("figcaption", {}, m.kind === "zelle" ? "Or scan in your bank's app" : "Or scan with your phone's camera")));
    panel.replaceChildren(...parts);

    $("#co-paid-label").textContent = `I've sent ${money(total())} with ${payName(m)}`;
    if (!$("#co-payer").value.trim()) $("#co-payer").value = $("#o-name").value.trim();
    updateContinue();
  }

  function updateContinue() {
    $("#to-step-3").disabled = !(chosen && $("#co-paid").checked && $("#co-payer").value.trim());
  }

  function showReceived() {
    $("#order-received-text").textContent = shop.order_received || "Your order has been received. Nadia will reach out to you shortly.";
    $("#order-received").hidden = false;
  }

  function openDialog() {
    if (!orderCode) orderCode = "LUN-" + String(Math.floor(1000 + Math.random() * 9000));
    const ul = $("#order-lines");
    ul.replaceChildren(
      ...lines().map(({ b, q }) => el("li", {}, el("span", {}, `${q} × ${b.name}`), el("span", {}, money(q * b.price)))),
      el("li", { class: "total" }, el("span", {}, "Total"), el("span", {}, money(total())))
    );
    $("#to-step-2").textContent = needsPay() ? "Continue to payment →" : "Continue →";
    $("#co-paid").checked = false; // a changed cart means a new amount: confirm again
    usingPicker = !!pickupData; // fixed for this dialog session, even if the data arrives late
    $("#pickup-picker").hidden = !usingPicker;
    $("#o-day-wrap").hidden = usingPicker;
    if (usingPicker) { computeSlots(); renderCal(); }
    $("#pickup-notice").hidden = true; $("#send-error").hidden = true; $("#sms-fallback").hidden = true; $("#order-received").hidden = true;
    goStep(1);
    $("#order-dialog").showModal();
    refreshTaken();
  }

  $("#bar-btn").addEventListener("click", openDialog);
  $("#close-dialog").addEventListener("click", () => $("#order-dialog").close());
  $("#to-step-2").addEventListener("click", () => {
    if (!$("#o-name").value.trim()) { $("#o-name").focus(); $("#o-name").reportValidity(); return; }
    if (usingPicker && !pickupLabel()) return;
    goStep(2);
  });
  $("#to-step-3").addEventListener("click", () => { if (!$("#to-step-3").disabled) goStep(3); });
  document.querySelectorAll("#order-form [data-back]").forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.back))));
  $("#co-paid").addEventListener("change", updateContinue);
  $("#co-payer").addEventListener("input", updateContinue);

  // ---------- Booking the pickup time ----------
  const BTN_SEND = "Open Messages";

  function setSending(on) {
    $("#send-text").disabled = on;
    $("#copy-order").disabled = on;
    $("#send-text").textContent = on ? "Saving your pickup time…" : BTN_SEND;
  }

  // Saves the booking. Returns true when the order may be sent.
  async function reserve() {
    if (!usingPicker) return true; // free-text fallback: nothing to book
    const key = `${pick.date} ${pick.time}`;
    if (myBookings.has(key)) return true;
    $("#send-error").hidden = true;
    setSending(true);
    try {
      const res = await fetch("/api/collections/bookings/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: pick.date,
          time: pick.time,
          name: $("#o-name").value.trim(),
          items: lines().map(({ b, q }) => `${q} × ${b.name}`).join(", "),
          total: total(),
          order_code: orderCode,
        }),
      });
      if (res.ok) { myBookings.add(key); return true; }
      const body = await res.json().catch(() => ({}));
      const d = body.data || {};
      const isTaken = res.status === 400 && [d.date, d.time].some((x) => x && /not_unique/.test(x.code || ""));
      if (isTaken) {
        const lost = S.formatTime(pick.time);
        pickupData.taken.push({ date: pick.date, time: pick.time });
        pick.time = "";
        goStep(1);
        computeSlots();
        renderCal();
        $("#pickup-notice").textContent = `Sorry, ${lost} was just taken. Please pick another time.`;
        $("#pickup-notice").hidden = false;
        refreshTaken();
        return false;
      }
      throw new Error(String(res.status));
    } catch (_) {
      $("#send-error").textContent = "We couldn't save your pickup time. Please check your connection and try again.";
      $("#send-error").hidden = false;
      return false;
    } finally {
      setSending(false);
    }
  }

  $("#send-text").addEventListener("click", async () => {
    if (needsPay() && !(chosen && $("#co-paid").checked)) return goStep(2); // can't skip paying
    if (!(await reserve())) return;
    showReceived();
    // "?&body=" works on both iPhone and Android. A real link click is more reliable than
    // setting location.href (which can leave the page stuck on desktop browsers).
    const href = `sms:${digits(shop.phone)}?&body=${encodeURIComponent(orderText())}`;
    const a = el("a", { href, hidden: "" });
    document.body.append(a);
    a.click();
    a.remove();
    // Saving the booking took a moment, and some phones then refuse to open Messages
    // automatically, so offer a real link the customer can tap.
    $("#sms-link").href = href;
    $("#sms-fallback").hidden = false;
  });
  $("#copy-order").addEventListener("click", async (e) => {
    if (needsPay() && !(chosen && $("#co-paid").checked)) return goStep(2);
    if (!(await reserve())) return;
    showReceived();
    try {
      await navigator.clipboard.writeText(orderText());
      e.target.textContent = "Copied!";
      setTimeout(() => (e.target.textContent = "Copy order"), 2000);
    } catch (_) {
      prompt("Copy your order:", orderText());
    }
  });

  load();
})();
