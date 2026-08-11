// scripts/post-deploy-smoke.mjs — after a publish, check that what the world
// sees matches what we built. Reads package.json's version, then asks npm's
// registry and the Pages home page what they are serving. Both must agree.
// It also round-trips one row through the deployed row service, one live
// turn through the deployed turn service, and one corpus-band term read —
// same same-origin `/api/*` surface the page itself calls.
//
// Registry and Pages both lag a publish by a minute or two, so an early
// disagreement means nothing. This polls, and reports one only once the
// attempts run out. It reads public endpoints, so it needs no token; every
// probe that needs a session mints its own, so none needs one either.
//
// Run it after publish:npm and pages. With nothing published, it reports the
// disagreement it exists to catch. `rowServiceRoundTrip`, `turnServiceRoundTrip`
// and `corpusReadProbe` are exported so a test can point them at a local
// double instead of the live origin.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { parseVersionFile } from "../src/domain/version-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version, homepage } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const REGISTRY_URL = `https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`;
const PAGES_URL = homepage;
// The row service lives at the same origin as the page; SMOKE_API_BASE_URL
// exists so a dry run can point this at a local double (server/row-service's
// own reference backend) instead of the deployed origin.
const API_BASE_URL = process.env.SMOKE_API_BASE_URL ?? PAGES_URL;
const VERSION_URL = new URL("version.txt", PAGES_URL.endsWith("/") ? PAGES_URL : `${PAGES_URL}/`).href;
const ATTEMPTS = Number(process.env.SMOKE_ATTEMPTS ?? 10);
const DELAY_MS = Number(process.env.SMOKE_DELAY_MS ?? 30_000);
const FETCH_TIMEOUT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hex SHA-256 of `text`, for the `x-amz-content-sha256` header every
 *  body-carrying `/api/*` request needs: Lambda URLs behind OAC 403 at the
 *  URL auth layer, before the handler runs, if a body-carrying request
 *  arrives without it. */
function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "user-agent": `${name} post-deploy-smoke` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** The version npm's registry serves as `latest`. */
async function publishedVersion() {
  return JSON.parse(await fetchText(REGISTRY_URL)).version;
}

/** The version the deployed site's version.txt shows. */
async function pagesVersion() {
  const { version } = parseVersionFile(await fetchText(VERSION_URL));
  if (!version) throw new Error("version.txt shows no version");
  return version;
}

/** Whether the deployment actually serves the precompressed sibling of the
 *  wink vendor asset. The CloudFront function rewrites the request to the
 *  .gz/.br files the build writes next to it, by Accept-Encoding; this probe
 *  is what turns that behavior into a verified one. Returns the
 *  content-encoding served, or throws. */
async function vendorEncoding() {
  const url = new URL("vendor/wink.js", PAGES_URL.endsWith("/") ? PAGES_URL : `${PAGES_URL}/`).href;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "accept-encoding": "br, gzip", "cache-control": "no-cache", "user-agent": `${name} post-deploy-smoke` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const encoding = res.headers.get("content-encoding");
  if (!encoding) throw new Error("served with no content-encoding — the precompressed siblings are not being served");
  return encoding;
}

/** Whether the mudiii page actually reached the edge and is precompressed.
 *  Worth a probe of its own because it is a critical page asset. Returns the
 *  content-encoding served, or throws. */
async function mudiiiPage() {
  const url = new URL("mudiii.html", PAGES_URL.endsWith("/") ? PAGES_URL : `${PAGES_URL}/`).href;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "accept-encoding": "br, gzip", "cache-control": "no-cache", "user-agent": `${name} post-deploy-smoke` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const encoding = res.headers.get("content-encoding");
  if (!encoding) throw new Error("served with no content-encoding");
  return encoding;
}

/** Whether the town square's own 3D models actually reached the edge.
 *
 *  Worth a probe of its own because they are the site's ONE committed binary
 *  asset — every other thing the deploy ships is generated by the build, so a
 *  path that quietly drops committed files would show up nowhere else. Reads
 *  one model's byte length against the size the asset manifest records, so a
 *  truncated or HTML-error-page response fails rather than passing on a 200.
 *  Returns the byte count served, or throws. */
async function modelBytes() {
  const manifest = JSON.parse(readFileSync(new URL("../data/mudiii-assets.json", import.meta.url), "utf8"));
  const row = manifest.assets.find((a) => a.key === "well") ?? manifest.assets[0];
  const path = row.destPath.replace(/^public\//, "");
  const url = new URL(path, PAGES_URL.endsWith("/") ? PAGES_URL : `${PAGES_URL}/`).href;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "user-agent": `${name} post-deploy-smoke` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  const served = (await res.arrayBuffer()).byteLength;
  if (served !== row.bytes) throw new Error(`${path} served ${served} bytes, the manifest records ${row.bytes}`);
  return served;
}

/** PUT one row under a fresh session, GET it back, then DELETE the whole
 *  session — the round trip a real page's first write and its "stop and
 *  forget" both take. Throws on any step that doesn't behave; on success
 *  returns the minted session key (nothing to compare it against — a fresh
 *  UUID every run is the point). `baseUrl` defaults to the deployed origin;
 *  a test passes a local double's URL instead. */
export async function rowServiceRoundTrip(baseUrl = API_BASE_URL) {
  const origin = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const sessionKey = randomUUID();
  const rowKey = `fact:post-deploy-smoke@${sessionKey}`;
  const fetchJson = (path, init) => fetch(`${origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "content-type": "application/json", "user-agent": `${name} post-deploy-smoke`, ...init?.headers },
  });

  const putBody = JSON.stringify({ puts: [{ rowKey, rowClass: "fact", term: "", json: JSON.stringify({ smoke: true }) }] });
  const putRes = await fetchJson(`/api/sessions/${sessionKey}/rows`, {
    method: "PUT",
    body: putBody,
    headers: { "x-amz-content-sha256": sha256Hex(putBody) },
  });
  if (putRes.status !== 204) throw new Error(`PUT /api/sessions/:uuid/rows returned ${putRes.status}, not 204`);

  const getRes = await fetchJson("/api/rows", { method: "GET", headers: { "x-tmct-session": sessionKey } });
  if (!getRes.ok) throw new Error(`GET /api/rows returned ${getRes.status}, not 200`);
  const { rows } = await getRes.json();
  if (!rows.some((row) => row.rowKey === rowKey)) throw new Error("the row just PUT is missing from GET /api/rows");

  const deleteBody = JSON.stringify({ all: true });
  const deleteRes = await fetchJson(`/api/sessions/${sessionKey}/rows`, {
    method: "DELETE",
    body: deleteBody,
    headers: { "x-amz-content-sha256": sha256Hex(deleteBody) },
  });
  if (deleteRes.status !== 204) throw new Error(`DELETE /api/sessions/:uuid/rows returned ${deleteRes.status}, not 204`);

  return sessionKey;
}

/** POST one turn under a fresh session key, the same round trip the news
 *  page's chat area and any other turn-service caller takes. Throws unless
 *  the deployed turn service answers 200 with real reply text; on success
 *  returns the minted session key. `baseUrl` defaults to the deployed
 *  origin; a test passes a local double's URL instead. */
export async function turnServiceRoundTrip(baseUrl = API_BASE_URL) {
  const origin = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const sessionKey = randomUUID();
  const turnBody = JSON.stringify({ text: "hello" });
  const res = await fetch(`${origin}/api/sessions/${sessionKey}/turn`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "user-agent": `${name} post-deploy-smoke`,
      "x-amz-content-sha256": sha256Hex(turnBody),
    },
    body: turnBody,
  });
  if (res.status !== 200) throw new Error(`POST /api/sessions/:uuid/turn returned ${res.status}, not 200`);
  const { reply } = await res.json();
  if (typeof reply !== "string" || !reply.trim()) throw new Error("the turn service answered with no reply text");
  return sessionKey;
}

// A term the bundled mid-band seed never carries (§3.18 moved WordNet's
// depth out of the Lambda's own seed and into this band) — the same
// wordnet-complete/dolphin pairing test/services/turn-handler.test.mjs uses
// to prove a corpus-band round trip. Only present once the CI corpus:load
// job has loaded wordnet-complete for real, which is the point of the probe.
const CORPUS_PROBE_BAND = "wordnet-complete";
const CORPUS_PROBE_TERM = "dolphin";

/** GET one term from a loaded corpus band, no session key. Throws unless the
 *  band answers 200 with at least one row; on success returns the row
 *  count. `baseUrl` defaults to the deployed origin; a test passes a local
 *  double's URL instead. */
export async function corpusReadProbe(baseUrl = API_BASE_URL) {
  const origin = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const res = await fetch(`${origin}/api/corpus/${CORPUS_PROBE_BAND}/rows?term=${CORPUS_PROBE_TERM}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "user-agent": `${name} post-deploy-smoke` },
  });
  if (!res.ok) throw new Error(`GET /api/corpus/${CORPUS_PROBE_BAND}/rows returned ${res.status}, not 200`);
  const { rows } = await res.json();
  if (!rows.length) throw new Error(`no rows for the WordNet-only probe term "${CORPUS_PROBE_TERM}" — is ${CORPUS_PROBE_BAND} loaded?`);
  return rows.length;
}

/** One pass over every endpoint. Never throws; the caller decides when to give up. */
async function checkOnce() {
  const results = {};
  for (const [label, read] of [
    ["npm", publishedVersion],
    ["pages", pagesVersion],
    ["vendor", vendorEncoding],
    ["mudiii", mudiiiPage],
    ["models", modelBytes],
    ["api", rowServiceRoundTrip],
    ["turn", turnServiceRoundTrip],
    ["corpus", corpusReadProbe],
  ]) {
    try {
      results[label] = { value: await read() };
    } catch (err) {
      results[label] = { error: err.message };
    }
  }
  const ok = results.npm.value === version && results.pages.value === version
    && Boolean(results.vendor.value) && Boolean(results.mudiii.value) && Boolean(results.models.value)
    && Boolean(results.api.value) && Boolean(results.turn.value) && Boolean(results.corpus.value);
  return { results, ok };
}

const describe = (r) => r.error ?? r.value;

async function main() {
  console.log(`checking ${name}@${version} is live on npm and at ${PAGES_URL}, and that precompressed assets, the row service, the turn service and the corpus read serve`);
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    last = await checkOnce();
    const { npm, pages, vendor, api, turn, corpus } = last.results;
    console.log(`attempt ${attempt}/${ATTEMPTS}: npm=${describe(npm)} pages=${describe(pages)} vendor-encoding=${describe(vendor)} api=${describe(api)} turn=${describe(turn)} corpus=${describe(corpus)}`);
    if (last.ok) {
      console.log(`both serve ${version}, vendor/wink.js serves content-encoding: ${vendor.value}, the row service round-tripped session ${api.value}, the turn service answered session ${turn.value}, and the corpus read returned ${corpus.value} row(s)`);
      return 0;
    }
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
  const { npm, pages, vendor, api, turn, corpus } = last.results;
  console.error(`after ${ATTEMPTS} attempts, the deploy did not verify.`);
  console.error(`  npm:    ${describe(npm)}`);
  console.error(`  pages:  ${describe(pages)}`);
  console.error(`  vendor: ${describe(vendor)}`);
  console.error(`  api:    ${describe(api)}`);
  console.error(`  turn:   ${describe(turn)}`);
  console.error(`  corpus: ${describe(corpus)}`);
  if (vendor.error) {
    console.error(
      "  the vendor probe failing means precompressed serving on this deployment is still documented-but-unverified"
      + " — the .gz/.br siblings built, but the host did not serve one.",
    );
  }
  if (api.error) {
    console.error("  the api probe failing means the row service did not accept, return, or delete its own smoke row.");
  }
  if (turn.error) {
    console.error("  the turn probe failing means the turn service did not answer its own smoke turn.");
  }
  if (corpus.error) {
    console.error(`  the corpus probe failing means ${CORPUS_PROBE_BAND} is not loaded, or the corpus read route is not serving it.`);
  }
  return 1;
}

// Only run the live check when this file is the process entry point — a test
// imports `rowServiceRoundTrip` alone and must not trigger a run against the
// real deployed origin just by loading the module.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
