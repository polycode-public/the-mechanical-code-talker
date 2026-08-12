// The product's whole loop, once, locally: poll cached news fixtures, then
// enrich ungrounded terms through the real live reference works, then build
// the feed. Prints every card with its enrichment.
import { readFileSync } from "node:fs";
import { createNewsFetcher, NEWS_SOURCE_RECORDS } from "./src/adapters/corpus/news-sources.mjs";
import { clampNewsConfig, createNewsState, pollNewsSources, enrichTopTerms, buildFeed } from "./src/services/news.mjs";
import { openMemoryBackend, loadMemory, readFactRows, appendFacts, removeFacts } from "./src/adapters/memory/core.mjs";
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

const backend = await openMemoryBackend("unused-repo-root", "memory");
const ctx = {
  memoryDir: backend.dir,
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
for (const item of feed.items) {
  console.log(`\n### ${item.hub}${item.newName ? "  [new name]" : ""}`);
  console.log("paragraph:", item.paragraph);
  if (item.backgroundParagraph) console.log("already knew:", item.backgroundParagraph);
  console.log("sources:", (item.sources || []).map((s) => s.title).join(" | "));
}
await backend.close();
