# PLAN_GRAPH_NEUTRALITY.md — domain-neutral core, code graphing as the first domain pack

Drafted 2026-08-06 from the operator's graph-neutrality directive, after a repo audit and a
live probe of a bare install. tmct began as a code-indexing graph and must keep every
code-graph capability testable in bare-metal tmct, without seonix. What changes is where the
code vocabulary lives: a neutral install must never hint at code concepts in its misses,
banners, or counts, and no domain concept (like "class") should be defined by hand in
application code. Everything domain-specific moves into an optionally loaded **domain pack**
— lexicon, ontology, corpus, and adapters as one loadable unit, with code merely the first
example. Capability is retained bit for bit; only its packaging moves.

Companion doc: [PLAN_CLAIMS.md](PLAN_CLAIMS.md)'s "Design frontiers of Symbolic Artificial
Intelligence" section is the problem statement this plan answers in mechanism — in
particular its symbol-grounding row, which is why a pack's grounding channel is a required
part of the contract below, and its evaluation discipline, which this plan's finish line
borrows.

## What exists now (the audit)

Most of the machinery this plan needs already ships. The gap is narrower than it looks:
it is a handful of hard-coded vocabularies and strings in `chat.mjs` and
`chat-session.mjs`, not a missing subsystem.

**The extension seam is the domain loader, already built.** `src/services/extensions.mjs`
resolves named bundles of five kinds (`corpus`, `lexicon`, `templates`, `pack`,
`ontology`), each with its own provenance prefix and bias. `tmct.toml`'s `[extensions]`
table activates, overrides, or adds host bundles; `mergedLexiconExtra` merges active
lexicon bundles into the closed grammar lexicon at load; `seedActiveCorpusEntries` seeds
every active corpus bundle; `validateExtensionPack` backs `tmct extend --validate` for
third-party packs. Personas (`src/services/init.mjs`) are named activation presets:
`human` (default), `code` (activates `seon` + `conceptnet`), `empty`.

**A code-domain corpus already exists in embryo.** `corpus/seon/` holds 399 curated
code-concept isa rows (`class IsA type`, `struct IsA class`), 11 relations, and 288
curated definitions. The chat layer already prefers a curated SEON definition for
"what is a class" **only when `corpus:seon` rows are present in the store** — an existing,
working example of domain-gated behavior keyed on loaded content, and the pattern this
plan generalizes. `tier2-python`, `tier2-java`, and `tier2-aws` are further themed
corpora, inactive by default.

**The worlds pack is the shippable-domain template.** `corpus/worlds/` is an optionally
loaded, sharded, indexed package of facts, rules, and an opening line, with its own
generator, budgets, manifest, and on-demand loading into session memory under
`world:<name>` provenance. A domain pack is the same shape with a vocabulary file and a
grounding declaration added.
The child pack, reference pack (cleaned Simple English Wikipedia), and prose corpus are
siblings of the same pattern.

**The code-graph capability lives behind a clean seam.** `createSession({ graphPaths })`
loads `.tmct/graph.json`; `tmct index` produces one; seonix supplies its own through the
same seam; the `provider` source type carries its trust tier (0.9). The reasoning sits in
`src/domain/codegraph.mjs` (`resolveSymbol`, entity/edge walks, counts) and the chat
lanes that consume it. Committed fixtures (`examples/mini-webapp`, `tiny-lib-py`,
`tiny-webapp-src`, `polyglot`) plus `npm run example:mini` already give bare-metal tests
a real graph with no seonix anywhere. IDXBENCH grades fidelity against these.

**What is hard-coded in application code (the actual gaps, live-probed on a bare
default install):**

- `COUNT_NOUNS` / `CLASS_LABELS` (`chat.mjs`, the count lane): class, function, module,
  package, method, attribute, variable, commit, session — the code-graph ontology as an
  object literal. Probe: "how many classes are there" on a bare install answers
  **"0 classes."** instead of an honest miss or the taught-class path.
- Graphless code-lane misses: "no module matching \"parser\" found in the index. This
  store holds no code index…" plus the honest-empty polish appending "(this repo has no
  code graph — index it with `tmct index`…)" to code-shaped misses, and
  `NO_GRAPH_BOOTSTRAP_WALL_LEAD` ("I can't answer that as a code question…").
- The session banner and greeting (`chat-session.mjs`): "no code graph loaded" and "for
  code structure, index this repo with `tmct index`…" print before the first prompt of
  every bare install.
- Orientation and capability answers: "For code structure (imports, calls, definitions)
  point me at a repo: `--repo <path>`…" renders for "what can you do" with no code
  domain loaded. `helpText()` advertises counting classes/functions/modules/commits.
- `/stats` with no graph: "no graph loaded — /stats needs an index."

Neutral pieces that need no change: `GENERIC_ANCHOR_NOUNS` (thing, concept, object,
entity), the fact-store lanes, the teach lanes, the honest-miss machinery itself, and
the grammar lexicon (class, module, function are ordinary English nouns; the leak is in
lane vocabulary and templates, not the lexicon).

## The neutrality contract

The behavioral invariant, stated once and testable: **a session whose active bundles and
loaded graphs carry no code-domain content never emits code-domain vocabulary in any
banner, greeting, answer, miss, hint, count, help, or orientation text.** Refusals stay
honest and name only what is actually available: the teach lane, the loaded corpora, and
how to load more. The same holds symmetrically for any future domain: a bare install's
refusals never name another domain's vocabulary.

"Code domain active" is a per-session boolean, computed once, deterministic: a loaded
code graph with modules, or the `seon` bundle (or a successor code pack) active. When it
is true, every surface above reads exactly as it does today — capability retention is
verified against today's strings, not approximated.

Surfaces under the contract: the session banner and greeting; orientation and
capabilities; `helpText()`; the count lane (an unrecognized count noun falls through to
the taught-class count and the ordinary miss wall, never "0 classes"); the code lanes'
misses (the lanes decline silently when the domain is inactive, and the general miss
stands); the honest-empty polish (the `tmct index` pointer renders only when the code
domain is active); `/stats` and sibling slash-command errors.

Parsing is gated too (operator decision, 2026-08-06, reversing the draft's
recommendation): when the code domain is inactive, code-shaped lanes decline silently
and the ordinary general miss stands. A bare install gives no neutral in-lane answer to
a code-shaped phrasing; slash commands still answer, neutrally.

## The domain-pack contract

Extend the existing seam; build nothing parallel to it.

**A domain pack is a `pack`-kind extension entry** carrying, per its existing keys, a
corpus (ontology facts and definitions), an optional lexicon top-up, and optional
templates — plus one new key this plan adds: `vocab_path`, a JSON file of lane
vocabulary. First entries: count nouns and their class labels (what `COUNT_NOUNS` /
`CLASS_LABELS` hold today), and the domain's surface lines (its banner clause, its
orientation clause, its help rows, its miss-recovery pointer). The lanes' vocabularies
become the merge of active packs' vocab files, empty by default. `validateExtensionPack`
validates the new key; bias ordering resolves collisions the same way lexicon merges do.

**The grounding channel is a required part of the contract, not an optional extra.** A
pack with an ontology and lexicon but no route from symbols to the domain's own
artifacts is symbols defined in symbols — a miniature Cyc. Every pack therefore
declares, in its manifest, exactly one of: an **extraction adapter** (the deterministic
path from domain artifacts to facts — for code, that is `tmct index` plus the
`graphPaths` provider seam; for a document domain, an ingest adapter) or an explicit
**taught-only mode** (the pack's facts grow solely through the teach lane, and the pack
says so). `validateExtensionPack` rejects a pack that declares neither. The declaration
is also what the capabilities surface reports, so a user can see how a loaded domain's
facts reach the store.

**The code domain pack** ships in-repo: the `seon` corpus as its ontology, a new vocab
file carrying the count nouns and the code surface lines, its grounding channel declared
as the existing extraction adapter (`tmct index` / the provider seam), and the existing
`--with-persona code` preset activating it. The pack's facts keep their `corpus:seon`
provenance, so the existing curated-definitions gate keeps working unchanged.

## The finish line (measured, not asserted)

The plan is done when both hold:

- **(a) Bare metal, no pack loaded:** the claims tests show zero code-hinted behavior —
  the neutrality tier's probes over banner, greeting, counts, misses, help, orientation,
  and `/stats` find no code-domain vocabulary anywhere.
- **(b) Code pack loaded:** IDXBENCH restores 25/25 across its surfaces — the same score
  the committed benchmark records today, now earned through the pack instead of
  hard-coded vocabulary.

This bar generalizes, and every future pack ships against it: its own grounding rate,
its own refusal matrix, and the citation invariant, measured the way
[PLAN_CLAIMS.md](PLAN_CLAIMS.md) measures them — the journal-ingest idea below included.

**Bare-metal testing without seonix**: `tmct init --with-persona code` in a scratch
repo, `tmct index` over `examples/mini-webapp` (already committed), then the same count,
call, and orientation questions the corpus rows pin today. IDXBENCH remains the fidelity
grader. A new neutrality tier probes the bare install: the five surfaces, asserted free
of code vocabulary, plus the same probes with the domain loaded, asserted identical to
today's strings.

`.tmct/graph.json` keeps its name: it is the session's graph store, not code-domain
vocabulary, and renaming it is storage churn with no neutrality gain.

## Tasks

Dispatch contract as in PLAN_PUBLISH.md: stop on any quoted-state mismatch; blast-radius
testing only (`test:smoke` per edit, `test:fast` plus named files per commit); repo-local
identity; no doc/date references in comments or test names; plain prose in every string.
Anchors are symbols, not line numbers — the file moves daily.

### Wave 1 — domain-gate the leaking surfaces (Sonnet, `src/services/chat.mjs` + `chat-session.mjs`)

- **T1 — the domain-presence predicate and the count lane.** Add one pure helper
  (`codeDomainActive(session)` shape: loaded graph with modules, or the code bundle
  active), computed once per session and threaded where the gates below need it. Gate
  `answerCount`/`answerEdgeCount` on it: inactive → return null so the taught-class
  count and ordinary miss stand. Acceptance: bare install "how many classes are there"
  is a miss or taught answer, never "0 classes"; with the domain active, today's counts
  verbatim; `node --test test/tools/ask.test.mjs` and the count-lane corpus rows green.
- **T2 — graphless code-miss texts.** Gate `NO_GRAPH_BOOTSTRAP_WALL_LEAD`, the
  "no module matching X" family, the honest-empty polish's `tmct index` pointer, and
  `/stats`' "needs an index" wording on the predicate. Inactive → the general miss text
  and a neutral `/stats` line ("no graph loaded — this session holds N facts…").
  Acceptance: the probe transcript from this plan's audit, re-run, shows no code
  vocabulary; active-domain probes byte-match today's strings.
- **T3 — banner, greeting, orientation, help.** The neutral base text names the teach
  lane and loaded corpora; each active pack contributes its clause (code's clause is
  today's wording, verbatim). `helpText()`'s counts row renders from the merged count
  vocabulary and disappears when empty. Acceptance: bare greet has no code text;
  `--with-persona code` greet matches today's; `test:fast` green.

### Wave 2 — externalize the vocabulary; assemble the pack (Sonnet)

- **T4 — `vocab_path` and the grounding declaration on pack entries.** Extend
  `extensions.mjs` (schema, merge, validation) and add `mergedLaneVocab(entries, bias)`
  beside `mergedLexiconExtra`. `COUNT_NOUNS`/`CLASS_LABELS` move out of `chat.mjs` into
  the code pack's vocab file; the lanes read the merge. `validateExtensionPack` requires
  every pack to declare its grounding channel (extraction adapter or taught-only) and
  rejects one that declares neither. Acceptance: `tmct extend --validate` accepts and
  reports both new keys and refuses an undeclared pack; a bare session's merged vocab is
  empty; unit tests over merge order.
- **T5 — the code domain pack.** Register the `code` pack entry bundling the seon
  corpus, the vocab file (count nouns + surface lines), any lexicon top-up, and the
  grounding declaration naming the extraction adapter (`tmct index` / the provider
  seam); `--with-persona code` activates it; `tmct index` writes the activation into
  that repo's `tmct.toml` (see Q2). Acceptance: fresh repo + persona code +
  `tmct index` over `examples/mini-webapp` answers the pinned count/call questions
  exactly as today, and IDXBENCH's surfaces score what the committed benchmark records.
- **T6 — the neutrality test tier.** Corpus rows keyed for the bare-install probes and
  the active-pack probes; an estate-style guard asserting the surfaces stay
  domain-silent bare. This tier is the plan's finish line made runnable: its bare half
  is criterion (a), and an IDXBENCH pass with the pack loaded is criterion (b).
  Acceptance: the new rows in `scripts/corpus-matrix.mjs`'s map; full lane files green.

### Wave 3 — follow-through (Haiku unless noted)

- **T7 — docs.** README and help copy describe domain packs and the code pack's
  activation; PLAN docs' stale references swept. Docs-only gates.
- **T8 — tier2 bundles as domains.** Repackage `tier2-python`/`java`/`aws` as pack
  entries with empty vocab files (mechanical; proves the seam on three more domains).
- **T9 — domain listing (Sonnet).** `/capabilities` names the loaded domains and what
  each adds, from the packs' own metadata.

## Decisions (the open questions, answered 2026-08-06)

1. **Where the code domain lives** — physically relocate the data into
   `corpus/domains/code/`. The bundle name `seon` and the `corpus:seon` provenance
   prefix stay stable so existing stores and the curated-definitions gate keep
   working; only the on-disk location and path references move.
2. **`tmct index` auto-activates** the code domain in that repo's `tmct.toml`.
3. **Bare count-noun semantics** — fall through to the taught-class count and the
   ordinary miss. No new template.
4. **Parsing is gated too** — code-shaped lanes decline silently when the domain is
   inactive; the general miss stands (see the contract section).
5. **`.tmct/graph.json` keeps its name.**
6. **tier2 bundles become domain packs in wave 3 (T8), this pass.**
7. **The journal-ingest pack** stays at idea level; no separate plan doc now.

## Other shippable domain packs (idea level only)

Each idea names its grounding channel, since the contract requires one.

- **Research-journal document class (the operator's idea).** A pack carrying one
  journal class's section/citation/figure ontology plus ingest templates; grounding
  channel: the ingest extraction adapter over the journal's own documents, with the
  reference-pack and prose machinery loaded beside it. Shows Simple English Wikipedia
  ingest prepared and extended in local tests, and grows toward an app that ships
  selectable domain packs for ingesting documents into synthesized, exportable graphs
  questionable in page.
- **The game worlds, retro-fitted.** The worlds pack already behaves like a domain
  pack; registering it through the same entry proves the seam on shipped content.
  Grounding channel: taught-only, declared (its facts are authored and grow through
  play and teaching).
- **AWS infrastructure.** `tier2-aws` upgraded with a vocab file (count stacks,
  buckets, functions). Grounding channel: taught-only at first; a CloudFormation/CDK
  template extraction adapter is the natural upgrade.
- **Contract clauses.** A clause-type ontology (party, term, obligation, defined term)
  with partOf/memberOf structure. Grounding channel: an ingest adapter over headings
  and cross-references in the contract documents themselves.
- **Recipes.** Ingredient/step/quantity ontology exercising ordered procedures and
  units. Grounding channel: an ingest adapter over recipe text, or taught-only for a
  first cut.
- **Lab protocols.** Reagent/step/hazard ontology, the same ordered-procedure shape as
  recipes with a safety vocabulary. Grounding channel: an ingest adapter over protocol
  documents, or taught-only first.

## Sequencing

T1–T3 land the user-visible neutrality and can ship alone; T4–T6 move the vocabulary out
of application code and make the contract testable; wave 3 is polish. Until a wave
lands, its surface keeps today's behavior — nothing here degrades the code experience at
any point, and the honest-miss invariant holds throughout: a bare install refuses
plainly; it never guesses, and never pitches a domain it isn't carrying.

## Delivery status

Updated as waves merge to local main (2026-08-06):

- Wave 1 (T1–T3) — landed (07a375cf), with parses gated per decision 4. Bare-install
  probes show zero code vocabulary; active-domain output byte-matches the pre-edit
  capture. Two flagged leftovers moved into wave 2's scope: `helpText()`'s code-command
  roster, and the `NO_CODE_INDEX_NOTE` family gated at source in `src/domain`.
- Wave 2 (T4–T6) — landed (d9e75f5e, 8810b830, ddc9aa1c): `vocab_path` +
  grounding-channel declaration on pack entries (`grounding_kind` /
  `grounding_adapter`, enforced by `tmct extend --validate` for pack candidates),
  `mergedLaneVocab` with the code pack's vocab at `corpus/domains/code/vocab.json`,
  the seon corpus relocated to `corpus/domains/code/` with zero provenance-layer
  changes (the `corpus:seon` prefix is a literal in extensions.mjs, not path-derived),
  the neutrality test tier (corpus rows + estate guard), and both wave-1 leftovers
  (helpText rows from the pack, `/untested` neutral when inactive). One scoped
  deviation, kept: the banner/orientation clauses stay inline behind
  `codeDomainActive` rather than moving into the vocab file — wave 1's gating was
  already byte-identical and tested, and the move was pure duplication-shuffling.
- Wave 3: T7 docs + T8 tier2 packs — landed (337067a4, cbd24fb9): README documents
  domain packs, tier2-python/java/aws are pack-kind entries with an empty vocab file
  and taught-only grounding, import behavior byte-identical (30/31/39 facts). T9
  `/capabilities` domain listing — in flight in the chat-engine fixes agent.
