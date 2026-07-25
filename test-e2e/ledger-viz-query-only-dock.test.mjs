// ledger-viz-query-only-dock.test.mjs — the query-only tmctMemoryAsk dock,
// driven in a real browser. Every other browser-driven ledger test
// (browser-chat.test.mjs, pages-ledger-teach.test.mjs, pages-ledger.test.mjs)
// serves the Pages DEMO SITE, where the live teach-and-ask bundle
// (tmctLedger) always loads and wins the dock's submit handler over
// tmctMemoryAsk (ledger-viz.mjs's own else-if). That means the CLI's actual
// output — `tmct viz` never links tmctLedger, only the checked-in
// tmctMemoryAsk bundle (bin/tmct.mjs's own viz mode, ledgerBundleAvailable
// left at renderLedgerHtml's default false) — has never been driven in a
// browser: this file closes that gap, and with it audits the two English
// phrasings ledger-viz.mjs itself generates for this exact dock (the
// example-term placeholder and the miss-time "try: ..." tips) by actually
// typing them back in and checking they ground.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { appendFact, readFactRows } from "../src/adapters/memory/core.mjs";
import { computeLedgerData, renderLedgerHtml, readMemoryAskBundle } from "../src/services/ledger-viz.mjs";
import { readDigestStructures, digestTermFromRows } from "../src/adapters/corpus/digest-bank.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const ANSWER_TIMEOUT_MS = 15_000;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

/** A small real graph, taught through the real appendFact path — the same
 *  shape e2e/ledger-viz-cli.test.mjs's own fixture uses, so a fresh `tmct
 *  viz` run against a real repo would carry the same query-only dock this
 *  test drives. */
async function seededRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ledger-query-dock-"));
  const TS = "2026-07-15T09:00:00.000Z";
  await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA", createdAt: TS });
  await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA", createdAt: TS });
  await appendFact(dir, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf", createdAt: TS });
  await appendFact(dir, { subject: "cat", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA", createdAt: TS });
  await appendFact(dir, { subject: "cat", predicate: "mgx:hasA", object: "whiskers", provenance: "corpus:human /r/HasA", createdAt: TS });
  await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat", createdAt: TS });
  return dir;
}

/** Render exactly what `bin/tmct.mjs viz` writes (ledgerBundleAvailable left
 *  at its default false: only tmctMemoryAsk links, never tmctLedger) into a
 *  throwaway directory, and serve it. */
async function buildAndServeQueryOnlyLedger(memoryDir) {
  const data = await computeLedgerData(memoryDir);
  const memoryAskBundle = await readMemoryAskBundle();
  // Exactly what bin/tmct.mjs's viz mode embeds: the structure table (so the
  // page reads a refocused term back client-side) and the initial focus's
  // node-side digest (the fallback for a page whose engine never loads).
  const digestStructures = readDigestStructures();
  let focusDigest = null;
  if (data.focus && data.payload) {
    const allFactRows = readFactRows(data.payload);
    const focusRows = allFactRows.filter((r) => r.subject === data.focus);
    const article = focusRows.length ? digestTermFromRows(data.focus, focusRows, allFactRows, { budget: 8 }) : null;
    if (article && article.paragraphs.length) {
      focusDigest = {
        term: data.focus,
        paragraphs: article.paragraphs,
        sources: [...new Set(article.sources.map((s) => s.provenance).filter(Boolean))],
        facts: (article.detail.facts || []).map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
        factCount: article.detail.factCount,
      };
    }
  }
  const html = renderLedgerHtml({ ...data, memoryAskBundle, digestStructures, focusDigest });
  const siteDir = await mkdtemp(join(tmpdir(), "tmct-ledger-query-dock-site-"));
  await writeFile(join(siteDir, "ledger.html"), html, "utf8");
  const server = await serveDirectory(siteDir);
  return { siteDir, server };
}

async function openPage(server) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  await page.goto(`${server.origin}/ledger.html`, { waitUntil: "networkidle" });
  await page.locator("#chatform").waitFor({ state: "visible" });
  return { context, page };
}

async function ask(page, question) {
  // The goal line renders as its own "a goal" entry (see chat's own
  // withGoalLine posture, mirrored here) — excluded so it never masquerades
  // as the answer this helper reads back.
  const replies = page.locator("#chatlog > div.a:not(.goal)");
  const before = await replies.count();
  await page.fill("#chatq", question);
  await page.press("#chatq", "Enter");
  await page.waitForFunction(
    (seen) => document.querySelectorAll("#chatlog > div.a:not(.goal)").length > seen,
    before,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const reply = replies.last();
  const className = (await reply.getAttribute("class")) ?? "";
  return { text: (await reply.textContent()) ?? "", isMiss: className.split(/\s+/).includes("miss") };
}

test("the CLI's own ledger output links only tmctMemoryAsk, never tmctLedger — the query-only branch is the one this file drives", async () => {
  const memoryDir = await seededRepo();
  const { siteDir, server } = await buildAndServeQueryOnlyLedger(memoryDir);
  try {
    const { context, page } = await openPage(server);
    try {
      const engines = await page.evaluate(() => ({
        hasMemoryAsk: typeof window.tmctMemoryAsk !== "undefined",
        hasLedger: typeof window.tmctLedger !== "undefined",
      }));
      assert.equal(engines.hasMemoryAsk, true, "the checked-in query-only bundle loaded");
      assert.equal(engines.hasLedger, false, "the CLI's own output never links the live teach bundle");
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    await rm(siteDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("the query-only dock grounds a real question and reports a source", async () => {
  const memoryDir = await seededRepo();
  const { siteDir, server } = await buildAndServeQueryOnlyLedger(memoryDir);
  try {
    const { context, page } = await openPage(server);
    try {
      const reply = await ask(page, "what is a dog");
      assert.equal(reply.isMiss, false, "a term the graph holds is answered, not missed");
      assert.match(reply.text, /dog is a kind of animal/, "the answer reads back the taught fact");
      assert.match(reply.text, /source: corpus:human/, "the answer carries its provenance");
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    await rm(siteDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("a relation question chases the taught fact through factReadBack, not just factAnswer", async () => {
  const memoryDir = await seededRepo();
  const { siteDir, server } = await buildAndServeQueryOnlyLedger(memoryDir);
  try {
    const { context, page } = await openPage(server);
    try {
      const reply = await ask(page, "who is the father of john");
      assert.equal(reply.isMiss, false, "a taught relation is answered, not missed");
      assert.match(reply.text, /ahab/i, "the chase reaches ahab");
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    await rm(siteDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("an honest miss names this dock's OWN canned wording and offers real, term-length-floored tips that themselves ground when tried", async () => {
  const memoryDir = await seededRepo();
  const { siteDir, server } = await buildAndServeQueryOnlyLedger(memoryDir);
  try {
    const { context, page } = await openPage(server);
    try {
      const reply = await ask(page, "what is a quokka");
      assert.equal(reply.isMiss, true, "an unknown term is reported as a miss");
      // This dock's own narrower canned text (never runTurn's richer teach-me
      // cascade — that only exists on the live tmctLedger branch this page
      // doesn't carry): see ledger-viz.mjs's tmctMemoryAsk fallback branch.
      assert.match(reply.text, /I can't ground that in this graph/);
      const tipMatch = /try: (.+)\.$/.exec(reply.text);
      assert.ok(tipMatch, `the miss offers suggested queries: ${reply.text}`);
      const tips = [...tipMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(tips.length >= 1, "at least one tip renders");
      for (const tip of tips) {
        assert.ok(!/^what is (.{1,2})$/.test(tip), `tip "${tip}" names a term at least 3 characters long`);
      }
      // The audit itself: type the exact suggested phrasing back in and
      // confirm it genuinely grounds, closing the loop the miss-tips imply.
      for (const tip of tips) {
        const follow = await ask(page, tip);
        assert.equal(follow.isMiss, false, `the suggested query "${tip}" itself grounds, not a second miss`);
      }
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    await rm(siteDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("the example-term placeholder itself grounds when typed verbatim", async () => {
  const memoryDir = await seededRepo();
  const { siteDir, server } = await buildAndServeQueryOnlyLedger(memoryDir);
  try {
    const { context, page } = await openPage(server);
    try {
      const placeholder = await page.locator("#chatq").getAttribute("placeholder");
      assert.match(placeholder, /^ask the graph… e\.g\. (.+)$/, `unexpected placeholder shape: ${placeholder}`);
      const example = /^ask the graph… e\.g\. (.+)$/.exec(placeholder)[1];
      const reply = await ask(page, example);
      assert.equal(reply.isMiss, false, `the placeholder's own example query "${example}" grounds`);
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    await rm(siteDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});

test("the query-only page reads a refocused term back as a digest, computed client-side from the embedded structure table over the same store", async () => {
  const memoryDir = await seededRepo();
  const { siteDir, server } = await buildAndServeQueryOnlyLedger(memoryDir);
  try {
    const { context, page } = await openPage(server);
    try {
      // Refocus to a term that composes, through the search box. No live teach
      // bundle is present here, so a digest for the new focus can only come from
      // the client path over tmctMemoryAsk — the CLI page's own engine.
      await page.fill("#q", "cat");
      await page.press("#q", "Enter");
      await page.waitForFunction(
        () => /\bcat\b/.test(document.querySelector(".focuscard .term")?.textContent || ""),
        null,
        { timeout: ANSWER_TIMEOUT_MS },
      );

      const digest = page.locator(".focuscard .focusdigest");
      await digest.waitFor({ state: "visible", timeout: ANSWER_TIMEOUT_MS });
      const paras = await digest.locator("p:not(.dgsrc)").allInnerTexts();
      assert.ok(paras.join(" ").toLowerCase().includes("cat"), `the refocused digest reads the new term back, got ${JSON.stringify(paras)}`);
      assert.match(paras.join(" "), /animal/i, "the narrative states the term's class");

      // Provenance rides through in the shared "(sources: …)" idiom.
      const src = (await digest.locator(".dgsrc").innerText()).trim();
      assert.match(src, /^\(sources:.*\)$/, `the sources line matches the idiom, got ${JSON.stringify(src)}`);

      // The full fact list is reachable behind the explicit escape.
      assert.equal(await digest.locator(".dgfacts").getAttribute("open"), null, "the fact list starts collapsed");
      await digest.locator(".dgfacts > summary").click();
      const facts = await digest.locator(".dgfacts .dgfactlist .dgfact").allInnerTexts();
      assert.ok(facts.length >= 1, "show the facts reveals the stored facts behind the narrative");
      assert.ok(facts.join(" ").toLowerCase().includes("cat"), "the revealed facts are about the refocused term");
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    await rm(siteDir, { recursive: true, force: true });
    await rm(memoryDir, { recursive: true, force: true });
  }
});
