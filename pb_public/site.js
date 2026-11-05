(function () {
  const $ = (s) => document.querySelector(s);
  const cart = {}; // id -> qty
  let breads = [];
  let shop = {};
  let payMethods = [];

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

  async function load() {
    $("#year").textContent = new Date().getFullYear();
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
    if (shop.tagline) $("#tagline").textContent = shop.tagline;
    $("#about").textContent = shop.about || "";
    $("#pickup").textContent = shop.pickup_info || "";
    $("#order-note").textContent = shop.order_note || "";
    if (shop.hero) $("#hero-img").src = fileUrl(shop, "hero", "1600x0");

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

  // ---------- Checkout: 1 order → 2 pay → 3 send ----------
  let step = 1;
  let chosen = null; // payment method picked in step 2
  let orderCode = "";
  const needsPay = () => !!shop.require_payment && payMethods.length > 0;
  const amt = () => total().toFixed(2);

  function orderText() {
    const name = $("#o-name").value.trim();
    const day = $("#o-day").value.trim();
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
    if (notes) t += `Notes: ${notes}\n`;
    return t.trim();
  }

  function goStep(n) {
    if (n === 2 && !needsPay()) n = step < 2 ? 3 : 1; // skip paying when it's turned off
    step = n;
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

  function openDialog() {
    if (!orderCode) orderCode = "LUN-" + String(Math.floor(1000 + Math.random() * 9000));
    const ul = $("#order-lines");
    ul.replaceChildren(
      ...lines().map(({ b, q }) => el("li", {}, el("span", {}, `${q} × ${b.name}`), el("span", {}, money(q * b.price)))),
      el("li", { class: "total" }, el("span", {}, "Total"), el("span", {}, money(total())))
    );
    $("#to-step-2").textContent = needsPay() ? "Continue to payment →" : "Continue →";
    $("#co-paid").checked = false; // a changed cart means a new amount: confirm again
    goStep(1);
    $("#order-dialog").showModal();
  }

  $("#bar-btn").addEventListener("click", openDialog);
  $("#close-dialog").addEventListener("click", () => $("#order-dialog").close());
  $("#to-step-2").addEventListener("click", () => {
    if (!$("#o-name").value.trim()) { $("#o-name").focus(); $("#o-name").reportValidity(); return; }
    goStep(2);
  });
  $("#to-step-3").addEventListener("click", () => { if (!$("#to-step-3").disabled) goStep(3); });
  document.querySelectorAll("#order-form [data-back]").forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.back))));
  $("#co-paid").addEventListener("change", updateContinue);
  $("#co-payer").addEventListener("input", updateContinue);

  $("#send-text").addEventListener("click", () => {
    if (needsPay() && !(chosen && $("#co-paid").checked)) return goStep(2); // can't skip paying
    // "?&body=" works on both iPhone and Android. A real link click is more reliable than
    // setting location.href (which can leave the page stuck on desktop browsers).
    const a = el("a", { href: `sms:${digits(shop.phone)}?&body=${encodeURIComponent(orderText())}`, hidden: "" });
    document.body.append(a);
    a.click();
    a.remove();
  });
  $("#copy-order").addEventListener("click", async (e) => {
    if (needsPay() && !(chosen && $("#co-paid").checked)) return goStep(2);
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
