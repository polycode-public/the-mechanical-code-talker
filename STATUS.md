# STATUS — tmct's latest measured capability, one page

What tmct's benchmark reports last proved, what the last full CI pipeline actually exercised,
where every open design doc stands, and how `README.md`'s own claims hold up against the tree.
This page is generated from the reports committed in `reports/`, the root `PLAN_*.md` docs,
`README.md`, and the most recent pipeline on `main` — see the `refresh-status` skill
(`.claude/skills/refresh-status/SKILL.md`) for the refresh recipe. It does not re-run anything itself.

**Repo now at 5.0.32.** Every report doc for an axis measured before 5.0 — AGENT, AGI,
CODE_INDEX, CODE_SYNTHESIS, CONVERSATION, INFERENCE, INGEST, RESEARCH, the summaries, the
playtests — is historical record in `archive/`, at the versions they name.

## Last CI pipeline: every consumer surface exercised, one failure

[Pipeline #2745251534](https://gitlab.com/polycode-projects/the-mechanical-code-talker/-/pipelines/2745251534),
sha `4ebdf416`, 2026-08-09, **25/26 jobs green** in 18m 16s wall-clock — the fullest job set CI
defines, because this push's diff matched `e2e:heavy`'s path rules, so the heavy tier (a full
`demo:build`, an uncapped ConceptNet seed, an export/import round trip) ran alongside everything
below. `deploy:website` and `publish:npm` both succeeded — this is the pipeline behind the site
now serving version 5.0.32.

`e2e-web-local-origin` failed: 8 tests error with `ENOENT: no such file or directory, lstat
'.../public/chat-seed.json'` — a build artifact the news-feed specs in that job expect wasn't
present. Nothing else in the run failed.

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

Longest job: `e2e:deployed:pages` at 9m 31s. No defined job was absent from this run.

## The benchmark axes

`reports/BENCHMARK_INFERENCE_5.0.28.md` is the live report. Every other axis (AGENT, AGI,
CODE_INDEX, CODE_SYNTHESIS, CONVERSATION, INGEST, RESEARCH) is not currently measured: no
report in `reports/`, no owning `benchmark-*` skill.
Their most recent measurements live in `archive/` (`BENCHMARK_INGEST_5.0.18.md`,
`BENCHMARK_RESEARCH_5.0.18.md`, `BENCHMARK_AGENT_5.0.6.md`, and
earlier). One number from today's tree worth naming because CI regenerates it
deterministically: the agentbench envelope reads `rungReached: TOOL-9` at stamp 5.0.22
(`test-benchmarks/agentbench/envelope.json`), the goal-recognition rung landed 2026-08-08 with
0% hallucination — that is an artifact of the always-run test suite, not a report.

## The design docs: what's delivered, what's next, what's a research horizon

Root `PLAN_*.md` docs, enumerated fresh. Delivered plans retire to `archive/` (six did on
2026-08-09: PLAN_SYLLOGIST_EL_DL, PLAN_DL_ENGLISH_SURFACE, PLAN_COMMON_SENSE_QA,
PLAN_RIVER_CROSSING, then PLAN_NEWS_FEED and PLAN_CSQA_SELECTION — each verified by code
inspection and against the deployed site, 5.0.32 and 5.0.35 respectively, before the move;
PLAN_NEWSWORTHINESS followed on 2026-08-10, its N0-N4 live since 5.0.36 with its two recorded
remainders promoted to NEXT items before the move). A `backlog/` directory holds 14 parked plans — a third lifecycle state beside
root (live) and `archive/` (delivered/retired) — not tabulated here.

| plan | goal | delivered | design horizon (known engineering) | research horizon (open problem) |
|---|---|---|---|---|
| `PLAN_NLU_BENCHMARKS.md` | score tmct against CLINC150 and HWU64 with a deterministic harness-only matcher, and feed confirmed gaps back as levers and corpus rows | nothing committed — a 2026-07-15 spike measured tier-1 arms but its scripts are not in-repo | steps 0–5 (ground truth, baseline, matcher, both runs, failure taxonomy); levers L1–L6; L7/L8 (RL property completion, Horn generalization — L8's stratified negation-as-failure needs its own design pass but the technique is precedented); W1/W2 | the far end of the "why" spectrum: contested historiography, defaults, counterfactuals, competing narratives — the plan names defeasible logic and argumentation frameworks as candidate literatures with no settled deterministic engineering today |
| `PLAN_PUBLISH.md` | publication readiness for the site and repo, then the launch | every engineering task (T1–T7, T10, T11a/b, T15) and all four manual items shipped; the receipts page delivered under `archive/PLAN_RECEIPTS.md` | launch sequencing only — announcement timing (the ELIZA 60th-anniversary cycle), Show HN, direct submissions, conference talks (NodeConf EU CFP closes 2026-09-01) | — |

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

## Methodology pins

Product path: no model call anywhere. Any judge is offline-eval tooling only, never in the
shipped product — see `CLAUDE.md`'s project section.

## Refreshing this page

Run the `refresh-status` skill after a new benchmark sweep lands, after a new pipeline resolves
on `main`, or when this page's "measured tree" version falls materially behind `package.json`'s
current version. The skill does not run benchmarks itself, and does not trigger a pipeline — it
reads whatever reports and pipeline results already exist and resynthesizes this page from them.
