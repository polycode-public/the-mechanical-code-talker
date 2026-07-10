# CLAUDE.md — project guidance for Claude Code sessions

## Working model: coordinator + background sub-agents

Run big tasks in **concurrent background sub-agents** and keep the main chat free — the main
session is the COORDINATOR (plans, launches, integrates, answers the operator), not the worker.

- Decompose into workstreams with **clear file-ownership boundaries**; serialize on shared
  files (one agent owns `package.json`, `src/`, `bin/`, `test/` sequences; docs/site tracks
  run in parallel).
- **Keep the chat for chat**: anything long-running (benchmarks, judge passes, builds, test
  sweeps) executes as a BACKGROUND task at maximum safe concurrency (the chatbench judge
  defaults to `--concurrency 12`); the main session launches it, keeps coordinating and
  conversing, and collects results on the completion notification. Never block the
  conversation on a run.
- Commit per completed step with the repo-local identity (`antony@polycode.co.uk` /
  `Antony at Polycode`); keep `npm test` green at every commit.
- Push/publish is gated on the operator (CI publishes on version bump on `main`).
- **Version bump timing:** only bump the version (`package.json` + `package-lock.json`) at the
  moment of actually pushing a release — the bump commit is part of that same push, not a
  separate step staged in advance. Default to a patch bump unless the batch is clearly
  feature-level (minor) or breaking (major). Do NOT pre-stage a future version number and leave
  it sitting unpushed in git between releases — that produced confusing "linking to a version
  that doesn't exist yet" noise in practice and was reverted by operator instruction 2026-07-09.
  Between pushes, `package.json`'s version should always equal whatever's actually live on npm.

## Project

`@polycode-projects/the-mechanical-code-talker` (short: **tmct**) — a pure-JS, **no-LLM**
chatbot: deterministic language libraries (wink-nlp), template sets, committed corpuses, an
OWL-labelled JSON graph memory on disk (`.tmct/`, never committed). LLMs are allowed ONLY in
the offline eval harness (LLM-as-judge in the chat tuning cycle), never in the product path.

- `npm test` — node --test suite; must stay green.
- CLI smoke: `printf 'hi\n/exit\n' | node bin/tmct.mjs` must greet and exit 0.
- See `ROADMAP.md` (phases), `SKILL_BENCHMARK_CEFR_ENGLISH.md` (autonomous chat tuning loop),
  `SKILL_AGENT_STRATEGY_ADVISOR.md` (background advisor recipe).
