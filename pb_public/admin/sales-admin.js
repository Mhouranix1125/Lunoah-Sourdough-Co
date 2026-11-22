// "Sales" tab: Nadia's sales one calendar year at a time (every past year is kept and can be
// reopened), the cottage food limit, a month-by-month history, and a CSV per year for taxes.
window.SalesAdmin = function ({ api, toast }) {
  const $ = (s) => document.querySelector(s);
  const S = window.LunoahSlots;
  const V = window.LunoahSales;
  const thisYear = () => S.localParts(new Date(), S.SHOP_TZ).date.slice(0, 4);
  const localDate = (ms) => S.localParts(new Date(ms), S.SHOP_TZ).date;
  const money = (c) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const whole = (c) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

  let txns = [];
  let year = null;
  let loading = null;

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Every order, all pages (a busy year is a few thousand at most).
  async function fetchAll() {
    const all = [];
    for (let page = 1; ; page++) {
      const r = await api(`/api/collections/bookings/records?perPage=500&page=${page}&sort=date,time&filter=${encodeURIComponent("status != 'held'")}`);
      all.push(...r.items);
      if (page >= r.totalPages) break;
    }
    return all;
  }

  function load() {
    if (!loading) {
      loading = fetchAll().then((all) => {
        txns = V.transactions(all, localDate);
        if (!year) year = thisYear();
        render();
      }).finally(() => { loading = null; });
    }
    return loading;
  }

  function renderYears() {
    const box = $("#sl-years");
    box.replaceChildren(...V.years(txns, thisYear()).map((y) => {
      const b = h("button", "sl-year" + (y === year ? " active" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(y === year));
      b.append(h("span", "sl-year-num", y), h("span", "sl-year-tag", y === thisYear() ? "This year" : y < thisYear() ? "Archived" : ""));
      b.addEventListener("click", () => { year = y; render(); });
      return b;
    }));
  }

  function stat(label, value, cls) {
    const d = h("div", "sl-stat" + (cls ? " " + cls : ""));
    d.append(h("span", "sl-stat-label", label), h("span", "sl-stat-value", value));
    return d;
  }

  function renderSummary(sum) {
    const t = sum.total;
    const box = $("#sl-summary");
    box.replaceChildren(
      stat(`${year} sales`, money(t.net), "big"),
      stat("Card (website)", money(t.card)),
      stat("Cash & apps", money(t.other)),
      stat("Refunds", t.refunds ? money(-t.refunds) : "$0.00"),
      stat("Orders", String(t.orders)),
    );

    // Michigan cottage food limit, per calendar year.
    const pct = Math.max(0, Math.min(100, (t.net / sum.capCents) * 100));
    const cap = $("#sl-cap");
    const bar = h("div", "sl-bar");
    const fill = h("div", "sl-bar-fill" + (pct >= 100 ? " over" : pct >= 80 ? " near" : ""));
    fill.style.width = pct > 0 ? `max(${pct}%, 6px)` : "0"; // any sales at all show a visible sliver
    bar.append(fill);
    // Small amounts get a decimal ("0.1%"), so a few sales never read as "0%".
    const raw = Math.max(0, (t.net / sum.capCents) * 100); // the text shows the real figure, even past 100%
    const pctText = raw === 0 ? "0"
      : raw < 1 ? String(Math.max(0.01, Number(raw.toFixed(2))))
      : raw < 10 ? String(Number(raw.toFixed(1)))
      : String(Math.floor(raw));
    const line = h("p", "sl-cap-text");
    line.append(h("strong", null, `${whole(Math.max(0, t.net))} of ${whole(sum.capCents)}`), ` cottage food limit for ${year} (${pctText}%)`);
    const parts = [line, bar];
    if (pct >= 100) parts.push(h("p", "sl-cap-warn over", "You've reached the cottage food sales limit for this year. Check with MDARD before taking more orders."));
    else if (pct >= 80) parts.push(h("p", "sl-cap-warn", "Getting close to the yearly cottage food limit."));
    cap.replaceChildren(...parts);

    $("#sl-download").textContent = `Download ${year} sales for taxes (CSV)`;
    $("#sl-download").disabled = !sum.months.some((m) => m.txns.length);
  }

  function txnRow(t) {
    const li = h("li", "sl-txn" + (t.kind === "refund" ? " refund" : ""));
    const top = h("div", "sl-txn-top");
    top.append(h("span", "sl-txn-name", `${S.formatDate(t.date, "short")} · ${t.name}`), h("span", "sl-txn-amt", money(t.cents)));
    li.append(top);
    const bits = [t.kind === "refund" ? "Refund" : V.METHOD[t.method] || t.method, t.items, t.kind === "sale" ? t.status : "", t.note].filter(Boolean);
    li.append(h("div", "sl-txn-meta", bits.join(" · ")));
    return li;
  }

  function renderMonths(sum) {
    const box = $("#sl-months");
    const months = sum.months.filter((m) => m.txns.length).reverse(); // newest month first
    if (!months.length) {
      box.replaceChildren(h("p", "or-empty", year === thisYear()
        ? `No sales yet in ${year}. They'll show up here as orders are paid.`
        : `No sales recorded in ${year}.`));
      return;
    }
    const current = `${thisYear()}-${S.localParts(new Date(), S.SHOP_TZ).date.slice(5, 7)}`;
    box.replaceChildren(...months.map((m) => {
      const d = h("details", "sl-month");
      if (m.key === current) d.open = true;
      const s = h("summary");
      const left = h("div");
      left.append(h("div", "sl-month-name", m.label));
      const t = m.totals;
      const sub = [`${t.orders} order${t.orders === 1 ? "" : "s"}`];
      if (t.card) sub.push(`card ${money(t.card)}`);
      if (t.other) sub.push(`cash & apps ${money(t.other)}`);
      if (t.refunds) sub.push(`refunds ${money(-t.refunds)}`);
      left.append(h("div", "sl-month-sub", sub.join(" · ")));
      s.append(left, h("span", "sl-month-net", money(t.net)));
      const ul = h("ul", "sl-txns");
      m.txns.slice().reverse().forEach((x) => ul.append(txnRow(x)));
      d.append(s, ul);
      return d;
    }));
  }

  function render() {
    if (!year) return;
    const sum = V.summarize(txns, year);
    renderYears();
    renderSummary(sum);
    renderMonths(sum);
  }

  $("#sl-download").addEventListener("click", () => {
    const csv = V.toCSV(V.summarize(txns, year));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `lunoah-sales-${year}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Downloaded ${year} sales.`);
  });

  // Orders changed (ticked off, refunded, phone order paid): refresh if the tab has been opened.
  document.addEventListener("lunoah:orders-changed", () => { if (year) load().catch(() => {}); });

  return { load };
};
