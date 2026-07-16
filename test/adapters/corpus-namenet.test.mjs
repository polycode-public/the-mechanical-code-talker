// corpus/namenet/generate.mjs tests — the Open English Namenet -> ConceptNet
// -shape converter's PURE pieces only (CSV parsing, per-source mapping,
// merge/dedupe) against small synthetic fixtures. Never touches the real
// local english-namenet/english-wordnet checkouts — both are maintainer-only,
// uncommitted, machine-local sources (see generate.mjs's own header
// comment), so nothing here can depend on them existing in CI or another
// contributor's machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsvRecords, parseCsv, firstOf,
  buildSpeciesFacts, buildTaxon2CommonFacts, buildOccupationFacts, mergeFacts,
  resolveNamenetDir, DEFAULT_NAMENET_DIR,
} from "../../corpus/namenet/generate.mjs";
import { termText, loadMap } from "../../src/adapters/corpus/conceptnet.mjs";

test("parseCsvRecords: plain rows, quoted fields with embedded commas, escaped quotes, CRLF", () => {
  assert.deepEqual(parseCsvRecords("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
  // embedded comma inside quotes must NOT split the field
  assert.deepEqual(
    parseCsvRecords('a,b\n1,"two, or three"\n'),
    [["a", "b"], ["1", "two, or three"]],
  );
  // "" inside a quoted field is a literal quote character
  assert.deepEqual(
    parseCsvRecords('a\n"she said ""hi"""\n'),
    [["a"], ['she said "hi"']],
  );
  // CRLF line endings
  assert.deepEqual(parseCsvRecords("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  // no trailing newline still yields the final row
  assert.deepEqual(parseCsvRecords("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  // empty input -> no records
  assert.deepEqual(parseCsvRecords(""), []);
});

test("parseCsv: header row becomes object keys, exactly the real CSVs' shape", () => {
  const rows = parseCsv('Scientific Name,SSID,Accept\nGallus gallus,01794266-n,TRUE\n"Foo, bar",00000001-n,FALSE\n');
  assert.deepEqual(rows, [
    { "Scientific Name": "Gallus gallus", SSID: "01794266-n", Accept: "TRUE" },
    { "Scientific Name": "Foo, bar", SSID: "00000001-n", Accept: "FALSE" },
  ]);
  assert.deepEqual(parseCsv(""), []);
});

test("firstOf: first comma-separated candidate, trimmed; null for empty/blank", () => {
  assert.equal(firstOf("Plantae, kingdom Plantae, plant kingdom"), "Plantae");
  assert.equal(firstOf("politician, political leader"), "politician");
  assert.equal(firstOf("solo"), "solo");
  assert.equal(firstOf(""), null);
  assert.equal(firstOf("   "), null);
  assert.equal(firstOf(undefined), null);
});

test("buildSpeciesFacts: accepted rows only, SSID -> representative lemma via bySynset, self-loop/unresolved skipped", () => {
  const bySynset = new Map(Object.entries({
    "01794266-n": { members: ["chicken", "domestic fowl"] },
    "00000002-n": { members: ["okra"] }, // sciName IS the representative member -> self-loop
  }));
  const rows = [
    { "Scientific Name": "Gallus gallus", SSID: "01794266-n", Accept: "TRUE" },
    { "Scientific Name": "Gallus gallus", SSID: "01794104-n", Accept: "FALSE" }, // not accepted -> skipped
    { "Scientific Name": "okra", SSID: "00000002-n", Accept: "TRUE" }, // self-loop -> skipped
    { "Scientific Name": "Nowhere species", SSID: "99999999-n", Accept: "TRUE" }, // unresolved SSID -> skipped
    { "Scientific Name": "", SSID: "01794266-n", Accept: "TRUE" }, // empty name -> skipped
  ];
  const facts = buildSpeciesFacts(rows, bySynset);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], {
    start: "/c/en/gallus_gallus",
    rel: "/r/Synonym",
    end: "/c/en/chicken",
    weight: 1,
    surfaceText: "[[Gallus gallus]] Synonym [[chicken]]",
  });
});

test("buildTaxon2CommonFacts: accepted rows only, first lemma of each side", () => {
  const rows = [
    { "SSID 1": "11550054-n", "Lemmas 1": "Plantae, kingdom Plantae, plant kingdom", "SSID 2": "00017402-n", "Lemmas 2": "plant, flora, plant life", Accept: "TRUE" },
    { "SSID 1": "11558792-n", "Lemmas 1": "Anthocerotales, order Anthocerotales", "SSID 2": "11559271-n", "Lemmas 2": "hornwort", Accept: "TRUE" },
    { "SSID 1": "xxxxxxxx-n", "Lemmas 1": "rejected one, x", "SSID 2": "yyyyyyyy-n", "Lemmas 2": "rejected two", Accept: "FALSE" },
  ];
  const facts = buildTaxon2CommonFacts(rows);
  assert.equal(facts.length, 2);
  const has = (start, end) => facts.some((f) => f.rel === "/r/Synonym" && f.start === start && f.end === end);
  assert.ok(has("/c/en/plantae", "/c/en/plant"));
  assert.ok(has("/c/en/anthocerotales", "/c/en/hornwort"));
  assert.ok(!facts.some((f) => f.start === "/c/en/rejected_one"));
});

test("buildOccupationFacts: accepted+genuine-occupation rows only, first label/lemma, self-loop skipped", () => {
  const rows = [
    { Labels: "politician, political leader", Lemma: "pol, political leader, politician", Accept: "TRUE", "Not an occupation": "FALSE" },
    { Labels: "painter", Lemma: "painter", Accept: "TRUE", "Not an occupation": "FALSE" }, // self-loop -> skipped
    { Labels: "football player", Lemma: "footballer", Accept: "FALSE", "Not an occupation": "FALSE" }, // not accepted
    { Labels: "some label", Lemma: "some lemma", Accept: "TRUE", "Not an occupation": "TRUE" }, // flagged not-an-occupation
  ];
  const facts = buildOccupationFacts(rows);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], {
    start: "/c/en/politician",
    rel: "/r/Synonym",
    end: "/c/en/pol",
    weight: 1,
    surfaceText: "[[politician]] Synonym [[pol]]",
  });
});

test("mergeFacts: unions multiple per-source fact lists, deduped and sorted, same shape each source already carries", () => {
  const a = buildTaxon2CommonFacts([
    { "SSID 1": "1", "Lemmas 1": "zebra", "SSID 2": "2", "Lemmas 2": "equid", Accept: "TRUE" },
  ]);
  const b = buildOccupationFacts([
    { Labels: "zebra", Lemma: "equid", Accept: "TRUE", "Not an occupation": "FALSE" }, // exact duplicate pair from a different source
    { Labels: "vet", Lemma: "veterinarian", Accept: "TRUE", "Not an occupation": "FALSE" },
  ]);
  const merged = mergeFacts(a, b);
  assert.equal(merged.length, 2, "the duplicate zebra/equid pair from two sources collapses to one row");
  assert.ok(merged.some((f) => f.start === "/c/en/zebra" && f.end === "/c/en/equid"));
  assert.ok(merged.some((f) => f.start === "/c/en/vet" && f.end === "/c/en/veterinarian"));
  // deterministic sort: rel, then start, then end
  for (let i = 1; i < merged.length; i++) {
    const x = merged[i - 1], y = merged[i];
    const kx = `${x.rel} ${x.start} ${x.end}`, ky = `${y.rel} ${y.start} ${y.end}`;
    assert.ok(kx <= ky);
  }
  // every row has the tier-1 slice shape
  for (const f of merged) {
    assert.equal(typeof f.start, "string");
    assert.equal(typeof f.rel, "string");
    assert.equal(typeof f.end, "string");
    assert.equal(typeof f.weight, "number");
    assert.equal(typeof f.surfaceText, "string");
  }
});

test("every relation this converter emits (/r/Synonym) has a real (ace != \"none\") row in conceptnet-map.toml", async () => {
  const map = await loadMap();
  assert.ok(map.has("/r/Synonym"), "/r/Synonym: no row in conceptnet-map.toml at all");
  assert.notEqual(map.get("/r/Synonym").ace, "none", "/r/Synonym: row exists but ace=\"none\"");
});

test("encodeTerm round-trip via termText matches corpus/wordnet/generate.mjs's own convention", () => {
  const facts = buildTaxon2CommonFacts([
    { "SSID 1": "1", "Lemmas 1": "Ice Cream", "SSID 2": "2", "Lemmas 2": "gelato", Accept: "TRUE" },
  ]);
  assert.equal(facts[0].start, "/c/en/ice_cream");
  assert.equal(termText(facts[0].start), "ice cream");
});

test("resolveNamenetDir: CLI arg > env var > default, pure and injectable", () => {
  assert.equal(resolveNamenetDir(["/explicit/path"], {}), "/explicit/path");
  assert.equal(resolveNamenetDir([], { TMCT_NAMENET_DIR: "/env/path" }), "/env/path");
  assert.equal(resolveNamenetDir([], {}), DEFAULT_NAMENET_DIR);
  assert.match(DEFAULT_NAMENET_DIR, /english-namenet$/);
});
