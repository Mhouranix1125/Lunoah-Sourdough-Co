/// <reference path="../pb_data/types.d.ts" />

// Time off (pickup_blocks): the server checks every new or changed entry (pb_hooks/lib/timeoff.js),
// so a bad entry can't be saved by any route, not only through the admin page.

onRecordCreateRequest((e) => {
  require(`${__hooks}/lib/timeoff.js`).check(e.record);
  e.next();
}, "pickup_blocks");

onRecordUpdateRequest((e) => {
  require(`${__hooks}/lib/timeoff.js`).check(e.record);
  e.next();
}, "pickup_blocks");
