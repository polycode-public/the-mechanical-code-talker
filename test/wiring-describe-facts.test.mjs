// Bug B4 (0.8.2 follow-up) — /describe never surfaced taught facts about the
// resolved entity: renderDescribe (codegraph.mjs) and dispatchTool (server.mjs)
// never receive memoryDir, so ACE-taught facts were architecturally invisible
// to /describe even though the SAME facts already answer ordinary ask-path
// questions (test/wiring-facts.test.mjs's W4 round-trip). Mirrors that file's
// conventions: write a fact directly via appendFact (memory/core.mjs, the same
// low-level write point provenance.test.mjs/syllogise.test.mjs use — sidesteps
// the ACE lexicon's closed noun list, which the fixture's Class/Function/Method
// labels don't happen to intersect), then read back via /describe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { appendFact } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("Bug B4: /describe <resolved entity> appends a taught fact about it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-b4-describe-"));
  try {
    const g = await graph();
    // Widget is a real Class individual in the fixture (cls-widget) — the fact's
    // subject is the SAME term /describe resolves ("Widget" -> normFactTerm ->
    // "widget"), exactly the seam factReadBack's own subject-side matching uses.
    await appendFact(dir, {
      subject: "Widget", predicate: "mgx:ownedBy", object: "Priya",
      provenance: "ace:chat:b4@2026-07-07T00:00:00.000Z",
    });

    const described = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(described.record.command, "describe");
    // the code-map answer (renderDescribe's own output) still leads...
    assert.match(described.answer, /^Widget — Class \(id: cls-widget\)/);
    // ...and the taught fact is appended below it, cited verbatim (same
    // rendering discipline as the ask-path's factReadBack lines).
    assert.match(described.answer, /taught facts:/);
    assert.match(described.answer, /you told me: widget is owned by priya \(source: ace:chat:b4@/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug B4: multiple facts about the same entity are trust-ranked, highest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-b4-trust-"));
  try {
    const g = await graph();
    // corpus provenance (trust 0.7) written first, an operator/teach fact (trust
    // 1.0) written second — the higher-trust fact must render FIRST regardless
    // of write order (byTrust, the same comparator factReadBack uses).
    await appendFact(dir, {
      subject: "Widget", predicate: "mgx:hasProperty", object: "slow",
      provenance: "corpus:conceptnet /r/HasProperty",
    });
    await appendFact(dir, {
      subject: "Widget", predicate: "mgx:ownedBy", object: "Priya",
      provenance: "ace:chat:b4@2026-07-07T00:00:00.000Z",
    });

    const described = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    const factsBlock = described.answer.split("taught facts:\n")[1];
    const lines = factsBlock.split("\n");
    assert.match(lines[0], /you told me: widget is owned by priya/, "the higher-trust (operator) fact leads");
    assert.match(lines[1], /widget is slow/, "the lower-trust (corpus) fact follows");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug B4: /describe with no memoryDir (bare runTurn) is unaffected — pure code-map output", async () => {
  const g = await graph();
  const described = await runTurn("/describe Widget", { config: CONFIG, graph: g });
  assert.match(described.answer, /^Widget — Class \(id: cls-widget\)/);
  assert.doesNotMatch(described.answer, /taught facts:/);
});

test("Bug B4: /describe with memoryDir but NO matching fact stays byte-identical to the no-memory answer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-b4-nofact-"));
  try {
    const g = await graph();
    const bare = await runTurn("/describe Widget", { config: CONFIG, graph: g });
    const withMemory = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(withMemory.answer, bare.answer, "no taught fact about Widget → no append");
    assert.doesNotMatch(withMemory.answer, /taught facts:/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bug B4: a taught fact about a DIFFERENT subject never leaks into an unrelated /describe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-b4-unrelated-"));
  try {
    const g = await graph();
    await appendFact(dir, {
      subject: "Button", predicate: "mgx:ownedBy", object: "Priya",
      provenance: "ace:chat:b4b@2026-07-07T00:00:00.000Z",
    });
    const described = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.doesNotMatch(described.answer, /taught facts:/, "Button's fact must not attach to Widget's describe");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
