#!/usr/bin/env node
// scripts/probe-news-sources.mjs — the maintenance re-probe for the news
// source registry (PLAN_NEWS_FEED.md section 4 and 9.5): fetches every
// registered record from a real headless-Chromium page context on an https
// origin, and prints the same verdict table the plan's own probe rounds
// recorded, so a maintainer can re-run it by hand when a source misbehaves
// or before bumping a record's `browserVerified` date.
//
// Why a page context and not a plain Node fetch: the shipped page is static
// with no backend, so what decides whether a source is usable is whether a
// BROWSER can read it — CORS is a browser-only rule, and section 4's own
// probe rounds found sources whose CORS header is conditional on the
// requesting client (present for curl, absent for Chromium). A Node fetch
// would pass every source curl passed and miss that distinction entirely.
//
// Run by hand: `node scripts/probe-news-sources.mjs`. Never part of any test
// tier (CI has no internet) and never invoked by the news capability itself
// — the registry's own `browserVerified` field is the artifact this script
// updates, not a runtime dependency.
import { chromium } from "playwright";

import { newsSourceRecords } from "../src/adapters/corpus/news-sources.mjs";

// A real, stable https origin to run `fetch` from — the page's own origin is
// what a source's CORS policy is evaluated against, so any real https page
// works; this one carries nothing else the probe depends on.
const PROBE_ORIGIN = "https://example.com/";
const PROBE_TERM = "heart";
const REQUEST_TIMEOUT_MS = 8000;

function utcDateParts(now) {
  const d = new Date(now);
  return {
    yyyy: d.getUTCFullYear(),
    mm: String(d.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(d.getUTCDate()).padStart(2, "0"),
  };
}

/** One representative URL per record format — not the full multi-step
 *  fetch a live poll runs (Hacker News's ten item calls, Wikidata's three
 *  round trips), just enough to answer "does a browser on this origin get a
 *  usable response at all". */
function representativeUrl(record) {
  const { yyyy, mm, dd } = utcDateParts(Date.now());
  switch (record.format) {
    case "wikimedia-feed":
      return `${record.url}/${yyyy}/${mm}/${dd}`;
    case "hn":
      return `${record.url}/topstories.json`;
    case "mediawiki":
      return `${record.url}?action=query&list=recentchanges&rcnamespace=0&rcnewonly=1&rclimit=5&format=json&formatversion=2&origin=*`;
    case "wikipedia-summary":
      return `${record.url}/api/rest_v1/page/summary/${PROBE_TERM}`;
    case "wikidata":
      return `${record.url}/w/api.php?action=wbsearchentities&format=json&language=en&type=item&search=${PROBE_TERM}&origin=*`;
    case "wiktionary":
      return `${record.url}/api/rest_v1/page/definition/${PROBE_TERM}`;
    case "dbpedia-lookup":
      return `${record.url}/api/search?query=${PROBE_TERM}&maxResults=5&format=json`;
    default:
      // rss, atom, jsonfeed, usgs: the record's own url is already the feed.
      return record.url;
  }
}

/** Run inside the page context via page.evaluate — this closure is
 *  serialized and executed IN the browser, so it has no access to anything
 *  outside its own arguments. */
async function probeInPage({ url, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      size: body.length,
      acao: res.headers.get("access-control-allow-origin"),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

function verdictLine(record, result, url) {
  const status = result.ok ? `pass (${result.status}, ${result.size} bytes, ACAO: ${result.acao ?? "none"})` : `FAIL — ${result.error ?? `status ${result.status}`}`;
  return `| ${record.id} | ${record.kind} | ${record.format} | \`${url}\` | ${status} |`;
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(PROBE_ORIGIN);

    console.log(`probe-news-sources: ${new Date().toISOString()}, origin ${PROBE_ORIGIN}\n`);
    console.log("| source | kind | format | probed url | browser verdict |");
    console.log("|---|---|---|---|---|");

    for (const record of newsSourceRecords()) {
      const url = representativeUrl(record);
      const result = await page.evaluate(probeInPage, { url, timeoutMs: REQUEST_TIMEOUT_MS });
      console.log(verdictLine(record, result, url));
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`probe-news-sources: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
