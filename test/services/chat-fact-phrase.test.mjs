// A teach/read-back turn per predicate family: what a chat answer actually
// says for each curated entry, end to end through the store, rather than the
// renderer's own unit view of the table.
// owl:unionOf/complementOf/oneOf/differentFrom already have their own
// dedicated read-back coverage in
// test/adapters/teach-negative-and-enumeration.test.mjs; this file covers the
// rest of the table's curated entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-fact-phrase-"));
}

async function teachAndReadBack(teach, term) {
  const dir = await tmpRepo();
  try {
    await runTurn(teach, { memoryDir: dir, sessionId: "fact-phrase" });
    const { answer } = await runTurn(`what do you know about ${term}`, { memoryDir: dir, sessionId: "fact-phrase" });
    return answer;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("rdfs:subClassOf reads back as 'is a kind of'", async () => {
  assert.match(await teachAndReadBack("a robin is a bird.", "robin"), /robin is a kind of bird/);
});

test("mgx:usedFor reads back as 'is used for'", async () => {
  assert.match(await teachAndReadBack("a knife is used for cutting.", "knife"), /knife is used for cutting/);
});

test("mgx:partOf reads back as 'is part of'", async () => {
  assert.match(await teachAndReadBack("a gizmo is part of a widget.", "gizmo"), /gizmo is part of widget/);
});

test("mgx:memberOf reads back as 'is a member of'", async () => {
  assert.match(await teachAndReadBack("an ace is a member of a deck.", "ace"), /ace is a member of deck/);
});

test("mgx:capableOf reads back as 'can'", async () => {
  assert.match(await teachAndReadBack("a dog can bark.", "dog"), /dog can bark/);
});

test("mgx:causes reads back as 'causes'", async () => {
  // A bare present-tense name-verb-name line is wrapper-required by design
  // ("john likes mary" gets the same nudge), so this teaches through the
  // wrapper. Every other row here carries an article and needs none.
  assert.match(await teachAndReadBack("remember that fire causes smoke.", "fire"), /fire causes smoke/);
});

test("mgx:madeOf reads back as 'is made of'", async () => {
  assert.match(await teachAndReadBack("a table is made of wood.", "table"), /table is made of wood/);
});
