// grammar/assert.mjs — the grammar→memory bridge: parseAce a sentence and land
// every emitted triple in tmct's OWN memory graph via memory/core.mjs's
// appendFact (ROADMAP Phase 2 item 2 meeting Phase 1 item 9).
//
// appendFact normalizes each triple's subject/object through normFactTerm
// (tmct:Legacy-module → "legacy-module"; the predicate keeps its vocabulary
// casing) and content-addresses the fact id — so re-asserting the same
// sentence upserts, never duplicates, and different writers (chat, corpus)
// converge on the same stored term spelling. Provenance is a compact tag
// ("ace:chat:<sessionId>@<ts>"); core.mjs unions tags "|"-joined when several
// writers assert the same fact.

import { appendFact } from "../memory/core.mjs";
import { parseAce } from "./ace.mjs";
import { loadLexicon } from "./lexicon.mjs";

/** Render a provenance descriptor {source, sessionId?, ts?} as the stored tag.
 *  Deterministic, compact, greppable: ace:chat:0189…abcd@2026-07-04T10:00:00Z */
export function provenanceTag({ source = "chat", sessionId = "", ts = "" } = {}) {
  return `ace:${source}${sessionId ? `:${sessionId}` : ""}${ts ? `@${ts}` : ""}`;
}

/** Parse `sentence` against the ACE-OWL sub-fragment and append every emitted
 *  triple to the memory graph under `dir`. Returns the parse result extended
 *  with `ids` (one fact id per triple, same order) and the provenance tag —
 *  or null (grammar miss, nothing written), or the residue parse (unknown
 *  words: triples empty, ids empty, nothing written). */
export async function assertSentence(dir, sentence, { lexicon, provenance } = {}) {
  const parse = parseAce(sentence, lexicon ?? loadLexicon());
  if (!parse) return null;
  const tag = provenanceTag(provenance);
  const ids = [];
  for (const t of parse.triples) {
    const { id } = await appendFact(dir, {
      subject: t.subject, predicate: t.predicate, object: t.object, provenance: tag,
    });
    ids.push(id);
  }
  return { ...parse, ids, provenance: tag };
}
