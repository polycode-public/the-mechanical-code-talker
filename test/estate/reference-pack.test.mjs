// scripts/fetch-reference-pack.mjs builds corpus/reference/ from a pinned
// Simple English Wikipedia dump. The build phases are pure exported functions,
// driven here over a hand-written dump fixture so the whole
// parse/clean/select/emit pipeline is pinned without any dump on disk. The
// committed-pack guards at the bottom activate only where corpus/reference/
// has actually been built (mirrored on the missing-WordNet skip in
// generated-artifacts.test.mjs): absent pack, nothing to guard.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPages, redirectTargetOf, isDisambiguation, wikitextToPlain, passesSanityCheck,
  sentencesUpTo, isaOf, selectArticles, emitPack,
  BUDGET_TEXT_BYTES, BUDGET_SHARDS_GZ_BYTES, BUDGET_INDEX_GZ_BYTES, REFERENCE_LICENSE_NOTICE,
} from "../../scripts/fetch-reference-pack.mjs";
import { shardNameFor, isReferenceIndexEntry, isReferenceArticleRow } from "../../src/domain/reference-pack.mjs";
import { normFactTerm } from "../../src/domain/hash.mjs";
import { loadLexicon, lookupNoun } from "../../src/domain/grammar/lexicon.mjs";
import { loadReferenceArticle, clearReferencePackCache } from "../../src/adapters/corpus/reference-pack.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DUMP_FIXTURE = join(REPO_ROOT, "test", "fixtures", "reference-dump.xml");
const PACK_DIR = join(REPO_ROOT, "corpus", "reference");

/** The fixture dump as awkward 13-byte chunks, so a <page> element never
 *  arrives whole and the parser's chunk-boundary handling is what's tested. */
async function* fixtureChunks() {
  const xml = readFileSync(DUMP_FIXTURE, "utf8");
  for (let i = 0; i < xml.length; i += 13) yield xml.slice(i, i + 13);
}

async function collectPages() {
  const pages = [];
  for await (const page of extractPages(fixtureChunks())) pages.push(page);
  return pages;
}

// ---- the cleaning steps, individually ---------------------------------------

test("wikitextToPlain cuts at the first heading and strips templates, refs, comments, media, tables and quote markup", () => {
  assert.equal(
    wikitextToPlain("'''Bold''' and ''italic'' text.\n== History ==\nGone."),
    "Bold and italic text.",
  );
  assert.equal(wikitextToPlain("{{Infobox|a=[[File:x.jpg|thumb]]}}A dog is an animal."), "A dog is an animal.");
  assert.equal(wikitextToPlain("A dog<ref>source</ref> barks.<ref name=\"x\"/>"), "A dog barks.");
  assert.equal(wikitextToPlain("<!-- hidden -->A [[dog|puppy]] chases a [[cat]]."), "A puppy chases a cat.");
  assert.equal(
    wikitextToPlain("[[File:Dog.jpg|thumb|A dog [[running]] fast]]A dog runs."),
    "A dog runs.",
    "a media block keeps its nested links out of the prose",
  );
  assert.equal(wikitextToPlain("{| class=\"wikitable\"\n|-\n| cell\n|}\nA table-laden lead survives."), "A table-laden lead survives.");
  assert.equal(wikitextToPlain("Fish &amp; chips&nbsp;here."), "Fish & chips here.");
  const messy = "  A   dog\n\n  barks. ";
  assert.equal(wikitextToPlain(messy), "A dog barks.");
});

test("redirect, disambiguation and sanity classifiers say what they see", () => {
  assert.equal(redirectTargetOf("#REDIRECT [[Harbor]]"), "Harbor");
  assert.equal(redirectTargetOf("#redirect [[Otter_(animal)|otters]]"), "Otter (animal)");
  assert.equal(redirectTargetOf("A plain article."), null);
  assert.ok(isDisambiguation("Crane may mean:\n{{disambiguation}}"));
  assert.ok(isDisambiguation("{{ disambig |geo}}"));
  assert.ok(!isDisambiguation("A crane is a bird."));
  assert.ok(passesSanityCheck("A meadow is a field of grass and wild flowers."));
  assert.ok(!passesSanityCheck("Too short."), "under 40 chars is dropped");
  assert.ok(!passesSanityCheck("| stray table cell markup that goes on long enough."), "must start with a letter");
  assert.ok(!passesSanityCheck("A sentence that never actually finishes with a period"), "no finished sentence, no article");
});

test("sentencesUpTo keeps whole sentences under the cap; isaOf needs the pattern AND a lexicon head noun", () => {
  const text = "A meadow is a field. Meadows are open land. Farmers cut hay.";
  assert.equal(sentencesUpTo(text, 45), "A meadow is a field. Meadows are open land.");
  assert.equal(sentencesUpTo(text, 10), "A meadow i", "a first sentence over the cap is hard-cut at it");
  const lexicon = loadLexicon();
  assert.equal(isaOf("An otter is an animal that swims.", lexicon), "animal");
  assert.equal(isaOf("A zorbulon is a blorf with fur.", lexicon), null, "an unresolvable head noun is no isa");
  assert.equal(isaOf("it is a bird.", lexicon), null, "must start like a sentence");
  assert.equal(
    isaOf("Otters are animals that live near water. They are a part of a larger family.", lexicon),
    "animal",
    "the copula must sit in the first sentence — a later sentence never supplies the category",
  );
  assert.equal(isaOf("A beagle is a small kind of dog.", lexicon), "dog", "an of-chain resolves to its final noun");
  assert.equal(isaOf("A harbor is a place where ships shelter.", lexicon), "place", "a relative clause ends the phrase");
  assert.equal(isaOf("An otter is a member of the weasel family.", lexicon), null, "a generic classifier head is no isa");
  assert.equal(isaOf("The sun is light and warm.", lexicon), null, "a bare predicate head must be an inflected plural");
  assert.equal(isaOf("Falcons are birds of prey.", lexicon), null, "the of-chain head 'prey' is not a folded plural");
});

// ---- the pipeline end-to-end over the dump fixture --------------------------

test("the fixture dump builds a pack: resolvable titles ship, redirects alias, talk/disambiguation/non-lexicon pages do not", async () => {
  const all = await collectPages();
  assert.equal(all.length, 7, "every <page> element is parsed despite the 13-byte chunking");

  const redirects = [];
  for (const p of all) {
    if (p.ns !== 0) continue;
    const target = p.redirect ?? redirectTargetOf(p.text);
    if (target) redirects.push({ from: p.title, to: target });
  }
  assert.deepEqual(redirects, [{ from: "Harbour", to: "Harbor" }]);

  const lexicon = loadLexicon();
  const pages = [];
  for (const p of all) {
    if (p.ns !== 0 || p.redirect || redirectTargetOf(p.text)) continue;
    if (isDisambiguation(p.text)) continue;
    const plain = wikitextToPlain(p.text);
    if (!passesSanityCheck(plain)) continue;
    pages.push({ title: p.title, revid: p.revid, plain });
  }
  const selection = selectArticles(pages, redirects, lexicon);
  assert.deepEqual([...selection.articles.keys()], ["harbor", "meadow", "otter"], "zorbulon (no lexicon entry), Crane (disambiguation) and Talk:Otter (ns 1) never ship");
  assert.deepEqual([...selection.aliases.entries()], [["harbour", "harbor"]]);

  const otter = selection.articles.get("otter");
  assert.equal(otter.title, "Otter");
  assert.equal(otter.revid, 9184482);
  assert.equal(otter.isa, "animal");
  assert.match(otter.text, /^An otter is an animal that lives in and near fresh and salt water\. Otters have long thin bodies & thick brown fur\./);
  assert.ok(!/Description|Category|File:|\{\{|\[\[|<ref/.test(otter.text), "no wikitext survives the cleaning");
  assert.ok(otter.summary.length <= 400 && otter.text.length <= 2500);

  const out = await mkdtemp(join(tmpdir(), "tmct-refpack-emit-"));
  try {
    const manifest = emitPack(selection, out, { dump: { url: "u", mirrorUrl: "m", date: "20260701", sha256: "s" }, built: "2026-07-18" });
    assert.equal(manifest.counts.articles, 3);
    assert.equal(manifest.counts.aliases, 1);
    for (const f of manifest.files) {
      const body = readFileSync(join(out, f.file));
      assert.equal(createHash("sha256").update(body).digest("hex"), f.sha256, `${f.file}: manifest sha256 is the emitted bytes`);
    }
    clearReferencePackCache();
    assert.equal(loadReferenceArticle(out, "otter").title, "Otter", "the emitted pack round-trips through the runtime loader");
    assert.deepEqual(loadReferenceArticle(out, "harbour"), loadReferenceArticle(out, "harbor"));
    assert.equal(loadReferenceArticle(out, "crane"), null);
    assert.equal(loadReferenceArticle(out, "zorbulon"), null);

    const again = await mkdtemp(join(tmpdir(), "tmct-refpack-emit2-"));
    try {
      emitPack(selection, again, { dump: { url: "u", mirrorUrl: "m", date: "20260701", sha256: "s" }, built: "2026-07-18" });
      for (const f of manifest.files) {
        assert.deepEqual(readFileSync(join(again, f.file)), readFileSync(join(out, f.file)), `${f.file}: byte-deterministic emit`);
      }
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  } finally {
    clearReferencePackCache();
    await rm(out, { recursive: true, force: true });
  }
});

test("emitPack fails loudly on a blown budget instead of trimming", async () => {
  const big = {
    term: "otter", title: "Otter", text: "x".repeat(BUDGET_TEXT_BYTES + 1),
    summary: "An otter is an animal.", url: "https://simple.wikipedia.org/wiki/Otter", revid: 1,
  };
  const out = await mkdtemp(join(tmpdir(), "tmct-refpack-budget-"));
  try {
    assert.throws(
      () => emitPack({ articles: new Map([["otter", big]]), aliases: new Map() }, out, { dump: {} }),
      /budget/,
    );
    assert.ok(!existsSync(join(out, "manifest.json")), "an over-budget build writes no manifest");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// ---- the committed pack, where it exists ------------------------------------

const missingPack = existsSync(join(PACK_DIR, "manifest.json"))
  ? false
  : "corpus/reference/manifest.json absent — the reference pack is not built in this checkout. "
    + "Run `npm run gen:reference-pack` (downloads the pinned Simple English Wikipedia dump) to enable these guards.";

test("the committed pack matches its manifest byte-for-byte and stays inside its budgets", { skip: missingPack }, () => {
  const manifest = JSON.parse(readFileSync(join(PACK_DIR, "manifest.json"), "utf8"));
  let shardGz = 0;
  let indexGz = 0;
  for (const entry of manifest.files) {
    const body = readFileSync(join(PACK_DIR, entry.file));
    assert.equal(body.length, entry.bytes, `${entry.file}: byte count drifted from the manifest`);
    assert.equal(createHash("sha256").update(body).digest("hex"), entry.sha256, `${entry.file}: sha256 drifted from the manifest`);
    if (entry.file.startsWith("shards/")) shardGz += body.length;
    if (entry.file === "index.json.gz") indexGz = body.length;
  }
  assert.ok(shardGz > 0 && shardGz <= BUDGET_SHARDS_GZ_BYTES, `shards total ${shardGz} gz bytes within budget`);
  assert.ok(indexGz > 0 && indexGz <= BUDGET_INDEX_GZ_BYTES, `index ${indexGz} gz bytes within budget`);
  assert.ok(manifest.dump?.url && manifest.dump?.sha256 && manifest.dump?.date, "the manifest pins the dump it was built from");
  assert.equal(readFileSync(join(PACK_DIR, "LICENSE-NOTICE"), "utf8"), REFERENCE_LICENSE_NOTICE, "the notice is the one the build script emits");
});

test("every committed index entry names an existing shard holding its row", { skip: missingPack }, () => {
  const index = JSON.parse(gunzipSync(readFileSync(join(PACK_DIR, "index.json.gz"))).toString("utf8"));
  const shardRows = new Map();
  for (const [term, entry] of Object.entries(index)) {
    assert.ok(isReferenceIndexEntry(entry), `index["${term}"] is not a valid {s, t, r} entry`);
    if (!shardRows.has(entry.s)) {
      const file = join(PACK_DIR, "shards", `${entry.s}.jsonl.gz`);
      assert.ok(existsSync(file), `index["${term}"] names missing shard ${entry.s}`);
      const rows = new Map();
      for (const line of gunzipSync(readFileSync(file)).toString("utf8").split("\n")) {
        if (line.trim()) rows.set(JSON.parse(line).term, JSON.parse(line));
      }
      shardRows.set(entry.s, rows);
    }
    assert.ok(shardRows.get(entry.s).has(entry.t), `index["${term}"] points at "${entry.t}", absent from shard ${entry.s}`);
  }
});

test("every committed shard row is a valid, correctly-sharded, lexicon-resolvable normFactTerm fixed point within the text budget", { skip: missingPack }, () => {
  const manifest = JSON.parse(readFileSync(join(PACK_DIR, "manifest.json"), "utf8"));
  const lexicon = loadLexicon();
  let textBytes = 0;
  for (const entry of manifest.files) {
    if (!entry.file.startsWith("shards/")) continue;
    const shard = entry.file.slice("shards/".length).replace(/\.jsonl\.gz$/, "");
    for (const line of gunzipSync(readFileSync(join(PACK_DIR, entry.file))).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      assert.ok(isReferenceArticleRow(row), `${entry.file}: malformed row ${line.slice(0, 80)}`);
      assert.equal(row.term, normFactTerm(row.term), `"${row.term}" is not a normFactTerm fixed point`);
      assert.ok(lookupNoun(lexicon, row.term), `"${row.term}" does not resolve through the lexicon`);
      assert.equal(shardNameFor(row.term), shard, `"${row.term}" sits in the wrong shard`);
      textBytes += Buffer.byteLength(row.text, "utf8");
    }
  }
  assert.ok(textBytes > 0 && textBytes <= BUDGET_TEXT_BYTES, `uncompressed article text ${textBytes} bytes within budget`);
});
