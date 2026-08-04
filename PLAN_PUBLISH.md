# PLAN_PUBLISH.md — publication readiness

Drafted 2026-08-04 from the operator's Claude Desktop publish notes (23 items), after a
three-agent audit: repo state at `56a5621b` plus two local commits, technical claims checked
against current web sources, launch chatter researched. Every item was verified before it
became a task; the verdict table records what changed and why.

Already shipped, for context: `publish:npm` creates a GitLab Release per published version,
idempotently (a retry after a failed POST re-checks and re-creates; commit `1319d1b3`), and
README states the tarball→provenance→tag→commit chain (`4df9a1a1`).

## Dispatch contract (applies to every task)

Each task below is self-contained: it names its files, quotes the current state it expects,
gives the exact change, and ends with acceptance commands. An implementing agent needs no
other part of this doc and no repo-wide survey.

Rules for every dispatched agent, restated in every brief:

- **Stop rule.** If the tree does not match what the task quotes (a string is absent, a file
  is missing, a count differs), stop and report the mismatch. Do not improvise.
- **Tests.** Run only what the task names: `npm run test:smoke` after any edit, `npm run
  test:fast` plus the task's named blast-radius files before committing. Never the full
  suite, never e2e — those run once, coordinator-side, at the push.
- **Site pages.** `public/` demo pages are gitignored build outputs. Run `npm run demo:build`
  before reading any generated page. `public/index.html` and the 11 `*-about.html` files are
  hand-authored and tracked — edit those directly.
- **Git.** Commit as `Antony at Polycode <antony@polycode.co.uk>`. Stage by explicit path,
  never `git add -A`. Never stash/reset/checkout-- /clean. Never push. Do not touch the
  untracked `publish-notes.txt`.
- **Comments.** No comment may cite this plan, a date, an item number, or a conversation.
  Comments state still-binding reasons only, or don't exist.
- **Prose.** Human-facing text follows `.claude/skills/plain-prose/SKILL.md`: short
  sentences, active voice, no em-dash glue, no "not X, it's Y", no hype words.

## Ground truth (audited 2026-08-04)

Facts every task may rely on without re-checking:

- Canonical repo: `gitlab.com/polycode-projects/the-mechanical-code-talker` (MPL-2.0).
  Read-only mirror: `github.com/polycode-public/the-mechanical-code-talker`, synced hourly
  at :17 by `.github/workflows/mirror-from-gitlab.yml` (committed on GitLab), which
  force-pushes `refs/heads/*` and `refs/tags/*` with prune, authenticated with the
  auto-issued `secrets.GITHUB_TOKEN`.
- Site: `https://tmct.polycode.co.uk`, built by `npm run demo:build`
  (`scripts/build-demo-site.mjs`) into `public/`, deployed by `deploy:website` (CDK to AWS).
  Brotli precompression already ships (wire weight for the heaviest page is ~1.8 MB, raw
  ~4.6 MB). A generated service worker (`public/tmct-sw.js`) precaches the site; offline
  operation must survive every change.
- Pages: `index.html` plus 11 demo pages (chat, spider-fly, plan, adventure, ledger, code,
  ingest, sprites, research, mud, mudiii) plus 11 matching `-about.html`. The demo pages are
  generated; index and the about pages are hand-authored and tracked. The build already
  re-stamps the version into the tracked `index.html`, so build-time mutation of tracked
  pages has precedent and an estate test.
- `scripts/site-pages.mjs` holds the page list/order and is the only current single source
  of truth. No page has any `og:`, `twitter:`, or canonical tag. All 11 about pages and the
  index have a `meta name="description"`; the 11 demo pages have none.
- Screenshots: `public/screenshots/<page>.png`, 11 files, all 1024x600.
  `scripts/gen-screenshots.mjs` exists.
- Live site serves `robots.txt` and `sitemap.xml` as HTTP 403 because neither file exists in
  the build. A 403 on robots.txt makes Google treat the whole site as blocked, so this is
  the most urgent SEO item in the plan.
- `npm run check:links` validates relative links in tracked `.md` files only. It knows
  nothing about HTML; HTML checks belong in `test/estate/`.
- npmjs.com renders the README from the published tarball and does not render Mermaid.
  GitHub and GitLab both render ` ```mermaid ` fences natively.

## Verdicts on the 23 notes items

| item | verdict | disposition |
|---|---|---|
| 1 OG tags | premise holds; mechanism wrong — titles are not in `build-demo-site.mjs`, and `check-links.mjs` is md-only | T1 (tags) + T2 (images), estate test instead of check-links |
| 2 GitHub social preview | holds | T2 builds the file; upload is manual M1 |
| 3 demo video | holds | manual M2; T5 degrades gracefully until it exists |
| 4 hero | holds; add poster-first LCP shape | T5 |
| 5 About panel | holds | text drafted below; manual M3 |
| 6 README banner/badges | holds; use `img.shields.io/npm/...` endpoints | T4 |
| 7 MMORPG rename | holds (two live surfaces only; `PLAN_MUD_*.md` file names are deliberate, untouched) | T1 (about title) + T3 (index card) |
| 8 | dropped by the operator | — |
| 9 footer GitHub link | holds | T3 |
| 10 grid titles | holds | T3, payload verbatim below |
| 11 titles/descriptions | partly — 12 of 23 pages already have descriptions | T1 fills the missing 11, normalizes titles |
| 12 grid order | holds; "Plate I-XI" vocabulary does not exist in the codebase — the narrative `<h2>` sections are what stays put | T3 |
| 13 about-polycode | holds | T12, blocked on operator bio/contact D1 |
| 14 stale GitLab Pages copy | **debunked in location.** No such copy on the index; the two real stale references are comments at `scripts/build-demo-site.mjs:1` and `:740` | T3 |
| 15 page weight | **debunked in premise.** Wire weight is already solved (brotli, 0.85–1.83 MB); sprites is 3.96 MB raw, under the claimed floor; `reports/PAGE_WEIGHTS.md` rev 3 already documents all of it. The live question is first paint on the embedded payload | T6, reframed |
| 16 receipts numbers | **debunked.** No rig measures token-reduction-vs-RAG, query latency, or index size; zero hits across all committed reports. The notes asked to be told rather than estimated: all three are missing | moved to [PLAN_RECEIPTS.md](PLAN_RECEIPTS.md): R1 bench, R2 page, R3 RAG-harness design sketch |
| 17 why.html | dropped by the operator | — |
| 18 README overhaul | holds; Mermaid needs an SVG fallback for the npm page | T10 |
| 19 CONTRIBUTING etc. | holds | T11a files shipped; the five drafted starter items land as corpus rows instead of issues |
| 20 org profile | holds | T14 drafts text; manual M4 |
| 21 mobile pass | holds | T7 |
| 22 analytics | **debunked as scoped.** CloudFront log analysis meets every stated constraint with zero client-side code; beacon options fail offline anyway | D5 decision; AWS work is coordinator/operator-side, no page changes |
| 23 robots/sitemap | holds, and is urgent (403 = full crawl block) | T1 |

## Waves

| wave | tasks | tier | owns |
|---|---|---|---|
| 1 | T1 | Sonnet | `scripts/site-pages.mjs`, `scripts/build-demo-site.mjs`, `public/index.html`, `public/*-about.html`, `test/estate/` |
| 1 | T2 | Sonnet | `scripts/gen-og-images.mjs` (new), `package.json` scripts, `test/estate/` (own file) |
| 2 | T3 | Haiku | `public/index.html`, `scripts/build-demo-site.mjs` comments |
| 2 | T4 | Haiku | `README.md` top block |
| 2 | T11a | Haiku | `CONTRIBUTING.md`, `SECURITY.md`, `.github/pull_request_template.md` (new files) |
| 3 | T5 | Sonnet | `public/index.html` hero block |
| 3 | T6 | Sonnet | `scripts/build-demo-site.mjs` splash, `reports/PAGE_WEIGHTS.md` |
| 3 | R1, R2 | Sonnet | see [PLAN_RECEIPTS.md](PLAN_RECEIPTS.md) |
| 4 | T7 | Sonnet | mobile fixes in generated-page templates |
| 4 | T10 | Sonnet | README overhaul |
| unblocked-by-operator | T12, analytics | — | after D1/D5 |

Waves run as concurrent background sub-agents in worktrees, one wave at a time; the
coordinator merges, removes each worktree at merge, and pushes per the repo's standing
cadence (full suite only at the push).

## Tasks

### T1 — one metadata source; head tags on all 23 pages; robots + sitemap (Sonnet)

Files: `scripts/site-pages.mjs`, `scripts/build-demo-site.mjs`, `public/index.html`, all 11
`public/*-about.html`, new `test/estate/site-meta.test.mjs`.

1. In `scripts/site-pages.mjs`, extend the existing `DEMO_PAGES` list (11 entries, order:
   chat, spider-fly, plan, adventure, ledger, code, ingest, sprites, research, mud, mudiii —
   stop if the file disagrees) so each entry carries `slug`, `title`, `description`. Titles,
   verbatim:
   - chat: `Ask it anything, check every answer`
   - spider-fly: `A spider hunts a fly, each planning blind`
   - plan: `Watch it solve a puzzle it was taught`
   - adventure: `A house drawn only from what its facts say`
   - ledger: `Every fact, its source, and how far to trust it`
   - code: `Ask a codebase what calls what`
   - ingest: `Paste text, watch it refuse what it can't ground`
   - sprites: `A poodle draws as a dog, because it is one`
   - research: `Teach it, feed it, or let it look things up`
   - mud: `Four burrowers, one world, four partial maps`
   - mudiii: `A fox and goblins in a 3D town square`
   Descriptions: copy each page's existing `meta name="description"` content attribute out
   of its `<slug>-about.html` file, verbatim, into the module. Also export an `INDEX_META`
   object: title `the-mechanical-code-talker`, description copied from `index.html`'s
   existing meta description.
2. In `build-demo-site.mjs`, add a head-block renderer producing, per page:
   `<title><demo title> — tmct</title>` (index keeps its current title), the meta
   description, `<link rel="canonical" href="https://tmct.polycode.co.uk/<slug>.html">`
   (index: `https://tmct.polycode.co.uk/`), `og:title`, `og:description`,
   `og:image` = `https://tmct.polycode.co.uk/og/<slug>.png` (about pages reuse their demo
   page's image; index uses `og/index.png`), `og:url` = the canonical URL,
   `og:type` = `website`, `og:site_name` = `the-mechanical-code-talker`,
   `twitter:card` = `summary_large_image`, `twitter:image` = the og:image URL.
   Generated demo pages get the block emitted directly. For the 12 hand-authored pages, add
   `<!-- meta:begin --><!-- meta:end -->` markers in each `<head>` (one edit per file,
   replacing the existing `<title>` and `meta description` lines so nothing is duplicated)
   and have the build replace the marker interior on every run, the same way it already
   re-stamps the version into `index.html`.
3. Emit `public/robots.txt` from the build, exactly:
   ```
   User-agent: *
   Allow: /
   Sitemap: https://tmct.polycode.co.uk/sitemap.xml
   ```
   Emit `public/sitemap.xml` from the page list: 23 `<url><loc>` entries, canonical URLs as
   above, no lastmod.
4. New `test/estate/site-meta.test.mjs`: after a build, every page in the page list exists
   and contains exactly one canonical link, one `og:image`, one `twitter:card`; robots.txt
   matches the payload above; sitemap.xml parses and holds 23 locs. Do not assert og image
   files exist (a sibling task owns those).

Acceptance: `npm run demo:build` exits 0; `node --test test/estate/site-meta.test.mjs`
passes; `npm run test:fast` passes; `grep -c 'og:image' public/chat.html` prints 1.

### T2 — og images at 1200x630, social preview at 1280x640 (Sonnet)

Files: new `scripts/gen-og-images.mjs`, `package.json` (one script line), new
`test/estate/og-images.test.mjs`.

Playwright is already a dependency; use it, no new packages. The script renders a local HTML
shell per image: page background taken from the `background` declaration on `body` in
`public/index.html` (stop and report if none is found), the 1024x600 screenshot centred and
scaled to fit height, never stretched. Screenshot the shell at 1200x630 to
`public/og/<slug>.png` for the 11 pages, `public/og/index.png` from the mudiii screenshot,
and `public/og/github-social.png` at 1280x640, also from mudiii. Add
`"gen:og-images": "node scripts/gen-og-images.mjs"` to package.json and call it from the
demo-build script after screenshots exist. The estate test reads each PNG's IHDR bytes
(width at offset 16, height at offset 20, big-endian) and asserts the exact dimensions and
that every og:image URL emitted into `public/` resolves to a file on disk.

Acceptance: `npm run gen:og-images` exits 0 and writes 13 files;
`node --test test/estate/og-images.test.mjs` passes; `npm run test:fast` passes.

### T3 — index grid retitle + reorder, rename, footer, stale comments (Haiku)

Files: `public/index.html`, `scripts/build-demo-site.mjs` (two comment lines only).

1. The demo grid cards each carry an `<h3>` heading (e.g. line ~205 reads
   `<h3>MMORPG</h3>`; stop if absent). Replace each card's `<h3>` text with the T1 title
   list above (same 11 strings; mudiii's card becomes `A fox and goblins in a 3D town
   square` and any nearby "MMORPG" wording becomes `3D multi-agent town square`). Keep each
   card's existing capability line as the subtitle, unchanged.
2. Reorder the card blocks to: chat, ledger, research, spider-fly, plan, code, ingest,
   mudiii, mud, adventure, sprites. Move whole card blocks only. Leave the narrative
   sections and the capability matrix exactly where they are; the matrix keeps its filename
   labels.
3. Footer (currently GitLab + npm links, around line 787): after the npm anchor, add
   ` &middot; <a href="https://github.com/polycode-public/the-mechanical-code-talker">github mirror</a>`.
4. `scripts/build-demo-site.mjs` line 1 comment says the script regenerates "the GitLab
   Pages site" and line ~740 mentions "GitLab Pages documents serving these variants". Both
   are stale (the site moved to an AWS edge). Reword each to say what the line's code does
   today, with no hosting history.

Acceptance: `npm run demo:build` exits 0; `grep -c MMORPG public/index.html` prints 0;
`grep -c 'github mirror' public/index.html` prints 1; `npm run test:smoke` passes;
`node --test test/estate/site-meta.test.mjs` passes.

### T4 — README banner + badges (Haiku)

File: `README.md`, immediately under the title line. Insert, verbatim:

```markdown
[![npm version](https://img.shields.io/npm/v/@polycode-projects/the-mechanical-code-talker)](https://www.npmjs.com/package/@polycode-projects/the-mechanical-code-talker)
[![npm downloads](https://img.shields.io/npm/dm/@polycode-projects/the-mechanical-code-talker)](https://www.npmjs.com/package/@polycode-projects/the-mechanical-code-talker)
[![licence](https://img.shields.io/npm/l/@polycode-projects/the-mechanical-code-talker)](https://gitlab.com/polycode-projects/the-mechanical-code-talker/-/blob/main/LICENSE)
[![live demos](https://img.shields.io/badge/demos-tmct.polycode.co.uk-blue)](https://tmct.polycode.co.uk)

> Canonical home: [GitLab](https://gitlab.com/polycode-projects/the-mechanical-code-talker).
> Installs come from [npm](https://www.npmjs.com/package/@polycode-projects/the-mechanical-code-talker).
> The [GitHub repo](https://github.com/polycode-public/the-mechanical-code-talker) is a
> read-only mirror, synced hourly. Issues and merge requests go to GitLab.
```

`package.json`'s `repository` already points at GitLab; leave it. README ships in the npm
tarball, so keep the block plain markdown (badges are images with absolute URLs, which npm
renders fine).

Acceptance: `npm run check:links` exits 0; `node --test test/estate/links.test.mjs` passes;
`npm run test:fast` passes.

### T5 — hero above the fold (Sonnet)

File: `public/index.html`. Above the demo grid, below the one-line thesis, add a hero block:

- `<video autoplay muted loop playsinline poster="og/index.png">` with no `<source>` in the
  markup. A three-line inline script does a `fetch('media/hero-mudiii.mp4', {method:
  'HEAD'})`; on 200 it appends the source and calls `load()`. Absent video, the poster shows
  — which is the required degraded state, and it makes the poster the LCP element.
- Wrap in a `@media (prefers-reduced-motion: reduce)` rule that hides the video element and
  shows a plain `<img src="og/index.png">` fallback (both in markup; CSS picks one).
- The poster/fallback image gets `fetchpriority="high"`.
- The service worker precache list is generated from `public/` contents; confirm
  `og/index.png` lands in it after a build, and do not add the mp4 to the precache (it may
  not exist, and it is heavy).

Acceptance: `npm run demo:build` exits 0; index renders the poster with no mp4 present
(verify with Playwright: screenshot the top of the page, assert the img/video box is
visible); `node --test test/estate/site-meta.test.mjs` passes; `npm run test:fast` passes.

### T6 — first paint on the four heavy pages (Sonnet)

Files: `scripts/build-demo-site.mjs`, `reports/PAGE_WEIGHTS.md`.

Wire weight is already solved (brotli precompression ships; heaviest page ~1.83 MB on the
wire). The open question is whether first paint waits on the embedded payload. Measure
first: using the re-measurement procedure documented in `reports/PAGE_WEIGHTS.md` (rev 3),
record first-paint/FCP for adventure, mud, spider-fly, sprites from a cold load. If FCP on
any of the four exceeds 500ms after first byte, add to the generated-page template a
minimal splash: an inline-styled `<div>` at the top of `<body>` naming the demo and saying
`loading…`, removed by the page's own boot code — it paints as soon as the first bytes
arrive because it precedes the payload. No payload splitting in this task; if measurement
says splitting is needed anyway, stop and report the numbers instead of building it.
Append a dated revision to `reports/PAGE_WEIGHTS.md` with the before/after FCP table.

Acceptance: measured FCP table in the report; `npm run demo:build` exits 0; service worker
still precaches (grep the generated `tmct-sw.js` for the four pages); `npm run test:fast`
passes.

### T7 — mobile pass (Sonnet)

Playwright at 390x844 and 360x800 against a fresh build: mudiii, mud, spider-fly, adventure.
Record per page: touch controls working, horizontal overflow, WebGL context creation.
Fix what is broken in the generated-page templates in `build-demo-site.mjs` (viewport meta,
touch handlers, canvas sizing). Anything that needs a per-demo engine change in `src/` gets
reported, not fixed here. Append findings to the task report; update
`reports/PAGE_WEIGHTS.md` only if page bytes changed.

Acceptance: the four pages at both viewports show no horizontal scroll and a live canvas;
`npm run test:fast` passes; named e2e files for touched demos if they exist under
`test-e2e/` (list them in the report).

### T8 — moved

The receipts page (bench, template, and the RAG-harness design sketch) lives in
[PLAN_RECEIPTS.md](PLAN_RECEIPTS.md) as R1–R3.

### T10 — README overhaul (Sonnet, after T4)

Reshape README.md: 30-second quickstart at top (install, one `runTurn` snippet, the CLI
smoke line), then architecture. The diagram ships twice: a committed SVG
(`docs/architecture.svg`, hand-drawn simple boxes, renders everywhere including npm) as the
image, with the Mermaid source in a collapsed `<details>` block for GitLab/GitHub readers.
npm does not render Mermaid, so the SVG is the primary. Keep the existing bibliography,
supply-chain section (including the new chain paragraph), and benchmark pointers. Verify
the result renders as the npm page will: no Mermaid-only content, no relative links that
break in the tarball context.

Acceptance: `npm run check:links` exits 0; `npm run check:readme` locally (README examples
changed); `npm run test:fast` passes.

### T11a — CONTRIBUTING.md, SECURITY.md, PR template (Haiku)

Three new files, content in full:

- `CONTRIBUTING.md`: merge requests go to GitLab (canonical repo URL); dev setup is
  `npm ci`, `npm run test:fast` while iterating, `npm test` before an MR; the test-rung
  table exists in CLAUDE.md; style rules live in `.claude/skills/plain-prose/SKILL.md`;
  the GitHub repo is a mirror and PRs opened there will be redirected.
- `.github/pull_request_template.md`: two sentences — this repo is a read-only mirror;
  please open this change as a merge request on GitLab (link), where CI runs.
- `SECURITY.md`: report privately to `antony@polycode.co.uk` (operator to confirm address,
  decision D6); no bounty; acknowledgement target one week.

Acceptance: `npm run check:links` exits 0; `node --test test/estate/links.test.mjs` passes.

### T11b — starter-item corpus rows

Delivered as five verified candidates; the operator chose to land them directly as corpus
rows rather than open them as issues.

### T12 — about-polycode.html (blocked on D1)

Blocked until the operator supplies biography and contact route. Then: a generated page
(same head-block machinery as T1) covering who built this, the commercial intent behind
MPL-2.0, Seonix and Marginalia as sibling projects, and the contact route; linked from the
index footer.

## Operator decisions needed

- **D1** — biography and contact route for about-polycode.html (T12).
- **D5** — analytics: recommendation is CloudFront standard logs to an S3 bucket, analyzed
  offline; zero client-side code, nothing to consent-banner, offline operation untouched.
  Needs an AWS change (coordinator or operator with credentials), not a page change.
  Confirm before anything is enabled.
- **D6** — confirm the security contact address for SECURITY.md.

## Manual checklist (operator, web UIs)

- **M1** — GitHub Settings → Social preview: upload `public/og/github-social.png` (T2
  builds it, 1280x640).
- **M2** — record the 60–90s silent mudiii capture; export MP4 (place at
  `public/media/hero-mudiii.mp4`) and a looping GIF.
- **M3** — GitHub About panel: website `https://tmct.polycode.co.uk`; topics `symbolic-ai`,
  `knowledge-graph`, `owl`, `rdf`, `provenance`, `no-llm`, `eliza`; description:
  *Deterministic, no-LLM chat over an OWL-labelled JSON graph memory. Grounded answers with
  provenance, or a refusal. Pure JS, offline, $0 to run. Read-only mirror of the GitLab
  repo; live demos at tmct.polycode.co.uk.*
- **M4** — put the drafted profile README on the polycode-public account and pin the repo.

## Launch sequencing

Publication order matters more than completeness. The sequence that fits the research:

1. **Fix robots.txt first** (T1). Until the 403 goes, search engines treat the whole site
   as blocked, which nullifies every other conversion task.
2. **Land waves 1–3 before any announcement.** Link previews (OG tags), the receipts page,
   and the mirror banner are what launch-day readers check within minutes.
3. **Time the announcement to the ELIZA 60th-anniversary cycle** already running in 2026
   (MIT Press open-access monograph, FOSDEM talk, mainstream coverage). The one-line frame:
   sixty years after ELIZA faked understanding, a deterministic chatbot that says when it
   doesn't know.
4. **Show HN**, demo link first, plain title, no superlatives. Comparable "deterministic,
   no LLM at runtime" launches get real discussion at modest scores; plan for engaged
   comments rather than virality, and be present for several hours. Lead the post with a
   live miss example — current HN threads pick apart ungrounded claims, and the refusal
   behaviour is the product.
5. **Direct submissions**: console.dev (hand-curated, published selection criteria that fit
   this project), then TLDR after any spike.
6. **Talks**: XAI+KG 2026 (ISWC workshop) and Knowledge Graph Conference 2026 both have
   open, fitting calls; NodeConf EU 2026 CFP closes 2026-09-01 for the pure-JS angle. A
   write-up of the abstention lineage (Chow 1970, Reiter 1978) lands in a live research
   conversation on LLM abstention.
