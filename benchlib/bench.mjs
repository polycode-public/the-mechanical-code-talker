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

/** Parse JSONL case text into { cases, errors } with the prologue every bench
 *  case file shares: keep non-blank lines, JSON.parse each, and require a
 *  unique string `id` (a bad line becomes an error and is skipped). For each
 *  surviving row `validateOne(row, cases, errors, at)` runs to lint the row's
 *  own body and collect it — it owns the `cases.push`, so a body can decline a
 *  row by returning before it. Returns { cases, errors }. */
export function parseJsonlRows(text, validateOne) {
  const cases = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text).split("\n").filter((l) => l.trim());
  lines.forEach((line, i) => {
    const at = `line ${i + 1}`;
    let c;
    try { c = JSON.parse(line); } catch (e) { errors.push(`${at}: invalid JSON — ${e.message}`); return; }
    if (!c.id || typeof c.id !== "string") { errors.push(`${at}: missing id`); return; }
    if (seen.has(c.id)) errors.push(`${at}: duplicate id ${c.id}`);
    seen.add(c.id);
    validateOne(c, cases, errors, at);
  });
  return { cases, errors };
}
