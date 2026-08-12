// scripts/news-bench/articles.mjs — the bench's per-run articles log
// (PLAN_NEWS_FEED_QUALITY.md section 2): every card's rendered text, its
// backing source item(s), and the offered items that never became one.
// Pure: takes a run's own already-computed feed/state/rows, no I/O and no
// clock of its own, so the same run produces the same articles report byte
// for byte. Card date/backing-item data the feed document itself does not
// expose (PLAN_NEWS_FEED_QUALITY.md section 1's own named gap) is computed
// here from the poll state rather than touching src.
import { ledgerFromPayload } from "../../src/domain/term-ledger.mjs";
import { groundedTermPerItem, noisyHubIndex, cardIdentityLineClassifications } from "./metrics.mjs";

function splitSentences(paragraph) {
  const trimmed = String(paragraph || "").trim().replace(/\.$/, "");
  if (!trimmed) return [];
  return trimmed.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
}

function aroundItClauseOf(paragraph) {
  return /Around it: (.+)$/.exec(String(paragraph || "").replace(/\.$/, ""))?.[1]?.trim() || null;
}

function byFetchedAtThenId(a, b) {
  return String(a.fetchedAt).localeCompare(String(b.fetchedAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Items keyed to what the card's own `sources` array names (url, falling
 *  back to title) — the same rows-behind-the-card boundary `collectSources`
 *  drew when it built `card.sources` from the hub's own reported rows,
 *  never the card's whole two-hop subgraph: a quake card's two-hop walk
 *  reaches all 44 of the day's quakes through the shared "earthquake" node,
 *  but only the quake it actually reported is its own article. Sorted by
 *  fetchedAt then id so the same run always lists them in the same order. */
function backingItemsFor(card, items) {
  const sourceKeys = new Set((card.sources || []).map((s) => s.url || s.title).filter(Boolean));
  return items
    .filter((item) => sourceKeys.has(item.url || item.title))
    .sort(byFetchedAtThenId);
}

/** The latest publishedAt among a card's backing items, or null. */
function cardDate(backingItems) {
  const dates = backingItems.map((item) => item.publishedAt).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** A card's own noisy identity-sentence objects, metric 5's same-sense test
 *  read out per card instead of pooled across the feed — the same
 *  classification `noisyHubRelationRate` counts, so a card's own display
 *  can never drift from the feed-wide rate. */
function cardNoisyContextLines(card, index) {
  return cardIdentityLineClassifications(card, index)
    .filter((c) => c.noisy)
    .map((c) => c.row.object);
}

/** Whether this card's paragraph repeats another card's sentence, or its
 *  "Around it" clause repeats another card's — and which card, by hub, so a
 *  reader can go look. First match wins; deterministic because `allCards`
 *  is always the feed's own already-sorted order. */
function cardRepeat(card, allCards) {
  const mySentences = new Set(splitSentences(card.paragraph).map((s) => s.toLowerCase()));
  const myAroundIt = aroundItClauseOf(card.paragraph)?.toLowerCase() || null;
  let repeatsSentencesOf = null;
  let repeatsAroundItOf = null;
  for (const other of allCards) {
    if (other === card) continue;
    if (!repeatsSentencesOf) {
      const theirs = splitSentences(other.paragraph).map((s) => s.toLowerCase());
      if (theirs.some((s) => mySentences.has(s))) repeatsSentencesOf = other.hub;
    }
    if (!repeatsAroundItOf && myAroundIt) {
      const theirAroundIt = aroundItClauseOf(other.paragraph)?.toLowerCase();
      if (theirAroundIt && theirAroundIt === myAroundIt) repeatsAroundItOf = other.hub;
    }
    if (repeatsSentencesOf && (repeatsAroundItOf || !myAroundIt)) break;
  }
  return { repeatsSentencesOf, repeatsAroundItOf };
}

/** A cheap two-bucket read on why an offered item admitted zero facts: the
 *  ledger already records every term the item's own text produced that
 *  never grounded, so an item with ledger entries got its text read and
 *  parsed but nothing in it grounded; an item with none never produced a
 *  recognizable claim at all. This is not a full pipeline trace — it is the
 *  cheapest thing the runner's own state can say without instrumenting
 *  ingestText. */
function rejectionStage(item, ledgerEntries) {
  const touched = ledgerEntries.some((entry) => (entry.itemIds || []).includes(item.id));
  return touched ? "parsed; term(s) never grounded" : "no recognizable claim in the text";
}

function cardArticle(card, allCards, items, perItemGrounded, index) {
  const backingItems = backingItemsFor(card, items);
  const noisy = cardNoisyContextLines(card, index);
  const repeat = cardRepeat(card, allCards);
  const date = cardDate(backingItems);
  const backingGrounded = backingItems.map((item) => perItemGrounded.get(item.id)).filter(Boolean);
  const groundedSum = backingGrounded.reduce((a, r) => a + r.grounded, 0);
  const extractedSum = backingGrounded.reduce((a, r) => a + r.extracted, 0);

  return {
    kind: "card",
    id: card.id,
    hub: card.hub,
    paragraph: card.paragraph,
    backgroundParagraph: card.backgroundParagraph || null,
    sources: card.sources || [],
    date,
    backingItems: backingItems.map((item) => ({
      id: item.id, sourceId: item.sourceId, title: item.title, url: item.url, publishedAt: item.publishedAt || null,
    })),
    groundedTermProportion: {
      articles: backingGrounded.length,
      grounded: groundedSum,
      extracted: extractedSum,
      microAverage: extractedSum ? groundedSum / extractedSum : null,
    },
    noisyContextLines: { count: noisy.length, objects: noisy },
    repeatsSentencesOf: repeat.repeatsSentencesOf,
    repeatsAroundItOf: repeat.repeatsAroundItOf,
    sentenceCount: splitSentences(card.paragraph).length,
    headlinePresent: (card.sources || []).some((s) => s.title),
    linkPresent: (card.sources || []).some((s) => s.url),
    datePresent: date !== null,
    // The report a card was built from, in the source's own words, is the one
    // thing a reader can check the graph's sentences against.
    summaryPresent: (card.sources || []).some((s) => s.summary),
  };
}

/** The whole articles log as one flat, kind-discriminated array: one "card"
 *  entry per feed card (feed order preserved), one "cardless-admitted" entry
 *  per item that grounded a fact no card ever cites, and one "rejected"
 *  entry per item that admitted nothing at all — the produced articles and
 *  the two ways an article failed to happen, all in the same machine-
 *  readable shape. */
export function buildArticlesReport({ feed, state, rows }) {
  const items = state.items || [];
  const cards = feed.items;
  const perItemGrounded = new Map(groundedTermPerItem(state, rows).map((r) => [r.itemId, r]));
  const ledgerEntries = [...ledgerFromPayload(state.ledger).terms.values()];
  const index = noisyHubIndex(rows, state);

  const citedSourceKeyUnion = new Set();
  for (const card of cards) for (const s of card.sources || []) if (s.url || s.title) citedSourceKeyUnion.add(s.url || s.title);

  const cardEntries = cards.map((card) => cardArticle(card, cards, items, perItemGrounded, index));

  const cardlessEntries = items
    .filter((item) => (item.factIds || []).length > 0 && !citedSourceKeyUnion.has(item.url || item.title))
    .map((item) => ({
      kind: "cardless-admitted", id: item.id, sourceId: item.sourceId, title: item.title, factCount: item.factIds.length,
    }));

  const rejectedEntries = items
    .filter((item) => (item.factIds || []).length === 0)
    .map((item) => ({
      kind: "rejected", id: item.id, sourceId: item.sourceId, title: item.title, stage: rejectionStage(item, ledgerEntries),
    }));

  return [...cardEntries, ...cardlessEntries, ...rejectedEntries];
}

// ---------------------------------------------------------------------------
// markdown rendering
// ---------------------------------------------------------------------------

const pct = (rate) => (rate === null || rate === undefined ? "n/a" : `${(rate * 100).toFixed(2)}%`);
const num = (n) => (n === null || n === undefined ? "n/a" : (Number.isInteger(n) ? String(n) : n.toFixed(2)));

/** Each cited report as the source filed it — headline, description, byline.
 *  Indented as a markdown quote so it reads apart from the graph's own
 *  sentences above it. */
function renderReportBlock(sources) {
  const blocks = (sources || []).map((s) => {
    const cite = [s.name, s.publishedAt ? String(s.publishedAt).slice(0, 10) : ""].filter(Boolean).join(", ");
    const lines = [];
    if (s.title) lines.push(`> **${s.title}**`);
    if (s.summary) lines.push(`> ${s.summary}`);
    if (cite) lines.push(`> — ${cite}`);
    return lines.join("\n>\n");
  }).filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : "> (none)";
}

function renderCardSection(article, index) {
  const sourceNames = article.sources.map((s) => s.title || s.url).filter(Boolean).join(", ") || "none";
  const backing = article.backingItems.length
    ? article.backingItems.map((it) => `- ${it.sourceId}: "${it.title}" (${it.id})`).join("\n")
    : "- none";
  const noisyList = article.noisyContextLines.objects.length ? article.noisyContextLines.objects.join(", ") : "none";

  return `### ${index + 1}. ${article.hub}

**paragraph:** ${article.paragraph || "(empty)"}

**the report as filed:**

${renderReportBlock(article.sources)}

**what the graph already knew:** ${article.backgroundParagraph || "none"}

**sources:** ${sourceNames}

**date:** ${article.date || "no date"}

**backing item(s):**
${backing}

**scores:**
- grounded-term proportion: ${article.groundedTermProportion.grounded}/${article.groundedTermProportion.extracted} (${pct(article.groundedTermProportion.microAverage)}) over ${article.groundedTermProportion.articles} article(s)
- sentences in the paragraph: ${article.sentenceCount}
- noisy context lines: ${article.noisyContextLines.count} (${noisyList})
- repeats another card's sentence: ${article.repeatsSentencesOf || "no"}
- repeats another card's "Around it": ${article.repeatsAroundItOf || "no"}
- headline present: ${article.headlinePresent ? "yes" : "no"}, link present: ${article.linkPresent ? "yes" : "no"}, date present: ${article.datePresent ? "yes" : "no"}, raw summary present: ${article.summaryPresent ? "yes" : "no"}
`;
}

/** `report` is the same object `run.mjs`'s own `runBench` returns — its
 *  `metrics` fill the header table so this file stands alone without the
 *  paired `-articles.json`/main report open beside it. */
export function renderArticlesMarkdown(report, articles, { runDate, label }) {
  const m = report.metrics;
  const cards = articles.filter((a) => a.kind === "card");
  const cardless = articles.filter((a) => a.kind === "cardless-admitted");
  const rejected = articles.filter((a) => a.kind === "rejected");

  const rejectedBySource = {};
  for (const entry of rejected) (rejectedBySource[entry.sourceId] || (rejectedBySource[entry.sourceId] = [])).push(entry);

  const cardlessRows = cardless.length
    ? cardless.map((c) => `| ${c.sourceId} | "${c.title}" | ${c.factCount} |`).join("\n")
    : "| — | none | — |";

  const rejectedSections = Object.keys(rejectedBySource).sort().map((sourceId) => {
    const rows = rejectedBySource[sourceId].map((r) => `- "${r.title}" — ${r.stage}`).join("\n");
    return `### ${sourceId}\n\n${rows}`;
  }).join("\n\n") || "none";

  return `# newsbench articles — ${runDate} (${label})

| run label | seed | cards | admission | grounded-term | dedupe ratio | noisy-hub rate | repeated-sentence rate | ranked-term noise |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| ${label} | ${report.meta.seed} | ${cards.length} | ${pct(m.admissionRate.aggregate.rate)} | ${pct(m.groundedTermProportion.aggregate.microAverage)} | ${num(m.dedupeRatio.ratio)} | ${pct(m.noisyHubRelationRate.rate)} | ${pct(m.paragraphShape.repeatedSentenceRate)} | ${pct(m.rankedTermNoise.rate)} |

## Cards

${cards.map((c, i) => renderCardSection(c, i)).join("\n")}

## Admitted, no card minted

${cardless.length} item(s) grounded a fact but never made it into a card.

| source | headline | facts |
| --- | --- | --: |
${cardlessRows}

## Offered, never admitted

${rejected.length} item(s) admitted zero facts.

${rejectedSections}

## Reproduce

\`node scripts/news-bench/run.mjs --seed ${report.meta.seed} --label ${label}\`
`;
}
