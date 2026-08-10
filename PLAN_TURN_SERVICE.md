# PLAN_TURN_SERVICE.md — the whole tmct surface as a consumer-hosted turn API: a Dynamo corpus supplement, retrieve-then-resolve, and a circuit breaker that degrades to today's product

Status: DESIGN. Nothing in this plan is built. It stands on `PLAN_MEMORY_BACKEND.md` (cited as
MB §N throughout) and does not modify it: the row backend contract, the DynamoDB backend, the
table, the session model, the caps, the soft deletes, and the conformance kit are that plan's
deliverables and this plan's foundation. The operator's decisions here are settled: the turn
surface is consumer-hosted architecture that tmct demos; the Lambda's only network is DynamoDB;
the big corpora live in shared read-only Dynamo partitions loaded by a CLI verb at deploy time;
resolution stays synchronous behind a bounded retrieval phase; and enumeration answers say so
when retrieval bounded them.

This plan is written to be built by Sonnet-tier implementers with no further design work, with
the two engine-adjacent phases marked for Opus. Every phase names its module paths, data
structures, function signatures, test files, and acceptance commands. The hard decisions (the
endpoint, the band schema, the loader, the retrieval bounds, the breaker, the enumeration
marker, the cold-start posture) are fixed here, in writing.

The feature in one paragraph: `POST /api/sessions/:uuid/turn {text}` runs a full tmct turn in a
Lambda — resolution, inference, proof, wiki-backed lookups — and returns
`{reply, factsTouched, narration}`. The Lambda boots nearly empty: a small bundled seed, the
session's rows from the table (MB §3.5), and a per-turn subgraph retrieved from shared
`corpus:<band>` partitions holding corpora far too large to bundle (WordNet complete, full
ConceptNet, Wikidata slices, a wikipedia-derived band). Retrieval is bounded, deterministic,
and shaped by the engine's own bounded reasoning, so the synchronous engine runs unchanged
over seed ⊕ subgraph ⊕ session. A Dynamo-backed circuit breaker turns corpus trouble into a
clean degrade: the turn runs on seed ⊕ session alone, which is today's shipped product. The
bands are loaded by `tmct corpus load`, run from CI after deploy or from any shell with AWS
credentials. tmct is offline; this surface is what a consumer hosts, and tmct's own deployment
of it is the demonstration.

---

## 1. What ships today

Every phase below cites these seams instead of re-deriving them.

**The row service and its stack** (MB §3.8, §3.10, MB phases M0–M10). The turn endpoint is one
more route on that service: same table, same session model (client-minted UUIDv4, strict v4
validation, implicit creation, key in the mutating path), same caps and abuse framework, same
local double pattern (the real handler on `node:http` over the in-memory reference backend),
same infra stack and deploy job. Nothing in this plan changes MB's endpoints or semantics.

**The engine is already a bounded reasoner.** The alias chase is two hops. Property, capability,
and does-have inheritance widen exactly one stored `rdfs:subClassOf` hop. Syllogise runs under
a budget. The planner search is bounded. The choice lane's constraint pull is capped per turn.
This matters because the retrieval phase (§3.4) mirrors those bounds; a subgraph that covers
them loses nothing the engine could have reached.

**The term machinery retrieval needs exists.** `normFactTerm` folds surface forms to canonical
terms; the lexicon's plural/lemma folds and the real-word collision table (an estate-guarded
generated artifact) give a deterministic, closed way to produce fuzzy variants without ranking
or scoring.

**The embedded target is proven.** bedrock-meter runs `createSession`/`runTurn` inside Lambda
today. The engine needs no decomposition into services: resolution, the syllogist, `/prove`,
and the reference lanes are in-process library calls.

**The offline research and reference sources.** `researchSource: "simple-wikipedia-pack"` and
the shipped reference pack already serve wiki-backed lookups with zero network. On this
surface they are the wiki story (§2); the wikipedia-derived corpus band extends the same
posture to much larger data.

**CLI verbs have one home.** `src/domain/cli-verbs.mjs` is the single verb list both `--help`
and unknown-invocation errors render from; `bin/tmct.mjs` dispatches on it. The loader verb
(§3.3) follows that pattern.

---

## 2. The constitution for this surface

- **tmct is offline. This surface is consumer-hosted, and tmct demos it.** The browser demo
  stays the product claim, untouched: the engine in your page, deterministic, nothing sent
  anywhere. The turn API is the architecture a consumer hosts (bedrock-meter-style), and
  tmct's own deployment exists to demonstrate it working end to end. Every consumer-facing
  sentence in docs and site copy frames it that way.
- **No egress.** The Lambda's only network is DynamoDB. No live wikipedia, no outbound HTTP of
  any kind. Wiki-backed search is served by the wikipedia-derived corpus band and the shipped
  reference pack. Every fact a turn can ground comes from a committed or loaded source, and
  its provenance says which.
- **Determinism holds through retrieval.** Same query + same corpus state + same session rows
  ⇒ same subgraph ⇒ same answer. Retrieval uses sorted terms, sorted sort-key traversal, and
  fixed caps, so a budget cut always lands in the same place (§3.4).
- **The honest miss survives bounding.** A fact outside the retrieved subgraph is an honest
  miss, the same miss the browser page gives for a fact outside its seed. A retrieval timeout
  is a smaller subgraph, never a guess. Enumeration answers state their bounds (§3.6).
- **Breaker state selects between two honest modes** — with the corpus supplement or without —
  and the answer says which mode served it (§3.5).

---

## 3. The decisions

### 3.1 The turn endpoint

One route joins the row service's table (MB §3.8):

| method + path | success | notes |
| --- | --- | --- |
| POST /api/sessions/:uuid/turn | 200 `{reply, factsTouched, narration}` | body `{text}`, ≤ 4 KB (413 above); the key rides the path because a turn can write, same strict v4 rule, implicit session creation on the first learning turn; 429 over the turn rate; 507 surfaces as MB's `BackendUnavailable` posture — the turn still answers, learned facts are not persisted, and the reply says so |

The handler's sequence, `server/turn-service/handler.mjs`:

1. validate (key shape, body size, content type) — MB §3.8's rules verbatim;
2. read the breaker item and the cap counter (one `_meta` read each, §3.5);
3. construct a fresh `createDynamoRowBackend` for the session (fresh per invocation, MB §3.11)
   and `loadMemory` — one Query;
4. retrieval (§3.4): assemble the corpus subgraph, unless the breaker says skip;
5. assemble seed ⊕ subgraph ⊕ session and `runTurn` — the synchronous engine, byte-identical
   to the library's;
6. `persistMemory` — the turn's learned rows land as session rows through the same backend
   (delta puts, soft-delete rules, cap enforcement, all MB §3.8);
7. respond. `narration` is the same trace `--narrate` emits; `factsTouched` keeps its
   published shape (MB constitution).

Retrieved corpus facts are a per-turn read-only overlay. They are never written to the session
partition; only what the turn *learns* persists. A corpus fact cited in an answer cites its
band provenance.

**Turn rate and spend.** Turns cost real CPU, so the limits sit below the row-write limits:
30 turns per session per hour (an atomic counter row beside MB's mutation counter, own TTL),
the same per-IP WAF rule at the edge (MB §3.9), and the turn Lambda's own reserved concurrency
(deployment parameter, default 5) separate from the row service's 10. Lambda timeout 10 s; the
retrieval wall budget (§3.4) keeps the turn's storage phase far inside it.

### 3.2 The corpus supplement: shared read-only partitions

Corpora too large to bundle live in the same table under band partitions:

- pk `corpus:<band>` (e.g. `corpus:wordnet-complete`, `corpus:conceptnet-full`,
  `corpus:wikidata-slice`, `corpus:simplewiki-derived`); sk `fact#<term>#<rowKey>`, the same
  layout as session fact rows (MB §3.3), so a term read is one `begins_with` Query;
- rows are MB §3.2 wire rows: content-addressed `rowKey`, `rowClass: "fact"`, canonical
  `term`, `json` ≤ 4 KB, **no `expiresAt`** — bands never expire;
- one manifest row per band: sk `manifest`, json `{band, version, rowCount, loadedAt,
  sourceDigest}` — the loader's idempotency check and the citation's version;
- outside the global session counter (MB §3.8): the cap protects against anonymous writes, and
  bands are written only by the credentialed loader;
- unreachable through the public API by construction: every service route validates the
  session key as a UUIDv4, and `corpus:<band>` is not one. No new validation is needed; the
  existing check is the wall.

Band fact provenance is stamped at load time from the band's source, in the existing corpus
grammar (`corpus:<name>`), with the manifest version available to citations. No new provenance
grammar.

### 3.3 The loader: a CLI verb pair

`tmct corpus load <band> [--table <name>] [--source <path>] [--dry-run]` and
`tmct corpus clear <band> [--table <name>]`, following `cli-verbs.mjs`'s pattern (one
`CLI_VERBS` entry, `bin/tmct.mjs` dispatch, help text in the two-column layout).

- **Load**: stream the band source (a jsonl of wire-row-shaped facts, produced by per-band
  build scripts out of this plan's scope for existing corpora already in-tree), write with
  `BatchWriteItem` in 25s, bounded concurrency, backoff on throttle. Content-addressed keys
  make re-runs idempotent overwrites. The manifest row is written last; a run that dies
  mid-load leaves individually valid rows and a stale manifest, and the re-run completes it.
- **No-op on unchanged**: load computes the source digest first, reads the manifest, and exits
  0 with "unchanged" when digests match — that is what makes the CI post-deploy job cheap to
  run every pipeline.
- **Clear**: a paginated Scan of the band partition and physical `DeleteItem`s, manifest last.
  Physical, unlike the service's soft deletes, because the loader is an operator tool holding
  AWS credentials, on the other side of the trust line from the public API.
- Credentials are ambient (a profile locally, OIDC in CI). The verb never embeds any.

Module paths: `src/adapters/memory/corpus-bands.mjs` (band naming, manifest shape, the term
Query helper `queryBandTerm(client, tableName, band, term)`), `src/services/corpus-loader.mjs`
(load/clear/status over an injected document client — lazy SDK, same discipline as MB §3.10).
Both ship in the library: a consumer hosting this surface loads their own bands with the same
verb.

### 3.4 Retrieve-then-resolve

The fix for MB §17's term-lazy horizon, without the engine surgery. The horizon assumed
resolution might touch anything, forcing async reads inside the folds. But §1's observation is
load-bearing: the engine's reasoning is already bounded by design. A retrieval phase that
mirrors those bounds, run *before* the engine, feeds the unchanged synchronous folds
everything they can reach.

The sequence, in `src/domain/retrieval-plan.mjs` (pure) and
`src/services/subgraph-retrieval.mjs` (executes the plan over a document client):

1. **Term extraction** (pure): the turn text's content terms, folded through `normFactTerm`
   and the lexicon's lemma/plural folds, plus deterministic fuzzy variants — a fixed edit
   distance over the lexicon's own vocabulary with the real-word collision table as the guard,
   no scoring, no ranking, capped per term. Sorted output.
2. **Hop plan** (pure): for each term, a k-hop relation expansion (k fixed at 2, matching the
   engine's two-hop alias chase; a config constant, not a request option) plus the full
   `rdfs:subClassOf` ancestry chain (the ontology is shallow; ancestry is what the one-hop
   inheritance lanes read, and pulling the whole chain costs a few rows per term).
3. **Execution**: `begins_with(sk, "fact#<term>#")` Queries against each configured band
   partition, breadth-first over the hop plan, terms and pages in sorted order, bounded
   concurrency, until done or a budget trips (§3.4.1).
4. **Assembly**: the retrieved rows join `rowsToPayload`'s input beside the bundled seed and
   the session rows (MB §3.4's base-overlay mechanics — the subgraph is a second read-only
   overlay; the diff can never emit it as a write).
5. The engine runs. It cannot tell a retrieved fact from a seed fact; provenance carries the
   difference into citations.

Determinism: steps 1–3 are pure functions of (turn text, corpus state, fixed caps). Sorted
traversal means a budget cut always lands at the same row for the same inputs. The conformance
of this claim is a unit test feeding the same plan twice and demanding identical subgraphs,
and once more with a lowered budget demanding a reproducible prefix.

What this does not cover, honestly: a term that only becomes relevant *mid-resolution*, beyond
k hops from any query term, stays outside the subgraph and reads as an honest miss — exactly
the miss the browser page gives beyond its seed. The engine's own chase depths make this rare
by construction; §6 keeps it as a named sharp edge, and true term-lazy folds remain the
horizon (§7) if measurement ever shows the bounds pinching.

#### 3.4.1 The good-citizen budgets

All fixed constants, one frozen exported object (`RETRIEVAL_BUDGETS` in
`subgraph-retrieval.mjs`), changed only by a code change:

| budget | default | trips into |
| --- | --- | --- |
| fuzzy variants per term | 4 | fewer variants |
| hop depth k | 2 | plan truncation |
| rows per Query page | 200 | pagination |
| total rows | 5,000 | stop, mark bounded |
| total Queries per turn | 40 | stop, mark bounded |
| wall time | 300 ms | stop, mark bounded |
| in-flight Queries | 8 | queueing |

- Exhaustion degrades, never errors: assemble what arrived, set the retrieval-bounded marker
  (§3.6), proceed. A timeout is a smaller subgraph, never a guess.
- Throttle responses get exponential backoff *inside* the wall budget, then degrade. No retry
  storms; a throttled Query also feeds the breaker's failure count (§3.5).
- Retrieval reads are metered per session beside the turn counter, so one chatty session
  cannot monopolize table throughput.
- Every turn's narration carries the retrieval metrics — subgraph size, Queries issued, which
  budget tripped — which is the tuning instrument for k and the caps.

### 3.5 The DynamoDB-backed circuit breaker

Lambdas share nothing, so the breaker state is one item in MB's reserved `_meta` partition
(sk `breaker#corpus`): `{state, failures, windowStart, openedAt}`.

```
closed     turn reads the item (piggybacked beside the cap pre-check read);
           retrieval runs. A SYSTEMIC failure — throttle, 5xx, timeout;
           never an empty result — atomically ADDs failures in the current
           window (window length fixed, 60 s; a new window resets the count).
           failures ≥ threshold (fixed, 5) → conditional write
           {state: open, openedAt: now}. One Lambda wins; the rest read the
           new state.

open       inside cooldown (fixed, 60 s from openedAt): the turn SKIPS corpus
           retrieval entirely and runs seed ⊕ session — today's shipped
           product, fully working — and the answer carries the
           supplement-absent marker (§3.6). After cooldown: conditional
           write {state: half-open}; exactly the winner proceeds to probe.

half-open  the winning turn retrieves with a single bounded probe Query
           before committing to the full plan. Success → conditional
           {state: closed, failures: 0}. Failure → conditional
           {state: open, openedAt: now}. Losers of the transition race read
           half-open and skip, as in open.
```

The breaker protects three things: the table (no hammering through a throttle storm), the
turn's latency (fail fast instead of forty timing-out Queries), and the bill. The Lambda clock
feeds windows and cooldowns only — operational mode selection, never answer content. The
honesty nuance, stated plainly: breaker state means the same question can answer with or
without the supplement at different moments. Both modes are honest, and the answer's marker
says which one served it. Skip mode is not a stub; it is the current product.

### 3.6 The enumeration honesty marker

The constitutional requirement retrieval creates. A bounded subgraph either grounds a
point-answer or misses honestly — nothing changes for is-a, property, proof, or does-have
answers. Enumeration is different: "list animals" over a corpus band reached through a bounded
retrieval is structurally partial, and reporting the subgraph's contents as the store's would
be a silent completeness claim.

The mechanism:

- the assembled payload carries `retrieval: { mode, bounded }` — `mode` is `"supplemented"`
  (corpus retrieval ran) or `"seed-session"` (breaker skip, or no bands configured);
  `bounded` is true when any §3.4.1 budget tripped;
- enumeration-class lanes (list, count, what-else — the lanes whose answers assert a set's
  extent) append their bound in the answer when `mode: "supplemented"`: "counted among what
  this query pulled in from the corpus" — and when `bounded` is also true, the stronger "the
  corpus may hold more than this query pulled in". The phrasing is a template, written once;
- every answer in `mode: "seed-session"` while bands are configured carries one trailing
  source-note line: "answered without the corpus supplement" — the breaker marker;
- point-answer lanes change nothing.

This is an answer-shape change through `chat.mjs`'s enumeration lanes and templates, which is
why its phase (T4) is Opus and carries corpus-row pins: the marked shapes, the unmarked
point-answers, and a lane-inventory test asserting every enumeration-class lane reads the flag
(the guard against a lane silently claiming completeness — §6.4).

### 3.7 Cold start and the seed band

The xl band set is 63,470 facts, ~93.5 MB raw JSON; parsing it is a multi-second cold start
and the reason the corpus-in-Dynamo path exists. The turn tier bundles the tier-1 seed (the
same bands `tmct init` seeds by default) and nothing larger; everything xl-sized and beyond
lives in corpus bands behind retrieval. T3's acceptance measures the cold boot with the
bundled band and publishes the number in the plan's build marker; provisioned concurrency is
the named fallback lever if that measurement disappoints, priced, and not the plan.

### 3.8 What this surface inherits without change

The session model, key validation, implicit creation, path-scoped mutation, caps, soft
deletes, TTL, global cap and counter, error taxonomy, abuse table, kill switch, deploy path,
and local-double testing pattern are all MB §3.8–§3.10 and MB §4, unchanged. The turn endpoint
adds exactly two rows to that abuse surface: turn-rate flooding (the 30/hour counter and the
turn Lambda's own reserved concurrency answer it) and retrieval read amplification (the
§3.4.1 budgets and per-session metering answer it). Everything else is already enumerated
there.

---

## 4. Phases

## T0 — corpus bands and the loader

**Owns** `src/adapters/memory/corpus-bands.mjs` (new), `src/services/corpus-loader.mjs` (new),
`src/domain/cli-verbs.mjs` (the `corpus` entry), `bin/tmct.mjs` (dispatch),
`test/adapters/corpus-bands.test.mjs`, `test/services/corpus-loader.test.mjs` (new; the loader
over the fake document client from MB M4, including idempotent re-run, digest no-op,
mid-load-death recovery, clear). **Sonnet.**

Acceptance: `node --test test/adapters/corpus-bands.test.mjs test/services/corpus-loader.test.mjs`;
`node --test test/adapters/cli-verbs.test.mjs`; `npm run test:fast`; CLI smoke.

## T1 — the retrieval module

**Owns** `src/domain/retrieval-plan.mjs` (new, pure), `src/services/subgraph-retrieval.mjs`
(new), `test/domain/retrieval-plan.test.mjs`, `test/services/subgraph-retrieval.test.mjs`
(new; determinism twice-same, budget-cut prefix reproducibility, every budget's trip path,
backoff-inside-budget, the metrics record). **Opus** — it composes the lexicon fold, the
collision table, and the hop plan, and its determinism claims carry the surface.

Acceptance: the two test files; `npm run test:fast`.

## T2 — the breaker

**Owns** `src/adapters/memory/dynamo-circuit-breaker.mjs` (new; over an injected document
client, `_meta` item, the §3.5 machine), `test/adapters/dynamo-circuit-breaker.test.mjs`
(new; the full state machine over the fake client, the conditional-write races — two
contenders, one winner — window roll, systemic-vs-empty classification). **Sonnet**, parallel
with T1.

Acceptance: the test file; `npm run test:fast`.

## T3 — the turn handler

**Owns** `server/turn-service/handler.mjs`, `server/turn-service/local.mjs` (new; the same
double pattern as MB M5 — real handler on `node:http`, in-memory backend, a fixture band
loaded through the real loader), `npm run build:turn-service`,
`test/services/turn-handler.test.mjs` (new; the §3.1 sequence, rate counter, breaker-skip
path, 413/429/507 semantics, fresh-backend-per-invocation, cold-boot measurement published in
the build marker). **Sonnet**, after T0–T2 and MB M5.

Acceptance: the test file; `npm run test:fast`; the measured boot number recorded.

## T4 — the enumeration marker

**Owns** `src/services/chat.mjs` (the enumeration lanes and templates), the corpus rows
pinning marked and unmarked shapes, `test/adapters/chat-retrieval-marker.test.mjs` (new,
including the lane-inventory guard). **Opus**, serialized on `chat.mjs`.

Acceptance: the test file; the corpus runners for the new rows; `node --test
test/tools/ask.test.mjs`; `npm run test:fast`; ask bundle rebuilt.

## T5 — end to end against the double

**Owns** `test-e2e/turn-service.test.mjs` (new): a real HTTP conversation against
`local.mjs` with a loaded fixture band — teach, ask, a corpus-grounded answer citing band
provenance, an enumeration answer carrying the marker, a breaker-forced skip turn carrying
the absent-marker, learned rows persisted and read back on a second "invocation", stop &
forget through the row service's purge. **Sonnet**, after T3–T4. No network, no AWS.

Acceptance: the e2e file; `npm run test:fast`.

## T6 — infra and the CI load job

**Owns** the turn Lambda constructs in `infra/` (function, reserved concurrency parameter,
the `/api/sessions/*/turn` behavior wiring), the `corpus:load` post-deploy CI job
(`.gitlab-ci.yml`: runs `tmct corpus load` per configured band over OIDC; the digest no-op
makes it cheap every pipeline), and the post-deploy smoke's turn probe (one live turn under a
fresh UUID). **Sonnet**, after T3.

Acceptance: `cdk synth` clean; the CI lint job; smoke script dry-run against the double.

## T7 — docs and framing

**Owns** `docs/adapter-contract.md` (the turn surface section), `README.md` (one consumer
paragraph: host it yourself, load your bands, the demo is our deployment), the site copy line
MB M8 already owns extended with the consumer-hosted framing. **Haiku**, after T5. Docs gate
only.

## T8 — consumer handoff

**Owns** the bedrock-meter inbox note: the endpoint, the corpus-band loader, the retrieval
budgets, the breaker, what their embedded path can adopt (the retrieval module and bands work
identically over their table), and what stays theirs. **Haiku**, last.

---

## 5. Concurrency and model tiers

| phase | files | tier | after | parallel with |
| --- | --- | --- | --- | --- |
| T0 bands + loader | corpus-bands, corpus-loader, cli-verbs | Sonnet | MB M4 | T1, T2 |
| T1 retrieval | retrieval-plan, subgraph-retrieval | Opus | MB M0 | T0, T2 |
| T2 breaker | dynamo-circuit-breaker | Sonnet | MB M4 | T0, T1 |
| T3 turn handler | server/turn-service | Sonnet | T0–T2, MB M5 | T4 |
| T4 enumeration marker | chat.mjs, corpus rows | Opus | T1 | T3 |
| T5 e2e | turn-service e2e | Sonnet | T3, T4 | T6 |
| T6 infra + CI load | infra/, .gitlab-ci.yml | Sonnet | T3 | T5 |
| T7 docs | contract doc, README, site copy | Haiku | T5 | T8 prep |
| T8 handoff | bedrock-meter inbox | Haiku | all | — |

`chat.mjs` serializes T4 against anything else touching it; the MB plan's own phases hold
their table. The full suite runs at the coordinator's push moments; each phase's acceptance
list is its blast radius.

---

## 6. Known sharp edges

1. **Beyond-k discoveries.** A chain that would need a term more than k hops from any query
   term misses, honestly. Mirrored bounds make it rare; the retrieval metrics in every
   narration are the evidence base for ever raising k, and raising k is a one-constant change
   priced in Queries.
2. **Corpus staleness between loads.** A band is as fresh as its last `corpus load`; answers
   cite the band, and the manifest carries version and load time. Accepted: bands are
   reference corpora, not news.
3. **Breaker flap.** A partial brownout can oscillate open/half-open/open. The cooldown and
   threshold are fixed constants tuned once from the metrics; flap's worst case is
   alternating honest modes, both marked.
4. **Marker coverage.** An enumeration-class lane that never reads the retrieval flag would
   silently claim completeness. T4's lane-inventory test is the guard; a new enumeration lane
   fails it until it reads the flag.
5. **Retrieval cost per turn.** Up to 40 Queries inside 300 ms, bounded and metered, but real:
   the per-session metering and the turn rate cap bound the aggregate, and the narration
   metrics price every turn.
6. **Hot band partitions.** Popular terms concentrate reads on one `corpus:<band>` pk.
   At this surface's turn rates the per-partition throughput ceiling is far away; if a load
   test ever finds it, band sharding by term prefix (`corpus:<band>#a`…) is the lever, a
   loader-and-helper change with no service or engine impact.
7. **Fuzzy false friends.** A variant within edit distance that means something else pulls
   irrelevant rows. The collision table already exists to guard exactly this class; variants
   stay capped, deterministic, and unranked, so the worst case is wasted rows inside the
   budget, never a wrong answer — grounding still has to succeed on the engine's own terms.

---

## 7. Not in this plan

- **True term-lazy folds.** If measurement ever shows the retrieval bounds pinching — point
  misses beyond k at meaningful rates, or enumeration bounds users refuse — the folds going
  async over `readRowsByTerm` remains the named engine work, its own plan. The sk layout
  (MB §3.3) still needs no migration for it; nothing here forecloses it.
- **Band build pipelines.** Producing the jsonl for WordNet-complete, full ConceptNet, or a
  wikidata slice from their upstream dumps is per-band tooling with its own licensing
  diligence, planned per band when a band is wanted. T0 ships the loader and a fixture band;
  it does not ship the corpora.
- **The browser page calling the turn endpoint.** The browser demo keeps its in-page engine —
  that is the product claim. A thin-client page is a posture change this plan explicitly does
  not make.
- **Any change to MB's row service semantics.** One plan owns that surface; this one consumes
  it.
