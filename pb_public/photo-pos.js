// Photo positioning, shared by the website and the admin. Nadia chooses what part of a photo shows;
// the full photo is kept, and every spot it appears in uses her choice.
//
// A position is { x, y, z, fit }:
//   x, y  0–100: the point of the photo (in % of its width/height) that sits at the same % of the frame.
//         50/50 is centred; y 0 shows the top. The same idea works for any frame shape.
//   z     zoom, 1 (fills the frame) to 4, centred on that same point
//   fit   true = show the whole photo (no cropping), with a plain background around it
(function (root) {
  var DEFAULT = { x: 50, y: 50, z: 1, fit: false };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  function normalize(p) {
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (_) { p = null; } }
    if (!p || typeof p !== "object") return Object.assign({}, DEFAULT);
    var n = function (v, d) { v = Number(v); return isFinite(v) ? v : d; };
    return { x: clamp(n(p.x, 50), 0, 100), y: clamp(n(p.y, 50), 0, 100), z: clamp(n(p.z, 1), 1, 4), fit: !!p.fit };
  }

  // Style an <img> that fills a frame with overflow hidden. opts.zoom === false skips the zoom
  // (for small thumbnails whose frame doesn't clip).
  function apply(img, p, opts) {
    p = normalize(p);
    var s = img.style;
    if (p.fit) {
      s.objectFit = "contain"; s.objectPosition = "50% 50%"; s.transform = ""; s.transformOrigin = "";
      return;
    }
    s.objectFit = "cover";
    s.objectPosition = p.x + "% " + p.y + "%";
    var zoom = !(opts && opts.zoom === false) && p.z > 1.001;
    s.transform = zoom ? "scale(" + p.z + ")" : "";
    s.transformOrigin = zoom ? p.x + "% " + p.y + "%" : "";
  }

  // The photo's size when it just covers a W×H frame (before zoom).
  function coverSize(nat, frame) {
    var s = Math.max(frame.w / nat.w, frame.h / nat.h);
    return { w: nat.w * s, h: nat.h * s };
  }

  // Dragging by (dx, dy) screen pixels moves the photo with the finger.
  // On screen, photo point u sits at  p·W + z·rw·(u − p)  so moving p by dx/(W − z·rw) keeps it under the finger.
  function pan(p, dx, dy, nat, frame) {
    p = normalize(p);
    if (p.fit) return p;
    var c = coverSize(nat, frame);
    var ax = frame.w - p.z * c.w, ay = frame.h - p.z * c.h;
    if (Math.abs(ax) > 0.5) p.x = clamp(p.x + (100 * dx) / ax, 0, 100);
    if (Math.abs(ay) > 0.5) p.y = clamp(p.y + (100 * dy) / ay, 0, 100);
    return p;
  }

  // The part of the photo (in its own pixels) that shows in the frame: what "Crop to this" keeps.
  function visibleRegion(nat, frame, p) {
    p = normalize(p);
    if (p.fit) return { sx: 0, sy: 0, sw: nat.w, sh: nat.h };
    var c = coverSize(nat, frame);
    var px = p.x / 100, py = p.y / 100;
    var u0 = clamp(px - (px * frame.w) / (p.z * c.w), 0, 1), u1 = clamp(px + ((1 - px) * frame.w) / (p.z * c.w), 0, 1);
    var v0 = clamp(py - (py * frame.h) / (p.z * c.h), 0, 1), v1 = clamp(py + ((1 - py) * frame.h) / (p.z * c.h), 0, 1);
    return { sx: u0 * nat.w, sy: v0 * nat.h, sw: (u1 - u0) * nat.w, sh: (v1 - v0) * nat.h };
  }

  var api = { DEFAULT: DEFAULT, normalize: normalize, apply: apply, pan: pan, visibleRegion: visibleRegion, coverSize: coverSize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LunoahPhoto = api;
})(this);
