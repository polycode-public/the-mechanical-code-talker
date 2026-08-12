// scripts/news-bench/fixtures.mjs — the captured-fixture store both
// capture-fixtures.mjs (writer) and run.mjs (reader) share: where a source's
// dated capture lives on disk, and how to turn one back into a fetchImpl a
// real createNewsFetcher can drive. No network here — reading and replaying
// only.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_NEWS_SOURCE_IDS } from "../../src/adapters/corpus/news-sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const FIXTURES_DIR = join(ROOT, "test", "fixtures", "news-feeds");

export const FIXTURE_SOURCE_IDS = DEFAULT_NEWS_SOURCE_IDS;

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function sourceDir(sourceId) {
  return join(FIXTURES_DIR, sourceId);
}

/** Every captured date for `sourceId`, ascending. Empty when the source has
 *  never been captured. */
export function listSourceDates(sourceId) {
  const dir = sourceDir(sourceId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => DATE_FILE_RE.exec(name)?.[1])
    .filter(Boolean)
    .sort();
}

/** The most recent captured date for `sourceId`, or null when there is none. */
export function latestSourceDate(sourceId) {
  const dates = listSourceDates(sourceId);
  return dates.length ? dates[dates.length - 1] : null;
}

/** The parsed fixture file for one source and date. Throws (loudly, on
 *  purpose) when it is missing — a bench run over a date it has no capture
 *  for is a setup mistake, not a source that legitimately had nothing. */
export function loadFixture(sourceId, date) {
  const path = join(sourceDir(sourceId), `${date}.json`);
  if (!existsSync(path)) {
    throw new Error(`news-bench: no captured fixture for "${sourceId}" dated ${date} (${path})`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const missingResponse = () => ({
  ok: false, status: 404, headers: { get: () => null },
  json: async () => ({}), text: async () => "",
});

/** A fetchImpl that answers every URL from `fixture.calls`' own recorded
 *  {url, status, kind, body} — exact URL match, the same lookup key the
 *  courtesy gate itself used when the capture was recorded. A URL the
 *  fixture never saw (a bug in either the capture or the replay's own `now`)
 *  answers 404 rather than throwing, the same "nothing came back" shape a
 *  real dead source gives the gate. */
export function replayFetchImplFor(fixture) {
  const byUrl = new Map((fixture.calls || []).map((c) => [c.url, c]));
  return async (url) => {
    const call = byUrl.get(String(url));
    if (!call) return missingResponse();
    const ok = call.status >= 200 && call.status < 300;
    if (call.kind === "text") {
      const text = call.body ?? "";
      return {
        ok, status: call.status, headers: { get: () => null },
        text: async () => text,
        json: async () => JSON.parse(text || "null"),
      };
    }
    return {
      ok, status: call.status, headers: { get: () => null },
      json: async () => call.body,
      text: async () => JSON.stringify(call.body ?? null),
    };
  };
}
