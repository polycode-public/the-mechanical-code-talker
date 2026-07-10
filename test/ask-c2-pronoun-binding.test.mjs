// ask-c2-pronoun-binding.test.mjs — regression test for HANDOVER.md item 1
// (CHATBENCH C2 `pronoun-binding`, cases g-c2-pron-3/7/8/10, all 0/10 tier-1
// green / confidently-wrong before this fix).
//
// This was never a linguistic coreference problem — it was a ROUTING bug.
// Every failing case shares one exact single-turn sentence template:
//   "<A> ... because it <verb> <B> — which of them <verb> <object>"
// parseAnaphora (src/ask.mjs) unconditionally treats "of them"/"of those" as a
// reference to a PREVIOUS turn's cached result set (ask()'s opts.prev). On the
// very first turn there is no prev, so evalAnaphora returned an honest-sounding
// but WRONG miss ("'those'/'them' needs a previous answer to refer to") even
// though the two candidates ("them") were named right there in the SAME
// sentence, and the filter ("which ... still imports app/lib/f.mjs") is
// directly checkable against the graph's own `imports` edges with zero
// cross-turn context required.
//
// The fix: parseAnaphora now also scans the clause BEFORE the "of them"/"of
// those" trigger (back to sentence start) for 2+ code-identifier-shaped
// tokens (dotted paths / Capitalized symbols / lowerCamelCase — the same
// NAME_TOKEN_RE shape chat.mjs's discourseRewrite uses, duplicated locally in
// ask.mjs since chat.mjs only ever imports ask.mjs LAZILY). When 2+ are found,
// evalAnaphora resolves them to real graph entities and evaluates the trailing
// filter against THAT explicit candidate set instead of opts.prev — no
// previous turn needed at all. An ordinary multi-turn "which of those are
// tested" follow-up (no named entities in the CURRENT utterance) is completely
// unaffected: it still falls through to opts.prev exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { ask } from "../src/ask.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

// Fixture ground truth this suite leans on (test/fixtures/entities.fixture.json):
//   imports: e.mjs -> a.mjs, e.mjs -> f.mjs, f.mjs -> e.mjs (mutual), b.mjs -> a.mjs
//   fnAlpha (fn-alpha) is DEFINED in app/lib/a.mjs only.

test("g-c2-pron-3 shape: 'which of them still imports X' resolves against the two NAMED modules, not opts.prev", () => {
  const r = ask(graph, "app/lib/e.mjs can't be removed before app/lib/f.mjs because it still imports app/lib/f.mjs — which of them still imports app/lib/f.mjs", {});
  assert.equal(r.tmct_ask.miss, false, `expected a real answer, got a miss: ${r.content}`);
  assert.match(r.content, /app\/lib\/e\.mjs/, "the importer (e.mjs) is the correct binding, not f.mjs");
  assert.doesNotMatch(r.content, /^Yes\.|^No\b/, "never a bare yes/no framing for a which-of-them question");
});

test("g-c2-pron-7 shape: 'which of them defines X' picks the DEFINING module out of the two named", () => {
  const r = ask(graph, "app/lib/e.mjs imports app/lib/a.mjs because it defines fnAlpha — which of them defines fnAlpha", {});
  assert.equal(r.tmct_ask.miss, false, `expected a real answer, got a miss: ${r.content}`);
  assert.match(r.content, /app\/lib\/a\.mjs/, "fnAlpha is defined in a.mjs, not e.mjs");
  assert.doesNotMatch(r.content, /app\/lib\/e\.mjs/, "e.mjs does not define fnAlpha — must not appear as the answer");
});

test("g-c2-pron-8 shape: same template, different module pair (b.mjs/a.mjs) — the importer binds correctly", () => {
  const r = ask(graph, "app/lib/b.mjs can't be removed before app/lib/a.mjs because it still imports app/lib/a.mjs — which of them still imports app/lib/a.mjs", {});
  assert.equal(r.tmct_ask.miss, false, `expected a real answer, got a miss: ${r.content}`);
  assert.match(r.content, /app\/lib\/b\.mjs/);
  assert.doesNotMatch(r.content, /^Yes\.|^No\b/);
});

test("g-c2-pron-10 shape: same template, different module pair (c.mjs/a.mjs) — the definer binds correctly", () => {
  const r = ask(graph, "app/lib/c.mjs imports app/lib/a.mjs because it defines fnAlpha — which of them defines fnAlpha", {});
  assert.equal(r.tmct_ask.miss, false, `expected a real answer, got a miss: ${r.content}`);
  assert.match(r.content, /app\/lib\/a\.mjs/);
  assert.doesNotMatch(r.content, /app\/lib\/c\.mjs/);
});

test("in-sentence candidates ANSWER, not just AVOID the miss — must cite the actual satisfying entity", () => {
  const r = ask(graph, "app/lib/e.mjs can't be removed before app/lib/f.mjs because it still imports app/lib/f.mjs — which of them still imports app/lib/f.mjs", {});
  // f.mjs does NOT import itself, so only e.mjs should survive the filter.
  assert.deepEqual(r.tmct_ask.matches.map((m) => m.label), ["app/lib/e.mjs"]);
});

test("regression guard: an ordinary MULTI-TURN 'which of those' follow-up (no named entities in the CURRENT utterance) is unaffected — still needs opts.prev", () => {
  const noPrev = ask(graph, "which of those are tested", {});
  assert.equal(noPrev.tmct_ask.miss, true);
  assert.match(noPrev.content, /needs a previous answer/);

  const prevIds = ask(graph, "which modules import app/lib/a.mjs", {}).tmct_ask.matches.map((m) => m.id);
  assert.ok(prevIds.length >= 2, "sanity: the prior set actually has 2+ ids to filter");
  const withPrev = ask(graph, "which of those are tested", { prev: prevIds });
  assert.equal(withPrev.tmct_ask.miss, false);
});

test("regression guard: a single named entity before the trigger (only 1, not 2+) still falls back to opts.prev, never guesses off one name", () => {
  const r = ask(graph, "app/lib/a.mjs is a module — which of them defines fnAlpha", {});
  // Only ONE code-identifier ("app/lib/a.mjs") appears before "of them" — the
  // in-sentence candidate path requires 2+, so this must fall straight through
  // to the ordinary no-prev honest miss, not silently invent a second candidate.
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /needs a previous answer/);
});
