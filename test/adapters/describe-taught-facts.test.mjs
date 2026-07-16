// /describe's taught-facts append, driven through the appendFact seam
// (memory/core.mjs's low-level write point) — it sidesteps the ACE lexicon's
// closed noun list, so facts with arbitrary predicates/provenances can be
// staged, including the corpus-vs-operator trust ranking a chat teach can't
// set up. The chat-taught surface itself is a templates-lane row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/chat.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import { appendFact } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import * as source from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("/describe <resolved entity> appends a directly-written fact about it, cited verbatim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-describe-append-"));
  try {
    const g = await graph();
    // Widget is a real Class individual in the fixture (cls-widget) — the fact's
    // subject is the SAME term /describe resolves ("Widget" -> normFactTerm ->
    // "widget"), exactly the seam factReadBack's own subject-side matching uses.
    await appendFact(dir, {
      subject: "Widget", predicate: "mgx:ownedBy", object: "Priya",
      provenance: "ace:chat:describe@2026-07-07T00:00:00.000Z",
    });
    const described = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(described.record.command, "describe");
    assert.match(described.answer, /^Widget — Class \(id: cls-widget\)/, "the code-map answer still leads");
    assert.match(described.answer, /taught facts:/);
    assert.match(described.answer, /you told me: widget is owned by priya \(source: ace:chat:describe@/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("multiple facts about the same entity are trust-ranked, highest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-describe-trust-"));
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
      provenance: "ace:chat:describe@2026-07-07T00:00:00.000Z",
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

test("/describe with no memoryDir (bare runTurn) is pure code-map output", async () => {
  const g = await graph();
  const described = await runTurn("/describe Widget", { config: CONFIG, graph: g });
  assert.match(described.answer, /^Widget — Class \(id: cls-widget\)/);
  assert.doesNotMatch(described.answer, /taught facts:/);
});

test("/describe with memoryDir but NO matching fact stays byte-identical to the no-memory answer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-describe-nofact-"));
  try {
    const g = await graph();
    const bare = await runTurn("/describe Widget", { config: CONFIG, graph: g });
    const withMemory = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.equal(withMemory.answer, bare.answer, "no taught fact about Widget means no append");
    assert.doesNotMatch(withMemory.answer, /taught facts:/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a taught fact about a DIFFERENT subject never leaks into an unrelated /describe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-describe-unrelated-"));
  try {
    const g = await graph();
    await appendFact(dir, {
      subject: "Button", predicate: "mgx:ownedBy", object: "Priya",
      provenance: "ace:chat:describe@2026-07-07T00:00:00.000Z",
    });
    const described = await runTurn("/describe Widget", { config: CONFIG, graph: g, memoryDir: dir });
    assert.doesNotMatch(described.answer, /taught facts:/, "Button's fact must not attach to Widget's describe");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
