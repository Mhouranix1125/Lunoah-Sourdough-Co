// "Adjust photo": Nadia drags and zooms a photo inside the exact frame it gets on the website.
//   Save position  keeps the whole photo and remembers what to show (can be changed any time)
//   Crop to this   makes a new photo of just the framed part
//   Show whole photo  fits all of it in, nothing cut off
// PhotoEditor.open({ src, aspect, pos, title }) resolves to
//   { pos }            position saved
//   { file, pos }      cropped: upload this file instead (its position is reset)
//   null               cancelled
window.PhotoEditor = (function () {
  const $ = (s) => document.querySelector(s);
  const P = window.LunoahPhoto;
  let pos, nat, resolve, aspect, src;
  const pointers = new Map();
  let pinch = null;

  const frameSize = () => { const r = $("#pe-frame").getBoundingClientRect(); return { w: r.width, h: r.height }; };

  function show() {
    P.apply($("#pe-img"), pos);
    $("#pe-zoom").value = String(pos.z);
    $("#pe-zoom").disabled = pos.fit;
    $("#pe-fit").textContent = pos.fit ? "Fill the frame" : "Show whole photo";
    $("#pe-crop").hidden = pos.fit;
    $("#pe-frame").classList.toggle("fit", pos.fit);
  }

  function finish(result) {
    $("#photo-dialog").close();
    const r = resolve;
    resolve = null;
    if (r) r(result);
  }

  function open(opts) {
    src = opts.src;
    aspect = opts.aspect || 4 / 3;
    pos = P.normalize(opts.pos);
    $("#pe-title").textContent = opts.title || "Adjust photo";
    $("#pe-frame").style.aspectRatio = String(aspect);
    $("#pe-frame").style.width = `min(100%, ${Math.round(40 * aspect)}vh)`; // leaves room for the buttons on a phone
    const img = $("#pe-img");
    nat = null;
    img.onload = () => { nat = { w: img.naturalWidth, h: img.naturalHeight }; show(); };
    img.src = src;
    show();
    $("#photo-dialog").showModal();
    return new Promise((r) => { resolve = r; });
  }

  // ----- dragging, pinching, wheel -----
  const frame = $("#pe-frame");
  frame.addEventListener("pointerdown", (e) => {
    if (!nat || pos.fit) return;
    try { frame.setPointerCapture(e.pointerId); } catch (_) { /* dragging still works without it */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: pos.z };
    }
  });
  frame.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev || !nat) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      pos.z = Math.min(4, Math.max(1, pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.dist || 1))));
    } else if (pointers.size === 1) {
      pos = P.pan(pos, cur.x - prev.x, cur.y - prev.y, nat, frameSize());
    }
    show();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  frame.addEventListener("pointerup", up);
  frame.addEventListener("pointercancel", up);
  frame.addEventListener("wheel", (e) => {
    if (!nat || pos.fit) return;
    e.preventDefault();
    pos.z = Math.min(4, Math.max(1, pos.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    show();
  }, { passive: false });

  // ----- controls -----
  $("#pe-zoom").addEventListener("input", () => { pos.z = Number($("#pe-zoom").value); show(); });
  $("#pe-fit").addEventListener("click", () => { pos.fit = !pos.fit; show(); });
  $("#pe-reset").addEventListener("click", () => { pos = P.normalize(null); show(); });
  $("#pe-cancel").addEventListener("click", () => finish(null));
  $("#photo-dialog").addEventListener("cancel", (e) => { e.preventDefault(); finish(null); }); // Esc key
  $("#pe-save").addEventListener("click", () => finish({ pos: P.normalize(pos) }));

  $("#pe-crop").addEventListener("click", async () => {
    if (!nat) return;
    if (!confirm("Crop the photo to just what's in the frame? The parts outside are removed from the website copy (the original stays on your phone).")) return;
    const r = P.visibleRegion(nat, frameSize(), pos);
    const scale = Math.min(1, 1600 / Math.max(r.sw, r.sh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(r.sw * scale));
    c.height = Math.max(1, Math.round(r.sh * scale));
    c.getContext("2d").drawImage($("#pe-img"), r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return alert("That photo couldn't be cropped. Please try Save position instead.");
    finish({ file: new File([blob], "photo.jpg", { type: "image/jpeg" }), pos: P.normalize(null) });
  });

  return { open };
})();
