// "Your order" page: the link customers land on after paying (and get by email).
// Shows the booking, and a Cancel button while the 2-hour refund window is open.
(function () {
  const $ = (s) => document.querySelector(s);
  const k = new URLSearchParams(location.search).get("k") || "";
  const money = (c) => "$" + (c / 100).toFixed(2);
  let polls = 0;

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
  }

  function show(o) {
    $("#op-details").hidden = false;
    $("#op-when").textContent = `Pickup: ${o.when}`;
    $("#op-where").replaceChildren();
    if (o.location) {
      const a = document.createElement("a");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.location);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Map";
      $("#op-where").append(`📍 ${o.location} · `, a);
    }
    const total = el("li", "", "total");
    total.append(el("span", "Total"), el("span", money(o.amount_cents)));
    $("#op-lines").replaceChildren(
      ...o.lines.map((l) => {
        const li = document.createElement("li");
        li.append(el("span", `${l.qty} × ${l.name}`), el("span", money(l.qty * l.price_cents)));
        return li;
      }),
      total
    );
    $("#op-cancel-box").hidden = true;
    $("#op-msg").hidden = true;

    if (o.status === "paid") {
      $("#op-title").textContent = "You're booked!";
      $("#op-lead").textContent = `Thank you, ${o.name}! ${o.message || ""} A confirmation email is on its way.`.replace(/  +/g, " ");
      if (o.can_cancel) {
        $("#op-cancel-box").hidden = false;
        $("#op-cancel-note").textContent = `Changed your mind? You can cancel for a full refund until ${o.cancel_until_label}.`;
      } else {
        $("#op-msg").textContent = `This order can no longer be cancelled online. Please text Nadia at ${o.phone}.`;
        $("#op-msg").hidden = false;
      }
    } else if (o.status === "held") {
      $("#op-title").textContent = "Confirming your payment…";
      $("#op-lead").textContent = "This usually takes a few seconds.";
      if (polls++ < 15) setTimeout(load, 2000);
      else $("#op-lead").textContent = `Still confirming. You'll get an email shortly. If you don't, text Nadia at ${o.phone}.`;
    } else if (o.status === "cancelled") {
      $("#op-title").textContent = "Order cancelled";
      $("#op-lead").textContent = o.refund_status === "refunded"
        ? `${money(o.amount_cents)} is on its way back to your card (5–10 days).`
        : `Your refund is being processed. Questions? Text Nadia at ${o.phone}.`;
    } else {
      $("#op-title").textContent = "Your pickup is booked";
      $("#op-lead").textContent = "";
    }
  }

  function notFound() {
    $("#op-title").textContent = "Order not found";
    $("#op-lead").textContent = "Please use the link from your confirmation email.";
  }

  async function load() {
    if (!/^[A-Za-z0-9]{32}$/.test(k)) return notFound();
    try {
      const r = await fetch("/api/lunoah/order?k=" + encodeURIComponent(k));
      if (r.status === 404) return notFound();
      if (!r.ok) throw new Error(String(r.status));
      show(await r.json());
    } catch (_) {
      $("#op-title").textContent = "We couldn't load your order";
      $("#op-lead").textContent = "Please check your connection and refresh.";
    }
  }

  $("#op-cancel").addEventListener("click", async () => {
    if (!confirm("Cancel your order and get a full refund?")) return;
    const btn = $("#op-cancel");
    btn.disabled = true;
    btn.textContent = "Cancelling…";
    try {
      const r = await fetch("/api/lunoah/order/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: k }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) return show(d);
      $("#op-cancel-box").hidden = true;
      $("#op-msg").textContent = d.code === "closed"
        ? `This order can no longer be cancelled online. Please text Nadia at ${d.phone}.`
        : d.message || "Something went wrong. Please try again.";
      $("#op-msg").hidden = false;
    } catch (_) {
      $("#op-msg").textContent = "We couldn't reach the bakery. Please try again.";
      $("#op-msg").hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Cancel my order";
    }
  });

  fetch("/api/collections/shop/records?perPage=1").then((r) => r.json())
    .then((s) => { if (window.LunoahTheme && s.items && s.items[0]) window.LunoahTheme.apply(s.items[0].theme); })
    .catch(() => {});
  load();
})();
