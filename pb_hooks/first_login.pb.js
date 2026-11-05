/// <reference path="../pb_data/types.d.ts" />

// First-run helper: lets the admin page create Nadia's login when no login exists yet.
// Only allowed (1) while there are zero bakers and (2) from this same computer, so nobody
// on the internet can claim the admin on a live server. On a live server, create bakers
// from the dashboard (/_/) or with "Setup Accounts.command".

routerAdd("GET", "/api/lunoah/status", (e) => {
  // remoteIP() is the direct connection address (not spoofable headers). "::1" may be expanded.
  const local = /^(127\.|::1$|(0000:){7}0001$|::ffff:127\.)/i.test(e.remoteIP());
  const none = $app.countRecords("bakers") === 0;
  return e.json(200, { needsSetup: none, canSetupHere: none && local });
});

routerAdd("POST", "/api/lunoah/setup", (e) => {
  const local = /^(127\.|::1$|(0000:){7}0001$|::ffff:127\.)/i.test(e.remoteIP());
  if (!local) {
    return e.json(403, { message: "Logins can only be created from the computer running the website." });
  }
  if ($app.countRecords("bakers") > 0) {
    return e.json(400, { message: "A login already exists. Please log in instead." });
  }
  const body = e.requestInfo().body || {};
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return e.json(400, { message: "Please enter a valid email address." });
  }
  if (password.length < 8) {
    return e.json(400, { message: "Password must be at least 8 characters." });
  }
  const rec = new Record($app.findCollectionByNameOrId("bakers"));
  rec.set("email", email);
  rec.set("name", name);
  rec.setPassword(password);
  rec.setVerified(true);
  $app.save(rec);
  return e.json(200, { ok: true });
});
