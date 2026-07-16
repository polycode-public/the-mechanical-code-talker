// callgraph.test.mjs — the callsSymbol (fn/method-precise) call-graph fix (cycle W2P).
//
// The fixture records a symbol-level call edge: Widget.render --callsSymbol--> fnAlpha
// (mgx:callsSymbol), separate from the module-coarse `calls` edge (scripts/g.mjs → the
// MODULE app/lib/a.mjs). Before this fix EVERY callers/callees query ignored callsSymbol
// and mis-resolved a fine symbol to its enclosing module, so:
//   - "what calls fnAlpha"  wrongly answered "No modules found whose module directly calls…"
//   - /callers fnAlpha, /callees Widget.render resolved to mod:<path> and reported empty.
// These tests pin the corrected behaviour AND the still-honest empty for an uncalled symbol.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { ask } from "../src/domain/ask.mjs";
import { dispatchTool } from "../src/server.mjs";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url)), "utf8"),
);
const graph = parseEntities(fixture);
const config = { graphFile: "/stub/.tmct/graph.json" };
const stubSource = { fetchEntities: async () => fixture };
const call = (name, args) => dispatchTool(name, args, { config, source: stubSource });

test("NL: 'what calls fnAlpha' names the symbol-level caller Widget.render (with its site)", () => {
  const { content, tmct_ask } = ask(graph, "what calls fnAlpha");
  assert.equal(tmct_ask.miss, false, "a recorded callsSymbol caller exists — not the old false empty");
  assert.match(content, /Widget\.render/, "the real caller is named");
  assert.match(content, /app\/lib\/b\.mjs/, "with its module/site, read off the callsSymbol subject");
  assert.doesNotMatch(content, /No modules found/, "the old module-coarse honest-empty is gone");
});

test("NL: reverse call query traverses callsSymbol, not only the module-coarse `calls`", () => {
  // scripts/g.mjs calls the MODULE a.mjs, never the function — so a caller found via the
  // module-coarse edge (scripts/g.mjs) must NOT be reported for the function fnAlpha.
  const { content } = ask(graph, "what calls fnAlpha");
  assert.doesNotMatch(content, /scripts\/g\.mjs/, "the module-coarse caller is not conflated with the symbol");
});

test("/callers fnAlpha → Widget.render (callsSymbol subjects), resolved to the SYMBOL not its module", async () => {
  const out = await call("tmct_callers", { symbol: "fnAlpha" });
  assert.match(out, /^fnAlpha — called by 1 symbol\(s\):/, "resolves to the function node, cites symbol-grain");
  assert.match(out, /Widget\.render/);
  assert.doesNotMatch(out, /mod:app\/lib\/a\.mjs/, "no longer mis-mapped to its enclosing module id");
});

test("/callees Widget.render → fnAlpha (callsSymbol objects), resolved to the SYMBOL not its module", async () => {
  const out = await call("tmct_callees", { symbol: "Widget.render" });
  assert.match(out, /^Widget\.render — calls into 1 symbol\(s\):/);
  assert.match(out, /fnAlpha/);
  assert.doesNotMatch(out, /mod:app\/lib\/b\.mjs/, "no longer mis-mapped to its enclosing module id");
});

test("honest-empty stays honest: a truly-uncalled symbol reports no callers, no hallucination", () => {
  // Nothing in the fixture calls Widget.render (no callsSymbol edge targets m-render).
  const { content, tmct_ask } = ask(graph, "what calls Widget.render");
  assert.equal(tmct_ask.miss, true, "genuinely uncalled → the honest miss");
  assert.match(content, /No .* found whose module directly calls Widget\.render/, "honest empty");
  // (0.8.2 WS1: the receipt rides the envelope, not the prose.)
  assert.equal(tmct_ask.traversal, "callsSymbol edges where object = Widget.render", "with the accurate callsSymbol receipt on the envelope");
});

test("honest-empty stays honest at the tool layer: /callers on an uncalled symbol", async () => {
  const out = await call("tmct_callers", { symbol: "Widget.render" });
  assert.match(out, /Widget\.render: no recorded callers/, "honest, no invented caller");
});
