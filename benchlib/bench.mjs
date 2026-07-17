// benchlib/bench.mjs — the shared primitives the three bench directories
// (chatbench, agentbench, infbench) each grew their own byte-identical copy of.
// It lives one level up from all three, so each imports it as ../benchlib/bench.mjs
// without reaching into a sibling bench's internals (the coupling the benches'
// own comments were written to avoid). Dev-only, like the benches themselves —
// not in package.json's `files`, never shipped, never on the product path.

/** Run `worker(item, i)` over items with bounded concurrency, preserving order
 *  (results[i] by index, so row order is identical to a sequential loop). */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, lane));
  return results;
}
