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
- **Version-bump-after-push:** immediately after a push lands on `main`, bump the version
  (`package.json` + `package-lock.json`, default to a patch bump unless the shipped batch was
  clearly feature-level or breaking) and commit that bump locally — but do NOT push it. Let the
  next batch of work commits land on top of it; when that batch is ready to push, the whole thing
  goes out together with the version already baked in from the start. This keeps the npm-published
  version always exactly matching the last commit of whatever was actually pushed, and avoids
  triggering a separate CI publish for every small change.

## Project

`@polycode-projects/the-mechanical-code-talker` (short: **tmct**) — a pure-JS, **no-LLM**
chatbot: deterministic language libraries (wink-nlp), template sets, committed corpuses, an
OWL-labelled JSON graph memory on disk (`.tmct/`, never committed). LLMs are allowed ONLY in
the offline eval harness (LLM-as-judge in the chat tuning cycle), never in the product path.

- `npm test` — node --test suite; must stay green.
- CLI smoke: `printf 'hi\n/exit\n' | node bin/tmct.mjs` must greet and exit 0.
- See `ROADMAP.md` (phases), `SKILL_TUNING_CYCLE.md` (autonomous chat tuning loop),
  `SKILL_STRATEGY_ADVISOR.md` (background advisor recipe).
