//#region ../src/invariant.ts
const PACKAGE_NAME = "dsh-wallpaper-engine";
/** Cordis companion plugin name. */
const name = "client-ui-wallpaper-engine-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: slot conflicts fail loud in the slot core, and the
* desktop bridge is an optional browser global the UI degrades without.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
