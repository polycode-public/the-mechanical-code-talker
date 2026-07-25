// synthbench/code/verify/tiers.mjs — run the verification tiers a planned-edit
// case declares (expect.tiers) against a synthesized, non-abstained artifact,
// through the real sandbox. Returns a per-tier result map plus verifiedComplete
// (every declared tier passed). Grading (grade.mjs) is pure and reads this; the
// real execution lives here.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openSandbox, nodeCheck, runExportStdout } from "./sandbox.mjs";
import { extractRepo, assembleEntities } from "../../../src/index/index-repo.mjs";
import { graphStateFromEntities, diffGraphStates, effectsEqual, normalizeGraphState } from "../../../src/domain/codeplan/graph-delta.mjs";

/** The id the REAL indexer would assign a renamed entity after re-extraction —
 *  `fn:<path>#<name>` (graph-build.mjs's fnId), applied to a retitle-entity
 *  effect's own `id`/`title`. The indexer derives an entity's id from its
 *  CURRENT identifier text, so a rename's declared `retitle-entity` (same id,
 *  new title) and the re-extracted graph's raw delta (old id gone, a
 *  differently-named id appeared) describe the same real change in two
 *  different vocabularies; this is the translation between them. */
const predictedIdAfterRetitle = (effect) => `${effect.id.slice(0, effect.id.lastIndexOf("#") + 1)}${effect.title}`;

/** Rewrite `state` so every occurrence of `fromId` reads as `toId` — entity id
 *  and every edge endpoint. Used to fold a re-extracted state's freshly-minted
 *  post-rename id back onto the stable id the plan declared the effect over,
 *  so the diff below reduces to the single retitle-entity token a rename
 *  actually is, rather than an unrelated-looking delete-then-add. */
function remapEntityId(state, fromId, toId) {
  if (fromId === toId) return state;
  const remap = (id) => (id === fromId ? toId : id);
  return normalizeGraphState({
    entities: state.entities.map((e) => (e.id === fromId ? { ...e, id: toId } : e)),
    edges: state.edges.map((r) => ({ subject: remap(r.subject), predicate: r.predicate, object: remap(r.object) })),
  });
}

/** Tier 1 (graph-delta): re-extract the edited sandbox directory through the
 *  REAL offline indexer (index-repo.mjs — the same producer `tmct index` runs),
 *  diff it against the fixture's committed pre-edit graph, and reconcile the
 *  observed delta against the declared one. `commits: []`/no symbol history is
 *  passed explicitly to `assembleEntities` — the sandbox copy carries no `.git`
 *  of its own anyway, so this only makes the skip explicit and keeps the tier
 *  fast. Returns { ok, detail }. */
async function graphDeltaTier(caseDef, synth, fixtureRoot, editedDir) {
  const beforePayload = JSON.parse(readFileSync(join(fixtureRoot, ".tmct", "graph.json"), "utf8"));
  const beforeState = graphStateFromEntities(beforePayload);

  const raw = await extractRepo(editedDir, { historyDepth: 0 });
  const afterPayload = assembleEntities({ modules: raw.modules, commits: [], symbolHistory: [], generatedAt: "", prose: false });
  let afterState = graphStateFromEntities(afterPayload);

  const declared = synth.plan?.[0]?.declaredDelta ?? [];
  for (const effect of declared) {
    if (effect.op !== "retitle-entity") continue;
    afterState = remapEntityId(afterState, predictedIdAfterRetitle(effect), effect.id);
  }

  const observed = diffGraphStates(beforeState, afterState);
  const ok = effectsEqual(declared, observed);
  return { ok, detail: ok ? "" : `declared ${JSON.stringify(declared)} != observed ${JSON.stringify(observed)}` };
}

/** Verify a planned-edit artifact. `caseDef.expect.tiers` names the tiers:
 *    "parse"       — tier 0, `node --check` on each edited module
 *    "side-effect" — run the export and confirm its stdout carries the token
 *    "graph-delta" — tier 1, re-index the edit and reconcile the observed
 *                    graph change against the plan's declared effect
 *  Returns { tiers: { <name>: { ok, detail } }, verifiedComplete }. */
export async function verifyPlannedEdit(caseDef, synth, fixtureRoot) {
  const declared = caseDef.expect?.tiers ?? [];
  const { dir, cleanup } = openSandbox(fixtureRoot, synth.edits);
  const tiers = {};
  try {
    for (const name of declared) {
      if (name === "parse") {
        let result = { ok: true, detail: "" };
        for (const edit of synth.edits) {
          const r = nodeCheck(dir, edit.module);
          if (!r.ok) { result = { ok: false, detail: `${edit.module}: ${r.detail}` }; break; }
        }
        tiers.parse = result;
      } else if (name === "side-effect") {
        const se = caseDef.goal?.sideEffect ?? {};
        const r = runExportStdout(dir, { ...se.run, token: se.contains });
        tiers["side-effect"] = { ok: r.ok, detail: r.detail };
      } else if (name === "graph-delta") {
        tiers["graph-delta"] = await graphDeltaTier(caseDef, synth, fixtureRoot, dir);
      } else {
        tiers[name] = { ok: false, detail: `unknown tier '${name}'` };
      }
    }
  } finally {
    cleanup();
  }
  const verifiedComplete = declared.length > 0 && declared.every((n) => tiers[n]?.ok);
  return { tiers, verifiedComplete };
}
