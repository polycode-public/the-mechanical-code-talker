# PLAN_TMCT_ECOSYSTEM_INTEGRATION.md — tmct as the shared interpreter across marginalia, seonix, and bedrock-meter

*(Drafted 2026-07-08. Status: RESEARCH PLAN, not a build order. Origin: operator's request, 3 parts —
1. tmct uplift to service requests through the necessary interfaces, 2. a bedrock-meter proxy layer
that can delegate to tmct as the bedrock LLM, 3. the marginalia (and, by the same question, seonix)
changes to use tmct, including an assessment of whether tmct can drive each repo's graph tools as-is
or needs a corpus+lexicon+template extension layered on top. A first attempt at this exact plan was
dispatched earlier this session and its result was lost to an untraceable context boundary — this is
a fresh, from-scratch, code-grounded pass, not a rewrite of anything recovered.)*

**Ground rules, restated because this doc spans four repos with different constraints.** tmct is
no-LLM, permanently, in the product path (`CLAUDE.md`). Every mechanism this plan proposes for tmct
itself must stay deterministic, explainable, and closed — same discipline as every other PLAN_*.md in
this repo. marginalia and bedrock-meter are **not** bound by that rule for their own code (marginalia
runs Bedrock LLMs today and will keep doing so for open-ended chat; bedrock-meter's whole purpose is
metering LLM spend) — tmct's contribution to both is strictly the **deterministic, $0, provably-in-envelope
slice**, with an honest, named escalation boundary to a real model everywhere tmct cannot answer. This
plan does not propose making marginalia or bedrock-meter no-LLM; it proposes giving them a cheaper,
auditable floor **and being explicit about where that floor ends**.

**Executive honesty scorecard — what is already shipped vs. what this plan actually proposes**, because
the three parts turned out to be at wildly different stages when checked against real code:

| Part | Claimed status (going in) | Verified status (this pass, code-grounded) |
|---|---|---|
| tmct `/v1/messages` shim | "unmerged, stray worktree commits" (per this task's own briefing) | **FALSE — already merged, shipped, on `main` since 0.8.0.** `git merge-base --is-ancestor` confirms both `5abc102` and `9f1c505` are ancestors of current `HEAD` (`640c852`, package.json `0.9.5`). The `.claude/worktrees/agent-*` directories are ordinary leftover git worktrees from past background-agent waves whose commits already landed on `main` — not orphaned work. §1.1. |
| bedrock-meter "tested cost-ordered router with a tmct routing target" | unverified claim from `HANDOVER.md` | **TRUE, and more built than the one-line claim suggested.** `packages/runtime/src/optimiser/{router,router-ladder,routing-target}.mjs` + 11 passing tests (`router.test.mjs`, `router-e2e-tmct.test.mjs`) implement exactly this, including a `tmct` rank-0 rung with an explicit envelope gate. §2.1. |
| seonix "please assess if tmct can drive its graph tools, and if not sketch a corpus/lexicon/template extension" | open research question | **Moot — already fully built, shipped, and in production.** `PLAN_CHAT_EXTRACTION.md` (archived, meaning *done*) shows seonix ripped out its entire in-house NL stack across 6 landed stages and now imports `@polycode-projects/the-mechanical-code-talker` as a real dependency (`^0.9.4`, seonix now at 0.10.6). No extension layer was needed — §3.1 explains why. |
| marginalia "please have a deep look... and if not, corpus/lexicon/template extension" | open research question | **Real, unstarted work — this is the one part of the plan that is genuinely a plan.** marginalia has its own, smaller, no-LLM "mechanical chat" (1,043 LOC) that is a plausible tmct replacement target, and a self-hosted code-graph MCP (`seon-mcp`) that is a near-zero-gap tmct integration exactly like seonix — but marginalia's PRIMARY domain (a general knowledge/memory ontology: Person/Organisation/Place/Event/Concept/…) is real, uncovered territory for tmct's vocabulary. §3.2 is the substantive design work in this document. |

The practical upshot: **Part 1 and Part 2 are mostly "close the gaps," not "build from zero,"** and Part 3
splits cleanly into "already done" (seonix) and "the actual new work" (marginalia). The rest of this
document is organized around what is genuinely left to do.

---

## 1. Part 1 — tmct uplift

### 1.1 What's already there (verified against code, not docs)

- **`POST /v1/messages`, an Anthropic-Messages-API-compatible HTTP shim** — `src/server-http.mjs`
  (296 lines), wired to `bin/tmct.mjs serve`. A request `{model, messages[], tools[]}` gets either a
  `text` `end_turn` answer (via `runTurn`, the same cited chat engine) or a `tool_use` block bound
  against the declared tools (`selectTool`, `server-http.mjs:101-133`), and every response carries
  `usage: {input_tokens: 0, output_tokens: 0}` — the file's own header comment says this is
  deliberately "bedrock-meter-pluggable... tmct is the $0 floor, priced as free by the meter." This
  is not aspirational text; bedrock-meter's test suite (§2.1) exercises this exact response shape.
- **The Repository Interface v1.0.0** — `src/repository-interface.mjs` (a pure-data, versioned service
  contract: 15 services across resolution/traversal/source/aggregate/temporal/search groups, a closed
  `MISS_REASONS` set, a closed `EDGE_KINDS` set of 11 relation kinds), `src/providers/graph-service.mjs`
  (the reference implementation, `createGraphService`), `src/conformance.mjs` (the runnable
  compatibility suite), and stable `package.json` `exports` subpaths (`./repository-interface`,
  `./graph-service`, `./conformance`, `./providers/fixture`, `./providers/bootstrap`) — all confirmed
  present and unchanged in shape since 0.5.0 (`mechanic` inbox correspondence with `codememory`
  cross-checked against `git log -- src/repository-interface.mjs`: zero commits touching it across the
  entire 0.8.2→0.9.5 wave).
- **A capability router + agentic benchmark** (`src/router/*`, `agentbench/*`, `PLAN_CAPABILITY_ROUTER.md`)
  — STRIPS/PDDL-style capability registry, a resolver, a planner, a goal-reasoner, all measured on
  `AGENTBENCH_*.md` with a "0% hallucination" gate. This is the machinery that lets tmct honestly claim
  a provable "in-envelope" class of requests, which is exactly the property bedrock-meter's router
  needs to trust the $0 floor (§2).

**Conclusion:** the interface Part 1 asks for is not a gap. What is a gap is three specific things,
below.

### 1.2 Gap 1 (real, load-bearing for Part 3) — tmct has no extension-pack loading seam

tmct's corpus, lexicon, and templates are **committed inside the tmct package itself** and loaded by
hardcoded relative paths:
- `src/chat.mjs:1908,1932` load `corpus/seon/definitions.jsonl` / `relations.jsonl` directly.
- `src/grammar/lexicon.mjs` loads `src/grammar/lexicon-core.json`, a single flat JSON whitelist.
- Templates load from `data/templates/responses.jsonl` (`src/corpus/templates.mjs`).
- `tmct.toml` (`src/init.mjs`) configures exactly three things: `graph_file`, `corpus.tier`
  (1/2/3 = network policy, not a source-list), and `seed.enabled`/`seed.limit`. **There is no
  `[corpus.extra]`, no `extension_dir`, no host-declared-lexicon knob of any kind.**

This means: today, a host package (seonix, marginalia, or anyone else) can supply its own **graph**
through the provider seam (§1.1), but cannot supply its own **vocabulary** — no way to add domain
corpus facts, lexicon nouns/verbs, or answer templates without forking tmct's `src/`/`corpus/`
directly. seonix never needed this (§3.1 — its domain vocabulary is a strict subset of tmct's own,
because tmct's vocabulary was extracted from code graphs like seonix's in the first place). marginalia
**does** need this (§3.2) — its knowledge domain (Person/Organisation/Concept/…) is real, populated
vocabulary tmct has zero native words for.

**What this needs, concretely** (new work, not yet built):
- An `[extensions]` table in `tmct.toml` (or an equivalent programmatic `registerExtension()` call for
  the in-process/library-consumer path, mirroring `registerProvider`) naming extra corpus JSONL files
  (same `{start, rel, end, weight}` ISA/definition/relation shape as `corpus/seon/*.jsonl`, so no new
  parser is needed — just a new *source list*), extra lexicon entries (same flat noun/verb/adjective
  shape as `lexicon-core.json`), and extra template rows (same shape as `data/templates/responses.jsonl`).
- **Namespacing so extension facts never silently collide with or shadow tmct's own core vocabulary.**
  The provenance/trust primitive (`ROADMAP.md` "Provenance & trust", already shipped) is the natural
  home for this: an extension's facts enter with a distinct `Source` (e.g. `corpus:marginalia`,
  parallel to the existing `corpus:seon`), carry their own trust prior, and a conflicting definition
  from two sources surfaces as a **visible contradiction** (already-shipped behavior for provenance
  conflicts generally), never a silent overwrite.
- **A closed-vocabulary discipline for the extension author, not an open one.** This mirrors
  `PLAN_ontology-hierarchies.md`'s own restated ground rule: an extension corpus is *more lexicon*,
  reviewed and diffable, never a live/unbounded feed. tmct should ship a `tmct extend --validate`
  (or equivalent) that runs the extension's rows through the same shape checks
  `test/corpus-templates.test.mjs`-style validation already applies to the core corpus, so a
  malformed or overly-broad extension pack fails loudly at build time, not at query time.

This is the single piece of **new tmct code** this plan actually recommends building — everything else
in Part 1 is either already shipped or a small, mechanical addition.

### 1.3 Gap 2 (real, but smaller) — no machine-readable capability envelope for a router to consume

bedrock-meter's `router-calibration.json` hand-codes a `TMCT_ENVELOPE` (`maxContextTokens: 8000,
maxReasoning: "low", structuredOk: true, toolsOk: true`) and the file's own `notes` field says plainly:
`"status": "NEWLY DEMONSTRATED spike, not a fitted production calibration"` — these numbers are
**hand-set in bedrock-meter**, not derived from tmct's own `AGENTBENCH_*.md` results. tmct has no
exported envelope artifact at all today (confirmed: no hits for "envelope" anywhere in `src/`, `*.md`,
or `package.json`). Two independently-maintained copies of "what tmct can be trusted for" is a drift
risk the moment either side changes: tmct's AGENTBENCH ladder moves (it already has — 0.8.0 → 0.8.2
→ 0.9.x each measured different capability), and bedrock-meter's hand-set numbers silently go stale.

**What this needs:** tmct should publish a small, versioned, machine-readable capability-envelope
artifact (e.g. `agentbench/envelope.json`, generated from the latest `AGENTBENCH_<version>.md`'s
gate-PASS rungs — `maxContextTokens`, `reasoning` depth reached, `structuredOk`/`toolsOk` flags) as
part of its release process, the same way `CHATBENCH_<version>.md`/`AGENTBENCH_<version>.md` are
already release artifacts. bedrock-meter's `router-calibration.json` should then be *generated from*
that file (or at minimum, a CI check should assert the two stay in sync), not hand-typed twice.

### 1.4 Gap 3 (minor, worth naming) — the tool-loop handshake is real but thin

`respondToMessages` (`server-http.mjs:156-191`) closes a tool loop correctly for the single-hop case
(emit `tool_use` → caller executes → caller returns `tool_result` → tmct relays it as `end_turn` text),
but the relay is a literal echo of the tool's own output text (`toolResultText(tr)`), not a re-run
through `runTurn` — so tmct never gets a chance to *compose* an answer across multiple tool results in
one conversation, and cross-turn state (focus/`it` anaphora, session memory) does not persist across
HTTP requests at all (`memoryDir: null`, deliberately, "so the endpoint is PURE — no session artifacts,
no writes, deterministic"). This is a **correct, honest design choice for a stateless router target**
(bedrock-meter's use case is exactly "one routed request, no session"), so this is not a defect to fix
— it is a scope boundary worth stating explicitly in this plan so Part 2/3 don't assume session
continuity the shim was deliberately built without.

---

## 2. Part 2 — bedrock-meter uplift

### 2.1 What's already there (verified against code)

`packages/runtime/src/optimiser/{router.mjs, router-ladder.mjs, routing-target.mjs}` — real, tested code:

- **`ROUTER_LADDER`** (`router-ladder.mjs`): a cost-ascending rung list — `tmct` at rank 0 (`£0`,
  `zeroCost: true`, gated by `TMCT_ENVELOPE`), then `amazon.nova-micro-v1:0` (rank 1) through
  `claude-haiku-4-5` (rank 4), each with real per-1k-token USD pricing. This is explicitly a *separate*
  ordering from marginalia's pre-existing `model-ladder.mjs` capability band-clip (which the file's own
  header comment explains: that ladder answers "is the model-of-the-day capable enough," not "which is
  cheapest," and leaves both `nova-micro` and any $0 rung off-ladder — a real, previously-unaddressed
  gap this new ladder closes).
- **`makeRouter({calibration, targets, accountant, ...})`** (`router.mjs`): `route({score, confidence,
  needs})` picks the cheapest rung whose rank clears a score-derived floor (`minRankForScore`,
  low-confidence biases up one rung) and whose hard constraints (`satisfiesHard`) and — for the $0
  floor specifically — envelope (`inEnvelope`) are satisfied; otherwise escalates. `dispatchMetered`
  wires this straight into the SAME accountant/`extractUsage` pipeline that prices real Bedrock calls,
  so a tmct dispatch is metered at £0 through the real metering code path, not a special case.
- **`makeTmctTarget({dispatch, baseUrl, rung})`** (`routing-target.mjs`): a `RoutingTarget` whose
  `dispatch` is either an injected test double or `httpDispatch(baseUrl)` — a real `fetch()` POST to
  `<baseUrl>/v1/messages`, tmct's actual shim from §1.1. The file's own header is explicit about
  status: *"the tmct rung is NEWLY DEMONSTRATED here, not a pre-existing contract... there is no
  cross-repo dependency on tmct in this repo's tests."*
- **Tests**: `router.test.mjs` (7 cases) + `router-e2e-tmct.test.mjs` (4 cases, end-to-end: optimiser →
  in-envelope request → tmct (injected dispatch returning tmct's exact documented response shape,
  `usage: {input_tokens:0, output_tokens:0}`) → metered at £0, contrasted against an
  out-of-envelope request escalating to a stub Bedrock target that reports real, non-zero usage). All
  green.

**Verdict on the disputed claim:** `HANDOVER.md`'s one-line summary — "bedrock-meter already has a
tested cost-ordered router with a tmct routing target" — is **true**, and undersold rather than
oversold: this is a genuinely built, envelope-gated, £0-metering-proven router, not a stub.

### 2.2 Gap 1 — the calibration is a hand-set spike, not derived from tmct (same as §1.3)

Already covered in §1.3 from tmct's side; the fix is the same artifact, consumed from bedrock-meter's
side: once tmct publishes `agentbench/envelope.json`, `router-calibration.json`'s `envelope` block
should be generated from it (a small sync script, `scripts/sync-tmct-envelope.mjs` or similar), and the
file's own `"status"` field should flip from `"NEWLY DEMONSTRATED spike"` to something like
`"derived from tmct AGENTBENCH <version>"` once that's true — an honest status field is cheap and this
repo's own convention (`PLAN_BEDROCK_METER_OPTIMISER.md` already models this kind of self-report).

### 2.3 Gap 2 — no live integration test, only injected-dispatch unit tests

`router-e2e-tmct.test.mjs` is thorough but entirely offline: `fakeTmctDispatch` returns a hand-built
response object matching tmct's documented shape; nothing in bedrock-meter's test suite ever starts a
real `node bin/tmct.mjs serve` process and round-trips an HTTP request through `httpDispatch`. This is
a reasonable unit-test boundary (the file's own comment says as much: `"Not exercised in unit tests
(no server spun there) — this is the deployment seam"`), but it means the actual wire format has never
been proven compatible end-to-end across the two real packages. **Recommendation:** a small
cross-repo smoke test — either a `behaviour-tests`-style script in bedrock-meter that shells out to
`npx @polycode-projects/the-mechanical-code-talker serve` and hits it with `httpDispatch`, or (cleaner,
avoiding a hard npm dependency from bedrock-meter on tmct) a CI job that runs this smoke test as a
separate, optional workflow triggered on tmct releases. Either way, this should land **before** any
production traffic is routed to the tmct rung — untested wire-format assumptions between two
independently-released packages are exactly the kind of thing that breaks silently on a version bump.

### 2.4 Gap 3 — the upstream "assessor" (raw request → `{score, confidence, needs}`) does not exist yet

`route()` and `dispatchMetered()` both *consume* `{score, confidence, needs}` — nothing in
`packages/runtime/src/` *produces* it from a raw inbound request. `PLAN_BEDROCK_METER_OPTIMISER.md`
(§1.0.1) describes the intended assessor in detail — "a cheap, fast assessor model (e.g.
`amazon.nova-micro-v1:0`) scores the task" — but this is prose in a planning doc, not code; grepping
`packages/runtime/src` for `assessScore`/`assessTask`/`complexity` returns nothing beyond the plan
doc's own references and the type signature `route()` expects. **This is the actual missing link for
"delegate to tmct as the bedrock LLM used to drive the tool loop"**: today, a caller must hand-compute
`{score, confidence, needs}` itself before `route()` can do anything.

**Design note connecting back to tmct (Part 1):** the planned assessor is itself an LLM call (a paid
one, on the cheapest available model) — worth naming plainly that **this is real, unavoidable spend
that happens before the router can even consider routing to the $0 floor**, which caps how cheap the
tmct rung can make any single request in practice (the assessment overhead is a real cost the
`PLAN_BEDROCK_METER_OPTIMISER.md` plan already accounts for as "a small single-digit % of the spend it
saves" — an estimate, not yet measured against the tmct rung specifically). One narrower, genuinely
$0 pre-filter is available for the specific "is this tmct-shaped" sub-question: tmct's own
`isConversational`/`selectTool` heuristic (`server-http.mjs:101-133`) already, deterministically,
distinguishes a structural graph-query-shaped request from small talk / open-ended prose, at zero
cost. This is **not** a substitute for the general complexity assessor (it only answers "would tmct's
own router even attempt this," not "how hard is this task overall"), but it is a legitimate, free,
zero-latency **first check** bedrock-meter's assessor step could run before paying for a model call —
worth a design note, not a full solution, in whichever session builds the assessor.

### 2.5 Publish readiness

The operator's ask was to "publish an npm package of the work we did in bedrock-meter." Checked:
`packages/runtime/package.json` already has a real `name` (`@polycode/bedrock-meter`), `version`
(`0.1.0`), `exports`, `main`, `types` — it looks publish-shaped already (unlike the workspace root,
which is `private: true` by convention for a monorepo). This plan does not find a blocker to publishing
`packages/runtime` specifically; the honest sequencing point is that §2.2-§2.4's gaps should land
**before** a 1.0 publish that advertises the tmct rung as production-ready, since right now its
calibration is self-described as a spike and its assessor is unbuilt. Publishing 0.1.x today with the
router present but the tmct rung clearly marked experimental (which the code already does, honestly,
via the `router-calibration.json` `status` field) is a defensible interim step; claiming it's
calibrated/production-ready is not yet, until §2.2 lands.

---

## 3. Part 3 — marginalia and seonix integration

### 3.1 seonix — already fully shipped; this section is a verification, not a proposal

The operator's question ("deep look at seonix's graph tools, assess if tmct can drive those, and if
not sketch a corpus/lexicon/template extension") turned out to have a definitive, already-executed
answer sitting in the repo: `PLAN_CHAT_EXTRACTION.md` is **archived** (seonix's convention for "done,"
same as tmct's `archive/` directory) — its full 6-stage cutover already landed and shipped:

```
ff85537 docs: add PLAN_CHAT_EXTRACTION
2ea692e docs: advance PLAN_CHAT_EXTRACTION to the "call tmct" stage
a129414 feat(seonix): call tmct for the ask API + CLI chat (Stage ~4)
fa594f4 feat(seonix): website Ask-the-graph panel runs tmct's engine (Stage 5)
acbd868 refactor(seonix): delete the in-house NL engine; drop wink deps (Stage 6)
e04f2f3 release: @polycode-projects/seonix 0.8.0 — tmct cutover docs + repo refresh
```

seonix is now at **0.10.6**, `package.json` carries a real dependency
`"@polycode-projects/the-mechanical-code-talker": "^0.9.4"`, and `src/tmct-provider.mjs` (37 lines) is
the entire provider adapter:

```js
import { createGraphService } from "@polycode-projects/the-mechanical-code-talker/graph-service";
export function makeSeonixProvider(graph, { sourceAccess = false } = {}) {
  return createGraphService(graph, { sourceAccess });
}
```

**Why the gap assessment came back "no gap, zero extension needed":** the file's own comment states it
plainly — *"seonix's `parseEntities()` result is byte-identical in shape to tmct's, so tmct's
`createGraphService` consumes it directly."* This isn't a coincidence: seonix's code graph is the
literal historical ancestor of tmct's own ontology (tmct was lifted *out of* seonix's chat surface,
`ROADMAP.md`'s own opening line: *"tmct v0.1.0 was a whole-package lift of the seonix chat
surface"*). Asking "can tmct drive seonix's graph tools" is close to asking "can tmct drive the graph
tools it was extracted from" — the honest answer is yes, trivially, and the shipped code proves it.

**What moved vs. what stayed** (from the plan's own table, cross-checked against current
`src/`/`bin/cli.mjs`): `seonix chat`, the `seonix_ask` NL engine, and the website "Ask the graph" panel
all now call tmct. Every **typed, structural** MCP tool (`seonix_describe`, `seonix_snippet`,
`seonix_members`, `seonix_impact`, `seonix_search`, `seonix_context`, etc. — the tools the `copilot`
inbox correspondent's Titan-estate feedback names) **stayed native to seonix**, along with the
Chronograph temporal/diff browser and the cytoscape visualizer. This is a clean, validated
architectural pattern worth carrying into marginalia's design (§3.2 and §3.3): **NL-to-tool-selection
routes through tmct; fast, typed, already-well-shaped tool calls stay native.** tmct's job was never to
reimplement `seonix_impact`'s reverse-closure computation — it was to decide, from natural language,
*that* impact is what's being asked for and bind the right module.

**Nothing here contradicts the `mechanic`/`codememory` inbox correspondence** — the inbox's own last
message from `codememory` ("`PLAN_CHAT_EXTRACTION.md`, unstarted this round") is truthful about *that
session's own turn* (they hadn't touched it *this session*), not about the repo's overall state; a
prior session had already carried it to completion. No action needed here beyond noting the plan is
current, not stale.

### 3.2 marginalia — the genuinely open design work

**Two separate systems exist in marginalia, and they map onto tmct very differently.**

#### 3.2.1 The self-hosted code graph (`seon-mcp/`) — near-zero gap, same pattern as seonix

marginalia already runs its own SEON-derived code-map of its *own* repository, exposed as a standalone
stdio MCP server (`seon-mcp/`, ~694 LOC: `codegraph.mjs`, `api.mjs`, `server.mjs`, `config.mjs`) with
three tools — `seon_describe`, `seon_impact`, `seon_search` — reading typed entities
(`mg:imports`/`mg:calls`/`mg:defines`/`mg:tests`/`mg:touches`) pushed by a CI collector
(`scripts/seon/push-code-map.mjs`) into a private memory graph, fetched over HTTP
(`GET /api/graph/{id}/entities`). This is a **near-1:1 vocabulary match** with tmct's own `EDGE_KINDS`
(`imports/calls/defines/tests/touches` are 5 of tmct's 11 closed kinds, and the classes involved —
`mg:Repository`/`mg:Module`/`mg:Function`/`mg:Commit`, declared in `app/lib/vocab.mjs`'s
`ENTITY_CLASSES` — align via `owl:equivalentClass`/`align` fields to the *same* SEON vocabulary
(`se-on.org/.../code.owl`) tmct's own `ontology/tmct-core.ttl` already cites as its reference
vocabulary for code entities). This is the same shape of integration as seonix: implement a thin
provider (`createGraphService`-compatible, or hand-written against `seon-mcp`'s HTTP entities
endpoint) and tmct drives it with **no extension pack needed**. This is genuinely additive, low-risk
work, staged first (§5).

#### 3.2.2 The "mechanical chat" (`app/lib/mechanical/`) — the actual replacement target, and a real gap

The operator's "mechanical chat which I would like to replace with tmct" is `app/lib/mechanical/`
(matcher.mjs, answer.mjs, render.mjs, refs.mjs, formulate-grammar.mjs, mine-turns.mjs — 1,043 LOC
total), shipped per `MARGINALIA_ROADMAP.md` Phase 16 ("mechanical chat mode — done + prod-verified,
2026-06-14"). Concretely:

- **Deterministic, no-LLM by construction** (same ethos as tmct, independently arrived at): a
  wink-nlp gazetteer matcher (`matcher.mjs`) over entity labels + closed class/predicate vocabulary,
  a template SPARQL grammar (`formulate-grammar.mjs`) that turns matched entities/classes/predicates
  into oxigraph SPARQL, and a citation-faithful renderer (`render.mjs`) — "Formulate (deterministic) →
  Solve (oxigraph) → Render," a grammar miss is a stated blank + the SPARQL receipt, **never a silent
  LLM fallback**.
- **It is a dark-flagged sub-path of marginalia's real chat, not the whole thing.** marginalia's
  primary conversational surface calls Bedrock (`app/functions/chat/*.mjs` all reference
  `BedrockRuntimeClient`/`Converse`); the mechanical grammar rung is tried FIRST only when a
  `mechanical_first` flag is on (off by default per `formulate.mjs`), and a `null` (grammar miss)
  falls through to Bedrock unchanged. **Replacing this with tmct does not mean marginalia stops using
  an LLM** — it means the deterministic pre-filter gets a much more capable deterministic engine
  (tmct's CEFR-graded chat surface, its router, its memory/provenance/trust layer) instead of a
  1,043-line homegrown one, and the Bedrock fallback stays for genuinely open-ended chat outside
  tmct's provable envelope. This is architecturally the **exact same escalation pattern** as bedrock-meter's
  router (§2) — worth flagging as a real synergy, not a coincidence: marginalia's `chat` Lambda could,
  in principle, eventually delegate its own model-routing decision to bedrock-meter's router with tmct
  as its rank-0 rung, unifying "try the $0 deterministic floor first, escalate to Bedrock" into one
  piece of shared infrastructure instead of marginalia's own bespoke `mechanical_first` flag. This
  plan does not recommend building that unification now (§5 stages it explicitly later) — it names it
  as the natural end state Parts 2 and 3 converge on.

**The real vocabulary gap, concretely.** marginalia's domain ontology (`app/ontology/ontology.ttl`,
533 lines; `app/lib/vocab.mjs`, 272 lines, the single source of truth the TTL is generated/checked
against) is a **general knowledge graph**, not a code graph:

- `mg:Entity` taxonomy: `Person`, `Organisation`, `Place`, `Event`, `Concept`, `Artifact`,
  `Technology`, `Work`, plus finer subclasses (`Researcher` ⊑ `Person`, `Course` ⊑ `Concept`, `Tool` ⊑
  `Technology`, `Paper` ⊑ `Work`, `Agent`, `Platform`, `Project`) — **zero overlap** with tmct's code-only
  class vocabulary (`Module`/`Class`/`Function`/`Commit`/`Test`/…).
- `TYPED_EDGES` (memory-to-memory relations): `mg:relatedTo` (generic, symmetric),
  `mg:isA`/`mg:partOf` (transitive), `mg:causes`, `mg:contradicts`, `mg:precedes`/`mg:follows`,
  `mg:exemplifies` — a **closed relation vocabulary of its own**, disjoint from tmct's 11-member
  `EDGE_KINDS`.
- `ENTITY_OBJECT_PROPS` (entity-to-entity relations): `mg:locatedIn`, `mg:memberOf`, `mg:createdBy`,
  `mg:influences`, `mg:dependsOn`, `mg:opposes`, `mg:collaboratesWith`, `mg:postedOn`, `mg:contacted`,
  `mg:used`, plus a repo-supervisor/dev-exhaust set (`mg:fixes`, `mg:implements`, `mg:reverts`,
  `mg:discusses`, `mg:decidedIn`, `mg:componentOf`) over `ChangeRequest`/`Issue`/`Post`/`Decision`/
  `Release` classes — each with a **`verbs: [...]` trigger-phrase list already declared**, e.g.
  `mg:dependsOn: ["depends on", "requires", "relies on", "built on", "powered by"]`.

**Precisely where the gap bites, mechanically:** tmct's `edges(id, kind)` service (§1.1) requires
`kind ∈ EDGE_KINDS` and *throws* `TypeError` for anything outside that closed set (`repository-
interface.mjs`: *"An unknown kind... is a programming error and throws TypeError, not a miss"*) — so a
kind-filtered traversal query ("what does X depend on") over `mg:dependsOn` is not expressible through
`edges()` today at all. `describe(id)` is **not** kind-gated (`edgesAround()` in `graph-service.mjs`
walks every relation group regardless of predicate) — so a provider-side `describe` call would
correctly surface an `mg:dependsOn` edge as a raw `Edge` with `predicate: "mg:dependsOn"` in its
`out[]` array. The practical implication: **whole-entity `describe` already degrades gracefully today
without any extension**, but kind-filtered/predicate-specific traversal, and — the bigger piece —
**natural-language routing to the right predicate** ("who does X depend on" → the `mg:dependsOn`
edge, not a generic describe dump) has no lexicon or grammar support in tmct at all.

**The extension design, concretely, using the pattern §1.2 proposes:**

1. **Corpus rows — mechanically derivable from `vocab.mjs`, not hand-authored.** marginalia's
   `ENTITY_CLASSES` array is *already* an ISA hierarchy (`{name, parent, comment}` — parent defaults to
   `mg:Entity`), structurally identical to tmct's own `corpus/seon/concepts.jsonl` rows
   (`{start, rel: "/r/IsA", end, weight}`). A small, mechanical compiler
   (`marginalia-tmct-extension/build-corpus.mjs`, new, small, pure data transform) emits:
   ```jsonl
   {"start":"/c/en/researcher","rel":"/r/IsA","end":"/c/en/person","weight":2}
   {"start":"/c/en/course","rel":"/r/IsA","end":"/c/en/concept","weight":2}
   ```
   and `definitions.jsonl` rows from each class's `comment` field (already human-written English
   definitions — "A person in a research role — an academic, scientist, or analyst" reads exactly like
   an existing `corpus/seon/definitions.jsonl` row).
2. **Lexicon entries — also mechanically derivable.** `ENTITY_OBJECT_PROPS`/`TYPED_EDGES`'s `verbs`
   arrays are already tmct-lexicon-shaped trigger-phrase lists; each becomes a verb entry in the
   extension lexicon, and each `ENTITY_CLASSES` name becomes a noun entry — the same compiler emits
   both from the one source of truth marginalia already maintains (and, per marginalia's own
   `vocab-sync.test.mjs` drift guard, already keeps in sync with its TTLs and prompts — so the
   extension's freshness is a solved problem on marginalia's side, not a new maintenance burden).
3. **Template/capability entries — the part that needs real (if small) new authoring.** Verb→predicate
   mapping gets an extension consumer route the same way tmct's grammar routes a matched verb to a
   query shape today; concretely, this is closer to the router's `registry.mjs` capability-declaration
   pattern (§1.1) than to a flat response template: a `Capability` entry per `ENTITY_OBJECT_PROPS`
   relation (e.g. `{id: "mg-depends-on", precondition: "focus entity resolved", effect: "adds
   dependsOn topic"}`) that the resolver's backward-chaining picks by **deduction over the declared
   preconditions/effects**, exactly matching the operator's own framing ("so tmct [can] use deduction
   to pick tools") rather than a keyword-matched special case.
4. **The provider side.** Unlike code-graph individuals, `mg:Memory`/`mg:Turn`/`mg:Entity` individuals
   live in oxigraph as RDF, not in tmct's in-memory `{individuals, byId, relations}` shape — so
   marginalia's provider adapter is genuinely new code (a SPARQL-backed implementation of the 15
   Repository Interface services, translating `resolve`/`describe`/`edges` calls into SPARQL SELECT/
   CONSTRUCT queries against the memory-tree store), not a thin `createGraphService` wrap like seonix's
   37-line adapter. This is real effort, honestly larger than seonix's, but bounded and well-precedented
   by marginalia's *own* `formulate-grammar.mjs`, which already does exactly this translation (matched
   entity/class/predicate → SPARQL) for its own smaller grammar today.

### 3.3 Shared machinery vs. repo-specific — the comparison table

| | seonix | marginalia (seon-mcp) | marginalia (mechanical chat / memory tree) |
|---|---|---|---|
| Domain | Code graph | Code graph (self-hosted) | General knowledge/memory graph |
| Vocabulary overlap with tmct core | ~100% (tmct's own ancestor) | ~90% (SEON-aligned, same 5 core edge kinds) | Near 0% on classes; edge-kind vocabulary is a disjoint closed set |
| Provider adapter | 37 LOC, `createGraphService` reused directly | Small, new (HTTP-backed, not in-memory graph shape) | Real, new (SPARQL-backed translation of all 15 services) |
| Extension pack needed (§1.2)? | **No** | **No** (or minimal — same reasoning as seonix) | **Yes** — corpus + lexicon mechanically derivable from `vocab.mjs`; capability/template entries need real, if bounded, authoring |
| Status | **Shipped, in production, seonix 0.8.0→0.10.6** | Not started | Not started |
| Effort remaining | None (verification only) | Low — same pattern as seonix, proven twice now | Medium — needs §1.2's extension-pack seam to exist first, plus the SPARQL-backed provider |

---

## 4. Risks and honesty

- **§1.2's extension-pack seam is a genuine new capability tmct has never had.** Every other
  "extensibility" tmct ships today is either a graph-data seam (the provider pattern — no vocabulary
  implications) or fully internal (corpus/lexicon/templates are tmct's own, committed, single-sourced).
  Letting an *external* package add vocabulary tmct's own core has to treat as trustworthy is closer in
  spirit to `PLAN_CODE.md`'s "this is the first capability category that writes/generates anything"
  framing than it first appears — it isn't code generation, but it **is** the first time tmct's answer
  surface can be shaped by data tmct's own maintainers didn't author or review. The namespacing +
  provenance/trust-scoring design in §1.2 is load-bearing for keeping this honest (an extension fact is
  never silently indistinguishable from a core tmct fact), not a nice-to-have.
- **The envelope-sync gap (§1.3/§2.2) is a real drift risk today, actively growing.** Every tmct release
  that moves AGENTBENCH's measured capability (0.8.0 → 0.8.2 → 0.9.x already have) makes bedrock-meter's
  hand-set `TMCT_ENVELOPE` more stale, silently. This is not hypothetical — it is the current state.
- **bedrock-meter's router is real and tested, but its one live-integration gap (§2.3) means the actual
  HTTP wire contract between the two packages has never been proven outside hand-built fixture objects.**
  Two independently-versioned npm packages agreeing on a JSON shape by convention, unverified by any
  test that starts a real server, is exactly the kind of thing that breaks on an innocuous release.
- **marginalia's extension (§3.2.2) is scoped as "corpus + lexicon are mechanically derivable," which is
  true for the ISA hierarchy and trigger-verb lists specifically — it is not a claim that the whole
  integration is mechanical.** The provider adapter (SPARQL translation) and the capability/template
  layer are real, hand-authored engineering, comparable in size to marginalia's own existing
  `formulate-grammar.mjs` (174 lines) plus `matcher.mjs` (213 lines) — a multi-day task, not a
  code-generation exercise, and this plan should not be read as claiming otherwise.
- **marginalia's mechanical-chat replacement does not remove marginalia's LLM usage, and this plan does
  not propose that it should.** Marginalia's core product — a public chat where conversations build a
  shared memory tree — depends on open-ended generative chat that is genuinely outside any closed-world
  engine's reach (the same open-world boundary `PLAN_CAPABILITY_ROUTER.md` already names as
  permanently unsolved for tmct). This plan's contribution is a better, more capable deterministic
  floor with an honest escalation boundary, not LLM removal.
- **No code has been written or should be inferred as written from this document.** Every LOC count,
  file path, and "status: shipped" claim above was verified by direct reads of the four repos'
  current `main` branches on 2026-07-07/08 — this plan carries no assumptions forward from any earlier,
  lost attempt at the same task.

---

## 5. Sequencing

*(See also [[PLAN_AGI_ARCHITECTURE.md]] — a sibling doc, drafted the same night, that answers a
narrower question this plan's Part 3 opens but doesn't resolve: how an LLM-decided fact in
marginalia should be trust-scored and made retractable using the same vocabulary tmct's
`SOURCE_PRIOR`/provenance system already ships. It verified marginalia's actual LLM-decision
write path (`typed-edges.mjs`) rather than assuming one didn't exist.)*

Staged so each phase either closes a verified gap or builds on a phase that already landed —
consistent with this repo's "measure before building" convention (`PLAN_CODE.md` §6,
`PLAN_ADVANCED_GRAMMAR.md` §2).

| Phase | What ships | Depends on | Repo(s) |
|---|---|---|---|
| 0 | **Cross-repo smoke test** (§2.3): a real `tmct serve` process, hit over HTTP by bedrock-meter's `httpDispatch`, asserting the documented response shape holds outside fixture objects. Cheapest, highest-value gap to close first — everything else assumes this wire contract is real. | Nothing (both sides already built) | tmct, bedrock-meter |
| 1 | **tmct publishes `agentbench/envelope.json`** (§1.3) as a release artifact; bedrock-meter's `router-calibration.json` generation/sync script consumes it (§2.2), flipping its `status` field from "spike" to a real derivation. | Phase 0 (proves the shim is trustworthy enough to calibrate against) | tmct, bedrock-meter |
| 2 | **seon-mcp provider adapter** (§3.2.1) — marginalia's self-hosted code graph wired to tmct exactly like seonix, near-zero new tmct-side work, proven pattern (2 for 2 so far). Ships marginalia's first real tmct integration with the least risk. | Repository Interface (already shipped) | marginalia |
| 3 | **tmct's extension-pack seam** (§1.2) — the `[extensions]` config surface + namespaced corpus/lexicon/template loading + `tmct extend --validate`. The one genuinely new tmct capability this plan calls for. | Nothing new (builds on the existing provenance/trust primitive) | tmct |
| 4 | **marginalia's mechanical-chat replacement** (§3.2.2) — the vocab.mjs→corpus/lexicon compiler, the capability/template entries, and the SPARQL-backed provider adapter, gated on Phase 3 existing. This is the substantive remaining work in this whole plan. | Phase 3 | tmct, marginalia |
| 5 | **The bedrock-meter assessor** (§2.4) — the raw-request→`{score, confidence, needs}` classifier `PLAN_BEDROCK_METER_OPTIMISER.md` already designs but has not built, informed by tmct's own zero-cost `isConversational` pre-filter as one input. | Phase 1 (a trustworthy envelope to route against) | bedrock-meter |
| Later | **Unify marginalia's `mechanical_first` flag with bedrock-meter's router** (§3.2.2's closing note) — marginalia's own chat function delegates its floor-vs-Bedrock decision to bedrock-meter's router instead of a bespoke flag, once both are proven independently. Named as the natural end state, not staged for near-term build. | Phases 2, 4, 5 all landed and independently verified | marginalia, bedrock-meter |

### Critical files for implementation

- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/repository-interface.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/providers/graph-service.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/server-http.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/init.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/chat.mjs` (corpus/lexicon load points, §1.2)
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/agentbench/` (envelope source, §1.3)
- `/Users/antony/projects/polycode-projects/bedrock-meter/packages/runtime/src/optimiser/router.mjs`
- `/Users/antony/projects/polycode-projects/bedrock-meter/packages/runtime/src/optimiser/router-ladder.mjs`
- `/Users/antony/projects/polycode-projects/bedrock-meter/packages/runtime/src/optimiser/routing-target.mjs`
- `/Users/antony/projects/polycode-projects/bedrock-meter/packages/runtime/data/router-calibration.json`
- `/Users/antony/projects/polycode-projects/bedrock-meter/PLAN_BEDROCK_METER_OPTIMISER.md`
- `/Users/antony/projects/polycode-projects/seonix/src/tmct-provider.mjs`
- `/Users/antony/projects/polycode-projects/seonix/archive/PLAN_CHAT_EXTRACTION.md`
- `/Users/antony/projects/polycode-projects/marginalia/app/lib/vocab.mjs`
- `/Users/antony/projects/polycode-projects/marginalia/app/lib/mechanical/` (matcher.mjs, answer.mjs, formulate-grammar.mjs, render.mjs)
- `/Users/antony/projects/polycode-projects/marginalia/app/ontology/ontology.ttl`
- `/Users/antony/projects/polycode-projects/marginalia/seon-mcp/src/codegraph.mjs`
- `/Users/antony/projects/polycode-projects/marginalia/MARGINALIA_ROADMAP.md` (Phase 16)
