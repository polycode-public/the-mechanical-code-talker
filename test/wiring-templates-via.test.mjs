// W1 seam tests — templates → render path + `via` provenance (ROADMAP Phase 4).
//
//   1. RENDER PARITY: the conversational/orientation/why-miss surfaces moved into
//      data/templates/responses.jsonl must render BYTE-IDENTICAL to the strings
//      chat.mjs used to hardcode (frozen here verbatim — if a template row drifts,
//      this fails before any bench does).
//   2. SLOT LINT: every chat-consumed row is zero-slot (rendered with {}), and the
//      whole template file still passes loadTemplates()' own validation.
//   3. VIA PRESENCE: every turn record type carries the answer-provenance `via`
//      field — template | conversational | count | command | composed | assert —
//      and sessions.mjs's sidecar parser passes it through unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { loadTemplates, render } from "../src/corpus/templates.mjs";
import { parseSessionJsonl } from "../src/sessions.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() {
  return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG)));
}

// The strings chat.mjs rendered BEFORE the swap — frozen verbatim. The template
// rows must reproduce them byte-for-byte (W1's "byte-stable swap" contract).
const FROZEN = {
  "conversational-greeting":
    "Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.",
  "conversational-greeting-hello-there":
    'Hello there. (A hollow voice says, "fool.") Ask me about this codebase, or /help.',
  "conversational-greeting-good-morning": "Good morning. Ask me about this codebase, or /help.",
  "conversational-greeting-good-afternoon": "Good afternoon. Ask me about this codebase, or /help.",
  "conversational-greeting-good-evening": "Good evening. Ask me about this codebase, or /help.",
  "conversational-thanks": "Any time. Ask another, or /help for what I can do.",
  "conversational-farewell": "Bye — flushing the session log. Come back with a question any time.",
  "orientation-friendly": [
    "I answer questions about THIS codebase's structure — imports, calls, definitions,",
    "history and counts. For example:",
    "  which modules import walk.mjs",
    "  what calls buildContextBundle",
    "  how many classes are there",
    "/help for commands, /stats for an overview of the graph.",
  ].join("\n"),
  "miss-no-previous-answer":
    'No previous answer to expand yet — ask me a question first, then say "why" or "say more".',
};

test("W1 render parity: every moved surface renders byte-identical to the pre-swap string", async () => {
  const templates = await loadTemplates();
  for (const [id, expected] of Object.entries(FROZEN)) {
    assert.equal(render(id, {}, templates), expected, `template "${id}" is byte-stable`);
  }
});

test("W1 slot lint: chat-consumed rows are zero-slot; the whole file validates", async () => {
  const templates = await loadTemplates(); // throws on any malformed row — the file lint
  for (const id of Object.keys(FROZEN)) {
    const row = templates.get(id);
    assert.ok(row, `row "${id}" exists`);
    assert.deepEqual(row.slots, [], `"${id}" needs no slots (chat renders it with {})`);
  }
});

test("W1 runTurn parity: the conversational turns answer with the exact template output", async () => {
  const g = await graph();
  const hi = await runTurn("hi", { config: CONFIG, graph: g });
  assert.equal(hi.answer, FROZEN["conversational-greeting"]);
  const zork = await runTurn("hello there", { config: CONFIG, graph: g });
  assert.equal(zork.answer, FROZEN["conversational-greeting-hello-there"]);
  const evening = await runTurn("good evening", { config: CONFIG, graph: g });
  assert.equal(evening.answer, FROZEN["conversational-greeting-good-evening"]);
  const ta = await runTurn("thanks", { config: CONFIG, graph: g });
  assert.equal(ta.answer, FROZEN["conversational-thanks"]);
  const bye = await runTurn("bye", { config: CONFIG, graph: g });
  assert.equal(bye.answer, FROZEN["conversational-farewell"]);
  assert.equal(bye.end, true, "farewell still ends the session");
  const help = await runTurn("what can you do", { config: CONFIG, graph: g });
  assert.equal(help.answer, FROZEN["orientation-friendly"]);
  const why = await runTurn("why", { config: CONFIG, graph: g });
  assert.equal(why.answer, FROZEN["miss-no-previous-answer"]);
  assert.equal(why.record.miss, true, "the empty why is still recorded as a miss");
});

test("W1 via: template wording carries via:'template'; a real why-expansion is via:'conversational'", async () => {
  const g = await graph();
  for (const line of ["hi", "hello there", "thanks", "bye", "what can you do", "why"]) {
    const r = await runTurn(line, { config: CONFIG, graph: g });
    assert.equal(r.record.via, "template", `"${line}" wording came from the template library`);
  }
  // a why/say-more with a real previous answer re-renders CONTENT, not a template
  const first = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  const why = await runTurn("say more", { config: CONFIG, graph: g, last: first.last });
  assert.equal(why.record.via, "conversational");
  assert.match(why.answer, /expanding: which modules import a\.mjs/);
});

test("W1 via: count/command/composed/orientation-miss each carry their own provenance", async () => {
  const g = await graph();
  const count = await runTurn("how many classes are there", { config: CONFIG, graph: g });
  assert.equal(count.record.via, "count");
  const cmd = await runTurn("/help", { config: CONFIG, graph: g });
  assert.equal(cmd.record.via, "command");
  const hit = await runTurn("which modules import a.mjs", { config: CONFIG, graph: g });
  assert.equal(hit.record.via, "composed", "an ask answer is the composed (productive) band");
  // (cycle W2P: "what calls fnAlpha" is now a real hit — use a genuinely-uncalled symbol for
  // the honest-ask-miss band; nothing calls Widget.render, still engine-composed wording.)
  const miss = await runTurn("what calls Widget.render", { config: CONFIG, graph: g });
  assert.equal(miss.record.via, "composed", "an honest ask miss is still engine-composed wording");
  assert.equal(miss.record.miss, true);
  // a conversational miss (short, non-code) is answered by the orientation TEMPLATE
  const convoMiss = await runTurn("jokes please", { config: CONFIG, graph: g });
  assert.equal(convoMiss.answer, FROZEN["orientation-friendly"]);
  assert.equal(convoMiss.record.via, "template");
});

test("W1 via: an asserted declarative sentence records via:'assert'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w1-assert-"));
  try {
    const g = await graph();
    const r = await runTurn("every module is a component", {
      config: CONFIG, graph: g, memoryDir: dir, sessionId: "w1-test",
    });
    assert.match(r.answer, /noted — remembered 1 fact/);
    assert.equal(r.record.via, "assert");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("W1 via: parseSessionJsonl passes via through unchanged (and tolerates its absence)", () => {
  const text = [
    JSON.stringify({ type: "session", id: "01890000-0000-7000-8000-000000000000", started: "2026-07-04T10:00:00.000Z" }),
    JSON.stringify({ type: "turn", ts: "2026-07-04T10:00:01.000Z", query: "hi", via: "template", resolvedIds: [], answeredIds: [], miss: false }),
    JSON.stringify({ type: "turn", ts: "2026-07-04T10:00:02.000Z", query: "old row", resolvedIds: [], answeredIds: [], miss: true }),
  ].join("\n");
  const rec = parseSessionJsonl(text);
  assert.equal(rec.turns[0].via, "template");
  assert.equal("via" in rec.turns[1], false, "pre-W1 sidecars parse exactly as before");
});
