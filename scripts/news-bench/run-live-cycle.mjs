// The quality loop's run step (PLAN_NEWS_FEED_QUALITY.md section 4): one
// full product cycle, locally — poll the cached news fixtures, synthesise
// facts, enrich ungrounded terms through the real live reference works, and
// build the feed — then print every card in the four-part form the loop
// reads: OUR PARAGRAPH, FACTS LEARNED, RELATED FACTS ALREADY HELD, and
// ORIGINAL TEXT. Fresh fixtures come from capture-fixtures.mjs; the xl seed
// from build:chat-seed (ensure-bench-inputs.mjs builds what is missing).
// Network is used ONLY for the enrichment lookups — the news sources are
// always the committed captures.
import { readFileSync } from "node:fs";
import { createNewsFetcher, NEWS_SOURCE_RECORDS } from "./src/adapters/corpus/news-sources.mjs";
import { clampNewsConfig, createNewsState, pollNewsSources, enrichTopTerms, buildFeed } from "./src/services/news.mjs";
import { createInMemoryStore, applySeedPayload, loadMemory, readFactRows, appendFacts, removeFacts } from "./src/adapters/memory/core.mjs";
import { loadLexicon } from "./src/domain/grammar/lexicon.mjs";
import { getResearchProvider } from "./src/adapters/corpus/wikipedia-live.mjs";
import { rankedTerms, ledgerFromPayload } from "./src/domain/term-ledger.mjs";

const NOW = new Date().toISOString();
const SOURCES = ["hacker-news", "nyt-world"];

function fixtureTransport(sourceId) {
  const capture = JSON.parse(readFileSync(`test/fixtures/news-feeds/${sourceId}/2026-08-12.json`, "utf8"));
  const calls = capture.calls;
  return async (url) => {
    const u = String(url);
    const hit = calls.find((c) => c.url === u) || calls[0];
    return {
      ok: true, status: hit.status ?? 200, headers: { get: () => null },
      json: async () => (typeof hit.body === "string" ? JSON.parse(hit.body) : hit.body),
      text: async () => (typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body)),
    };
  };
}

const handle = createInMemoryStore();
applySeedPayload(handle, JSON.parse(readFileSync("public/chat-seed.json", "utf8")));
const ctx = {
  memoryDir: handle,
  store: { loadMemory, readFactRows, appendFacts, removeFacts },
  cache: null,
  lexicon: loadLexicon(),
  config: clampNewsConfig({ sources: SOURCES }),
  state: createNewsState(),
  providers: {
    newsFetchers: new Map(SOURCES.map((id) => [
      id,
      createNewsFetcher(NEWS_SOURCE_RECORDS.find((r) => r.id === id), {
        fetchImpl: fixtureTransport(id), minIntervalMs: 0, now: NOW,
      }),
    ])),
    getResearchProvider,
  },
  now: () => NOW,
  notify: null,
};

console.log("== step 1+2: poll (ingest + synthesise) ==");
const poll = await pollNewsSources(ctx);
console.log(JSON.stringify(poll.sources ?? poll, null, 1));

const pending = rankedTerms(ledgerFromPayload(ctx.state.ledger), { limit: 20, status: "pending", now: NOW, ttlMs: 3600000 });
console.log("\nungrounded terms queued for enrichment:", pending.map((e) => `${e.term}(${e.count})`).join(", "));

console.log("\n== step 3: enrich (live reference lookups) ==");
const enrich = await enrichTopTerms(ctx, { limit: 8 });
console.log(JSON.stringify(enrich, null, 1));

console.log("\n== the enriched feed ==");
const feed = await buildFeed(ctx);
const allRows = readFactRows(await loadMemory(ctx.memoryDir));
const rowById = new Map(allRows.map((r) => [r.id, r]));
const snapshotByTitle = new Map((ctx.state.items || []).map((s) => [s.title, s]));
const rowLine = (r) => `${r.subject} | ${r.predicate} | ${r.object}`;
for (const item of feed.items) {
  console.log(`\n### ${item.hub}${item.newName ? "  [new name]" : ""}`);
  console.log("OUR PARAGRAPH:", item.paragraph);
  const ids = [...new Set([...(item.factIds || []), ...(item.background || [])])];
  const rows = ids.map((id) => rowById.get(id)).filter(Boolean);
  const hubNorm = String(item.hub || "").toLowerCase();
  const touchesHub = (r) => String(r.subject || "").toLowerCase() === hubNorm || String(r.object || "").toLowerCase() === hubNorm;
  const learned = rows.filter((r) => /(?:^|:)(?:news|news-fixture):/.test(String(r.provenance || "")) && touchesHub(r));
  const known = rows.filter((r) => !/(?:^|:)(?:news|news-fixture):/.test(String(r.provenance || "")));
  console.log("FACTS LEARNED:");
  for (const r of learned) console.log("  ", rowLine(r));
  console.log("RELATED FACTS ALREADY HELD:");
  if (!known.length) console.log("   (none)");
  for (const r of known.slice(0, 12)) console.log("  ", rowLine(r), `[${provSourceLabel(r.provenance)}]`);
  console.log("ORIGINAL TEXT:");
  for (const s of item.sources || []) {
    const snap = snapshotByTitle.get(s.title);
    console.log(`   ${s.title}`);
    if (snap?.summary) console.log(`   ${snap.summary}`);
    console.log(`   — ${s.name || ""} ${s.publishedAt || ""}`);
  }
}
function provSourceLabel(p) {
  const head = String(p || "").split(/\s+/)[0] || "";
  if (head.startsWith("research:")) return head.split(":").slice(0, 2).join(":");
  if (head.includes("seed") || head === "" ) return "seed";
  return head.split(":")[0] || "seed";
}
