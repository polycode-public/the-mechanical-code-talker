// The news capability's config surface: NEWS_DEFAULTS, clampNewsConfig's
// clamps (including the poll floor of 5), resolveNewsConfig's [news]
// pass-through via normalizeConfig, mergeEffective precedence, and
// parseNewsRequest's request grammar.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEWS_DEFAULTS, clampNewsConfig, resolveNewsConfig, parseNewsRequest,
} from "../../src/services/news.mjs";
import { normalizeConfig, mergeEffective } from "../../src/adapters/toml-config.mjs";

test("NEWS_DEFAULTS carries the shipped defaults, sources and kb_sources included", () => {
  assert.deepEqual([...NEWS_DEFAULTS.sources], ["wikimedia-featured", "hacker-news", "usgs-quakes"]);
  assert.deepEqual([...NEWS_DEFAULTS.kbSources], ["simple-wikipedia", "wikidata", "wiktionary"]);
  assert.equal(NEWS_DEFAULTS.pollMinutes, 15);
  assert.equal(NEWS_DEFAULTS.itemCap, 30);
  assert.equal(NEWS_DEFAULTS.feedTop, 3);
});

test("clampNewsConfig folds a camelCase partial onto defaults and clamps every knob to its range", () => {
  assert.deepEqual(clampNewsConfig({}).sources, [...NEWS_DEFAULTS.sources]);
  const cfg = clampNewsConfig({
    feedTop: 99, itemCap: 0, enrichTermsPerCycle: 0, syllogismsPerIngest: 999, negativeCacheTtlHours: -5,
  });
  assert.equal(cfg.feedTop, 10, "feed_top clamps to [1,10]");
  assert.equal(cfg.itemCap, 1, "item_cap clamps to its floor of 1");
  assert.equal(cfg.enrichTermsPerCycle, 1, "enrich_terms_per_cycle clamps to its floor of 1");
  assert.equal(cfg.syllogismsPerIngest, 50, "syllogisms_per_ingest clamps to its ceiling of 50");
  assert.equal(cfg.negativeCacheTtlHours, 0, "a negative value clamps to zero, the general non-negative-integer rule");
});

test("clampNewsConfig: poll_minutes is 0 (on-demand) or floors at 5", () => {
  assert.equal(clampNewsConfig({ pollMinutes: 0 }).pollMinutes, 0, "zero is a legal on-demand-only choice");
  assert.equal(clampNewsConfig({ pollMinutes: 1 }).pollMinutes, 5, "a low nonzero value floors up to 5");
  assert.equal(clampNewsConfig({ pollMinutes: 60 }).pollMinutes, 60, "a value already above the floor is untouched");
  assert.equal(clampNewsConfig({ pollMinutes: NaN }).pollMinutes, NEWS_DEFAULTS.pollMinutes, "a non-finite value falls back to the default");
});

test("clampNewsConfig: min_interval_ms only ever narrows down to a non-negative integer, never invents a floor of its own", () => {
  assert.equal(clampNewsConfig({}).minIntervalMs, 0, "unset means no override");
  assert.equal(clampNewsConfig({ minIntervalMs: 5000 }).minIntervalMs, 5000);
  assert.equal(clampNewsConfig({ minIntervalMs: -50 }).minIntervalMs, 0);
});

test("clampNewsConfig: unknown source ids drop, known ones keep config order", () => {
  const cfg = clampNewsConfig({ sources: ["hacker-news", "not-a-real-source", "usgs-quakes"] });
  assert.deepEqual(cfg.sources, ["hacker-news", "usgs-quakes"]);
});

test("clampNewsConfig: extra_sources keeps only https entries with a non-empty id, deduped", () => {
  const cfg = clampNewsConfig({
    extraSources: [
      { id: "jsonfeed-org", url: "https://www.jsonfeed.org/feed.json" },
      { id: "insecure", url: "http://example.com/feed.xml" },
      { id: "", url: "https://example.com/feed.xml" },
      { id: "jsonfeed-org", url: "https://www.jsonfeed.org/feed.json" },
    ],
  });
  assert.deepEqual(cfg.extraSources, [{ id: "jsonfeed-org", url: "https://www.jsonfeed.org/feed.json" }]);
});

test("resolveNewsConfig reads the [news] table through normalizeConfig's sparse pass-through, snake_case mapped to camelCase", async () => {
  assert.deepEqual(resolveNewsConfig(null), clampNewsConfig({}));
  const norm = await normalizeConfig(
    { news: { poll_minutes: 30, feed_top: 5, kb_sources: ["wikidata"] } },
    { configDir: "/x" },
  );
  const cfg = resolveNewsConfig(norm);
  assert.equal(cfg.pollMinutes, 30);
  assert.equal(cfg.feedTop, 5);
  assert.deepEqual(cfg.kbSources, ["wikidata"]);
});

test("resolveNewsConfig's knobs take part in mergeEffective's arg > tmct.toml > default precedence", async () => {
  const toml = await normalizeConfig({ news: { poll_minutes: 30 } }, { configDir: "/x" });
  const { effective, sources } = mergeEffective({
    args: { news: { poll_minutes: 60 } },
    toml,
    defaults: { news: { poll_minutes: NEWS_DEFAULTS.pollMinutes } },
  });
  assert.equal(effective["news.poll_minutes"], 60);
  assert.equal(sources["news.poll_minutes"], "arg");
  const { effective: tomlWins } = mergeEffective({
    args: {},
    toml,
    defaults: { news: { poll_minutes: NEWS_DEFAULTS.pollMinutes } },
  });
  assert.equal(tomlWins["news.poll_minutes"], 30);
});

// ---- parseNewsRequest -------------------------------------------------------

test("parseNewsRequest: the bare show forms", () => {
  assert.deepEqual(parseNewsRequest("news"), { kind: "show" });
  assert.deepEqual(parseNewsRequest("latest news"), { kind: "show" });
  assert.deepEqual(parseNewsRequest("/news"), { kind: "show" });
  assert.deepEqual(parseNewsRequest("any news on volcanoes?"), { kind: "show", focus: "volcanoes" });
});

test("parseNewsRequest: the /news subcommands", () => {
  assert.deepEqual(parseNewsRequest("/news poll"), { kind: "poll" });
  assert.deepEqual(parseNewsRequest("/news rank"), { kind: "rank" });
  assert.deepEqual(parseNewsRequest("/news enrich"), { kind: "enrich" });
  assert.deepEqual(parseNewsRequest("/news sources"), { kind: "sources" });
  assert.deepEqual(parseNewsRequest("/news add https://example.com/feed.xml"), { kind: "add", url: "https://example.com/feed.xml" });
  assert.deepEqual(parseNewsRequest("/news interval 30"), { kind: "interval", minutes: 30 });
});

test("parseNewsRequest: an unrecognized subcommand reports itself rather than silently declining", () => {
  assert.deepEqual(parseNewsRequest("/news frobnicate"), { kind: "unknown", subcommand: "frobnicate" });
});

test("parseNewsRequest declines a non-news line", () => {
  assert.equal(parseNewsRequest("what is a volcano"), null);
  assert.equal(parseNewsRequest("newsletter signup"), null);
  assert.equal(parseNewsRequest(""), null);
});
