const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../pb_public/photo-pos.js");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} ≈ ${b}`);
const portrait = { w: 1200, h: 1600 }; // a tall phone photo
const square = { w: 300, h: 300 };      // a square frame (Meet Nadia)

test("normalize: defaults, clamps, and reads saved JSON text", () => {
  assert.deepEqual(P.normalize(null), { x: 50, y: 50, z: 1, fit: false });
  assert.deepEqual(P.normalize('{"x":-5,"y":120,"z":9,"fit":1}'), { x: 0, y: 100, z: 4, fit: true });
  assert.deepEqual(P.normalize("not json"), P.DEFAULT);
});

test("default position shows the middle of a tall photo in a square frame (the forehead problem)", () => {
  const r = P.visibleRegion(portrait, square, null);
  close(r.sw, 1200, "full width"); close(r.sh, 1200, "square slice");
  close(r.sy, 200, "starts 200px down: the top of the head is cut");
});

test("y = 0 shows the very top of the photo", () => {
  const r = P.visibleRegion(portrait, square, { x: 50, y: 0, z: 1 });
  close(r.sy, 0, "top"); close(r.sh, 1200, "height");
});

test("zoom 2 shows half the width and height, around the chosen point", () => {
  const r = P.visibleRegion(portrait, square, { x: 50, y: 25, z: 2 });
  close(r.sw, 600, "half width"); close(r.sh, 600, "half height");
  close(r.sx, 300, "centred horizontally");
  // the chosen point (25% down) stays 25% down the frame
  close((1600 * 0.25 - r.sy) / r.sh, 0.25, "point stays put");
});

test("show whole photo keeps everything", () => {
  assert.deepEqual(P.visibleRegion(portrait, square, { fit: true }), { sx: 0, sy: 0, sw: 1200, sh: 1600 });
});

test("pan: dragging down reveals the top; it stops at the edge; no sideways pan when the width fits", () => {
  // In a 300×300 frame the photo is drawn 300×400, so 100px is hidden vertically.
  let p = P.pan(null, 0, 50, portrait, square);
  close(p.y, 0, "dragging down 50px from the middle reaches the top");
  p = P.pan(p, 0, 80, portrait, square);
  close(p.y, 0, "can't go past the top");
  p = P.pan(P.normalize(null), 40, 0, portrait, square);
  close(p.x, 50, "width already fits: no sideways movement");
  p = P.pan(P.normalize({ z: 2 }), 40, 0, portrait, square);
  assert.ok(p.x < 50, "zoomed in, dragging right shows more of the left");
});

test("apply: sets the CSS for cover, zoom, and whole-photo", () => {
  const img = { style: {} };
  P.apply(img, { x: 30, y: 0, z: 1.5 });
  assert.deepEqual(img.style, { objectFit: "cover", objectPosition: "30% 0%", transform: "scale(1.5)", transformOrigin: "30% 0%" });
  P.apply(img, { x: 30, y: 0, z: 1.5 }, { zoom: false });
  assert.equal(img.style.transform, "");
  P.apply(img, { fit: true });
  assert.equal(img.style.objectFit, "contain");
});
