# STATUS — tmct's latest measured capability, one page

What tmct's benchmark suite last proved, what the last full CI pipeline run actually exercised,
where every open design doc stands, and how `README.md`'s own claims hold up against the tree.
This page is generated from the reports committed in `reports/`, the root `PLAN_*.md` docs,
`README.md`, and the most recent pipeline on `main` — see `SKILL_REFRESH_STATUS.md` for the
refresh recipe. It does not re-run anything itself.

**Measured tree: 3.0.3 for eight of nine axes; CONVERSATION re-measured at 3.0.10. Repo now at
3.0.10 (rolling to a minor release).** Most numbers below are the 3.0.3 sweep's, not a live
reading — CEFR_ENGLISH's product path was re-verified byte-identical this cycle (see
`reports/BENCHMARK_SUMMARY_3.0.10.md`) but not re-judged in full. Treat every non-CONVERSATION
number here as "true as of 3.0.3", not "true today", until the next full sweep lands.

## Last CI pipeline: every consumer surface exercised, all green

[Pipeline #2707015398](https://gitlab.com/polycode-projects/the-mechanical-code-talker/-/pipelines/2707015398),
commit `57050579`, 2026-07-26, **29/29 jobs green** in ~13 minutes wall-clock. This is the first
pipeline to actually run `deploy:website`, `e2e:deployed`, and `smoke:post-deploy` for real
against the live AWS-hosted edge (`https://tmct.polycode.co.uk/`, confirmed serving HTTP 200) —
the GitLab-Pages-to-AWS cutover `PLAN_AWS.md` describes, executed live this session.

| job | what it exercises at the consumer surface |
|---|---|
| `e2e-web-index` | `index.html` (home page), demo-history/demo-templates replay, service-worker install |
| `e2e-web-chat` | `chat.html`: fullscreen, persistence, export, digest, boot budget |
| `e2e-web-chat-research` | `chat.html`'s research toggle and live Wikipedia supplement |
| `e2e-web-research` | `research.html` |
| `e2e-web-ingest` | `ingest.html` |
| `e2e-web-sprites` | `sprites.html` |
| `e2e-web-ledger` | `ledger.html`, teach mode, research dock, query-only viz |
| `e2e-web-code` | `code.html` |
| `e2e-web-spider-fly` | `spider-fly.html` |
| `e2e-web-plan` | `plan.html` |
| `e2e-web-adventure` | `adventure.html`, edit mode |
| `e2e-web-screenshot-sweep` | visual regression across every page, every viewport |
| `e2e-tui` | the terminal UI surface |
| `e2e-cli` | the `tmct` CLI: init, import, chat, viz, plan, memory, server |
| `unit`, `unit:fast`, `unit:smoke`, `unit:slow` | internal correctness underneath every surface above (4,458 tests total as of this tree) |
| `pack:contents` | what `npm install` actually receives — the published file list, diffed against the committed manifest |
| `license:deps` | the dependency tree a consumer inherits stays inside the licence allowlist |
| `publish:npm` | the real `npm publish` gate — version-checked, provenance-signed |
| `deploy:website` | the AWS deploy (CloudFront + S3) — the live public site at tmct.polycode.co.uk |
| `pages` | the old GitLab Pages origin — now a redirect stub to the AWS edge, kept for old deep links and previously-published npm versions' baked-in URLs |
| `e2e:deployed` | read-only page checks run against the live deployed site, not a local build |
| `smoke:post-deploy` | a post-deploy check against the **live** deployed site and the **live** npm registry, not a local approximation |
| `links:check`, `pii:lint`, `semgrep-sast`, `secret_detection` | repo hygiene and security scanning — not consumer-facing directly, but gate what ships |

`e2e:heavy` (a full `demo:build`, an uncapped ConceptNet seed, an export/import round trip) did
not run on this push — it's gated on paths this push didn't touch, plus a nightly schedule.
`pages` still runs alongside `deploy:website` too (it now publishes a redirect stub instead of
the real site, for old deep links and previously-published npm versions' baked-in URLs) —
retiring it entirely is one of `PLAN_AWS.md`'s two remaining burn-in follow-ups (`NEXT.md`).

## The nine axes, at a glance

Source: `reports/BENCHMARK_SUMMARY_3.0.10.md` — a targeted refresh (CONVERSATION re-measured;
the other eight axes carried from `reports/BENCHMARK_SUMMARY_3.0.3.md` unchanged).

| axis | result | vs baseline | gate / ceiling | source |
|---|---|---|---|---|
| AGENT | 68/68 at the goal ceiling (TOOL-8), 0% hallucination on all four drivers | byte-identical to 2.11.0 | resolver floor tops at TOOL-6 | `reports/BENCHMARK_AGENT_3.0.3.md` |
| INFERENCE | kernel 100/100, chat 379/379, 0% fabrication, all bands pass | byte-identical to 2.11.0 across 577 commits | INF-7/INF-8 ceiling-graded (56/379) | `reports/BENCHMARK_INFERENCE_3.0.3.md` |
| CEFR_ENGLISH | full 1,075-case pool judged: mean 1.773/2, 1068/1075 tier-1, 60 hard fails, 0 voids | byte-identical tier-1 replay + judged mean reconfirmed at 3.0.10 (0 tier-1 regressions, 1 case's wording changed and re-judged identically) | C1/C2 carry 36 of 60 hard fails | `reports/BENCHMARK_CEFR_ENGLISH_3.0.3.md` |
| **CONVERSATION** | **45/50 turns FLOW; all 4 of 3.0.3's routed dead-ends confirmed fixed live; 2 new dead-ends routed** | **ladder advances FLOW-3 → gates at FLOW-6** | **identity-phrasing gap, "what does X do" adverb-insertion gap** | **`reports/BENCHMARK_CONVERSATION_3.0.10.md`** |
| CODE_INDEX (founding) | IDX-0..9 all pass; conformance 180/180; 0 fabrication on 21 check surfaces | — | IDX-10 has no cases yet; C# reads unmeasured | `reports/BENCHMARK_CODE_INDEX_3.0.3.md` |
| CODE_SYNTHESIS (founding) | SYN-0 passes its gate: 4/4, 100% verified completion, 0 false-pass, byte-deterministic | — | SYN-1..8 named markers; SYN-3's rename operator is next | `reports/BENCHMARK_CODE_SYNTHESIS_3.0.3.md` |
| INGEST (founding) | ING-0..5 at 100% recall/precision; precision 100% on every rung | — | gates at ING-6 (38% recall vs 50% floor — the ordinal/temporal horizon); judged headroom: ING-8 2.0/2, ING-9 1.5/2 | `reports/BENCHMARK_INGEST_3.0.3.md` |
| RESEARCH (founding) | RES-0/RES-1 pass; zero invented traversal | — | gates at RES-2 (ordering 67% vs 80% floor — no relevance ranking yet) | `reports/BENCHMARK_RESEARCH_3.0.3.md` |
| AGI_SCALES | all eight entry rungs held; three scales moved (temporal-causal, stability×plasticity, loop closure) | 2.11.10 assessment | 2/8 scales scalar via the aggregator | `reports/BENCHMARK_AGI_3.0.3.md` |

**Headline: zero fabrication on every axis.** No harness, judge, or playtest — this cycle or
3.0.3's — found a single invented fact.

## The gates, ranked by leverage

From `reports/BENCHMARK_SUMMARY_3.0.10.md`'s own ranking — the fixes with the widest downstream
unlock, most leveraged first:

1. **RES-2 ordering (67% vs 80%)** — one relevance-ordering pass in `src/services/research.mjs`
   un-gates RES-3..6, which already hold receipts.
2. **ING-6 ordinal/temporal threading (38% vs 50%)** — the "First … Then …" slice; lifting it
   un-gates ING-7 and promotes the strong judged headroom.
3. **CONVERSATION's two FLOW-6 gates** — closed-set additions (colloquial identity-question
   phrasing, "what does X do" adverb-insertion tolerance); FLOW-3's two gates from 3.0.3 are
   closed.
4. **SYN-3's rename operator** — the first real transformation for the synthesis ladder.

All four are tracked as open items in `NEXT.md` with their owning plan docs.

## The design docs: what's delivered, what's next, what's a research horizon

Every `PLAN_*.md` at the repo root, one line of goal, what's shipped, what remains within known
engineering (**design horizon** — a plan exists or is straightforward to write), and what
remains genuinely open (**research horizon** — no settled approach exists yet; named, not
claimed impossible, per this project's own "no capability walls" discipline). Delivered plans
retire to `archive/`; everything below is still live.

| plan | goal | delivered | design horizon (known engineering) | research horizon (open problem) |
|---|---|---|---|---|
| `PLAN_DISCOURSE_AND_RECOGNITION.md` | two bounded, typed, refusable records: cross-turn discourse referents, and agent goal recognition | Part A (discourse) slices 1–5 all built — referents register, bind, tie-refuse, and a plural temporal comparison composes over a set | Part B (goal recognition: fitting a trace to a declared goal by operator containment, an N+1 "reject" class) is still design | — |
| `PLAN_BENCHMARK_MECHANISATION.md` | author judge intelligence once, replay benchmark runs mechanically thereafter | all seven levers landed: 1 (verdict cache, full 1,075-case CEFR pool seeded), 2 (tier-promotion matchers, 440 promoted), 3 (rubric compilation + calibration-gated down-tiering, 52-case calibration set graded both tiers), 4 (ingestbench's ING-7 paraphrase-equivalence checker wired into chatbench tier-1), 6 (execution speed), 7 (AGI-scales aggregation) | ING-8's own corpus-authored equivalence checker (research horizon, no settled approach yet) | — |
| `PLAN_CODE_PLANNING.md` | planning over code states: search + verification over closed operator catalogues, never an LLM guessing code | Track 1 (`test-benchmarks/synthbench/`) shipped; Track 5 §3.1–3.3 (state, operator catalogue, planner) shipped as `src/domain/codeplan/`; §3.6's re-index dependency shipped | §2.1's stage-1 build (read-only rule admission), Track 5 §3.4–3.5 (adaptor, verification tiers), §3.6's re-index wiring into the plan-act-verify loop, §3.7's two-step refactor milestone | — |
| `PLAN_CONSISTENCY_CHECK.md` | tmct as a consistency-checking service: an LLM tool loop proposes a claim in tmct's grammar, tmct returns a verdict (including an honest "unknown", never a silent pass) and the canonical form | approved in outline by the operator | the whole build — grammar-gated claim intake, the four-verdict check, one-shot semantics | — |
| `PLAN_PARAPHRASE_VERIFICATION.md` | a verified paraphrase shown alongside a literal answer, never instead of it, checked against the graph rather than assumed | the isa-family narrow slice (`paraphraseVerifiedSubClass`, closure-backed) already ships in the teach confirmation | the general `verifyParaphrase()`: this doc's own finding is that most paraphrase shapes need triple-equality checking, not `syllogise.mjs` entailment — only class-swap-along-⊑ paraphrases fit the closure kernels, and that generator doesn't exist yet either | — |
| `PLAN_EMBEDDINGS.md` | semantic-similarity search over the code graph | a working, dependency-free embedder (safetensors reader, WordPiece tokenizer, mean-pool + L2-normalise) shipped once, then was deleted at 2.1.0 as dead code — nothing called it | rebuilding it, if a real caller ever wants it — the architecture (a duck-typed `opts.embedder`, domain/adapter split) is proven and recorded | — |
| `PLAN_MUD.md` | persistent, shared tmct worlds over a `server:` memory backend — multiplayer without a shared host to log into | design only; six rounds of framing converged on a per-server DynamoDB-shaped backend with an anonymous-tier TTL and IAM Identity Center for private servers; exercised against `PLAN_OUDEZIJD.md`'s needs and holds up with 4 small additive extensions, no redesign | the actual build: the storage backend, the TTL/throttle policy, the CI-seeded durable lexicon, plus the 4 `PLAN_OUDEZIJD.md` extensions (a write-time durable-content rule, a place/timeSlot GSI, a `supersedes` attribute) once that plan is picked up | — |
| `PLAN_FILLER_AND_COUNTERFACTUALS.md` | two passes: parsing through sentence-initial filler clauses via closed-set templates; planner counterfactuals | neither started | the filler-clause widening (a closed discourse-marker inventory, strip-and-retry accepted only on double match) is scoped design work | the planner-counterfactuals half is less scoped in this doc than the filler-clause half; treat it as needing its own design pass before estimating further |
| `PLAN_NLU_BENCHMARKS.md` | score tmct against two third-party NLU benchmarks (CLINC150, HWU64) for outsider-reproducible credibility | nothing built; the as-is estimate shows tmct's capability universe doesn't cover either benchmark's domains (banking, travel, weather, …) yet | building the domain/intent coverage those benchmarks require, and the scoring adapter itself, is closed-set content-authoring work this project already does elsewhere | a fair scoring protocol for an *abstaining* system against benchmarks built for forced-choice classifiers is a real methodological question this doc doesn't fully resolve |
| `PLAN_SYLLOGIST_EL_DL.md` | inference beyond OWL 2 RL: an EL classifier (saturation-based TBox classification), then a DL tableau prover (targeting ALC, growing toward SHOIQ) | nothing built; explicitly sequenced after two cheaper RL-shaped uplifts | the EL tier extends the current pure-kernel architecture with a different, but well-understood, algorithm | the DL tier's tableau calculus is well-studied in isolation, but this doc names the actual gap plainly: the literature is silent on combining tableau reasoning with a system that also has to carry tmct's trust/provenance/budget guards — that combination has no settled engineering yet |
| `PLAN_OUDEZIJD.md` | a temporally-grounded, persistent historical-city adventure (Amsterdam is the working example), to be built as a separate standalone repo/app consuming tmct as a library — not a tmct package feature — with its own AWS account and public website; a player's own presence is durable and replayable to other players as an NPC; players themselves are generated as statistically plausible for whatever place/time they arrive at | nothing built; depends on `PLAN_MUD.md`'s persistence shipping first; planned build order is `PLAN_MUD.md` → tune ingest on real Amsterdam documents (including Dutch-language sources) → a standalone LLM layer for NPC dialogue phrasing and historic-image augmentation, added once stable (downstream rendering only, outside tmct's own no-LLM product path since it's a separate repo) | 13 of 20 named pieces are known engineering with real prior art in this codebase: an OWL-Time-based temporal ontology, attested/constructed/player-authored provenance tagging, closed-catalogue probabilistic content (mirrors `synthbench/phrasing/`), per-class object respawn, NPC schedule catch-up, cross-player NPC-replay of a player's own recorded history, Wikipedia image/link fetch, Dutch-language ingestion, a durable non-TTL world tier extending a pattern `PLAN_MUD.md` already accepts for seed data | how long a surveyed fact should be assumed to persist before it's a guess, not an interpolation, in real tension with tmct's "grounded or an honest miss" promise; real historical Amsterdam data acquisition and licensing; census category-frequency data for weighted sampling; a separate, coarser data regime for eras before recordkeeping (e.g. 1000 BC); abuse mitigation for cross-player write-back into another player's own history |

## README audit: claims vs. reality

What `README.md` claims, cross-checked against the tree. Covers every `##` section's headline
claim (17 sections); not a line-by-line audit of every sentence. "Consumer surface" names where a
real user actually meets the capability (CLI flag, web page, published npm export); "tested"
names the tier.

| README claim | implemented | consumer surface | tested |
|---|---|---|---|
| Teach a fact in plain English, mint a graph node | yes (`src/services/chat.mjs` teach lane) | CLI `tmct chat`, web `chat.html` | unit (`test/chatflow-*.test.mjs`), corpus lanes, e2e `pages-chat-*` |
| Ask a question, get a grounded answer or an honest miss | yes (`src/domain/ask.mjs`) | CLI, `chat.html`, `tmct_ask` tool | unit (`test/domain/*.test.mjs`), corpus lanes |
| Multi-hop inference by rule (grandparent-from-parent-of-parent) | yes (`src/domain/syllogise.mjs`) | CLI, web chat | corpus `inference` lane, `test/bench/infbench.test.mjs` |
| Tolerant paraphrase parsing (drop determiners, contractions, passives, clefts) | yes (`src/domain/interpret/`) | CLI, web chat | corpus `grammar`/`templates` lanes |
| Guided suggestions / `/help` | yes | CLI `/help` | not directly e2e-pinned as its own suite; covered incidentally in CLI smoke |
| Grounded, sourced answers with a digest lead | yes (`src/domain/digest*`) | `chat.html`, `research.html`, `ledger.html` dock | e2e `pages-chat-digest`, `pages-ledger*` |
| Live Wikipedia as an opt-in cited tier (`/wiki on`) | yes | CLI flag, `chat.html` toggle | e2e `pages-chat-live-toggle` |
| Planning across the graph (Towers-of-Hanoi style) | yes (`src/domain/router/`) | CLI `tmct plan`, `plan.html` | e2e `pages-plan`, `plan-cli` |
| Teach a game, then plan against it | yes | CLI, web | corpus `games/*` lanes |
| Play a game (adventure, spider-and-fly) | yes | CLI `--render`, `adventure.html`, `spider-fly.html` | e2e `pages-adventure*`, `pages-spider-fly` |
| Learning on a miss (teach offered after a failed lookup) | yes | CLI, web chat | corpus lanes; noted in `NEXT.md`'s own merge-hazard history |
| Persistent memory across sessions, multiple backends | yes (`src/adapters/memory/`) | CLI `tmct memory`, `--repo` persistence | unit `test/adapters/memory-*`, e2e `pages-chat-persistence` |
| Install via npm / npx, CLI usage | yes | `bin/tmct.mjs` | e2e `cli-smoke`, `init*` |
| The tool surface (`tmct_ask`, `tmct_context`, `tmct_snippet`, `tmct_ingest`, …) | yes (`src/tools/`) | published npm exports, HTTP server | unit `test/tools/*` (19 files) |
| The repository interface (arbitrary-repo indexing contract) | yes (`src/adapters/repository-interface.mjs`) | published npm export `./repository-interface` | `docs/repository-interface.md` + its schema, estate guards |
| Measuring it (benchmark claims) | yes, but the inline table is stale (2.7.12) | this page (`STATUS.md`) is now the live pointer | see the axes table above |
| Provenance / standards / licensing | narrative and legal, not testable capability claims | — | — |

## What's shipped but not in README

Found by checking the reverse direction — real, tested, deployed capability the README's
narrative doesn't name. Not an exhaustive sweep; two concrete, verified findings:

- **`research.html`** — a tenth deployed page (`reports/PAGE_WEIGHTS.md` lists it; e2e
  `pages-research` and `pages-chat-research` exercise it), but README's live-demo paragraph
  names only eight pages beyond the landing page and doesn't mention it by name or describe a
  standalone research-grounding surface.
- **Cross-turn pronoun/anaphora binding** (`it`/`that`/`those` resolving to a prior turn's
  referent, refusing honestly on a genuine same-turn tie) — all of
  `PLAN_DISCOURSE_AND_RECOGNITION.md` Part A is shipped and corpus-tested
  (`test/corpus/games/compositional.jsonl`), but README's capability narrative never mentions
  follow-up/context-carrying questions at all.

## Site weight

Source: `reports/PAGE_WEIGHTS.md` — see that file for its own version stamp and per-page
breakdown. Not duplicated here; refresh it via `SKILL_PAGE_WEIGHTS.md` when the deployed site
changes materially.

## Methodology pins

Judge model (CEFR, CONVERSATION, INGEST ING-8/9): `claude-haiku-4-5-20251001`, prompts
`judge-prompt-v2` / `ingest-judge-v1`, N=2. Product path: no model call anywhere; every
deterministic axis replayed byte-identically. The judge is offline-eval tooling only, never in
the shipped product — see `CLAUDE.md`'s project section.

## Refreshing this page

Run `SKILL_REFRESH_STATUS.md` after a new benchmark sweep lands (a new or updated
`reports/BENCHMARK_*.md`), after a new pipeline resolves on `main`, or when this page's
"measured tree" version falls materially behind `package.json`'s current version. The skill does
not run benchmarks itself, and does not trigger a pipeline — it reads whatever reports and
pipeline results already exist and resynthesizes this page from them.
