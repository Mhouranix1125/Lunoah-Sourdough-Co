// Seasonal theme: applies the last-used theme immediately (no flash), and lets pages switch it.
(function () {
  const THEMES = ["basic", "halloween", "thanksgiving", "christmas", "valentines", "spring", "summer"];
  function apply(name) {
    const t = THEMES.includes(name) ? name : "basic";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("lunoah_theme", t); } catch (_) {}
    return t;
  }
  let saved = "basic";
  try { saved = localStorage.getItem("lunoah_theme") || "basic"; } catch (_) {}
  apply(saved);
  window.LunoahTheme = { apply, THEMES };
})();
