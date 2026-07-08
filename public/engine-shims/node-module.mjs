// node-module.mjs — browser stand-in for `node:module`, mapped via the page's import map.
//
// Unlike the other three shims, this one really is a pure throwing stub: wink-model.mjs's
// createRequire() fallback (nodeRequireWink) only runs when NO browser factory was
// registered via registerWinkModel() — and tmct-browser.mjs always calls
// registerWinkModel() before the first query, so this path is provably dead in this
// page. Throwing (rather than returning a fake `require`) makes that provable at
// runtime too: if it's ever hit, the page fails loudly instead of silently misbehaving.

export function createRequire(_url) {
  throw new Error("node-module shim: createRequire is unreachable — registerWinkModel() must run before any query");
}
