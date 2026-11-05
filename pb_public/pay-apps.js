// Shared by the website and the admin page: how each payment app looks and what info it uses.
// Logos are simple brand-colour badges (not the companies' official artwork).
(function () {
  const badge = (bg, inner) =>
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="${bg}"/>${inner}</svg>`;
  const glyph = (t, size = 28, extra = "") =>
    `<text x="24" y="25" text-anchor="middle" dominant-baseline="central" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" fill="#fff" ${extra}>${t}</text>`;

  const strip = (h) =>
    String(h || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^(www\.)?(venmo\.com\/(u\/)?|account\.venmo\.com\/u\/|cash\.app\/|paypal\.me\/|paypal\.com\/paypalme\/)/i, "")
      .replace(/^[@$]/, "")
      .replace(/\/+$/, "");

  window.PAY_APPS = {
    venmo: {
      name: "Venmo",
      logo: badge("#008CFF", glyph("V", 30, 'font-style="italic"')),
      handle: { label: "Venmo username", prefix: "@", placeholder: "nadia-majed-1" },
      link: (m) => m.handle && `https://venmo.com/u/${encodeURIComponent(m.handle)}`,
      // Opens Venmo with the amount and note filled in
      payLink: (m, amt, note) => m.handle &&
        `https://venmo.com/?txn=pay&audience=private&recipients=${encodeURIComponent(m.handle)}&amount=${amt}&note=${encodeURIComponent(note)}`,
      linkLabel: "Open Venmo",
    },
    zelle: {
      name: "Zelle",
      logo: badge("#6D1ED4", glyph("Z", 30) + '<rect x="22.5" y="6" width="3" height="7" fill="#fff"/><rect x="22.5" y="35" width="3" height="7" fill="#fff"/>'),
      phone: { label: "Zelle phone number", placeholder: "313-384-0304" },
      email: { label: "Zelle email (if you use email instead)", placeholder: "" },
      tip: "Open your bank's app and choose Zelle.",
    },
    cashapp: {
      name: "Cash App",
      logo: badge("#00D632", glyph("$", 30)),
      handle: { label: "$Cashtag", prefix: "$", placeholder: "lunoahsourdough" },
      link: (m) => m.handle && `https://cash.app/$${encodeURIComponent(m.handle)}`,
      payLink: (m, amt) => m.handle && `https://cash.app/$${encodeURIComponent(m.handle)}/${amt}`,
      linkLabel: "Open Cash App",
    },
    paypal: {
      name: "PayPal",
      logo: badge("#003087", glyph("P", 30, 'font-style="italic"')),
      handle: { label: "PayPal.me name", prefix: "paypal.me/", placeholder: "lunoahsourdough" },
      email: { label: "PayPal email", placeholder: "" },
      link: (m) => m.handle && `https://paypal.me/${encodeURIComponent(m.handle)}`,
      payLink: (m, amt) => m.handle && `https://paypal.me/${encodeURIComponent(m.handle)}/${amt}USD`,
      linkLabel: "Open PayPal",
    },
    applecash: {
      name: "Apple Cash",
      logo: badge("#111", '<circle cx="24" cy="24" r="13" fill="none" stroke="#fff" stroke-width="3"/>' + glyph("$", 18)),
      phone: { label: "Phone number", placeholder: "" },
      email: { label: "Apple ID email (optional)", placeholder: "" },
      tip: "On iPhone, send it from the Messages app.",
    },
    other: {
      name: "Other",
      logo: badge("#8a5428", '<rect x="11" y="15" width="26" height="18" rx="3" fill="none" stroke="#fff" stroke-width="3"/><rect x="11" y="20" width="26" height="3" fill="#fff"/>'),
      custom: true, // uses the "label" field as its name
      handle: { label: "Username or account", prefix: "", placeholder: "" },
      phone: { label: "Phone number", placeholder: "" },
      email: { label: "Email", placeholder: "" },
    },
  };
  window.PAY_ORDER = ["venmo", "zelle", "cashapp", "paypal", "applecash", "other"];
  window.payName = (m) => (window.PAY_APPS[m.kind] || {}).custom ? m.label || "Other" : (window.PAY_APPS[m.kind] || {}).name || m.kind;
  window.payStrip = strip;
})();
