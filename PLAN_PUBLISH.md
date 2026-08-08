# PLAN_PUBLISH.md — publication readiness

Drafted 2026-08-04 from the operator's publish notes; realigned 2026-08-08 to the shipped
tree and the live site at version 5.0.21. Every engineering task (T1-T7, T10, T11a, T11b,
T15) has landed. What remains is launch timing, not implementation.

## Ground truth (2026-08-08, version 5.0.21)

- Site: `https://tmct.polycode.co.uk`, built by `npm run demo:build`
  (`scripts/build-demo-site.mjs`) into `public/`, deployed by `deploy:website` (CDK to AWS).
- Pages: `index.html` plus 6 demo pages (chat, ledger, plan, mudiii, adventure, sprites)
  plus their 6 matching `-about.html` pages, plus `claims.html` and `receipts.html`. That's
  15 pages total. `research`, `spider-fly`, `code`, `ingest`, and `mud` were dropped from the
  site (`7245ff0a`); sprites also drives four generated, untracked sub-pages
  (`sprites-adventure-props.html`, `sprites-emotions.html`, `sprites-objects.html`,
  `sprites-person-roles.html`) that carry no separate head-tag metadata of their own.
  `scripts/site-pages.mjs` remains the single source of truth for the tracked list
  (`DEMO_PAGES`, `DEMO_PAGE_META`, `INDEX_META`, `RECEIPTS_META`, `CLAIMS_META`).
- Every page carries `<title>`, meta description, canonical link, `og:*`, and
  `twitter:card` (`test/estate/site-meta.test.mjs`). `public/og/` holds 8 PNGs (6 demo
  pages, `index.png`, `github-social.png`) at their required dimensions
  (`test/estate/og-images.test.mjs`).
- Live `robots.txt` and `sitemap.xml` both serve HTTP 200; the sitemap lists 15 locs,
  matching the tracked page count.
- README's top block carries the npm-version/downloads/licence/demos badges and the
  canonical-home note (GitLab primary, npm install, GitHub read-only mirror). The
  architecture section ships a committed `docs/architecture.svg` plus the Mermaid source
  in a collapsed `<details>` block.
- `CONTRIBUTING.md`, `SECURITY.md`, and `.github/pull_request_template.md` exist and are
  populated.
- `infra/lib/website-stack.ts` enables CloudFront standard access logging to an S3 bucket
  with a lifecycle expiry.
- `reports/PAGE_WEIGHTS.md` carries a first-paint measurement (2026-08-05, version 5.0.7):
  all four then-heaviest pages painted well under the 500ms threshold, so no splash or
  payload splitting was needed. That measurement predates the research/spider-fly/code/
  ingest/mud page drop, so the report's own rev-3 page-weight table (23 pages) no longer
  matches the live site. A refresh is the `page-weights` skill's job, not this plan's.
- `archive/PLAN_RECEIPTS.md` (moved off the repo root in the 2026-08-08 plans-refocus
  sweep) records the receipts page as shipped: R1 (latency/size measurements) and R2 (the
  page itself) delivered. R3, a RAG-comparison harness, is open there.

## Shipped

- **T1** — head-tag metadata, robots.txt, sitemap.xml: shipped (`d1e37e75`,
  `test/estate/site-meta.test.mjs`).
- **T2** — og images at 1200x630, GitHub social preview at 1280x640: shipped (`b6de0d95`,
  `test/estate/og-images.test.mjs`).
- **T3** — index grid retitle/reorder, MMORPG rename, github-mirror footer link, stale
  comment fixes: shipped (`ad194c42`).
- **T4** — README badges and mirror banner: shipped (`c15e9500`).
- **T5** — poster-first hero above the fold: shipped (`88d449c1`).
- **T6** — first-paint measurement on the heavy pages, no splash needed: shipped
  (`1c16fde7`).
- **T7** — mobile pass at 390x844/360x800: shipped (`3d0321cc`).
- **T8** — receipts page: moved to `archive/PLAN_RECEIPTS.md`; R1/R2 delivered there, R3
  open there.
- **T10** — README quickstart and architecture diagram overhaul: shipped (`c8560663`).
- **T11a** — CONTRIBUTING.md, SECURITY.md, PR template: shipped (`f0df2285`).
- **T11b** — five starter-item corpus rows: shipped, landed directly as corpus rows.
- **T15** — CloudFront standard access logs: shipped (`99c4a616`).

## Manual checklist

- **M1** — done, verified 2026-08-05: custom GitHub social preview live.
- **M2** — done 2026-08-05: hero clip committed (`clips/`), MP4 ships at
  `public/media/hero-mudiii.mp4`, `capture:hero` re-records locally and in CI.
- **M3** — done, verified 2026-08-05: About panel carries the website link, description,
  and topics.
- **M4** — done, verified 2026-08-05: org profile README lives in `polycode-public/.github`
  and the-mechanical-code-talker is pinned.

## Launch sequencing

Engineering is done and robots.txt/sitemap.xml both serve 200, so the only work left is
timing the announcement:

1. **Time the announcement to the ELIZA 60th-anniversary cycle** running through 2026 (MIT
   Press open-access monograph, FOSDEM talk, mainstream coverage). The one-line frame:
   sixty years after ELIZA faked understanding, a deterministic chatbot that says when it
   doesn't know.
2. **Show HN**, demo link first, plain title, no superlatives. Lead with a live miss
   example — the refusal behaviour is the product. Plan for engaged comments rather than
   virality, and be present for several hours.
3. **Direct submissions**: console.dev (hand-curated, published selection criteria that fit
   this project), then TLDR after any spike.
4. **Talks**: XAI+KG 2026 (ISWC workshop) and Knowledge Graph Conference 2026 both have
   open, fitting calls; NodeConf EU 2026 CFP closes 2026-09-01 for the pure-JS angle. A
   write-up of the abstention lineage (Chow 1970, Reiter 1978) lands in a live research
   conversation on LLM abstention.
