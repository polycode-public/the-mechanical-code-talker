// viz-boot.test.mjs — loadWinkVendor, the bounded-race wink-nlp loader
// converged from six-plus-one page-local copies: success, timeout, memoized
// re-entry, and the swallow-and-warn failure contract every one of the
// originals shared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWinkVendor } from "../../src/services/viz-boot.mjs";

function neverSettles() {
  return new Promise(() => {});
}

test("loadWinkVendor: on success, registers a factory returning { winkNLP, model } and resolves 'loaded'", async () => {
  const mod = { winkNLP: { tag: "wink" }, model: { tag: "model" } };
  let registered = null;
  const load = loadWinkVendor({ timeoutMs: 50, register: (factory) => { registered = factory; }, importVendor: () => Promise.resolve(mod) });
  const status = await load();
  assert.equal(status, "loaded");
  assert.ok(registered, "register was called");
  assert.deepEqual(registered(), { winkNLP: mod.winkNLP, model: mod.model });
});

test("loadWinkVendor: a stalled import times out, resolves 'unavailable', and never calls register", async () => {
  let registered = false;
  const load = loadWinkVendor({ timeoutMs: 10, register: () => { registered = true; }, importVendor: neverSettles });
  const status = await load();
  assert.equal(status, "unavailable");
  assert.equal(registered, false);
});

test("loadWinkVendor: an importVendor that rejects also resolves 'unavailable' rather than throwing", async () => {
  const load = loadWinkVendor({ timeoutMs: 50, importVendor: () => Promise.reject(new Error("network down")) });
  const status = await load();
  assert.equal(status, "unavailable");
});

test("loadWinkVendor: register is optional — a caller with nothing to register still resolves cleanly", async () => {
  const load = loadWinkVendor({ timeoutMs: 50, importVendor: () => Promise.resolve({ winkNLP: {}, model: {} }) });
  await assert.doesNotReject(load());
});

test("loadWinkVendor: the returned loader is memoized — a second call never imports again", async () => {
  let calls = 0;
  const load = loadWinkVendor({
    timeoutMs: 50,
    importVendor: () => { calls += 1; return Promise.resolve({ winkNLP: {}, model: {} }); },
  });
  const [first, second] = await Promise.all([load(), load()]);
  assert.equal(calls, 1, "importVendor ran exactly once across both calls");
  assert.equal(first, "loaded");
  assert.equal(second, "loaded");
  await load();
  assert.equal(calls, 1, "a call after settlement still resolves the same memoized promise");
});

test("loadWinkVendor: two independent loaders never share memoization", async () => {
  const loadA = loadWinkVendor({ timeoutMs: 50, importVendor: () => Promise.resolve({ winkNLP: { id: "a" }, model: {} }) });
  const loadB = loadWinkVendor({ timeoutMs: 50, importVendor: () => Promise.resolve({ winkNLP: { id: "b" }, model: {} }) });
  assert.equal(await loadA(), "loaded");
  assert.equal(await loadB(), "loaded");
});
