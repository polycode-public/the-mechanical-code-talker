# PLAN_DOCS_BOT.md — docs that answer

Placeholder, design-only. Drafted 2026-08-04 from operator direction; no implementation is
scheduled yet.

## The idea

Embed a tmct chat on any repo's docs site. It answers only from that repo's own graph, cites
every answer, and refuses whatever the graph doesn't ground. No hallucinated answers, no server
cost, no network call at query time.

tmct's own site already runs this pattern on itself: an in-page chat backed by a graph built
from the demo content, running entirely in the browser. Point the same pattern at an arbitrary
repo's docs and it becomes a deployable artifact in its own right. Every deployment doubles as an
advert for the library underneath it.

## What it stands on

- The browser ask bundle (`npm run build:ask-bundle`, `scripts/build-ask-bundle.mjs`), the
  in-browser query bundle tmct's own demo pages already run entirely client-side.
- The browser entry points that already wire a page's chat to a graph
  (`src/surfaces/web/graph-ask-browser-entry.mjs`, `src/surfaces/web/chat-browser-entry.mjs`),
  precedent for embedding a scoped, cited chat in a page.
- The code-index producer (`src/index/index-repo.mjs`), which already turns a repo into the
  graph a docs bot would answer from.
- The ground-or-refuse answer path (`src/domain/ask.mjs`), unchanged for this use: an answer
  either cites its source or the bot says it does not know.
- The demo site build (`npm run demo:build`, `scripts/build-demo-site.mjs`), the existing
  pipeline that produces a static, deployable page from a graph and a chat bundle.

## Open questions

- Does a docs site rebuild its graph on every deploy (repo changes, graph regenerates), or is
  there a lighter incremental path?
- How does a repo owner scope the graph to "docs" specifically, rather than the whole codebase?
  That could be a separate index pass, or a filter over the existing one.
- What does an unanswerable question look like on someone else's docs site, so the refusal reads
  as expected behavior rather than a broken widget?
- Does this ship as a static bundle a repo owner drops into their own site, or as a hosted
  service tmct provides?

## First measurable step

Point the existing ask-bundle build at one real docs-bearing repo other than tmct's own, generate
its graph, and check by hand whether a handful of real "how does X work" questions get cited,
correct answers or a clean refusal, with no wrong or fabricated answer among them.
