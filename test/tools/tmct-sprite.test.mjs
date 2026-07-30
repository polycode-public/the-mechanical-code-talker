// tmct_sprite driven end to end: the plain-English request routes through the
// capability planner to a bound call, the call returns markup plus the chain
// that found it, and everything the catalog cannot ground misses honestly —
// an unknown class, a class the catalog does not draw, an expression outside
// the palette, an expression the matched template does not take.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dispatchTool, dispatchToolStructured } from "../../src/tools/server.mjs";
import { ToolError } from "../../src/adapters/config.mjs";
import { appendFact, openConfiguredMemoryBackend } from "../../src/adapters/memory/core.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan } from "../../src/domain/router/drive.mjs";
import { capabilityPlanDeps } from "../../src/services/chat.mjs";
import { capabilityByName, KINDS, PRECOND } from "../../src/domain/router/registry.mjs";
import { EXPRESSION_PALETTE } from "../../src/domain/sprite-expressions.mjs";
import { toolByName } from "../../src/tools/definitions.mjs";

const stubSource = { fetchEntities: async () => ({ objectProperties: [], individuals: [] }) };

const WORLD_TAXONOMY = [["spider", "animal"], ["fly", "animal"], ["egg", "object"], ["quibbleflax", "gadget"]];

/** A temp repo whose configured memory store carries the spider-and-fly world's
 *  own taxonomy, plus one class the store knows and the sprite catalog does not
 *  draw (the essential near-miss: bound by the resolver, refused by the tool).
 *  The store handle stays OPEN — the capability-plan ctx re-reads it per request,
 *  the same way a live session's does. */
async function repoWithWorldTaxonomy() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sprite-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify({ objectProperties: [], individuals: [] }));
  const { dir: mem, close } = await openConfiguredMemoryBackend(dir);
  for (const [subject, object] of WORLD_TAXONOMY) {
    await appendFact(mem, { subject, predicate: "rdfs:subClassOf", object, provenance: "world:spider-fly" });
  }
  return { dir, mem, close, config: { graphFile: join(dir, ".tmct", "graph.json") } };
}

const REPO = await repoWithWorldTaxonomy();
after(async () => {
  await REPO.close();
  await rm(REPO.dir, { recursive: true, force: true });
});

const dispatch = (args) => dispatchTool("tmct_sprite", args, { config: REPO.config, source: stubSource });
const dispatchStructured = (args) => dispatchToolStructured("tmct_sprite", args, { config: REPO.config, source: stubSource });

// ---- the declared surface ----------------------------------------------------

test("the schema takes a class plus an optional expression and size, and reads its expression enum off the real palette", () => {
  const def = toolByName("tmct_sprite");
  assert.deepEqual(def.inputSchema.required, ["class"]);
  assert.deepEqual(Object.keys(def.inputSchema.properties).sort(), ["class", "expression", "size"]);
  assert.deepEqual(def.inputSchema.properties.expression.enum, Object.keys(EXPRESSION_PALETTE).sort());
  assert.match(def.inputSchema.properties.size.description, /scale/i, "size is documented as a render scale, not a template tier");
});

test("the capability binds class against the memory graph's taxonomy and gates on memory facts", () => {
  const cap = capabilityByName("tmct_sprite");
  const classSlot = cap.parameters.find((p) => p.arg === "class");
  assert.equal(classSlot.kind, KINDS.MemoryTerm);
  assert.equal(classSlot.view, "taxonomy");
  assert.ok(cap.preconditions.some((p) => p.pred === PRECOND.memoryFacts));
  assert.ok(cap.effects.add.some((e) => e.topic === "sprite" && e.of === "?class"));
});

// ---- the whole round trip ----------------------------------------------------

test("\"get me the large sprite for a happy spider\" plans to a bound tmct_sprite call and grounds it", async () => {
  const ctx = await buildCapabilityPlanCtx({
    ...capabilityPlanDeps(), source: stubSource, config: REPO.config, memoryDir: REPO.mem,
  });
  try {
    const result = await runCapabilityPlan("get me the large sprite for a happy spider", ["tmct_sprite"], ctx);
    assert.equal(result.refused, false, String(result.why));
    assert.deepEqual(result.calls, [{ name: "tmct_sprite", input: { class: "spider", size: "large", expression: "happy" } }]);
    assert.ok(result.proof.some((s) => s.pred === PRECOND.memoryFacts && s.ok), "the memory-facts precondition is in the proof chain");
    assert.ok(result.proof.some((s) => s.step === "effect" && s.topic === "sprite"), "the add-effect closes the goal");
    assert.match(result.observed, /sprite for "spider"/);
  } finally {
    for (const dispose of ctx.disposers || []) dispose();
  }
});

test("the two other phrasings reach the same capability, filling only the slots they actually name", async () => {
  const ctx = await buildCapabilityPlanCtx({
    ...capabilityPlanDeps(), source: stubSource, config: REPO.config, memoryDir: REPO.mem,
  });
  try {
    const looks = await runCapabilityPlan("what does a hungry fly look like", ["tmct_sprite"], ctx);
    assert.equal(looks.refused, false, String(looks.why));
    assert.deepEqual(looks.calls[0].input, { class: "fly" }, "\"hungry\" is not a sprite expression, so no expression is bound");

    const icon = await runCapabilityPlan("show me the spider icon", ["tmct_sprite"], ctx);
    assert.equal(icon.refused, false, String(icon.why));
    assert.deepEqual(icon.calls[0].input, { class: "spider" });
  } finally {
    for (const dispose of ctx.disposers || []) dispose();
  }
});

test("a class the memory graph holds no taxonomy fact for never reaches the tool — the resolver misses first", async () => {
  const ctx = await buildCapabilityPlanCtx({
    ...capabilityPlanDeps(), source: stubSource, config: REPO.config, memoryDir: REPO.mem,
  });
  try {
    const result = await runCapabilityPlan("show me the narwhal sprite", ["tmct_sprite"], ctx);
    assert.equal(result.refused, true);
    // The resolver's own reason rides alongside the goal-reasoner's, which is
    // what the request falls through to once no capability binds.
    assert.match(String(result.c1Why), /"narwhal" is not a class the memory graph carries a taxonomy fact for/);
    assert.match(String(result.c1Why), /honest miss/);
  } finally {
    for (const dispose of ctx.disposers || []) dispose();
  }
});

// ---- the answer, and its data ------------------------------------------------

test("the call answers with a sentence and the same answer as data — the resolution chain included", async () => {
  const { content, data } = await dispatchStructured({ class: "spider", expression: "happy", size: "large" });
  assert.match(content, /sprite for "spider" \(expression happy, size large\)/);
  assert.match(content, /matched at "spider", the class itself/);
  assert.match(content, /render scale: 1\.3/);

  assert.equal(data.class, "spider");
  assert.equal(data.expression, "happy");
  assert.equal(data.size, "large");
  assert.equal(data.scale, 1.3);
  assert.equal(data.tier, "sprite tier");
  assert.equal(data.expressionApplied, true);
  assert.ok(data.svg.startsWith("<svg"));
  assert.deepEqual(data.chain.map((s) => s.term), ["spider"]);
  assert.equal(data.matched.term, "spider");
  assert.equal(data.matched.via, "template");
  assert.equal(data.matched.hops, 0);
  assert.ok(data.matched.template.parameters.includes("emotion"), "the template that matched is named by the parameters it carries");
});

test("dispatchTool still hands back the plain sentence, so a string caller is unaffected by the structured shape", async () => {
  const text = await dispatch({ class: "spider" });
  assert.equal(typeof text, "string");
  assert.equal(text, (await dispatchStructured({ class: "spider" })).content);
});

test("a class one taught hop below a drawn one resolves through the ancestor and reports the hop", async () => {
  const repo = await repoWithWorldTaxonomy();
  try {
    await appendFact(repo.mem, { subject: "wolf-spider", predicate: "rdfs:subClassOf", object: "spider", provenance: "test" });
    const { content, data } = await dispatchToolStructured("tmct_sprite", { class: "wolf-spider" }, { config: repo.config, source: stubSource });
    assert.deepEqual(data.chain.map((s) => s.term), ["wolf-spider", "spider"]);
    assert.equal(data.matched.term, "spider");
    assert.equal(data.matched.hops, 1);
    assert.match(content, /1 hop\(s\) up the ancestor chain/);
  } finally {
    await repo.close();
    await rm(repo.dir, { recursive: true, force: true });
  }
});

// ---- the miss wall -----------------------------------------------------------

test("a class the catalog does not draw misses honestly rather than answering with the generic root sprite", async () => {
  await assert.rejects(dispatch({ class: "quibbleflax" }), (e) => {
    assert.ok(e instanceof ToolError, "a clean tool miss, not a raw error");
    assert.match(e.message, /no sprite for "quibbleflax"/);
    assert.match(e.message, /quibbleflax -> gadget/, "the chain it walked is named");
    assert.doesNotMatch(e.message, /<svg/, "no markup rides on a miss");
    return true;
  });
});

test("an expression outside the palette is refused before anything is resolved, and the palette is offered", async () => {
  await assert.rejects(dispatch({ class: "spider", expression: "smug" }), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /"smug" is not a sprite expression/);
    for (const word of Object.keys(EXPRESSION_PALETTE)) assert.match(e.message, new RegExp(word));
    return true;
  });
});

test("a size outside the scale table is refused rather than quietly rendering at 1", async () => {
  await assert.rejects(dispatch({ class: "spider", size: "enormous" }), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /"enormous" is not a size the sprite scale recognises/);
    return true;
  });
});

test("an expression the matched template does not take is refused, never silently dropped", async () => {
  await assert.rejects(dispatch({ class: "egg", expression: "happy" }), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /takes no expression/);
    assert.match(e.message, /"happy" would not show/);
    return true;
  });
});

test("a missing class is the argument contract's own refusal", async () => {
  await assert.rejects(dispatch({}), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /class is required/);
    return true;
  });
});
