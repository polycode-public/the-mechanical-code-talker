// build-seed.mjs — writes the turn Lambda's cold-boot seed (§3.18's mid band
// set): the human persona at every size plus the code domain pack — persona
// and depth, none of the two bands retrieval serves per-query instead
// (WordNet-xl and the capped ConceptNet band, each a subset of the corpus
// partition its own name matches).
//
// Reuses `scripts/build-chat-seed.mjs`'s own seeding pipeline (the same
// resolveExtensions + seedActiveCorpusEntries path `tmct init` runs) with
// this band list in place of the xl set's — so the mid bundle can never
// drift from what those corpus entries actually contain, the same guarantee
// the browser's chat-seed.json already has.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main as buildSeed } from "../../scripts/build-chat-seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** §3.18's mid band set, in seeding order: the always-active `human` band,
 *  its additive medium/large size tiers, and the code domain pack. */
export const MID_BUNDLE_BANDS = Object.freeze([
  "human", "human-medium", "human-large", "code",
]);

// A guard specific to this bundle's expected scale (§3.18 measures it at
// roughly 14,100 facts, ~20.5 MB post-re-key at today's corpus content) —
// wide enough for corpus growth, tight enough that a band list mistake
// pulling in a heavy corpus (wordnet-xl, conceptnet) fails here instead of
// silently reaching the multi-second cold-start class this bundle exists to
// avoid.
export const MID_SEED_BYTE_CEILING = 32 * 1024 * 1024;

export async function main(outPath = join(here, "mid-seed.json")) {
  return buildSeed(outPath, { bands: MID_BUNDLE_BANDS, caps: {}, byteCeiling: MID_SEED_BYTE_CEILING });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const res = await main(process.argv[2]);
  for (const [name, r] of Object.entries(res.perBundle)) {
    console.log(`  ${name}: ${r.appended} facts, ${(r.bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`wrote ${res.outPath} (${res.facts} facts, ${(res.bytes / 1024).toFixed(0)} KB)`);
}
