# SKILL_CAPABILITIES_AUDIT.md — the tmct capability-audit cycle (naming, scope, back-referencing)

A capability audit is different from a `BENCHMARK_*.md` report. Each `BENCHMARK_*.md` measures one
axis (agentic tool routing, CEFR conversation quality, classical-logic inference, dialogue-flow
dead-ends) with its own harness. A `CAPABILITIES_<version>.md` audit does not run a new measurement.
It is a **synthesis pass**: read the four current `BENCHMARK_*.md` reports as evidence, then verify
each capability directly against the real code, and write down what tmct can actually do right now,
capability by capability, with file:line evidence for every row.

> **Invoke it by telling a session:** *"Follow `SKILL_CAPABILITIES_AUDIT.md` and run a capabilities
> audit"* (optionally: against a named version, if not the current `package.json`).

---

## 1. Naming

`CAPABILITIES_<version>.md`, named after whichever `package.json` version was current when the audit
ran — the exact convention `BENCHMARK_AGENT_<version>.md` / `BENCHMARK_CEFR_ENGLISH_<version>.md` /
`BENCHMARK_CONVERSATION_<version>.md` / `BENCHMARK_INFERENCE_<version>.md` already use. **No "AUDIT"
in the name.** A rerun at the same version appends `_00N` (`CAPABILITIES_1.4.0_001.md`,
`CAPABILITIES_1.4.0_002.md`), the same suffix the benchmark reports use for same-version reruns.

Two audits exist from before this convention: `CAPABILITIES_1.4.1.md` and `CAPABILITIES_1.5.0.md`.
Both were originally named `CAPABILITIES_AUDIT_2026-07-10_001.md`/`_002.md` — dated, not versioned,
which made them ambiguous (both were written on the same calendar day). Finding the real version each
one targets took real archaeology: `git log --follow` to find each file's first commit, then
`git show <that commit>:package.json` for the version field at that point, cross-checked against the
audit's own internal citations (which benchmark reports it names, which commit it says it's "pinned"
at). Do the same archaeology for any other undated/misdated audit you find — don't guess from the
filename alone.

---

## 2. The full-scope discipline — the cautionary precedent

**Read this section before writing a single row.** This project already has a real, checkable example
of an audit's scope narrowing over successive refreshes, and it happened in two separate steps, not
one big regression:

- **Refresh 1** (the true original, pinned at commit `0b730ad`, later folded into what became
  `CAPABILITIES_1.4.1.md`) catalogued **83 distinct capabilities** in one status table — the full
  scope, cross-checked against every doc claim and the actual code.
- **Refresh 2** (`CAPABILITIES_1.4.1.md` itself) condensed that into a changed/new-rows-only table
  (about 16 rows) and told readers to "see refresh 1's git history for the full 83-row table" for
  everything else. This is defensible on its own — a delta-only doc is honest and cheaper to write —
  but it means the live doc no longer contains the full catalog.
- **Refresh 3** (`CAPABILITIES_1.5.0.md`) narrowed again, to about 13 changed rows plus a
  comparative-table subset ("only rows that moved are reproduced in full below").

Each step looked reasonable in isolation. The compounded effect was not: by the third refresh, a
reader had no way to reconstruct tmct's actual capability surface without digging the original 83-row
table out of git history — and nothing in the live doc set pointed at where to find it.

**The rule this audit type follows because of that precedent**: every audit re-verifies the FULL
catalog against the actual current code, not just what changed since the last one. Never assume a
prior audit's verdict still holds — re-check the real file/line evidence at the commit you're pinned
to, every time, for every row, even rows you expect are unchanged. If you genuinely have a reason to
narrow the catalog (a capability was removed from the product entirely, a whole area was descoped),
say so explicitly in the doc — don't let the scope shrink silently by omission the way it did here.
"Full scope" doesn't mean every row needs equal words: an unchanged row gets a terse confirmation (see
§4). It means every row from the last full catalog gets checked and appears somewhere in the new one.

---

## 3. Required sections — mandatory, not optional

An audit is not just the status table from §2. **Every `CAPABILITIES_<version>.md` MUST also contain
the four sections below**, in addition to the full status table. This is not a style preference: an
earlier pass at this skill dropped all four in a from-scratch rewrite, and they had to be restored by
hand from `CAPABILITIES_1.4.1.md`'s own git history. Making them mandatory here is what stops that from
happening again. `CAPABILITIES_1.4.1.md` is the structural reference for what each of these looks like
— read it in full before writing any of the four, but never copy its content forward: every claim below
must be re-derived against your own pinned commit, the same discipline §2 already requires for the
status table.

### 3.1 Comparative agent-capability table + speculative TO-BE

A general agent-capability taxonomy (tool use, planning, reasoning, grounding, memory,
instruction-following, generation, coding, safety/honesty, autonomy — or whatever the current
equivalent list is; don't just copy this list forward without checking it still fits) as rows, with
tmct plus a small set of named, specific models as columns — real model names (`Claude Sonnet 5`,
`Llama 3.1 8B Instruct`), never an umbrella brand or hosting surface (`AWS Bedrock` hosts several
vendors, `Anthropic` is a company — neither is a column). Structure:

- A framing paragraph stating plainly that this is not an IQ-style "as smart as" claim — tmct is a
  narrow, deterministic, zero-cost system, and the table exists to place it on a scale a reader already
  recognizes, not to grade it against a rubric tmct itself designed.
- A fixed-width ASCII quick-reference table: verdict word only per cell (`Weaker` / `Comparable` /
  `Comparable-to-stronger` / `Stronger`, relative to tmct on that specific capability).
- The full prose table: same rows/columns, each cell carrying the "why," not just the verdict word.
  **Every tmct cell must cite a real number from that version's own current `BENCHMARK_*.md` reports**
  — never a stale number carried forward from a prior version's reports. If a benchmark is blocked or
  degraded this cycle (see §2's own "report that plainly" rule), say so honestly in that row instead of
  reusing an old number or inventing a new one.
- Model-column verdicts are informed estimates from general knowledge of those models' public
  capability tiers, not a measured cross-benchmark result — say so explicitly. They change slowly
  version to version, but **re-confirm each one against the current capability rather than assuming
  it still holds** — don't blind-copy the model columns forward either.
- A `### Speculative TO-BE` subsection: purely speculative, explicitly **not a roadmap commitment**,
  drawn only from the current `BENCHMARK_*.md` reports' own "Next" sections and the current
  `HANDOVER.md`'s ranked follow-ups — never from a prior audit's stale backlog. Before listing anything
  as still-TO-BE, confirm directly against current code that it hasn't already shipped since the
  backlog item was written.

### 3.2 Per-benchmark feature-support

One subsection per current `SKILL_BENCHMARK_*.md` doc. Bulleted, terse, specific — each bullet ends in
a bold status word, **complete** or **todo**, and cites the real current `BENCHMARK_*_<version>.md`
report by name. If a benchmark's harness itself is blocked or degraded this cycle, its subsection says
so plainly (see §2) rather than reporting stale feature bullets as if nothing changed.

### 3.3 Per-plan feature-support (Done / Doing / Todo)

One subsection per currently-live `PLAN_*.md` doc — survey the actual root-level `PLAN_*.md` files plus
any `archive/PLAN_*.md` still actively referenced as open/deferred scope (check `ROADMAP.md`'s
"deferred by design" or equivalent section for the current live set; a plan that's fully shipped and
archived with nothing left open doesn't need its own bucketed subsection, a one-line "fully done,
archived, see `archive/PLAN_X.md`'s own STATUS block" is enough).

Each subsection opens with a **`pinned at <commit-or-version>`** line — the same discipline the audit
itself uses to pin its own evidence — then three clean bulleted lists scoped to that plan's own scope
only, never the whole product:

- **Done** — capabilities/stages within this plan's scope that are shipped, each with a real code or
  commit citation.
- **Doing** — anything genuinely in progress or partially done.
- **Todo** — anything the plan itself still marks open, not-started, or research-only.

This is a structural upgrade over `CAPABILITIES_1.4.1.md`'s own §4, which used prose paragraphs ending
in a "which benchmark uplift helps most" note — that framing is not required going forward, three clean
buckets is. Keep the same terse, evidence-cited style as the rest of the doc: no invented capabilities,
only what's real and checked.

### 3.4 Non-benchmarked capabilities

Real, shipped work that doesn't reduce to any current benchmark's scalar — the class of thing a scalar
benchmark structurally can't measure (a whole pipeline unreachable from any benchmarked surface, a
default-behavior flip no case set probes, an end-to-end session quality no single-turn grading captures).
Name these explicitly rather than letting "no benchmark moved" read as "nothing happened" —
`CAPABILITIES_1.4.1.md`'s §5 is the structural reference for tone and shape. Re-derive for the current
pinned commit; don't carry a prior version's list forward without checking whether those items have
since become benchmarked, shipped further, or gone stale.

---

## 4. The back-referencing rule

When a capability's status differs from a prior audit's recorded verdict, **name that prior audit and
say exactly what changed** — the same discipline `CAPABILITIES_1.4.1.md`'s own status table already
practiced per row (e.g. "implemented AND re-measured — refresh 1's open caveat is now closed") and
`CAPABILITIES_1.5.0.md`'s own §0 formalized as an explicit "changes since `_001`" table.

- Cite the specific prior doc by its real filename (`CAPABILITIES_1.4.1.md`, not "the last audit").
- Say what the verdict was before and what it is now, in one sentence.
- Point at the evidence: a commit hash, a `git blame` result, a file:line. "Now implemented" without a
  commit citation is not a verified change, it's a guess.
- If a capability regressed (something that was `implemented` is now `claimed-only` or missing
  entirely), say so as plainly as a status that improved. A capability audit that only tracks progress
  in one direction isn't trustworthy. `CAPABILITIES_1.5.7.md` §3.2 is a worked example: the ACE-OWL
  parser's standalone-package extraction was `implemented` in two straight prior audits, then reverted
  — that gets the same direct treatment as any capability that newly shipped.

For capabilities **unchanged** since the last audit that covered them: a brief confirmation is enough
— restate the status, give one evidence citation, and move on. Don't re-derive the full case for a row
that hasn't moved. The deep verification effort belongs on what's new or changed, not on re-proving
what's stable.

---

## 5. The cycle

**Step 1 — Gather evidence you don't re-measure.** Read the current `BENCHMARK_AGENT_<version>.md`,
`BENCHMARK_CEFR_ENGLISH_<version>.md`, `BENCHMARK_CONVERSATION_<version>.md`, and
`BENCHMARK_INFERENCE_<version>.md` in full — not their one-line summaries. These are your primary
evidence for anything they measure (routing/planning, conversational quality, dialogue-flow dead-ends,
classical-logic inference), and for §3.1's comparative table and §3.2's per-benchmark feature-support.
**Do not re-run any of them.** This audit is a synthesis-plus-code-check pass, not a fifth benchmark.
If one of the four is blocked or degraded (a broken harness, a capped sprint), report that plainly —
it's real evidence about the current state, not a gap in the audit.

**Step 2 — Recover the last full catalog.** Find the most recent `CAPABILITIES_<version>.md` (or, if
its own scope was already narrowed per §2, the git history of whichever revision last held the full
row set). Read it end to end, including its own back-references to anything before it, and including
its own §3.1–§3.4-equivalent sections if it has them.

**Step 3 — Re-verify every row against real code, not against the prior doc.** For each capability in
the recovered catalog: find the real file/line evidence at the commit you're pinned to. Use `git log`,
`git blame`, and direct greps/reads — don't infer a status from a doc's prose alone. Where a prior
audit's own uncertainty flagged something worth a closer look (an "uncertain, couldn't fully confirm"
note), resolve it this time if you can, and say whether you did.

**Step 4 — Fan work out to parallel sub-agents by capability range, not by file.** A full 80+
capability re-verification is exactly the kind of long-running, parallelizable research this project's
coordinator model (`CLAUDE.md`) exists for. Split the catalog into ranges (for example, four chunks of
~20 rows), launch one background agent per chunk with the specific capability numbers/names and the
worktree path, and have each report back a compact table (status, evidence, change-note) rather than
prose — the coordinator then assembles and cross-checks the final doc. Reserve separate agents for
"what shipped since the last audit that isn't on the existing catalog at all" (see §6) and for §3's
four mandatory sections — those searches are qualitatively different from re-verifying a known row.

**Step 5 — Write new rows for anything that shipped but isn't on the catalog at all.** A genuinely new
capability area (a new storage backend, a new CLI verb, a default-behavior flip) doesn't fit into an
existing numbered row — give it a new number, continuing the existing sequence, and say plainly why it
wasn't on the prior catalog (it's new work, not a miss).

**Step 6 — Write §3's four mandatory sections.** Comparative table + speculative TO-BE, per-benchmark
feature-support, per-plan feature-support (Done/Doing/Todo), non-benchmarked capabilities — see §3 for
what each requires. Do this after the status table, not before: the table's file/line evidence is what
grounds the comparative table's tmct cells and the plan sections' Done/Doing/Todo buckets.

**Step 7 — Summarize with real counts, not vibes.** Close with a summary section giving the total row
count, how many are `implemented`/`partial`/`claimed-only`, and which specific rows flipped status
since the last audit. Grep the table for the status word, don't eyeball it — the same discipline
`CAPABILITIES_1.4.1.md`'s own §5/§6 already applied.

---

## 6. Finding what's new (not just what changed)

A status-change sweep over the existing catalog will miss capabilities that shipped with no prior row
to compare against at all. Before finishing, check specifically for:

- `git log <last-audit-commit>..HEAD --oneline` — read every commit subject, not just the ones that
  sound familiar. Group into workstreams.
- New entries in `package.json`'s `exports` map, new npm scripts, new CLI flags/verbs in
  `bin/tmct.mjs`'s own usage banner.
- New top-level `PLAN_*.md`/`SKILL_*.md` docs, and any `archive/PLAN_*.md` that got archived since
  (its own final STATUS block is usually the fastest authoritative source for what a whole workstream
  shipped) — this feeds §3.3's per-plan sections directly.
- Anything a fresh `BENCHMARK_*.md` report names as a "new finding" or "not on the prior audit's
  radar at all" — playtest/sprint reports are especially good at surfacing this, since they exercise
  real conversation flow a scalar benchmark doesn't reach. This also feeds §3.1's speculative TO-BE and
  §3.4's non-benchmarked capabilities.

---

## 7. Discipline

- **Never assume a prior audit's verdict still holds.** Every row gets checked against the real code
  at the commit you're pinned to, every time.
- **Full scope, every time, unless you say otherwise explicitly.** No silent narrowing (§2). If you
  have a real reason to drop something from the catalog, write the reason down.
- **Name the prior audit and the exact change for every status flip** (§4) — no bare "now
  implemented" without a commit citation.
- **Regressions get the same direct treatment as progress.** A capability that used to work and no
  longer does is exactly as reportable as one that newly shipped.
- **§3's four sections are mandatory, not optional.** A `CAPABILITIES_<version>.md` missing the
  comparative table + TO-BE, per-benchmark feature-support, per-plan Done/Doing/Todo, or
  non-benchmarked capabilities is an incomplete audit, not a shorter one.
- **This is not a benchmark run.** Cite the four `BENCHMARK_*.md` reports; don't re-execute them. If
  you find yourself running `node chatbench/run.mjs` or similar, you've stepped outside this skill's
  scope — that belongs to `SKILL_BENCHMARK_CEFR_ENGLISH.md` and its siblings.
- **`npm test` green, checked in the foreground.** This is a docs-only artifact, but confirm the suite
  is unaffected before closing out — run it yourself and read the real pass count, don't infer it from
  a benchmark report's own test line.
- **Follow `SKILL_AGENT_PLAIN_PROSE.md`** for the write-up itself — this is a human-facing doc like any
  other in this repo.

---

## 8. One-paragraph TL;DR

Name it `CAPABILITIES_<version>.md` after the `package.json` version current when you run it, no
"AUDIT" in the name, `_00N` for same-version reruns. Read the four current `BENCHMARK_*.md` reports as
evidence — don't re-run them. Recover the last full capability catalog (checking whether an
intervening audit silently narrowed it, the way `CAPABILITIES_1.4.1.md` → `CAPABILITIES_1.5.0.md` did
in two separate steps) and re-verify every row against the real code at your pinned commit, not
against what the prior doc says. Fan the re-verification out across parallel background agents by
capability range. Cite the specific prior audit and the exact commit for every status change, in
either direction, including regressions. Give unchanged rows a brief confirmation, not a full
re-derivation. Add new numbered rows for anything that shipped with no prior catalog entry to compare
against. Then write the four mandatory §3 sections — comparative model-tier table + speculative TO-BE,
per-benchmark feature-support, per-plan Done/Doing/Todo, non-benchmarked capabilities — re-derived
against your own pinned commit, never copied forward from a prior audit. Close with real, grepped
counts. Keep `npm test` green and check it yourself.
