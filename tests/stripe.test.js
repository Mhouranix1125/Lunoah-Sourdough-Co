const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const X = require("../pb_hooks/lib/stripe.js");

const hmac = (text, secret) => crypto.createHmac("sha256", secret).update(text).digest("hex");
const eq = (a, b) => a === b;
const SECRET = "whsec_test";
const RAW = '{"id":"evt_1","type":"checkout.session.completed"}';
const sign = (t, raw = RAW, secret = SECRET) => `t=${t},v1=${hmac(`${t}.${raw}`, secret)}`;

test("encode nests objects and arrays the way Stripe expects", () => {
  assert.equal(
    X.encode({ mode: "payment", metadata: { booking: "ab c" }, line_items: [{ quantity: 2 }], skip: null, n: 0 }),
    "mode=payment&metadata%5Bbooking%5D=ab%20c&line_items%5B0%5D%5Bquantity%5D=2&n=0"
  );
});

test("verifySignature accepts a valid signature", () => {
  assert.equal(X.verifySignature(RAW, sign(1000), SECRET, 1000, hmac, eq), true);
  assert.equal(X.verifySignature(RAW, `${sign(1000)},v1=deadbeef`, SECRET, 1100, hmac, eq), true);
});

test("verifySignature rejects tampering, staleness and a wrong secret", () => {
  assert.equal(X.verifySignature(RAW + " ", sign(1000), SECRET, 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, sign(1000), SECRET, 1301, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, sign(1000, RAW, "whsec_other"), SECRET, 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, "", SECRET, 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, sign(1000), "", 1000, hmac, eq), false);
  assert.equal(X.verifySignature(RAW, "t=1000", SECRET, 1000, hmac, eq), false);
});

test("configured needs all three settings", () => {
  const env = { STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh", SITE_URL: "http://x" };
  assert.equal(X.configured((k) => env[k] || ""), true);
  assert.equal(X.configured((k) => (k === "SITE_URL" ? "" : env[k])), false);
});
