// After `npm run demo:build`, every figure on receipts.html carries a
// data-source="<file>#<path>" attribute, and the value it displays matches
// what that committed file actually holds. This re-derives each expected
// value independently from the source file rather than trusting the page's
// own render, so a bug in build-demo-site.mjs's receipts template shows up
// here instead of only in a passing page. Reads public/ directly, so
// `npm run demo:build` must run first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const RECEIPTS_PAGE = join(PUBLIC_DIR, "receipts.html");

const siteUnbuilt = !existsSync(RECEIPTS_PAGE);

const fmtInt = (n) => Number(n).toLocaleString("en-US");
const fmtMs = (n) => Number(n).toFixed(2);

/** Dot/bracket path lookup, matching the same token grammar
 *  build-demo-site.mjs's receipts template addresses ("pages[3].bytesWire",
 *  "latencyMs.p50") — reimplemented here rather than imported, so a bug in
 *  one copy cannot hide behind the other. */
function resolveJsonPath(obj, path) {
  const tokens = path.match(/[^.[\]]+/g) || [];
  return tokens.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Every element in `html` carrying a data-source attribute, with its own
 *  displayed text. Matches the tag shapes the receipts template actually
 *  emits (`<strong data-source="...">value</strong>`,
 *  `<span data-source="...">value</span>`,
 *  `<blockquote data-source="...">value</blockquote>`) — content-free of
 *  nested tags, so a non-greedy run up to the next `<` is exact. */
function readFigures(html) {
  const re = /<(strong|span|blockquote)[^>]*\bdata-source="([^"]+)"[^>]*>([^<]*)<\/\1>/g;
  const figures = [];
  for (const m of html.matchAll(re)) figures.push({ tag: m[1], source: m[2], text: decodeEntities(m[3]) });
  return figures;
}

/** A bench report's own bolded headline sentence, extracted the same way
 *  build-demo-site.mjs's receipts template pulls it, for the two markdown
 *  sources the page cites. */
function extractReportHeadline(mdText, label) {
  const found = new RegExp(`\\*\\*${label}:\\s*([\\s\\S]*?)\\*\\*`).exec(mdText);
  assert.ok(found, `expected a **${label}: ...** headline in the report`);
  return found[1].trim();
}

function readPage() {
  assert.ok(existsSync(RECEIPTS_PAGE), "public/receipts.html is missing — run `npm run demo:build` first");
  return readFileSync(RECEIPTS_PAGE, "utf8");
}

test("receipts.html exists and carries at least 8 sourced figures", { skip: siteUnbuilt }, () => {
  const html = readPage();
  const figures = readFigures(html);
  assert.ok(figures.length >= 8, `expected at least 8 data-source figures, found ${figures.length}`);
});

test("every JSON-sourced figure matches the value in test-benchmarks/receipts/receipts.json", { skip: siteUnbuilt }, () => {
  const html = readPage();
  const figures = readFigures(html).filter((f) => f.source.startsWith("test-benchmarks/receipts/receipts.json#"));
  assert.ok(figures.length > 0, "expected at least one figure sourced from receipts.json");
  const receipts = JSON.parse(readFileSync(join(ROOT, "test-benchmarks", "receipts", "receipts.json"), "utf8"));
  for (const { source, text } of figures) {
    const path = source.split("#")[1];
    const raw = resolveJsonPath(receipts, path);
    assert.notEqual(raw, undefined, `${source}: path "${path}" resolved to nothing in receipts.json`);
    const expected = path === "host.model" ? String(raw)
      : /^latencyMs\.(p50|p90|p99|max)$/.test(path) ? fmtMs(raw)
      : fmtInt(raw);
    assert.equal(text, expected, `figure at ${source} shows "${text}", receipts.json holds "${expected}"`);
  }
});

test("the pages table lists every page receipts.json measured", { skip: siteUnbuilt }, () => {
  const html = readPage();
  const receipts = JSON.parse(readFileSync(join(ROOT, "test-benchmarks", "receipts", "receipts.json"), "utf8"));
  for (const slug of receipts.pages.map((p) => p.slug)) {
    assert.ok(html.includes(`<code>${slug}</code>`), `receipts.html has no row for page "${slug}"`);
  }
});

test("the answer-quality figure quotes the latest chatbench report's own headline", { skip: siteUnbuilt }, () => {
  const html = readPage();
  const figures = readFigures(html).filter((f) => f.tag === "blockquote" && f.source.includes("BENCHMARK_CEFR_ENGLISH"));
  assert.equal(figures.length, 1, "expected exactly one chatbench headline blockquote");
  const [relPath] = figures[0].source.split("#");
  const reportText = readFileSync(join(ROOT, relPath), "utf8");
  const expected = extractReportHeadline(reportText, "Result");
  assert.equal(figures[0].text, expected);
});

test("the index-fidelity figure quotes the latest idxbench report's own headline", { skip: siteUnbuilt }, () => {
  const html = readPage();
  const figures = readFigures(html).filter((f) => f.tag === "blockquote" && f.source.includes("BENCHMARK_CODE_INDEX"));
  assert.equal(figures.length, 1, "expected exactly one idxbench headline blockquote");
  const [relPath] = figures[0].source.split("#");
  const reportText = readFileSync(join(ROOT, relPath), "utf8");
  const expected = extractReportHeadline(reportText, "Headline");
  assert.equal(figures[0].text, expected);
});

test("every figure's cited source file is actually committed", { skip: siteUnbuilt }, () => {
  const html = readPage();
  const figures = readFigures(html);
  for (const { source } of figures) {
    const [relPath] = source.split("#");
    assert.ok(existsSync(join(ROOT, relPath)), `${source}: ${relPath} does not exist`);
  }
});
