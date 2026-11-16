(function () {
  const $ = (s) => document.querySelector(s);
  const cart = {}; // id -> qty
  let breads = [];
  let shop = {};
  let online = false; // Stripe is set up on the server
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
    try {
      online = !!(await fetch("/api/lunoah/checkout-config").then((r) => r.json())).online;
    } catch (_) { online = false; }
    renderGrid();
    await pickupReady;
    resumeFromStripe();
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
      $("#phone-line").replaceChildren("Questions? Text Nadia at ", el("a", { href: "sms:" + phone }, shop.phone), ".");
      $("#review-ask").replaceChildren("Questions before you pay? Text Nadia at ", el("a", { href: "sms:" + phone }, shop.phone), ".");
      $("#review-ask").hidden = false;
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
    const canOrder = online;
    $("#ordering-paused").hidden = online;
    if (!online) $("#ordering-paused").textContent = `Online ordering is paused. Text Nadia at ${shop.phone || "the number on this page"}.`;
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
      pickupData = null; // checkout shows "Couldn't load pickup times"
    }
  }

  function computeSlots() {
    if (!pickupData) return;
    slots = S.availableSlots({
      hours: pickupData.hours,
      blocks: pickupData.blocks,
      leadDays: shop.lead_days ?? 2,
      taken: pickupData.taken,
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
    if (step === 1) { computeSlots(); renderCal(); }
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

  // ---------- Checkout: 1 your order → 2 review & pay (Stripe) ----------
  const SAVED = "lunoah_checkout";
  let step = 1;
  const save = (v) => { try { sessionStorage.setItem(SAVED, JSON.stringify(v)); } catch (_) {} };
  const saved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) || "null"); } catch (_) { return null; } };
  const phoneOk = (p) => { let d = p.replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 && !/^[01]/.test(d); };

  function goStep(n) {
    step = n;
    document.querySelectorAll("#order-form .step").forEach((sec) => (sec.hidden = Number(sec.dataset.step) !== n));
    document.querySelectorAll("#steps li").forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle("current", k === n);
      li.classList.toggle("done", k < n);
    });
    if (n === 2) renderReview();
    $("#order-form").scrollTop = 0;
  }

  function renderLines(ul) {
    ul.replaceChildren(
      ...lines().map(({ b, q }) => el("li", {}, el("span", {}, `${q} × ${b.name}`), el("span", {}, money(q * b.price)))),
      el("li", { class: "total" }, el("span", {}, "Total"), el("span", {}, money(total())))
    );
  }

  function renderReview() {
    renderLines($("#review-lines"));
    $("#review-pickup").textContent = `Pickup: ${pickupLabel()}` + (shop.pickup_location ? ` · ${shop.pickup_location}` : "");
    $("#review-contact").textContent = `${$("#o-name").value.trim()} · ${$("#o-phone").value.trim()}`;
    $("#pay-btn").textContent = `Pay ${money(total())} securely →`;
    $("#pay-btn").disabled = false;
  }

  function openDialog(notice) {
    renderLines($("#order-lines"));
    const usable = !!pickupData;
    $("#pickup-picker").hidden = !usable;
    $("#pickup-error").hidden = usable;
    if (usable) { computeSlots(); renderCal(); }
    $("#pickup-notice").hidden = true;
    $("#pay-error").hidden = true;
    $("#checkout-notice").hidden = !notice;
    if (notice) $("#checkout-notice").textContent = notice;
    goStep(1);
    if (!$("#order-dialog").open) $("#order-dialog").showModal();
    refreshTaken();
  }

  $("#bar-btn").addEventListener("click", () => openDialog(""));
  $("#close-dialog").addEventListener("click", () => $("#order-dialog").close());
  $("#to-step-2").addEventListener("click", () => {
    if (!$("#o-name").value.trim()) { $("#o-name").focus(); $("#o-name").reportValidity(); return; }
    if (!phoneOk($("#o-phone").value)) {
      $("#o-phone").setCustomValidity("Please enter a 10-digit phone number.");
      $("#o-phone").reportValidity();
      return;
    }
    if (!pickupData || !pickupLabel()) return;
    goStep(2);
  });
  $("#o-phone").addEventListener("input", () => $("#o-phone").setCustomValidity(""));
  document.querySelectorAll("#order-form [data-back]").forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.back))));

  function backToTimes(msg) {
    pick.time = "";
    goStep(1);
    refreshTaken().then(() => { computeSlots(); renderCal(); });
    $("#pickup-notice").textContent = msg;
    $("#pickup-notice").hidden = false;
  }

  $("#pay-btn").addEventListener("click", async () => {
    const btn = $("#pay-btn");
    btn.disabled = true;
    btn.textContent = "Holding your pickup time…";
    $("#pay-error").hidden = true;
    const prev = saved();
    const body = {
      items: lines().map(({ b, q }) => ({ id: b.id, qty: q })),
      date: pick.date, time: pick.time,
      name: $("#o-name").value.trim(), phone: $("#o-phone").value.trim(), notes: $("#o-notes").value.trim(),
      previous: prev && prev.token ? prev.token : "",
    };
    let res, data;
    try {
      res = await fetch("/api/lunoah/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      data = await res.json().catch(() => ({}));
    } catch (_) {
      data = { code: "network" };
    }
    if (res && res.ok && data.url) {
      save({ token: data.token, cart: { ...cart }, name: body.name, phone: body.phone, notes: body.notes, date: body.date, time: body.time });
      location.href = data.url;
      return;
    }
    renderReview();
    if (data.code === "taken") return backToTimes(`Sorry, ${S.formatTime(body.time)} was just taken. Please pick another time.`);
    if (data.code === "sold_out" || data.code === "unavailable") {
      const b = breads.find((x) => x.name === data.bread);
      if (b) { delete cart[b.id]; b.sold_out = true; renderGrid(); updateBar(); }
      $("#order-dialog").close();
      if (lines().length) openDialog(data.message);
      return;
    }
    $("#pay-error").textContent = data.code === "network"
      ? "We couldn't reach the bakery. Please check your connection and try again."
      : data.message || "Something went wrong. Please try again.";
    $("#pay-error").hidden = false;
  });

  // Came back from Stripe without paying (?back=<token>): free the hold and reopen checkout.
  async function resumeFromStripe() {
    const u = new URL(location.href);
    const back = u.searchParams.get("back");
    if (!back) return;
    history.replaceState(null, "", u.pathname + u.hash);
    const s = saved();
    try {
      await fetch("/api/lunoah/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: back }) });
    } catch (_) {}
    try { sessionStorage.removeItem(SAVED); } catch (_) {}
    if (!s || s.token !== back) return;
    for (const [id, q] of Object.entries(s.cart || {})) if (breads.some((b) => b.id === id && !b.sold_out)) cart[id] = q;
    renderGrid(); updateBar();
    if (!lines().length) return;
    $("#o-name").value = s.name || ""; $("#o-phone").value = s.phone || ""; $("#o-notes").value = s.notes || "";
    pick = { date: s.date || "", time: s.time || "" };
    await refreshTaken();
    openDialog("Payment not completed. Your pickup time was released.");
    if (pickupData && slots.some((d) => d.date === pick.date && d.times.includes(pick.time))) goStep(2);
  }

  load();
})();
