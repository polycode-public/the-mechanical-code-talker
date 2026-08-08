# STATUS — tmct's latest measured capability, one page

What tmct's benchmark reports last proved, what the last full CI pipeline actually exercised,
where every open design doc stands, and how `README.md`'s own claims hold up against the tree.
This page is generated from the reports committed in `reports/`, the root `PLAN_*.md` docs,
`README.md`, and the most recent pipeline on `main` — see the `refresh-status` skill
(`.claude/skills/refresh-status/SKILL.md`) for the refresh recipe. It does not re-run anything itself.

**Measured tree: 3.0.3. Repo now at 5.0.25.** On 2026-08-08 `reports/` was cut to the two files
a living skill regenerates (`4f9e8d52`): the CEFR English report and the page-weights report.
The other twenty report docs — every other axis ever measured (AGENT, AGI, CODE_INDEX,
CODE_SYNTHESIS, CONVERSATION, INFERENCE, INGEST, RESEARCH, the summaries, the playtests) — are
historical record in `archive/`, at the versions they name. The one live benchmark number below
predates over 200 `feat` commits, including work aimed squarely at what it measures
(filler-clause stripping, the discourse record, quantified locative teach, plan
counterfactuals). Treat it as "true as of 3.0.3", not "true today", until a re-judge lands —
the delta-judging cache seeded at 3.0.3 (`test-benchmarks/chatbench/verdict-cache.json`) exists
to make that re-judge cheap.

## Last CI pipeline: every consumer surface exercised, all green

[Pipeline #2743964157](https://gitlab.com/polycode-projects/the-mechanical-code-talker/-/pipelines/2743964157),
sha `ffbb757b`, 2026-08-08, **26/26 jobs green** in 22m 29s wall-clock — the fullest job set CI
defines, because this push's diff (the README capability fixes plus a build-script comment)
matched `e2e:heavy`'s path rules, so the heavy tier (a full `demo:build`, an uncapped ConceptNet
seed, an export/import round trip) ran alongside everything below. The tree it verified carries
all of 2026-08-08's landed work.

Jobs grouped by stage, mapped to the consumer surface each one exercises:

| stage | jobs | what a consumer gets from it |
|---|---|---|
| gate | `secret_detection`, `detect:playwright-version` | no leaked credential ships; every browser job runs the pinned Playwright |
| test | `unit:smoke`, `unit:fast`, `unit`, `unit:slow`, `pack:contents`, `license:deps` | internal correctness under every surface; the published file list matches the committed manifest; the dependency tree stays inside the licence allowlist |
| e2e (local) | `e2e-web-index`, `e2e-web-local-origin`, `e2e-tui`, `e2e-cli` | the site shell, the sprites/ledger/WebRTC/boot-budget pages against a served build, the TUI, and the full CLI verb surface |
| deploy | `deploy:website`, `publish:npm` | the live AWS/CloudFront site; the version-gated, provenance-signed npm publish |
| verify | `semgrep-sast`, `pii:lint`, `links:check`, `smoke:post-deploy`, `e2e:published-package` | static analysis and repo hygiene; the just-deployed site serves the right version and encoding; the just-published package installs from the real registry and passes the CLI/TUI e2e against the installed binary |
| site-ready | `site:ready` | the CDN provably serves this exact commit before the deployed matrix runs |
| e2e (deployed) | `e2e:deployed:shell`, `e2e:deployed:pages`, `e2e:deployed:pages-timing`, `e2e:deployed:mesh`, `capture:hero` | every shipped page, the timing-sensitive flows, and the three-peer P2P mesh — all against `https://tmct.polycode.co.uk`, not a local build |

Longest job: `e2e:deployed:pages` at 7m 40s. No defined job was absent from this run.

## The benchmark axes

One axis has a live, skill-owned report; the rest are archived history.

| axis | result | measured tree | source |
|---|---|---|---|
| CEFR English (conversation quality) | mean 1.773/2 across the full 1,075-case graded pool; 1068/1075 tier-1 pass; 60 hard fails (36 of them C1/C2); 0 voided samples | 3.0.3 | `reports/BENCHMARK_CEFR_ENGLISH_3.0.3.md`, owning skill `benchmark-cefr-english` |

Every other axis (AGENT, AGI, CODE_INDEX, CODE_SYNTHESIS, CONVERSATION, INFERENCE, INGEST,
RESEARCH) is not currently measured: no report in `reports/`, no owning `benchmark-*` skill.
Their most recent measurements live in `archive/` (`BENCHMARK_INFERENCE_5.0.5.md`,
`BENCHMARK_INGEST_5.0.18.md`, `BENCHMARK_RESEARCH_5.0.18.md`, `BENCHMARK_AGENT_5.0.6.md`, and
earlier). One number from today's tree worth naming because CI regenerates it
deterministically: the agentbench envelope reads `rungReached: TOOL-9` at stamp 5.0.22
(`test-benchmarks/agentbench/envelope.json`), the goal-recognition rung landed 2026-08-08 with
0% hallucination — that is an artifact of the always-run test suite, not a report.

**The one ranked gate from the live report:** C1/C2 carry 36 of the 60 hard fails — the
highest-leverage re-judge target, and the conversational-grammar work landed since 3.0.3
(filler stripping, discourse binding, counterfactuals) is exactly the kind of change the
verdict cache can re-judge cheaply.

## The design docs: what's delivered, what's next, what's a research horizon

Root `PLAN_*.md` docs, enumerated fresh. Delivered plans retire to `archive/` (three did on
2026-08-08: PLAN_HELP, PLAN_FILLER_AND_COUNTERFACTUALS, PLAN_DISCOURSE_AND_RECOGNITION —
delivered in full, TOOL-9 included). A `backlog/` directory holds 14 parked plans — a third
lifecycle state beside root (live) and `archive/` (delivered/retired) — not tabulated here.

| plan | goal | delivered | design horizon (known engineering) | research horizon (open problem) |
|---|---|---|---|---|
| `PLAN_NEWS_FEED.md` | a `news.html` dashboard plus a core news capability: poll contemporary sources on a page timer, ground what's found, rank what doesn't ground, enrich from knowledge-base sources, render a paraphrased fact feed — one library contract behind chat, TUI, CLI, JS import | nothing — DESIGN, written and twice revised 2026-08-08 with browser-verified source probes | the whole arc, phases 0–9, specified to Sonnet-implementable depth; plus its own named deferrals (server-side relay, retraction UX, story-identity dedupe, a structural-thinness ranking signal) | entity linking/disambiguation beyond the shipped Wikidata Q-id short-circuit — the plan names the wikification literature and lands ambiguity on the cited top result until a tier is designed |
| `PLAN_NLU_BENCHMARKS.md` | score tmct against CLINC150 and HWU64 with a deterministic harness-only matcher, and feed confirmed gaps back as levers and corpus rows | nothing committed — a 2026-07-15 spike measured tier-1 arms but its scripts are not in-repo | steps 0–5 (ground truth, baseline, matcher, both runs, failure taxonomy); levers L1–L6; L7/L8 (RL property completion, Horn generalization — L8's stratified negation-as-failure needs its own design pass but the technique is precedented); W1/W2 | the far end of the "why" spectrum: contested historiography, defaults, counterfactuals, competing narratives — the plan names defeasible logic and argumentation frameworks as candidate literatures with no settled deterministic engineering today |
| `PLAN_PUBLISH.md` | publication readiness for the site and repo, then the launch | every engineering task (T1–T7, T10, T11a/b, T15) and all four manual items shipped; the receipts page delivered under `archive/PLAN_RECEIPTS.md` | launch sequencing only — announcement timing (the ELIZA 60th-anniversary cycle), Show HN, direct submissions, conference talks (NodeConf EU CFP closes 2026-09-01) | — |
| `PLAN_SYLLOGIST_EL_DL.md` | beyond the shipped OWL 2 RL kernels: an EL saturation classifier, then an ALC→SHOIQ tableau prover (`/prove`), closing six worked examples that miss today | nothing — DESIGN, rewritten whole-arc 2026-08-08 and revised same day (`987f02bf`: UNA-lite identity, KB module extraction, inverse roles, site surfacing) | the whole arc, phases 0–6, specified to Sonnet-implementable depth; batch materialisation of tableau case-split conclusions is design-horizon with the JTMS groundwork as its named starting point | four named horizons, each in the project's own template (problem, candidate literatures, honest miss until designed): arithmetic/datatypes; n-ary events and time; defaults-and-exceptions *reasoning* (storage already shipped); full FOL/probability/induction |
| `PLAN_COMMON_SENSE_QA.md` | swap the claims stack from OpenBookQA to CommonsenseQA end to end (closed multiple-choice lane, committed fixture and rig against the default seed, claims block, OpenBookQA removal) and climb five measured rungs off zero — deterministic gold-key scoring, no judge model on this axis | nothing — DESIGN, written 2026-08-08 with measured relation frequencies and scratch-projected rung yields recorded as forecasts | the whole arc: the floor (lane + fixture + rig + block + removal) and rungs 1–4 (seed coverage re-cut from the train split, relation routing, inference depth via the closure, wording levers), all Sonnet/Haiku-tiered | the abstained band (rung 5): CommonsenseQA's soft situational-judgment tail has no settled deterministic engineering; the plan keeps it visible as the block's abstained column rather than claiming a path |

## README audit: claims vs. reality

All 20 `##` sections' headline claims walked against the tree (forward direction), plus a
reverse sweep for shipped capability README never mentions. Full evidence trail in the audit
run; the load-bearing rows:

**Forward — claims hold.** Every capability claim checked resolves to a real module, a real
consumer surface, and a named test tier: `runTurn`/CLI smoke (`test/readme/readme.test.mjs`
replays README's own transcripts byte-for-byte), the interpret pipeline, orientation,
completions, the planner and taught games, the three in-chat games, learn-on-miss packs, the
two-layer memory with backends and trust, the 26-tool surface (count re-verified live: 26, 3
hot + 23 cold, no drift), and the versioned repository interface. Two spots could not be pinned
to a test: the architecture diagram has no drift guard against the layer set, and the
false-premise flag has no dedicated test file.

**Reverse direction and the one unbacked claim — found, then fixed the same day.** The audit
surfaced twelve shipped, tested capabilities absent from README's narrative (the typed
discourse record, goal recognition, plan counterfactuals, filler-clause stripping, quantified
locative teach, help.html, the sprites animation model, adventure staff animation, the research
service, the P2P/WebRTC sharing layer, receipts.html/claims.html, and MUDIII's other two
layouts) plus one claim CI does not back (a nightly `npm audit`/OSV-Scanner job that exists
nowhere in `.gitlab-ci.yml`). All twelve now have prose in their natural README sections, the
security section states exactly what runs (SAST and secret detection per pipeline,
provenance-signed publishing, an unscheduled local audit script), and the bibliography's
"no intent vocabulary" line was reworded to stay true beside the shipped goal recognition
(`71ecac4d`). The suspected stale about-page count turned out correct in README — the stale
figure was the build script's own comment, fixed alongside. A follow-up audit of the post-fix
README verified all twelve new passages independently and found one defect in them — the
follow-up-context worked example ran its two turns in an order the discourse record doesn't
support (a count never registers a set) — corrected to the verified list-then-count sequence.

## Site weight

Source: `reports/PAGE_WEIGHTS.md` (revision 3, measured 2026-08-02 at deployed 5.0.5, 23
pages). Stale twice over: it predates the site's reduction to 6 demo pages and the addition of
`help.html`, and it lists pages that no longer ship. Refreshing it is the `page-weights`
skill's job.

## Methodology pins

Judge model (CEFR): `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2, with the
verdict cache enabling delta re-judging. Product path: no model call anywhere; the judge is
offline-eval tooling only, never in the shipped product — see `CLAUDE.md`'s project section.

## Refreshing this page

Run the `refresh-status` skill after a new benchmark sweep lands, after a new pipeline resolves
on `main`, or when this page's "measured tree" version falls materially behind `package.json`'s
current version. The skill does not run benchmarks itself, and does not trigger a pipeline — it
reads whatever reports and pipeline results already exist and resynthesizes this page from them.
