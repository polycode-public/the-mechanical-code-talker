// scripts/news-bench/articles.mjs — the bench's per-run articles log
// (PLAN_NEWS_FEED_QUALITY.md section 2): every card's rendered text, its
// backing source item(s), and the offered items that never became one.
// Pure: takes a run's own already-computed feed/state/rows, no I/O and no
// clock of its own, so the same run produces the same articles report byte
// for byte. Card date/backing-item data the feed document itself does not
// expose (PLAN_NEWS_FEED_QUALITY.md section 1's own named gap) is computed
// here from the poll state rather than touching src.
import { normFactTerm } from "../../src/domain/hash.mjs";
import { ledgerFromPayload } from "../../src/domain/term-ledger.mjs";
import { NOISY_HUB_CLASS_TERMS, groundedTermPerItem } from "./metrics.mjs";

const IDENTITY_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf"]);

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

/** Items whose own extracted facts intersect a card's factIds set — the
 *  source item(s) a card's paragraph was built from, its own two-hop
 *  background included. Sorted by fetchedAt then id so the same run always
 *  lists them in the same order. */
function backingItemsFor(card, items) {
  const cardFactIds = new Set(card.factIds || []);
  return items
    .filter((item) => (item.factIds || []).some((id) => cardFactIds.has(id)))
    .sort(byFetchedAtThenId);
}

/** The latest publishedAt among a card's backing items, or null. */
function cardDate(backingItems) {
  const dates = backingItems.map((item) => item.publishedAt).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** A card's own identity-sentence objects (its hub's rdf:type/subClassOf
 *  rows) that fall in the noisy-hub-relation rate's closed class list —
 *  metric 5, read out per card instead of pooled across the feed. */
function cardNoisyContextLines(card, rowsById) {
  const objects = [];
  for (const factId of card.factIds || []) {
    const row = rowsById.get(factId);
    if (!row || !IDENTITY_PREDICATES.has(row.predicate)) continue;
    if (normFactTerm(row.subject) !== card.hub) continue;
    if (NOISY_HUB_CLASS_TERMS.has(normFactTerm(row.object))) objects.push(row.object);
  }
  return objects;
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

function cardArticle(card, allCards, items, rowsById, perItemGrounded) {
  const backingItems = backingItemsFor(card, items);
  const noisy = cardNoisyContextLines(card, rowsById);
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
    headlinePresent: (card.sources || []).some((s) => s.title),
    linkPresent: (card.sources || []).some((s) => s.url),
    datePresent: date !== null,
  };
}

/** The whole articles log as one flat, kind-discriminated array: one "card"
 *  entry per feed card (feed order preserved), one "cardless-admitted" entry
 *  per item that grounded a fact no card ever cites, and one "rejected"
 *  entry per item that admitted nothing at all — the produced articles and
 *  the two ways an article failed to happen, all in the same machine-
 *  readable shape. */
export function buildArticlesReport({ feed, state, rows }) {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const items = state.items || [];
  const cards = feed.items;
  const perItemGrounded = new Map(groundedTermPerItem(state, rows).map((r) => [r.itemId, r]));
  const ledgerEntries = [...ledgerFromPayload(state.ledger).terms.values()];

  const cardFactIdUnion = new Set();
  for (const card of cards) for (const id of card.factIds || []) cardFactIdUnion.add(id);

  const cardEntries = cards.map((card) => cardArticle(card, cards, items, rowsById, perItemGrounded));

  const cardlessEntries = items
    .filter((item) => (item.factIds || []).length > 0 && !(item.factIds || []).some((id) => cardFactIdUnion.has(id)))
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

function renderCardSection(article, index) {
  const sourceNames = article.sources.map((s) => s.title || s.url).filter(Boolean).join(", ") || "none";
  const backing = article.backingItems.length
    ? article.backingItems.map((it) => `- ${it.sourceId}: "${it.title}" (${it.id})`).join("\n")
    : "- none";
  const noisyList = article.noisyContextLines.objects.length ? article.noisyContextLines.objects.join(", ") : "none";

  return `### ${index + 1}. ${article.hub}

**paragraph:** ${article.paragraph || "(empty)"}

**what the graph already knew:** ${article.backgroundParagraph || "none"}

**sources:** ${sourceNames}

**date:** ${article.date || "no date"}

**backing item(s):**
${backing}

**scores:**
- grounded-term proportion: ${article.groundedTermProportion.grounded}/${article.groundedTermProportion.extracted} (${pct(article.groundedTermProportion.microAverage)}) over ${article.groundedTermProportion.articles} article(s)
- noisy context lines: ${article.noisyContextLines.count} (${noisyList})
- repeats another card's sentence: ${article.repeatsSentencesOf || "no"}
- repeats another card's "Around it": ${article.repeatsAroundItOf || "no"}
- headline present: ${article.headlinePresent ? "yes" : "no"}, link present: ${article.linkPresent ? "yes" : "no"}, date present: ${article.datePresent ? "yes" : "no"}
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
