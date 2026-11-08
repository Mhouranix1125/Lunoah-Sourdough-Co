/// <reference path="../pb_data/types.d.ts" />

// Tell browsers to check for a newer copy of the website's files before reusing a saved one.
// Without this, a browser can keep showing an old page or script for hours after an update.
// Unchanged files still load fast: the server answers "not modified" and nothing is re-downloaded.
routerUse((e) => {
  if (!e.request.url.path.startsWith("/api/")) {
    e.response.header().set("Cache-Control", "no-cache");
  }
  return e.next();
});
