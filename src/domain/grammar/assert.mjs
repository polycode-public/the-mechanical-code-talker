// grammar/assert.mjs — the grammar→memory bridge: parseAce a sentence and land
// every emitted triple in tmct's OWN memory graph via an INJECTED appendFact
// (memory/core.mjs's, in the live wiring — the grammar never imports the
// store).
//
// appendFact normalizes each triple's subject/object through normFactTerm
// (tmct:Legacy-module → "legacy-module"; the predicate keeps its vocabulary
// casing) and content-addresses the fact id — so re-asserting the same
// sentence upserts, never duplicates, and different writers (chat, corpus)
// converge on the same stored term spelling. Provenance is a compact tag
// ("ace:chat:<sessionId>@<ts>"); core.mjs unions tags "|"-joined when several
// writers assert the same fact.

import { parseAce } from "./ace.mjs";
import { loadLexicon } from "./lexicon.mjs";

/** Render a provenance descriptor {source, sessionId?, ts?} as the stored tag.
 *  Deterministic, compact, greppable: ace:chat:0189…abcd@2026-07-04T10:00:00Z */
export function provenanceTag({ source = "chat", sessionId = "", ts = "" } = {}) {
  return `ace:${source}${sessionId ? `:${sessionId}` : ""}${ts ? `@${ts}` : ""}`;
}

/** Parse `sentence` against the ACE-OWL sub-fragment and append every emitted
 *  triple to the memory graph under `dir`, via the REQUIRED injected
 *  `appendFact` (memory/core.mjs's, in the live wiring). Returns the parse
 *  result extended with `ids` (one fact id per triple, same order) and the
 *  provenance tag — or null (grammar miss, nothing written), or the residue
 *  parse (unknown words: triples empty, ids empty, nothing written).
 *
 *  `observedAt`, when given, passes straight through to every appended fact
 *  — the dated teach frame's own hook (chat.mjs's assertTurn strips the
 *  "as of <date>" suffix before the sentence ever reaches parseAce, and
 *  supplies the parsed instant here). */
export async function assertSentence(dir, sentence, { lexicon, provenance, appendFact, observedAt } = {}) {
  if (typeof appendFact !== "function") {
    throw new TypeError("assertSentence needs an appendFact option (memory/core.mjs's writer) — the grammar never imports the store");
  }
  const parse = parseAce(sentence, lexicon ?? loadLexicon());
  if (!parse) return null;
  const tag = provenanceTag(provenance);
  const ids = [];
  for (const t of parse.triples) {
    const { id } = await appendFact(dir, {
      subject: t.subject, predicate: t.predicate, object: t.object, provenance: tag,
      ...(observedAt ? { observedAt } : {}),
    });
    ids.push(id);
  }
  return { ...parse, ids, provenance: tag };
}
