//#region ../src/index.ts
/** Cordis plugin name (node half is intentionally empty for this UI package). */
const name = "client-ui-wallpaper-engine";
/**
* Apply the host-side half. Wallpaper Engine capability lives in the desktop
* main process; this plugin has no host behavior to register.
* @param ctx - host context (unused).
*/
function apply(_ctx) {}
//#endregion
export { apply, name };
