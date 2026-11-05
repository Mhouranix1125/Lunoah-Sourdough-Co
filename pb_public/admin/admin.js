(function () {
  const $ = (s) => document.querySelector(s);
  const TOKEN_KEY = "lunoah_token";
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let me = null;
  let breads = [];
  let shop = null;
  let editing = null; // bread record or null for new
  let pendingPhoto = null; // File to upload
  let removePhoto = false;
  let pendingHero = null;
  let removeHero = false;

  // ---------- helpers ----------
  const money = (n) => "$" + (Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2));
  const fileUrl = (rec, field, thumb) =>
    `/api/files/${rec.collectionName}/${rec.id}/${encodeURIComponent(rec[field])}` + (thumb ? `?thumb=${thumb}` : "");

  function toast(msg, kind = "ok") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + kind;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), kind === "bad" ? 5000 : 2200);
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = {};
    if (token) headers.Authorization = token;
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers, body: payload });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && me) { logout(); throw new Error("Please log in again."); }
    if (!res.ok) {
      const fieldMsg = data.data && Object.values(data.data)[0];
      throw new Error((fieldMsg && fieldMsg.message) || data.message || "Something went wrong. Please try again.");
    }
    return data;
  }

  // Shrink big phone photos before uploading (faster, and fits the site nicely).
  async function shrinkPhoto(file, type = "image/jpeg") {
    try {
      const bmp = await createImageBitmap(file);
      const max = 1600;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, type, 0.86));
      if (!blob) throw new Error("encode failed");
      return new File([blob], type === "image/png" ? "photo.png" : "photo.jpg", { type });
    } catch (_) {
      if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
      throw new Error("That photo type can't be used here. Please choose a JPG or PNG photo.");
    }
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn._label = btn.textContent; btn.textContent = label || "Saving…"; btn.disabled = true; }
    else { btn.textContent = btn._label || btn.textContent; btn.disabled = false; }
  }

  // ---------- auth ----------
  async function start() {
    if (token) {
      try {
        const r = await api("/api/collections/bakers/auth-refresh", { method: "POST" });
        setAuth(r);
        return showApp();
      } catch (_) { token = ""; localStorage.removeItem(TOKEN_KEY); }
    }
    showLogin();
  }

  function setAuth(r) {
    token = r.token;
    me = r.record;
    localStorage.setItem(TOKEN_KEY, token);
  }

  async function showLogin() {
    $("#app-view").hidden = true;
    let status = { needsSetup: false };
    try { status = await fetch("/api/lunoah/status").then((r) => r.json()); } catch (_) {}
    $("#login-view").hidden = status.needsSetup;
    $("#setup-view").hidden = !(status.needsSetup && status.canSetupHere);
    $("#nosetup-view").hidden = !(status.needsSetup && !status.canSetupHere);
    if (!status.needsSetup) $("#l-email").focus();
    else if (status.canSetupHere) $("#su-email").focus();
  }

  $("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const err = $("#setup-error");
    err.hidden = true;
    if ($("#su-pass").value !== $("#su-pass2").value) {
      err.textContent = "The two passwords don't match.";
      err.hidden = false;
      return;
    }
    busy(btn, true, "Creating…");
    try {
      await api("/api/lunoah/setup", {
        method: "POST",
        body: { name: $("#su-name").value, email: $("#su-email").value.trim(), password: $("#su-pass").value },
      });
      const r = await api("/api/collections/bakers/auth-with-password", {
        method: "POST",
        body: { identity: $("#su-email").value.trim(), password: $("#su-pass").value },
      });
      setAuth(r);
      $("#setup-view").hidden = true;
      await showApp();
      toast("Your login is ready. Welcome!");
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { busy(btn, false); }
  });

  function logout() {
    token = ""; me = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    $("#login-error").hidden = true;
    busy(btn, true, "Logging in…");
    try {
      const r = await api("/api/collections/bakers/auth-with-password", {
        method: "POST",
        body: { identity: $("#l-email").value.trim(), password: $("#l-pass").value },
      });
      setAuth(r);
      $("#l-pass").value = "";
      showApp();
    } catch (err) {
      $("#login-error").textContent = "That email or password didn't work. Please try again.";
      $("#login-error").hidden = false;
    } finally { busy(btn, false); }
  });

  $("#logout").addEventListener("click", logout);

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      for (const name of ["breads", "shop", "pay"]) $("#tab-" + name).hidden = t.dataset.tab !== name;
    })
  );

  async function showApp() {
    $("#login-view").hidden = true;
    $("#setup-view").hidden = true;
    $("#nosetup-view").hidden = true;
    $("#app-view").hidden = false;
    await Promise.all([loadBreads(), loadShop(), loadPay()]);
  }

  // ---------- payment methods ----------
  let pays = [];
  let payEditing = null; // record being edited, or null when adding
  let payKind = null;
  let pendingQr = null, removeQr = false;

  function logoEl(kind, cls = "pay-logo") {
    const s = document.createElement("span");
    s.className = cls;
    s.innerHTML = (PAY_APPS[kind] || PAY_APPS.other).logo; // static SVG from pay-apps.js
    return s;
  }

  function paySummary(m) {
    const app = PAY_APPS[m.kind] || PAY_APPS.other;
    const bits = [];
    if (m.handle) bits.push((app.handle && app.handle.prefix || "") + m.handle);
    if (m.phone) bits.push(m.phone);
    if (m.email) bits.push(m.email);
    if (m.qr) bits.push("QR code ✓");
    return bits.join(" · ") || "No details yet. Tap Edit.";
  }

  async function loadPay() {
    const r = await api("/api/collections/payment_methods/records?perPage=50&sort=sort,created");
    pays = r.items;
    renderPay();
  }

  function renderPay() {
    const ul = $("#pay-list");
    if (!pays.length) {
      ul.innerHTML = '<li class="hint">No payment apps yet. Tap “Add a payment app”.</li>';
      return;
    }
    ul.replaceChildren(...pays.map((m, i) => {
      const li = document.createElement("li");
      li.className = "bread pay-item";
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = payName(m);
      if (!m.enabled) name.insertAdjacentHTML("beforeend", ' <span class="tag hidden">Hidden</span>');
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = paySummary(m);
      info.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "bread-actions";
      const sw = document.createElement("label");
      sw.className = "switch";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!m.enabled;
      cb.addEventListener("change", async () => {
        try {
          pays[i] = await api(`/api/collections/payment_methods/records/${m.id}`, { method: "PATCH", body: { enabled: cb.checked } });
          renderPay();
          toast(cb.checked ? `${payName(m)} is on your website` : `${payName(m)} is hidden from your website`);
        } catch (err) { cb.checked = !cb.checked; toast(err.message, "bad"); }
      });
      sw.append(cb, "Show");
      actions.append(sw, mk("button", "btn small", "Edit", () => openPay(m.kind, m)));

      li.append(logoEl(m.kind, "pay-logo big"), info, actions);
      return li;
    }));
  }

  // "Which app?" picker
  $("#pay-pick").replaceChildren(...PAY_ORDER.map((kind) => {
    const b = mk("button", "pay-choice", "", () => { $("#pay-pick-dialog").close(); openPay(kind, null); });
    b.append(logoEl(kind), document.createTextNode(PAY_APPS[kind].name));
    return b;
  }));
  $("#add-pay").addEventListener("click", () => $("#pay-pick-dialog").showModal());

  function openPay(kind, m) {
    payKind = kind;
    payEditing = m || null;
    pendingQr = null; removeQr = false;
    const app = PAY_APPS[kind] || PAY_APPS.other;
    $("#pay-title").textContent = m ? payName(m) : app.name;
    $("#pay-title-logo").innerHTML = app.logo;

    $("#pf-label-wrap").hidden = !app.custom;
    $("#pf-label").required = !!app.custom;
    $("#pf-label").value = (m && m.label) || "";

    const field = (key, wrapId, labelId, inputId) => {
      const cfg = app[key];
      $(wrapId).hidden = !cfg;
      if (!cfg) { $(inputId).value = ""; return; }
      $(labelId).textContent = cfg.label;
      $(inputId).placeholder = cfg.placeholder || "";
      $(inputId).value = (m && m[key]) || "";
    };
    field("handle", "#pf-handle-wrap", "#pf-handle-label", "#pf-handle");
    $("#pf-handle-prefix").textContent = (app.handle && app.handle.prefix) || "";
    $("#pf-handle-prefix").hidden = !(app.handle && app.handle.prefix);
    field("phone", "#pf-phone-wrap", "#pf-phone-label", "#pf-phone");
    field("email", "#pf-email-wrap", "#pf-email-label", "#pf-email");

    $("#pf-note").value = (m && m.note) || "";
    $("#pf-enabled").checked = m ? !!m.enabled : true;
    setPreview($("#pf-qr-preview"), m && m.qr ? fileUrl(m, "qr", "600x600") : "");
    $("#pf-qr-remove").hidden = !(m && m.qr);
    $("#pay-delete").hidden = !m;
    $("#pay-dialog").showModal();
  }

  $("#pay-cancel").addEventListener("click", () => $("#pay-dialog").close());

  $("#pf-qr-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      pendingQr = await shrinkPhoto(f, "image/png"); // PNG keeps QR codes sharp
      removeQr = false;
      setPreview($("#pf-qr-preview"), URL.createObjectURL(pendingQr));
      $("#pf-qr-remove").hidden = false;
    } catch (err) { toast(err.message, "bad"); }
  });
  $("#pf-qr-remove").addEventListener("click", () => {
    pendingQr = null; removeQr = true;
    setPreview($("#pf-qr-preview"), "");
    $("#pf-qr-remove").hidden = true;
  });

  $("#pay-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#pay-save");
    const app = PAY_APPS[payKind] || PAY_APPS.other;
    const handle = app.handle ? payStrip($("#pf-handle").value) : "";
    const phone = app.phone ? $("#pf-phone").value.trim() : "";
    const email = app.email ? $("#pf-email").value.trim() : "";
    const hasQr = pendingQr || (payEditing && payEditing.qr && !removeQr);
    if (!handle && !phone && !email && !hasQr) {
      return toast("Please add at least one way to pay: a username, phone, email or QR code.", "bad");
    }
    const fd = new FormData();
    fd.append("kind", payKind);
    fd.append("label", app.custom ? $("#pf-label").value.trim() : "");
    fd.append("handle", handle);
    fd.append("phone", phone);
    fd.append("email", email);
    fd.append("note", $("#pf-note").value.trim());
    fd.append("enabled", $("#pf-enabled").checked ? "true" : "false");
    if (pendingQr) fd.append("qr", pendingQr);
    else if (removeQr) fd.append("qr", "");
    if (!payEditing) fd.append("sort", String((pays.length + 1) * 10));
    busy(btn, true);
    try {
      if (payEditing) await api(`/api/collections/payment_methods/records/${payEditing.id}`, { method: "PATCH", body: fd });
      else await api("/api/collections/payment_methods/records", { method: "POST", body: fd });
      $("#pay-dialog").close();
      toast(payEditing ? "Saved!" : `${app.custom ? $("#pf-label").value.trim() || "Payment method" : app.name} added!`);
      await loadPay();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  $("#pay-delete").addEventListener("click", async () => {
    if (!payEditing) return;
    if (!confirm(`Remove ${payName(payEditing)} from your payment methods?\n\nTip: to hide it for now, just turn off “Show”.`)) return;
    try {
      await api(`/api/collections/payment_methods/records/${payEditing.id}`, { method: "DELETE" });
      $("#pay-dialog").close();
      toast("Payment method removed");
      await loadPay();
    } catch (err) { toast(err.message, "bad"); }
  });

  // ---------- breads ----------
  async function loadBreads() {
    const r = await api("/api/collections/breads/records?perPage=200&sort=sort,created");
    breads = r.items;
    renderBreads();
  }

  function renderBreads() {
    const ul = $("#bread-list");
    if (!breads.length) {
      ul.innerHTML = '<li class="hint">No breads yet. Tap “Add a new bread” to get started.</li>';
      return;
    }
    ul.replaceChildren(...breads.map((b, i) => {
      const li = document.createElement("li");
      li.className = "bread";
      const img = document.createElement("img");
      img.src = b.photo ? fileUrl(b, "photo", "400x300") : "/img/placeholder-loaf.webp";
      img.alt = "";

      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = b.name;
      if (b.hidden) name.insertAdjacentHTML("beforeend", ' <span class="tag hidden">Hidden</span>');
      else if (b.sold_out) name.insertAdjacentHTML("beforeend", ' <span class="tag sold">Sold out</span>');
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = money(b.price || 0);
      info.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "bread-actions";
      const sw = document.createElement("label");
      sw.className = "switch";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!b.sold_out;
      cb.addEventListener("change", async () => {
        try {
          const updated = await api(`/api/collections/breads/records/${b.id}`, { method: "PATCH", body: { sold_out: cb.checked } });
          breads[i] = updated;
          renderBreads();
          toast(cb.checked ? `${b.name} marked sold out` : `${b.name} is available again`);
        } catch (err) { cb.checked = !cb.checked; toast(err.message, "bad"); }
      });
      sw.append(cb, "Sold out");

      const row = document.createElement("div");
      row.className = "row";
      const up = mk("button", "move", "▲", () => move(i, -1)); up.disabled = i === 0; up.title = "Move up";
      const down = mk("button", "move", "▼", () => move(i, 1)); down.disabled = i === breads.length - 1; down.title = "Move down";
      const edit = mk("button", "btn small", "Edit", () => openEdit(b));
      row.append(up, down, edit);
      actions.append(sw, row);

      li.append(img, info, actions);
      return li;
    }));
  }

  function mk(tag, cls, text, onClick) {
    const e = document.createElement(tag);
    e.className = cls; e.textContent = text; e.type = "button";
    e.addEventListener("click", onClick);
    return e;
  }

  async function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= breads.length) return;
    [breads[i], breads[j]] = [breads[j], breads[i]];
    renderBreads();
    try {
      await Promise.all(breads.map((b, idx) => {
        const sort = (idx + 1) * 10;
        if (b.sort === sort) return null;
        b.sort = sort;
        return api(`/api/collections/breads/records/${b.id}`, { method: "PATCH", body: { sort } });
      }));
    } catch (err) { toast(err.message, "bad"); loadBreads(); }
  }

  // ---------- edit dialog ----------
  function setPreview(imgEl, src) {
    if (src) imgEl.src = src; else imgEl.removeAttribute("src");
    imgEl.nextElementSibling.hidden = !!src;
  }

  function openEdit(b) {
    editing = b || null;
    pendingPhoto = null; removePhoto = false;
    $("#edit-title").textContent = b ? "Edit bread" : "Add a new bread";
    $("#e-name").value = b ? b.name : "";
    $("#e-price").value = b ? b.price : "";
    $("#e-desc").value = b ? b.description : "";
    $("#e-hidden").checked = b ? !!b.hidden : false;
    $("#delete-bread").hidden = !b;
    setPreview($("#photo-preview"), b && b.photo ? fileUrl(b, "photo", "800x600") : "");
    $("#photo-remove").hidden = !(b && b.photo);
    $("#edit-dialog").showModal();
  }

  $("#add-bread").addEventListener("click", () => openEdit(null));
  $("#cancel-edit").addEventListener("click", () => $("#edit-dialog").close());

  $("#photo-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      pendingPhoto = await shrinkPhoto(f);
      removePhoto = false;
      setPreview($("#photo-preview"), URL.createObjectURL(pendingPhoto));
      $("#photo-remove").hidden = false;
    } catch (err) { toast(err.message, "bad"); }
  });

  $("#photo-remove").addEventListener("click", () => {
    pendingPhoto = null; removePhoto = true;
    setPreview($("#photo-preview"), "");
    $("#photo-remove").hidden = true;
  });

  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#save-btn");
    const fd = new FormData();
    fd.append("name", $("#e-name").value.trim());
    fd.append("price", String(Number($("#e-price").value) || 0));
    fd.append("description", $("#e-desc").value.trim());
    fd.append("hidden", $("#e-hidden").checked ? "true" : "false");
    if (pendingPhoto) fd.append("photo", pendingPhoto);
    else if (removePhoto) fd.append("photo", "");
    if (!editing) fd.append("sort", String((breads.length + 1) * 10));

    busy(btn, true);
    try {
      if (editing) await api(`/api/collections/breads/records/${editing.id}`, { method: "PATCH", body: fd });
      else await api("/api/collections/breads/records", { method: "POST", body: fd });
      $("#edit-dialog").close();
      toast(editing ? "Saved!" : "New bread added!");
      await loadBreads();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  $("#delete-bread").addEventListener("click", async () => {
    if (!editing) return;
    if (!confirm(`Delete “${editing.name}” forever?\n\nTip: if you just want it off the website for now, use “Hide from website” instead.`)) return;
    try {
      await api(`/api/collections/breads/records/${editing.id}`, { method: "DELETE" });
      $("#edit-dialog").close();
      toast("Bread deleted");
      await loadBreads();
    } catch (err) { toast(err.message, "bad"); }
  });

  // ---------- shop info ----------
  async function loadShop() {
    const r = await api("/api/collections/shop/records?perPage=1");
    shop = r.items[0];
    if (!shop) return;
    $("#s-phone").value = shop.phone || "";
    $("#s-tagline").value = shop.tagline || "";
    $("#s-about").value = shop.about || "";
    $("#s-pickup").value = shop.pickup_info || "";
    $("#s-note").value = shop.order_note || "";
    $("#s-insta").value = shop.instagram || "";
    $("#s-reqpay").checked = !!shop.require_payment;
    pendingHero = null; removeHero = false;
    setPreview($("#hero-preview"), shop.hero ? fileUrl(shop, "hero", "1600x0") : "");
    $("#hero-remove").hidden = !shop.hero;
  }

  $("#hero-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      pendingHero = await shrinkPhoto(f);
      removeHero = false;
      setPreview($("#hero-preview"), URL.createObjectURL(pendingHero));
      $("#hero-remove").hidden = false;
    } catch (err) { toast(err.message, "bad"); }
  });
  $("#hero-remove").addEventListener("click", () => {
    pendingHero = null; removeHero = true;
    setPreview($("#hero-preview"), "");
    $("#hero-remove").hidden = true;
  });

  $("#shop-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const fd = new FormData();
    fd.append("phone", $("#s-phone").value.trim());
    fd.append("tagline", $("#s-tagline").value.trim());
    fd.append("about", $("#s-about").value.trim());
    fd.append("pickup_info", $("#s-pickup").value.trim());
    fd.append("order_note", $("#s-note").value.trim());
    fd.append("instagram", $("#s-insta").value.trim());
    fd.append("require_payment", $("#s-reqpay").checked ? "true" : "false");
    if (pendingHero) fd.append("hero", pendingHero);
    else if (removeHero) fd.append("hero", "");
    busy(btn, true);
    try {
      await api(`/api/collections/shop/records/${shop.id}`, { method: "PATCH", body: fd });
      toast("Shop info saved!");
      await loadShop();
    } catch (err) { toast(err.message, "bad"); }
    finally { busy(btn, false); }
  });

  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#pw-new").value !== $("#pw-new2").value) return toast("The two new passwords don't match.", "bad");
    try {
      await api(`/api/collections/bakers/records/${me.id}`, {
        method: "PATCH",
        body: { oldPassword: $("#pw-old").value, password: $("#pw-new").value, passwordConfirm: $("#pw-new2").value },
      });
      // Changing the password logs out old sessions, so log in again with the new one.
      const r = await api("/api/collections/bakers/auth-with-password", { method: "POST", body: { identity: me.email, password: $("#pw-new").value } });
      setAuth(r);
      e.target.reset();
      toast("Password changed!");
    } catch (err) { toast(err.message, "bad"); }
  });

  start();
})();
