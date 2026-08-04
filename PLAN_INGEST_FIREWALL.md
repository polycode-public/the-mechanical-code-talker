# PLAN_INGEST_FIREWALL.md — a hallucination firewall for agent memory

Placeholder, design-only. Drafted 2026-08-04 from operator direction; no implementation is
scheduled yet.

## The idea

Agent memory today mostly stores whatever an agent writes to it, true or not. tmct's ingest
behavior already does the opposite: ground each candidate sentence against the recognizer, or
refuse it. Nothing gets stored without grounding.

Point that behavior at agent memory instead of documents. An agent writes candidate facts; only
what grounds is stored; every stored fact cites the source it came from; queries can scope by
trust tier so a caller can ask for only the facts it trusts. This is a small library proposition
sitting inside machinery tmct already has, not a new engine.

## What it stands on

- `tmct_ingest` (`src/tools/handlers/tmct-ingest.mjs`) and the ground-or-refuse recognizer behind
  it (`src/services/extract-facts.mjs`), which already turn plain text into stored facts or a
  clean skip, with a strict tier and a lower-trust optimistic tier.
- The trust model (`src/domain/memory/trust.mjs`), which already scores and tiers facts
  deterministically from their source and inputs. That is the piece a "scope by trust tier" query
  would read.
- Provenance tagging on every stored fact (`sourceTag`, the `extracted:<tag>` /
  `optimistic-extract:<tag>` markers in `extract-facts.mjs`), which already ties a fact back to
  where it came from.
- The ingest projection (`src/domain/ingest-facts.mjs`), which already turns a session's stored
  facts into a queryable graph, session by session.

## Open questions

- Is "agent writes candidate facts" the existing `tmct_ingest` call as-is, or does an agent-memory
  caller need a distinct entry point (different defaults, different refusal behavior)?
- Does "scope by trust tier" need a new query parameter on `ask()`, or does it compose from the
  trust scores already stored per fact?
- What is the citation an agent gets back when it asks a question? A likely default is the same
  shape `ask()` already returns, but a more compact form may suit an agent's own context window
  better.
- Does this ship as a mode of tmct itself, or as a separate small package that depends on tmct's
  ingest and trust modules?

## First measurable step

Build a fixed test set of candidate agent-generated facts, some true and some fabricated, run
them through `tmct_ingest`, and measure how many fabricated facts get refused versus how many
grounded facts get stored with a correct citation.
