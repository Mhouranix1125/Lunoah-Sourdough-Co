/// <reference path="../pb_data/types.d.ts" />

// Which pickup times are already booked, from a given date on. Returns only dates and times,
// never names or orders, so customers can't see who booked what.
routerAdd("GET", "/api/lunoah/taken", (e) => {
  const from = e.request.url.query().get("from") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return e.json(400, { message: "from must be a date like 2026-11-13" });
  }
  const recs = $app.findRecordsByFilter("bookings", "date >= {:from}", "date,time", 5000, 0, { from: from });
  return e.json(200, {
    taken: recs.map((r) => ({ date: r.getString("date"), time: r.getString("time") })),
  });
});
