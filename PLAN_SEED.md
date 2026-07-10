# PLAN_SEED.md — the default "human-world" persona: seeding, lexicons, corpora, backends

> **STATUS (2026-07-10): design complete, not yet built.** This is Stage 0 of a larger batch —
> documentation only, no code changes. Everything below is grounded in direct reads of the actual
> codebase, two locally-cloned reference repos, the real W3C OWL 2 spec, and measured numbers from
> this repo's own dev store — not estimates. See `HANDOVER.md` for what else is in this batch
> (the CLI/config unification and `scm-svf`/cardinality monotonicity live in `PLAN_INFERENCE_TESTING.md`
> and this batch's own tracking instead — this doc is scoped to seeding/lexicon/corpus work only).

**Goal:** replace tmct's implicit code-domain default (SEON + a tech-filtered ConceptNet slice) with
a genuinely general "human-world" persona, so a fresh `npx @polycode-projects/the-mechanical-code-talker
chat` with no prior init understands ordinary sentences — "a man has a hat" should just work — without
the operator having to explain what a man or a hat is first. SEON/ConceptNet become opt-in, not
default; seonix (a sibling repo consuming tmct as a library) re-selects them explicitly if its own
code-domain chat surface needs them.

---

## 1. Why this exists, and what changed along the way

Today's `tmct init` has an *implicit* default: `BUILTIN_EXTENSIONS`' `seon` and `conceptnet` entries
are both `active: true`, so any fresh repo gets a code-domain vocabulary whether or not that's what
the user actually wants. A repo that never asks `--corpus`/`--with-persona` gets zero everyday-world
knowledge — only software concepts. This was floated once already, in an earlier `HANDOVER.md` draft
("Proposed: a default human-world persona"), but never built, and that draft's own framing had a real
error worth correcting here: it claimed a class-membership question ("is a dog a mammal") and a
code-membership question ("is `HttpError` an `Error`") would "walk the same inheritance-chase logic...
not two parallel systems," implying SEON already has a shared root ("Thing") that a new persona could
anchor to. **It doesn't.** Grepped directly: neither `ontology/tmct-core.ttl` nor any `src/*.mjs`
declares a `Thing` root. SEON's own top concept ("type", parent of class/interface/structure) has no
parent of its own; `general.jsonl`'s root ("animal") doesn't either. Both are unrooted, disconnected
trees today. This doc's design fixes that for real (§3, `human-base`), rather than assuming it away.

**The scope grew through discussion, in ways worth recording:**

- The operator's own framing for why: not just background facts, but making the chat **immediately
  useful** — breadth of common nouns/relations over deep semantic modeling. Flat facts like "man IsA
  person" are enough; no formal gender/kinship taxonomy is needed. Grammar and fact-extraction are
  hard enough without over-modeling.
- This surfaced a real, second vocabulary surface that a first pass would have missed entirely:
  **`src/grammar/lexicon-core.json`**, the ACE parser's closed-set declared vocabulary. A sentence
  like "a man has a hat" can only be taught/parsed at all if "man" and "hat" are declared nouns
  there — regardless of what corpus facts exist elsewhere. Growing the corpus alone would not have
  made the canonical example work.
- The operator asked for a real catalog of external ontology/lexicon/corpus candidates, with real
  sizes and licenses, not guesses (§5, §9).
- The operator then had two local reference-source repos already cloned (`~/projects/globalwordnet/`,
  `~/projects/schemaorg/`) and asked for direct exploration rather than continued web-search estimates
  — this changed several numbers and corrected two wrong assumptions (§5).
- A question about persistence ("we may need to move to a new persistence tech beyond a certain size,
  but we need a pure in-memory mode too") led to discovering a real, working SQLite store already
  built in the sibling repo `seonix`, worth adapting rather than designing from scratch (§7).
- A question about whether the size tiers were being ambitious enough ("our SQL example should max it
  as much as we can") led to recomputing the Large tier against the *real* available source data
  rather than an arbitrary multiplier — it came out roughly 4x bigger than the first draft, and
  landed almost exactly on the threshold that justifies the SQLite backend in the first place (§6).
- A tangent about whether tmct could "syllogise something interesting" from these datasets produced a
  genuinely useful, low-risk showcase deliverable: a hand-authored bridge between WordNet's and
  Schema.org's independently-built taxonomies, provable by machinery tmct already has (§8).
- A final question — "corpus" was being used to mean fact triples, but the operator also wanted a
  body of simple-grammar example *text* mapped to the same lexicon — surfaced a tenth deliverable,
  and a real, already-curated, zero-extra-licensing-risk source for it sitting in the same files
  already being extracted from (§10).

---

## 2. The default persona flip — exact mechanics

```js
// src/extensions.mjs builtinExtensions()
seon:       { ..., active: false },   // WAS true — now opt-in
conceptnet: { ..., active: false },   // WAS true — now opt-in (tech-domain-filtered, equally biased)
human:      { kind: "corpus", active: true, corpusPath: join(TIER2_DIR, "human.jsonl"),
              provenancePrefix: "corpus:human" },   // NEW — the new default
```

**Why `conceptnet` flips too, not just `seon`**: its committed slice (`corpus/conceptnet/slice.jsonl`)
was filtered from the real ConceptNet 5.7.0 dump via a **tech-domain seed-term match** (~90 base +
~230 extra terms) — it is not neutral general knowledge, it's the second half of today's code-domain
default. Flipping only `seon` would leave a tech-biased corpus active by default, undermining the
whole point.

```js
// src/init.mjs PERSONA_PRESETS
export const PERSONA_PRESETS = Object.freeze({
  human: { extensions: {}, bias: { human: 1.0 } },              // NEW implicit default, explicit
  code:  { extensions: { seon: { active: true }, conceptnet: { active: true } },
           bias: { seon: 1.0, conceptnet: 1.0 } },               // must now explicitly re-activate
  empty: { extensions: { human: { active: false } }, bias: {} }, // advanced escape hatch, §11
});
```

**`seedBannerLine` fix required** (`src/chat.mjs:7341`) — it currently hardcodes
`"(N curated SEON + N ConceptNet + …)"`. With the new default both are 0, which would render the
misleading `"seeded 750 starter facts (0 curated SEON + 0 ConceptNet + 750 human)"`. Rewrite to be
bundle-list-driven: render every `perBundle` entry with `appended > 0`, no privileged first-two
names. `test/wiring-seed.test.mjs`'s `SEED_BANNER_RE` (pinned to
`\((\d+) curated SEON \+ (\d+) ConceptNet\)`) needs relaxing to match the generic form.

**First-run UX** (a "docker-pull, not silent" experience): narrate a short banner *before* seeding
starts (today it seeds silently, then reports after) — one line, marker-absent path only, mirroring
how `narrate` already threads into `runChat`'s option set.

**Real bug found along the way, worth fixing in the same batch**: `seedActiveCorpusEntries`'s guard
(`if (entry.kind !== "corpus" || !entry.active) continue;`) only ever seeds `kind === "corpus"`
entries — a `"pack"`-kind entry's `corpusPath` is silently skipped despite `extensions.mjs`'s own
docblock claiming pack entries combine `corpus_path`/`lexicon_path`. No test exercises this path.
Not required for this batch's own `human` entry (plain `kind: "corpus"`), but a real, documented, doc
vs. behavior mismatch worth closing while in this code.

### Auto-init scope for a JS library consumer

Traced directly: `runChat`/`createSession` already auto-seed via the W3 bootstrap
(`seedBootstrapMemory`, gated on `graph.individuals.length === 0 && TMCT_NO_SEED !== "1"`), but they
only ever write `.tmct/memory/corpus-seed.json` — never a real `tmct.toml` or `.tmct/init.json`
provenance file (that's `initRepo`'s job today, CLI-only). `ask`/`resolveObject`/`fetchEntities`/
`dispatchTool` never auto-init at all — confirmed via grep, zero marker checks anywhere in those
files. A fresh `fetchEntities({graphFile})` call against an empty directory just returns
`emptyEntities()` silently.

**Recommendation**: make `createSession`'s W3 bootstrap call the FULL `initRepo(repo, {persona:
PERSONA_PRESETS.human})` instead of its own bespoke seed-only pair. This converges CLI `tmct init`
and library `runChat`/`createSession` onto ONE code path, so `import { runChat } from '...';
await runChat({repoPath})` on a bare directory gets a REAL `tmct.toml` + `.tmct/init.json`, not just
an in-memory seed marker — the "docker pull" experience for library consumers too, not just the CLI.

`ask`/`resolveObject`/`fetchEntities`/`dispatchTool` **deliberately stay non-auto-initing** — they're
graph/query primitives with no owned "repo lifecycle." `dispatchTool` especially may be called many
times per session; re-checking/writing a marker on every call is wasteful I/O and a real double-init
race without the session's single-entry-point discipline. Document this as an explicit doctrine
comment: *"no first-run bootstrap here — see chat.mjs createSession, the one place that owns repo
lifecycle."*

**seonix migration note** (documented here, can't be acted on from this repo): seonix consumes tmct
as an in-process library via `createGraphService`/the Repository Interface for its code-graph
functionality — not through `tmct init` or the W3 persona-seeding path at all, so this flip doesn't
break that. But if seonix's own chat surface also goes through `runChat`/`createSession` ("seonix
chat = tmct chat + a pointer," per the Repository Interface docs), seonix's own `tmct.toml` will need
to explicitly re-activate SEON/ConceptNet (`--with-persona code`, or
`[extensions.seon]`/`[extensions.conceptnet]` `active = true`) once this default flips, or its own
users will silently get the new `human` persona instead.

---

## 3. Persona clumps — 9 source-tied content modules

Each clump maps to a specific WordNet lexicographer file (or file group) plus, where relevant, a
Schema.org subtree — not an arbitrary category split. All 9 are included in every size tier (no
partial-coverage tier); the tier controls depth per clump, not which clumps are present.

**`human-base` (new, required, foundational — loads before every other clump).** Without this, each
of the 8 content clumps below would independently declare its own category root ("person", "place",
"artifact"...) with no shared parent — exactly the unrooted, disconnected-tree problem described in
§1. `human-base` declares the top-level category classes (`Person`, `Place`, `Object`/`Artifact`,
`Event`, `Time`, `Quantity`, `Organization`) as `rdfs:subClassOf` children of Schema.org's real
`:Thing` root (§5), reusing the exact mechanism as the `human-bridge` showcase (§8) — `human-base`
and `human-bridge` are the same mechanism at two scales: a handful of category roots vs. one full
demonstration chain. Every other clump's own root concept then subclasses into `human-base`'s
declarations. Fixed size across all tiers (~15-20 facts — scaffolding, not content that scales), and
**always active regardless of which other clumps or tier are chosen.**

### Large tier is deliberately maximal, grounded in real source population, not an arbitrary multiplier

Every synset count below was counted directly against the real source files this session (not
estimated):

| Source file | Real synset count |
|---|---|
| `noun.person.yaml` | 7,849 |
| `noun.group.yaml` | 2,578 |
| `noun.location.yaml` | 875 |
| `noun.artifact.yaml` | 11,986 |
| `noun.possession.yaml` | 1,119 |
| `noun.animal.yaml` | 4,646 |
| `noun.plant.yaml` | 5,590 |
| `noun.substance.yaml` | 3,143 |
| `noun.time.yaml` | 994 |
| `noun.event.yaml` | 1,078 |
| `noun.quantity.yaml` | 1,340 |
| `noun.body.yaml` | 2,037 |
| `noun.food.yaml` | 2,670 |
| `noun.communication.yaml` | 5,719 |
| `noun.cognition.yaml` | 3,153 |
| `noun.feeling.yaml` | 432 |
| **Total pool across all 8 content clumps' sources** | **~55,200 synsets** |

Taking all ~55,200 would be a raw dump, not curation — it would violate tmct's own standing
discipline (SEON, tier2, everything shipped so far is hand-selected, never a wholesale import), and
it would bury common words like "man"/"hat" under WordNet's genuinely obscure long tail (its
`noun.person` file alone includes senses like "imaginary being," "hypothetical creature,"
"extraterrestrial" — real synsets, just not what "make ordinary sentences work" needs).

**Large targets a frequency-informed cut** (common words prioritized via a word-frequency signal —
an NGSL-style list is the natural candidate — extended down the tail as far as each tier goes, never
first-N or random), landing the total right at the **~15,000-fact threshold identified in §6 as
where flat JSON starts to strain**. That's deliberate: Large's size is what justifies building the
SQLite backend, not the other way around.

| Clump | Source | Available pool | Small | Medium | **Large** |
|---|---|---|---|---|---|
| `human-base` (required scaffolding) | hand-authored, bridged to Schema.org `:Thing` | — | 15-20 | 15-20 | 15-20 |
| `human-core` (people, family, common verbs) | `noun.person`+`noun.group` (10,427) | 150 | 350 | **2,500** |
| `human-places` | `noun.location`+artifact-buildings share | 80 | 200 | **1,200** |
| `human-objects` | `noun.artifact` (tools/objects/clothing)+`noun.possession` | 100 | 250 | **2,800** |
| `human-nature` | `noun.animal`+`noun.plant`+`noun.substance` (13,379) | 100 | 250 | **2,800** |
| `human-time-events` | `noun.time`+`noun.event`+`noun.quantity` (3,412) | 60 | 150 | **900** |
| `human-body-food` | `noun.body`+`noun.food`+`verb.consumption` (4,953) | 80 | 200 | **1,400** |
| `human-mind` | `noun.communication`+`noun.cognition`+`noun.feeling`+`verb.emotion` (9,649) | 70 | 180 | **2,000** |
| `human-bridge` (the showcase, §8) | hand-authored, WordNet root ↔ Schema.org root | 10 | 10 | 10 |
| **Total, all clumps** | | | **~665-670** | **~1,605-1,610** | **~13,600-13,650** |

`human-nature` deliberately supersedes today's thin, 49-fact `corpus/tier2/general.jsonl` (animal/
weather only) rather than living alongside it.

### What actually changes tier to tier — concrete content, not just bigger counts

Using `human-core` as the representative example:

- **Small (150)**: the clear basics only — man, woman, person, child, friend, doctor, teacher;
  mother, father; the common verbs (has/owns/likes).
- **Medium (350)**: adds more roles (neighbor, stranger, engineer, nurse, lawyer, artist), more
  family (grandmother, cousin, sibling), more verbs (wants, needs, believes, trusts) — still flat,
  one hop each.
- **Large (2,500)**: adds real depth, not just breadth — specific professions (surgeon, electrician,
  librarian, journalist), extended family (godparent, in-law, stepchild), AND, because Large pulls
  from WordNet's actual multi-level hypernym chains rather than one flat fact per word, **genuine
  multi-hop chains** ("surgeon ⊑ doctor ⊑ medical_professional ⊑ professional ⊑ person"). This is
  the qualitative difference Large earns over Small/Medium: real chain depth for `scm-sco` to walk,
  directly useful for the bridge showcase (§8) and any future multi-hop reasoning work, since Small/
  Medium's flat one-level facts can't demonstrate that at all.

---

## 4. The two vocabulary surfaces (breadth over depth, by explicit operator instruction)

A background corpus fact ("a dog is a mammal") and a live-taught sentence ("a man has a hat") are
gated **independently** — growing one does not make the other work.

1. **`corpus/tier2/human.jsonl`** (new) — background facts, tier2 JSONL shape, generated via
   `corpus/tier2/generate.mjs`'s existing `CORPUSES` object pattern (`[subject, rel, concept]`
   triples; `rel` drawn only from the already-sufficient `conceptnet-map.toml` relation set — no new
   relation types needed). See §3 for the full per-clump breakdown.
2. **`src/grammar/lexicon-core.json`** (grown, not a separate merge-time file) — the ACE parser's
   closed-set vocabulary, checked *before* any grammar pattern fires, entirely independent of corpus
   facts. "Man"/"hat" must be declared nouns here for "a man has a hat" to parse at all. Today: 291
   words (180 nouns/63 verbs/33 adjectives/15 proper names), 7,061 bytes, 100% software-domain.
   **Target growth: ~220 new nouns, ~40 new verbs (the existing `have` verb already covers "has a
   hat" — confirmed by reading `ace.mjs`'s SVO pattern directly, no new verb entry needed for that
   specific example), ~25 new adjectives, ~5-10 new proper names** ≈ +295 words. At the file's own
   ratio (~24.3 bytes/word) ≈ **+7.2KB** (file grows from 7,061B to ~14.3KB).

   **Recommended: add directly into `lexicon-core.json`'s existing objects (Option A)**, not a
   separate extension-merged file (Option B). Option A is unconditionally loaded by every one of
   `chat.mjs`'s 8+ bare `loadLexicon()` fallback call sites with zero merge-timing risk. Option B's
   risk — whether every call site actually threads the session's merged lexicon rather than falling
   back to bare-core — is real and unverified; flag Option B as a v2 follow-up only if excludability
   independent of corpus facts is ever specifically needed.

   **Explicit scope discipline (operator instruction): breadth over depth.** No gender/kinship
   taxonomy, no formal role hierarchy — flat `IsA` facts only ("man IsA person"), same discipline as
   everything else SEON already does. Grammar/fact-extraction is hard enough without over-modeling.

   **Alignment mechanism**: extend `generate.mjs`'s `CORPUSES.human` entry with an optional
   `lexicon` sub-key (nouns/verbs/adjectives it introduces), driven by the same curated category
   list as the `facts` array. `--verify` gains a drift-guard check: every subject/concept term in
   `human.jsonl` must resolve to a declared lexicon noun (mirroring `conceptnet-map.toml`'s existing
   "slice relation missing from map = error" precedent).

Total new committed content at the Small tier (the default): ≈100KB (≈92.6KB corpus + ≈7.2KB
lexicon) — under 2% growth on the npm package's current 6.3MB unpacked size. See §6 for Medium/Large.

---

## 5. Reference sources — cloned locally, structure confirmed directly

The operator cloned the source repos to `~/projects/globalwordnet/` and `~/projects/schemaorg/`.
Both were explored directly this session (`ls`/`head`/`grep`, read-only) — no unzip needed anywhere;
everything is already plain text/YAML/Turtle (`find -iname "*.zip" -o -iname "*.gz" -o -iname "*.tar"`
returned nothing).

### `~/projects/globalwordnet/english-wordnet/src/yaml/` (44MB)

The reported 573MB total for the whole repo is almost entirely `.git` history, confirmed directly —
not a second data cache; `src/yaml/` is the real usable content. **73 YAML files**, exactly matching
WordNet's lexicographer-file scheme:

- 26 noun category files (`noun.act.yaml` … `noun.time.yaml`) **plus `noun.Tops.yaml`** — the actual
  root file. Confirmed by direct read: synset `00001740-n` = "entity", no `hypernym` key (the true
  top), with "physical entity"/"abstraction" etc. as its immediate children. **WordNet's noun side is
  a genuinely single-rooted tree** — 25 "unique beginner" top synsets, all linking up to "entity" —
  unlike SEON's or `general.jsonl`'s unrooted trees.
- 15 verb category files (`verb.body.yaml` … `verb.weather.yaml`), 4 adjective/adverb files
  (`adj.all`/`adj.pert`/`adj.ppl`/`adv.all`), `frames.yaml`.
- 28 `entries-<letter>.yaml` files — the WORD-FORM side (e.g. `entries-m.yaml`): surface word string
  → part of speech → list of `{id, synset}` senses, plus (at the sense level) explicit `antonym`
  pointers to another sense id. This is the reverse index for looking up which synset(s) a target
  word belongs to, and the source of real, sense-precise antonym pairs (e.g. `alive%3:00:01::` ↔
  `dead%3:00:01::`) — a better-grounded `owl:disjointWith` candidate source than guessing from
  sibling hyponyms, which WordNet doesn't actually guarantee are mutually exclusive.

Confirmed exact synset record shape (read directly, `noun.person.yaml`):

```yaml
09507443-n:
  definition:
  - a creature that has not been observed but is hypothesized to exist
  hypernym:
  - 09506868-n        # pointer to the more general synset — pure ID reference, walk to any depth
  ili: i86464          # interlingual index id (cross-language linking, not needed for tmct)
  members:
  - hypothetical creature   # every surface word/phrase that's a synonym in this sense
  partOfSpeech: n
  example:              # present on ~1-8% of synsets depending on category — see §10
  - a live volcano
```

This is ideal for extraction: hypernym chains are plain ID pointers (no NLP needed to walk them),
`members` gives synonym groups for free, `definition` gives a ready-made gloss, and `example` (where
present) gives a ready-made natural sentence.

**License, confirmed by reading `LICENSE.md`/`WNDB_License.txt` directly**: CC-BY-4.0 (Open English
WordNet team) layered over the original Princeton WordNet License — requires attribution to BOTH
Princeton WordNet and the Open English WordNet team on any derivative. Compatible with the same
"hand-author inspired-by, cite the source" discipline `corpus/seon/LICENSE-NOTICE` already uses.

### `~/projects/schemaorg/schemaorg/data/schema.ttl` (464,698 bytes)

The actual canonical core vocabulary, in clean Turtle. Confirmed by direct read:

```turtle
:Person a rdfs:Class ;
    rdfs:label "Person" ;
    rdfs:comment "A person (alive, dead, undead, or fictional)." ;
    rdfs:subClassOf :Thing ;
    owl:equivalentClass foaf:Person .
```

**Real finding, corrects the earlier wrong assumption from §1**: `:Thing` is a genuine, single root
class in `schema.ttl`, and `Person`/`Place`/`Event`/`Organization`/`Product` (confirmed via direct
grep) all chain up to it via `rdfs:subClassOf`. Schema.org's source data supplies exactly the
`Thing`-rooted taxonomy the earlier draft persona proposal assumed already existed in SEON — it
doesn't exist there, but a real, cleanly-licensed one exists here, ready to adapt (§3, §8).

**License correction**: an earlier web-search-derived catalog said CC-BY-SA 3.0 (share-alike). The
repo's own top-level `LICENSE` file, read directly, is **Apache License 2.0** — permissive, no
share-alike obligation, a strictly easier license than assumed. (CC-BY-SA applies to the schema.org
*website's* human-readable pages; the GitHub source repo's `data/schema.ttl` is Apache-2.0.)

The rest of `schemaorg/data/` (public_stats, l10n, 20140818/20140912 dated snapshots, `ext/`
extension proposals, `collab/`, `sdo-*-examples.txt`) is docs/examples/historical noise, not
vocabulary data — `schema.ttl` is the one file that matters.

### The extraction plan

**New maintainer-only script, `scripts/extract-persona-sources.mjs`** (mirrors
`corpus/tier2/generate.mjs`'s own "not part of the product path" discipline):

1. Reads `schema.ttl`, walks `rdfs:subClassOf` from `:Thing` down through a curated allowlist of
   types (`Person`, `Place`, `Event`, `Organization`, `Product`, and their most useful immediate
   subclasses) — emits candidate class/label/comment triples for `human-base` (§3).
2. For each of the 8 content clumps (§3), reads the matching `noun.*.yaml`/`verb.*.yaml` file(s),
   cross-references target common words against `entries-<letter>.yaml` to find their synset id(s),
   walks each word's `hypernym` chain (one hop for Small/Medium, full available depth for Large),
   and pulls the hypernym's primary `members[0]` as the candidate `IsA` target, plus the synset's own
   `definition` and (where present) `example` sentence.
3. **Output is a curation WORKSHEET, not the final committed files** — same discipline as
   `corpus/conceptnet/quality-filter.mjs`'s role. It surfaces candidates for review and hand-selection,
   producing the actual `corpus/tier2/human.jsonl` + `lexicon-core.json` additions — never a
   mechanical, wholesale dump. This keeps the committed bundle at its planned size, not WordNet's
   full ~55,200-synset scale, while genuinely informed by real hypernym structure.
4. Both source repos stay external to this repo — referenced by a configurable local path (e.g.
   `TMCT_WORDNET_SRC`/`TMCT_SCHEMAORG_SRC` env vars), never vendored, never committed, never part of
   the npm package. The script fails gracefully with a clear message if the paths aren't present
   locally (a maintainer convenience tool, not a build dependency).

---

## 6. Persistence backends — the tier maps directly to the backend

Real measured ratios this design is built on:

- **Raw corpus bytes ≈123.5 bytes/fact** (tier2 JSONL shape with `surfaceText` — measured from
  today's `aws`/`python`/`java`/`general` bundles).
- **Seeded memory bytes ≈1,117 bytes/fact** (measured directly from this dev repo's real
  `.tmct/memory/graph.json`: 7,278,135 bytes ÷ 6,517 Fact individuals). A fact costs ~9x more once
  stored than its raw file form, because each becomes a full reified individual with id, label,
  class, `derived_from`, `mentions`, 6+ attribute objects, provenance, trust inputs, prose tokens.
- **Read+parse+write time ≈0.02ms/fact** (measured: 22ms `readFile` + 42ms `JSON.parse` + 68ms
  `JSON.stringify` = 132ms combined, for today's real 6,517-fact/7.3MB store).
- **Critically**: `loadMemory`/`mutateMemory` (`src/memory/core.mjs`, confirmed by direct read) do a
  full `readFile` + `JSON.parse` on **every single memory-touching call**, and `mutateMemory` writes
  the **whole file back** every time too — there is no per-session cache. This cost is paid on every
  teach *and* every query, for the life of the session, scaling with total accumulated facts, not
  what changed in that turn.
- **V8's actual string ceiling** (context, not a near-term concern): ~536 million characters
  (`RangeError: Invalid string length`). At 1,117 bytes/fact that's roughly 480,000 facts before a
  hard wall — nowhere near anything below.

| Tier | Backend | Facts | Seeded memory bytes | Read+parse+write/turn (if flat JSON) | Rationale |
|---|---|---|---|---|---|
| **Small** | **Backend B — pure in-memory** (new) | ~665 | ~726KB (held as a JS object, never serialized) | ~0ms (no I/O at all) | Genuinely zero disk I/O — tests, embedded/serverless use, or anywhere even ephemeral-mode's throwaway-temp-dir I/O is unwanted overhead |
| **Medium** | **Backend A — flat JSON** (today, unchanged) | ~1,605 | ~1.79MB | ~32ms | The default; well within what's already shipped (today's 6,517-fact SEON+ConceptNet default costs ~132ms/turn and nobody's flagged it as slow) |
| **Large** | **Backend C — SQLite** (new, adapted from seonix) | ~13,600 | ~15.2MB if flat-JSON-serialized (real SQLite rows instead) | ~272ms — genuinely into the "starts to feel slow" zone | **Not an arbitrary pairing** — at ~13,600 facts, flat JSON's per-turn cost would actually be uncomfortable (272ms vs. today's already-accepted 132ms). Large's real, frequency-informed size is what justifies SQLite. |

### Backend B — pure in-memory (new)

A storage-backend abstraction behind `loadMemory`/`mutateMemory`. Backend A's flat-JSON-file
implementation stays the default; Backend B is a plain JS object held in the session's own closure —
`loadMemory`/`mutateMemory` become synchronous object mutations, zero `readFile`/`writeFile` calls
ever.

**Distinct from today's `--ephemeral` flag** — confirmed by reading `createSession` directly:
ephemeral mode diverts memory/logs/sessions to a throwaway `mkdtemp` OS temp directory and skips the
final graph upsert, but still does real `readFile`/`JSON.parse`/`writeFile` round-trips against that
temp dir every turn. It's "disposable disk," not "no disk." A new `--in-memory` flag (or
`memoryBackend: "memory"` session option) selects Backend B; `--ephemeral` stays as-is for its own
existing use case — the two solve different problems.

### Backend C — SQLite (new, schema adapted from seonix, write model is not)

seonix (a sibling repo, `~/projects/polycode-projects/seonix/`) already has a working, opt-in
`node:sqlite`-based store — read directly this session (`src/store.mjs`, 282 lines). Gated behind
`SEONIX_STORE=sqlite` at both build and load time (unset → `node:sqlite` is never even imported, zero
external dependency, matching tmct's own minimal-deps discipline). Its schema is directly reusable:
an `ids` table interning every string id to an integer, `nodes`/`relations`/`edges` tables
referencing those integers, a `meta` table tracking the source JSON's sha256/size/mtime so a stale
cache is detected and the caller falls back to re-parsing JSON.

**But its write model is not directly reusable.** `writeStore` always does a full
rebuild-and-atomic-swap — correct for seonix's actual problem (read-latency on a relatively static,
rebuild-on-change code graph), wrong for tmct's problem (write-heavy, one-fact-at-a-time accumulation
across a session's lifetime). Lifting seonix's design as-is would just replace "rewrite the whole
JSON file per turn" with "rebuild the whole SQLite file per turn" — no real improvement.

**tmct's Backend C reuses the schema shape but changes the write model**: real per-fact
`INSERT`/`UPDATE` statements against a live, open SQLite connection, not a rebuild-and-swap — the
actual correct match for "many small writes across a session's lifetime," which is exactly what
SQLite is built for.

**Cross-repo follow-up (explicit, later, out of scope for this batch — can't touch seonix's repo
from here)**: once tmct's adapted SQLite backend exists, rework seonix's own `src/store.mjs` to
import tmct's shared version instead of maintaining its own fork — the same duplication pattern
already noted elsewhere for `codegraph.mjs` ("seonix's own `src/codegraph.mjs` is a near-verbatim
fork of tmct's, 2109 vs. 2123 lines").

---

## 7. `init:persona:empty` — the escape hatch

`PERSONA_PRESETS.empty` (§2) deactivates the one bundle now active by default (`human`), leaving
`.tmct/` scaffolding + a `tmct.toml` with an explicit `[extensions.human] active = false` — a repo
genuinely empty of corpus facts, for a consumer bringing their own ontology/lexicon/corpus.

**Important nuance to document**: because `package.json`'s `"files"` allowlist pulls the whole
`corpus/` tree unconditionally into every npm install, `init:persona:empty` does **not** reduce
package size — the raw files are still on disk in `node_modules/`, just not seeded/activated for
that repo's `.tmct/memory/`. A user can flip `[extensions.human].active = true` later with zero
re-install. Worth one explicit sentence in `corpus/README.md`'s tiering table and in `tmct init
--help`'s `--with-persona` line, so "empty" isn't misread as package-size-reducing — it isn't; that's
a separate, currently-unaddressed packaging-level question (no opt-out mechanism exists there at all
today).

---

## 8. Showcase deliverable: a cross-ontology `scm-sco` bridge

WordNet's noun hierarchy (rooted at "entity," §5) and Schema.org's class hierarchy (rooted at
`:Thing`, §5) were built independently, by different people, for different purposes. `scm-sco`
(subClassOf transitivity — already built, already tested in `src/syllogise.mjs`) doesn't care where
an edge came from, so a tiny number of hand-authored **bridge facts** connecting the two lets tmct
prove a chain that spans both sources at once: e.g. "surgeon ⊑ doctor ⊑ … ⊑ person (WordNet) ⊑
Person ⊑ Thing (Schema.org)."

This is a concrete demonstration of `archive/PLAN_AGI_ARCHITECTURE.md` §5's own stated position
("domain-scoped ontologies, composed, not one universal graph") actually working on real external
data, not just asserted in a design doc.

**Scope, deliberately small**: a handful of bridge facts (e.g. `person rdfs:subClassOf Person`,
`place rdfs:subClassOf Place` — WordNet's category root to Schema.org's matching top-level class),
part of `human-bridge` (§3), plus one new test (`test/chat-cross-ontology-bridge.test.mjs`, or folded
into the existing chase tests) that teaches a multi-hop WordNet-side chain, asserts the Schema.org
bridge fact, and confirms `scm-sco`'s existing transitivity proves the full chain end to end —
citing both sources in the answer's provenance. No new rule code needed; this is a content + test
addition exercising machinery that already exists.

---

## 9. Tenth deliverable: an example-sentence corpus (simple grammar, not fact triples)

Distinct from the 9 fact/lexicon clumps above — real natural-language prose (short example
sentences), chosen because the words in them map directly to the same vocabulary already being
curated. Two sources, confirmed directly this session:

**Primary source: WordNet's own inline `example:` fields** — same files, same CC-BY-4.0 license as
everything else in §5, zero new licensing question. Real coverage counted directly: `noun.artifact`
992/11,986 synsets (~8.3%), `noun.person` 623/7,849 (~7.9%), `noun.food` 113/2,670 (~4.2%),
`noun.animal` 42/4,646 (~0.9%) have a hand-written example sentence. These are short, natural,
already-curated, and tied to a specific word sense — e.g. "he stepped on the gas," "the nearby hotel
offers overnight accommodation," "she was able to program her computer." Pull the example for every
word already selected into the 9 clumps, so the sentence corpus is aligned to the exact curated
vocabulary, not a separate unrelated text pull.

**Secondary source: SemCor** (`~/projects/globalwordnet/semcor/`) — real Brown Corpus text (news,
fiction, humor, religion, etc.), re-tagged to modern OEWN senses, used where WordNet's own inline
coverage is thin (`noun.animal` at under 1%). **Licensing, operator decision**: this specific fork's
`LICENSE.md` declares the same CC-BY-4.0 terms as the rest of the WordNet family; the original
underlying Brown Corpus text's 1960s-era permissions aren't independently re-verified beyond that —
proceed with attribution, accepted pragmatically rather than blocked on further legal research. Needs
filtering for simple grammar (short sentences, common words, no complex embedded clauses) — genres
like `fiction_general`/`belles_lettres` skew literary; `press_reportage`/`humor` are more likely to
yield plain sentences. Same "curate down from a big source" discipline as everything else, via
`scripts/extract-persona-sources.mjs` (§5).

**Size tiers, matching the 9 clumps' own tiers** (not a fixed size — scales with how much vocabulary
exists to find an example for):

| Tier | Approx. sentence count | Source mix |
|---|---|---|
| **Small** | ~120-150 | WordNet inline examples only, for the ~665 Small-tier words that have one |
| **Medium** | ~350-450 | WordNet inline examples for all Medium-tier words with coverage, no SemCor yet |
| **Large** | ~2,000-3,000 | WordNet inline (all available) + SemCor-filtered supplement for thin-coverage categories (`human-nature` especially, given `noun.animal`'s ~0.9% rate) |

**Where this connects to existing tmct machinery**: `src/completions/`'s pipeline (ranks/extracts
from prose, just wired to a real `graphService` adapter this session) currently only has memory
*blocks* to search — nothing in ordinary chat ever calls `saveBlock()`. Seeding this example-sentence
corpus as real blocks gives that pipeline genuine vocabulary-level material for "give me a detailed
summary of X"-style questions about everyday concepts, not just code entities — a second, independent
use for the same curated content, not just a test-fixture nicety.

---

## 10. External catalog — every candidate considered, in or out and why

Verified via direct license-page reads and the two local clones (§5), not memory or assumption:

| Candidate | License | Real size | Verdict |
|---|---|---|---|
| **Open English WordNet (OEWN) 2025** | CC-BY-4.0 | 135,969 words, 107,519 synsets, ~106-120MB compiled | Primary reference source (§5) — too big to ship raw, but its lexicographer-file scheme (45 files: 26 noun, 15 verb, 3 adj, 1 adv) is a ready-made supersense taxonomy guiding curation |
| **Schema.org vocabulary** | Apache-2.0 (corrected from an earlier CC-BY-SA 3.0 assumption — see §5) | 823 types, 1,529 properties, low single-digit MB | Primary reference source (§5) — the `:Thing`-rooted taxonomy `human-base`/`human-bridge` adapt from |
| **VerbNet** | Free w/ attribution | ~5,800 verbs, 270+ classes, ~23-25 thematic roles | Secondary reference for the everyday-verb list (§4); not pulled in this pass |
| **DBpedia ontology** (schema only) | CC-BY-SA (share-alike) | ~1,400 classes, low single-digit MB | Lower-priority secondary reference; not pulled in this pass |
| **Roget's Thesaurus (1911)** | Public domain | ~40,000 words, ~1,035 categories | Real category structure, dated vocabulary; not pulled in this pass |
| **SemCor** | CC-BY-4.0 (this fork; see §9's caveat) | 58MB, real genre text | Secondary source for the example-sentence corpus (§9) |
| ConceptNet 5.7 full | CC-BY-SA 4.0 | 34M edges, >9GB compiled | Already the source tmct's own committed slice was filtered from; `corpus/conceptnet/quality-filter.mjs` is the reusable mechanism for a bigger/different slice, not a new download |
| Wikidata (full) | CC0 (best license of any candidate) | 100GB (truthy) – 1.6TB (full JSON) | Far too large; a genuinely separate future project on the scale of building a new `quality-filter.mjs`, not part of this batch |
| YAGO 4.5 | CC-BY-4.0/CC-BY-SA | 49M entities, 109M facts | Same as Wikidata — license is fine, size is not |
| **SUMO** | **GPL** | ~20-25K terms, ~60-80K axioms | **Ruled out** — copyleft conflict with MPL-2.0 |
| **BabelNet** | **Non-commercial research only** (confirmed by reading the actual license page) | 20M+ entries, 500 languages | **Ruled out** — redistribution explicitly restricted to research institutions |
| FrameNet | Unclear (academic-use framing, no explicit open redistribution license found) | 1,200+ frames, 13,000+ lexical units | Needs-permission, not a confirmed candidate |
| NGSL | Unclear/unconfirmed public domain | 2,801 words (frequency list) | Curation-order aid only (informs which words to prioritize in Large's frequency-informed cut, §3), never shipped as facts itself |
| Wiktextract | MIT | 22GB / 2.6GB compressed | Way too big raw; a filtered-subset future option, same pattern as ConceptNet |

---

## 11. Test fallout (identified, not guessed)

- `test/init.test.mjs:266-268` — `PERSONA_PRESETS.code` deep-equal assertion changes shape.
- `test/init.test.mjs:270-290` — round-trip assertions flip (`code` now carries `[extensions]`; a
  new equivalent test is needed for `human`, empty extensions + `[bias]` only).
- `test/init.test.mjs:229-264` — the byte-pinned "no persona" test is **unaffected** (only checks
  `renderTomlConfig(defaultConfig())`, never touched extension `active` defaults).
- `test/wiring-seed.test.mjs:32` — `SEED_BANNER_RE` needs relaxing per §2's banner fix.

---

## 12. Open questions (do not silently pick)

1. **Multi-graph collision-prefix policy** — belongs to the sibling CLI/config unification work, not
   this doc, but affects whether a future multi-repo persona composition needs graph-level
   namespacing. Tracked in that work's own plan, not duplicated here.
2. **`init:persona:empty`'s packaging-level limitation** (§7) — raw files still ship even when not
   seeded. Documented-only for now; no fix proposed in this batch.
3. **Whether the frequency-informed cut for Large (§3) uses NGSL specifically, or a different signal**
   — NGSL's own licensing status is unconfirmed (§10); worth a final check before committing to it as
   the actual ranking source, versus a simpler heuristic (e.g. WordNet's own sense-count-per-lemma as
   a rough frequency proxy, which needs no external list at all).

## 13. Verification (once implementation starts)

- `npm test` green after every commit (1756 passing at the start of this batch).
- CLI smoke test (`printf 'hi\n/exit\n' | node bin/tmct.mjs`) still exits 0 with the new default
  persona.
- A real `npm pack` + fresh install in an empty folder (the same method used to verify the `ace-owl`
  revert earlier this session) — confirms the new default persona seeds correctly end to end for an
  actual external consumer, not just the dev repo.
- The cross-ontology bridge test (§8) passes, citing both sources in its provenance.
- No CHATBENCH/INFBENCH full sprint re-run yet — explicitly deferred by operator instruction until
  this batch of work is further along.
