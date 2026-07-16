// corpus/wordnet/generate.mjs tests — the WordNet -> ConceptNet-shape
// converter's PURE pieces only (relation mapping, term encoding, synonym
// chaining, direction, and the fact/XL builders against small synthetic
// synset fixtures). Never touches the real local OEWN checkout — that path
// (~/projects/globalwordnet/english-wordnet/src/yaml) is a maintainer-only,
// uncommitted, machine-local source (see that file's own header comment), so
// nothing here can depend on it existing in CI or another contributor's
// machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RELATION_MAP, SKIPPED_RELATIONS, encodeTerm, humanize, synonymPairs,
  buildFullFacts, buildXlFacts, hypernymRefCounts, resolveYamlDir, DEFAULT_YAML_DIR,
} from "../corpus/wordnet/generate.mjs";
import { termText, loadMap } from "../src/adapters/corpus/conceptnet.mjs";

test("RELATION_MAP: the closed set of eight structural WordNet relations this converter emits", () => {
  assert.deepEqual(Object.keys(RELATION_MAP).sort(), [
    "also", "attribute", "causes", "hypernym", "mero_member", "mero_part", "mero_substance", "similar",
  ]);
  assert.equal(RELATION_MAP.hypernym.rel, "/r/IsA");
  assert.equal(RELATION_MAP.hypernym.flip, false);
  assert.equal(RELATION_MAP.mero_part.rel, "/r/PartOf");
  assert.equal(RELATION_MAP.mero_part.flip, true);
  assert.equal(RELATION_MAP.mero_member.rel, "/r/PartOf");
  assert.equal(RELATION_MAP.mero_member.flip, true);
  assert.equal(RELATION_MAP.mero_substance.rel, "/r/MadeOf");
  assert.equal(RELATION_MAP.mero_substance.flip, false);
  assert.equal(RELATION_MAP.causes.rel, "/r/Causes");
  assert.equal(RELATION_MAP.attribute.rel, "/r/HasProperty");
  assert.equal(RELATION_MAP.similar.rel, "/r/SimilarTo");
  assert.equal(RELATION_MAP.also.rel, "/r/RelatedTo");
  assert.deepEqual([...SKIPPED_RELATIONS].sort(), ["entails", "exemplifies"]);
});

test("RELATION_MAP: every emitted rel has a real (ace != \"none\") row in conceptnet-map.toml", async () => {
  const map = await loadMap();
  for (const [wnRel, { rel }] of Object.entries(RELATION_MAP)) {
    assert.ok(map.has(rel), `${wnRel} -> ${rel}: no row in conceptnet-map.toml at all`);
    // Phase 1 (2026-07-12) widened conceptnet-map.toml so Synonym/RelatedTo/
    // SimilarTo emit real facts too, not just IsA/PartOf/MadeOf/Causes/
    // HasProperty — every relation this converter maps to should now be a
    // live, emitting row. This converter itself never touches
    // conceptnet-map.toml (scope boundary) — it only relies on what's there.
    assert.notEqual(map.get(rel).ace, "none", `${wnRel} -> ${rel}: row exists but ace="none"`);
  }
});

test("encodeTerm: lowercase, spaces -> underscores, exact inverse of termText()'s decode", () => {
  assert.equal(encodeTerm("Ice Cream"), "/c/en/ice_cream");
  assert.equal(termText(encodeTerm("Ice Cream")), "ice cream");
  assert.equal(encodeTerm("dog"), "/c/en/dog");
  assert.equal(termText(encodeTerm("dog")), "dog");
  // punctuation other than whitespace round-trips untouched, same as
  // termText's own decode (it only ever substitutes underscore -> space)
  assert.equal(encodeTerm("child's body"), "/c/en/child's_body");
  assert.equal(termText(encodeTerm("child's body")), "child's body");
  assert.equal(encodeTerm(""), null);
  assert.equal(encodeTerm("   "), null);
});

test("humanize: the surfaceText-facing inverse of underscore-joining", () => {
  assert.equal(humanize("ice_cream"), "ice cream");
  assert.equal(humanize("dog"), "dog");
});

test("synonymPairs: N members -> exactly N-1 pairs (chained, not the N*(N-1)/2 cross product)", () => {
  assert.deepEqual(synonymPairs([]), []);
  assert.deepEqual(synonymPairs(["solo"]), []);
  assert.deepEqual(synonymPairs(["a", "b"]), [["a", "b"]]);
  assert.deepEqual(synonymPairs(["a", "b", "c", "d"]), [["a", "b"], ["a", "c"], ["a", "d"]]);
  // exactly N-1, always chained off the FIRST member, never the full
  // combinatorial cross product (which would be N*(N-1)/2 = 6 for N=4)
  const four = synonymPairs(["a", "b", "c", "d"]);
  assert.equal(four.length, 3);
  assert.ok(four.every(([m0]) => m0 === "a"));
});

// ---- a small synthetic synset universe, mirroring the REAL shape confirmed
// by direct inspection of the OEWN yaml (see generate.mjs's own header
// comment) — no dependency on the local checkout existing. ----------------
function fixtureSynsets() {
  return new Map(Object.entries({
    // hypernym: dog IsA animal
    "00001-n": { members: ["animal"] },
    "00002-n": { members: ["dog", "canine"], hypernym: ["00001-n"] },
    // mero_part: keyboard HAS PART action (WordNet: whole -> mero_part -> part)
    // real slice.jsonl convention: PartOf is {start:part, end:whole} — so the
    // emitted fact must be action(part) PartOf keyboard(whole), i.e. FLIPPED
    // relative to WordNet's own whole->part edge direction.
    "00010-n": { members: ["keyboard"], mero_part: ["00011-n"] },
    "00011-n": { members: ["action"] },
    // mero_member: team HAS MEMBER player -> player PartOf team (same flip)
    "00030-n": { members: ["team"], mero_member: ["00031-n"] },
    "00031-n": { members: ["player"] },
    // mero_substance: computer HAS SUBSTANCE hardware -> computer MadeOf
    // hardware — NO flip (WordNet's whole->substance direction already
    // matches ConceptNet's MadeOf start=whole,end=substance convention).
    "00020-n": { members: ["computer"], mero_substance: ["00021-n"] },
    "00021-n": { members: ["hardware"] },
    // causes: fire causes smoke
    "00040-v": { members: ["fire"], causes: ["00041-v"] },
    "00041-v": { members: ["smoke"] },
    // attribute: temperature <-> hot
    "00050-n": { members: ["temperature"], attribute: ["00051-a"] },
    "00051-a": { members: ["hot"] },
    // similar: quick <-> fast
    "00060-a": { members: ["quick"], similar: ["00061-a"] },
    "00061-a": { members: ["fast"] },
    // also: walk <-> stroll
    "00070-v": { members: ["walk"], also: ["00071-v"] },
    "00071-v": { members: ["stroll"] },
    // entails/exemplifies: deliberately unmapped — must never appear in output
    "00080-v": { members: ["snore"], entails: ["00081-v"], exemplifies: ["00082-n"] },
    "00081-v": { members: ["sleep"] },
    "00082-n": { members: ["napping"] },
    // a self-referential hypernym edge — must be skipped (self-loop guard)
    "00090-n": { members: ["loop"], hypernym: ["00090-n"] },
    // a dangling target id — must be skipped, not throw
    "00091-n": { members: ["dangling"], hypernym: ["99999-n"] },
    // a multi-member synset for the synonym chain
    "00100-n": { members: ["couch", "sofa", "settee"] },
  }));
}

test("buildFullFacts: direction, flip, self-loop/dangling-target skip, entails/exemplifies never emitted", () => {
  const facts = buildFullFacts(fixtureSynsets());
  const has = (rel, start, end) => facts.some((f) => f.rel === rel && f.start === start && f.end === end);

  assert.ok(has("/r/IsA", "/c/en/dog", "/c/en/animal"), "hypernym: dog IsA animal (direct, no flip)");
  assert.ok(has("/r/PartOf", "/c/en/action", "/c/en/keyboard"), "mero_part FLIPPED: action(part) PartOf keyboard(whole)");
  assert.ok(has("/r/PartOf", "/c/en/player", "/c/en/team"), "mero_member FLIPPED: player(part) PartOf team(whole)");
  assert.ok(has("/r/MadeOf", "/c/en/computer", "/c/en/hardware"), "mero_substance NOT flipped: computer(whole) MadeOf hardware(substance)");
  assert.ok(has("/r/Causes", "/c/en/fire", "/c/en/smoke"));
  assert.ok(has("/r/HasProperty", "/c/en/temperature", "/c/en/hot"));
  assert.ok(has("/r/SimilarTo", "/c/en/quick", "/c/en/fast"));
  assert.ok(has("/r/RelatedTo", "/c/en/walk", "/c/en/stroll"));
  assert.ok(has("/r/Synonym", "/c/en/couch", "/c/en/sofa"));
  assert.ok(has("/r/Synonym", "/c/en/couch", "/c/en/settee"));
  assert.equal(facts.filter((f) => f.start === "/c/en/couch" && f.rel === "/r/Synonym").length, 2, "N-1 chain, not the cross product");

  // entails/exemplifies never surface under any relation URI
  assert.ok(!facts.some((f) => f.start === "/c/en/snore" || f.end === "/c/en/snore"));

  // self-loop and dangling-target edges never produce a row
  assert.ok(!facts.some((f) => f.start === "/c/en/loop" && f.end === "/c/en/loop"));
  assert.ok(!facts.some((f) => f.start === "/c/en/dangling"));

  // deterministic sort: rel, then start, then end
  for (let i = 1; i < facts.length; i++) {
    const a = facts[i - 1], b = facts[i];
    const ka = `${a.rel} ${a.start} ${a.end}`, kb = `${b.rel} ${b.start} ${b.end}`;
    assert.ok(ka <= kb, `sorted: ${ka} <= ${kb}`);
  }

  // every row has the tier-1 slice shape
  for (const f of facts) {
    assert.equal(typeof f.start, "string");
    assert.equal(typeof f.rel, "string");
    assert.equal(typeof f.end, "string");
    assert.equal(typeof f.weight, "number");
    assert.equal(typeof f.surfaceText, "string");
  }
});

test("buildXlFacts: budget-bounded, only IsA + Synonym rows, proportioned to the real full-corpus ratio", () => {
  const synsets = fixtureSynsets();
  const full = buildFullFacts(synsets);
  const xl = buildXlFacts(synsets, full, 4);
  assert.ok(xl.length <= 6, `stays roughly within budget (got ${xl.length})`); // a synonym chain isn't split, so a small fixture can slightly overshoot
  for (const f of xl) {
    assert.ok(f.rel === "/r/IsA" || f.rel === "/r/Synonym", `XL only ever carries the hypernym backbone + synonym chains, got ${f.rel}`);
  }
  assert.ok(xl.some((f) => f.rel === "/r/IsA" && f.start === "/c/en/dog" && f.end === "/c/en/animal"));
});

test("hypernymRefCounts: counts how often each synset is a hypernym TARGET", () => {
  const refs = hypernymRefCounts(fixtureSynsets());
  assert.equal(refs.get("00001-n"), 1); // animal is dog's hypernym target
  assert.equal(refs.get("00090-n"), 1); // the self-loop still counts as a reference
  assert.equal(refs.get("99999-n"), 1); // dangling target still counted (ref-counting doesn't require the target to resolve)
  assert.equal(refs.has("00002-n"), false); // dog is never itself a hypernym target here
});

test("resolveYamlDir: CLI arg > env var > default, pure and injectable", () => {
  assert.equal(resolveYamlDir(["/explicit/path"], {}), "/explicit/path");
  assert.equal(resolveYamlDir([], { TMCT_WORDNET_YAML_DIR: "/env/path" }), "/env/path");
  assert.equal(resolveYamlDir([], {}), DEFAULT_YAML_DIR);
  assert.match(DEFAULT_YAML_DIR, /english-wordnet\/src\/yaml$/);
});
