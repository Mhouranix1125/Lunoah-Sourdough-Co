// Stripe helpers. encode/verifySignature/configured are pure (unit-tested with node);
// api() uses PocketBase's $http and $os and only runs on the server.
function encode(obj) {
  var out = [];
  (function walk(v, key) {
    if (v === undefined || v === null) return;
    if (typeof v === "object") {
      Object.keys(v).forEach(function (k) { walk(v[k], key ? key + "[" + k + "]" : k); });
    } else {
      out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
    }
  })(obj, "");
  return out.join("&");
}

// Stripe-Signature: "t=<unix>,v1=<hex hmac of `${t}.${raw}`>[,v1=...]". 5-minute tolerance.
function verifySignature(raw, header, secret, nowSec, hmacHex, equal) {
  if (!header || !secret) return false;
  var t = 0;
  var sigs = [];
  String(header).split(",").forEach(function (part) {
    var i = part.indexOf("=");
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") sigs.push(v);
  });
  if (!t || !sigs.length || Math.abs(nowSec - t) > 300) return false;
  var expected = hmacHex(t + "." + raw, secret);
  return sigs.some(function (s) { return equal(s, expected); });
}

function configured(getenv) {
  return !!(getenv("STRIPE_SECRET_KEY") && getenv("STRIPE_WEBHOOK_SECRET") && getenv("SITE_URL"));
}

function api(method, path, params, idemKey) {
  var headers = { Authorization: "Bearer " + $os.getenv("STRIPE_SECRET_KEY") };
  if (idemKey) headers["Idempotency-Key"] = idemKey;
  var url = "https://api.stripe.com" + path;
  var body = "";
  if (method === "GET") {
    var q = params ? encode(params) : "";
    if (q) url += "?" + q;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = params ? encode(params) : "";
  }
  try {
    var r = $http.send({ method: method, url: url, body: body, headers: headers, timeout: 20 });
    return { status: r.statusCode, json: r.json || {} };
  } catch (err) {
    return { status: 0, json: { error: { message: String(err) } } };
  }
}

module.exports = { encode: encode, verifySignature: verifySignature, configured: configured, api: api };
