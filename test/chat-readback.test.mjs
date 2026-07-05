// Assert-recall READ-BACK (PLAN_CYCLE_4 tail): the via:fact path WROTE a declared
// fact but the superclass side was unqueryable — "every X is a Y" asserted, then
// "what is a Y" died as "'Y' isn't a term in this graph's own vocabulary". The
// reverse-membership reader (factReadBack, over readFactRows) makes declared facts
// queryable from either side, citing provenance; an un-asserted term still misses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

test("read-back: assert 'every X is a Y', then 'what is a Y' answers from the remembered fact, cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-rb-"));
  try {
    const asserted = await runTurn("every function is a component", {
      config: CONFIG, memoryDir: dir, sessionId: "rb-session",
    });
    assert.match(asserted.answer, /remembered 1 fact: function rdfs:subClassOf component/);
    assert.equal(asserted.record.via, "assert");

    // The SUPERCLASS side — previously an honest miss ("'component' isn't a term …") —
    // now answers from the remembered fact, provenance verbatim. (Leading case is left
    // to the finish grammar pass, so we match the fact content, not the first letter.)
    const whatIsY = await runTurn("what is a component", { config: CONFIG, memoryDir: dir });
    assert.match(whatIsY.answer, /^[Yy]ou told me: function is a kind of component \(source: ace:chat:rb-session@/);
    assert.equal(whatIsY.record.via, "fact");
    assert.equal(whatIsY.record.miss, false);

    // The SUBCLASS side (factAnswer's existing subject match) still answers too.
    const whatIsX = await runTurn("what is a function", { config: CONFIG, memoryDir: dir });
    assert.match(whatIsX.answer, /^[Yy]ou told me: function is a kind of component \(source: ace:chat:/);
    assert.equal(whatIsX.record.via, "fact");

    // The yes/no form answers YES from the same fact.
    const isa = await runTurn("is a function a component", { config: CONFIG, memoryDir: dir });
    assert.match(isa.answer, /^[Yy]es — you told me: function is a kind of component \(source: ace:chat:/);
    assert.equal(isa.record.via, "fact");
    assert.equal(isa.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("read-back: an un-asserted superclass term still honestly misses (byte-identical to no-memory)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-rb-miss-"));
  try {
    // one unrelated fact remembered, so memory is non-empty but holds nothing about 'widget'
    await runTurn("every function is a component", { config: CONFIG, memoryDir: dir, sessionId: "rb-miss" });

    const withMemory = await runTurn("what is a widget", { config: CONFIG, memoryDir: dir });
    const bare = await runTurn("what is a widget", { config: CONFIG });
    assert.equal(withMemory.answer, bare.answer, "un-asserted term unchanged by the read-back");
    assert.equal(withMemory.record.miss, true);
    assert.notEqual(withMemory.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
