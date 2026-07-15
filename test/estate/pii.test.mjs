// The tracked tree must stay free of personally identifying leftovers: home
// directory paths, unallowlisted email addresses, and personal names in the
// playtest transcripts. scripts/pii-lint.mjs is the scanner; these tests run
// it over the real tree and prove the detectors actually detect.

import test from "node:test";
import assert from "node:assert/strict";
import { scanRepo, scanText } from "../../scripts/pii-lint.mjs";

test("no unallowlisted PII in any tracked text file", () => {
  const findings = scanRepo();
  const listing = findings.map((f) => `${f.path}:${f.line} [${f.kind}] ${f.hit}`).join("\n");
  assert.equal(findings.length, 0, `PII findings not covered by scripts/pii-allowlist.json:\n${listing}`);
});

test("the detectors catch home paths, tilde user areas and emails", () => {
  const sample = [
    "log written to " + "/Us" + "ers/someperson/work/repo/session.log",
    "backup under " + "/ho" + "me/someperson/backups",
    "data in ~someperson/share/corpus",
    "mail someperson" + "@example.com about it",
  ].join("\n");
  const kinds = scanText(sample, "docs/example.md", []).map((f) => f.kind);
  assert.ok(kinds.includes("home-directory path"), "misses /Users|/home paths");
  assert.ok(kinds.includes("tilde user area"), "misses ~name/ areas");
  assert.ok(kinds.includes("email"), "misses email addresses");
});

test("URL tilde segments and bare ~/ paths are not flagged", () => {
  const sample = [
    "see https://homes.cs.washington.edu/~weld/papers/pop.pdf",
    "clone it under ~/projects/globalwordnet/english-wordnet",
  ].join("\n");
  assert.deepEqual(scanText(sample, "docs/example.md", []), []);
});

test("personal names are flagged in playtests/ but the check stays scoped there", () => {
  const sample = "tester: An" + "tony Ex" + "ample said hi";
  assert.equal(scanText(sample, "playtests/PLAYTEST_LOG_999.md", []).length, 1);
  assert.equal(scanText(sample, "docs/example.md", []).length, 0);
});

test("allowlisted identities are not findings", () => {
  const sample = "contact an" + "tony@poly" + "code.co.uk (An" + "tony at Poly" + "code)";
  const allow = ["antony@polycode.co.uk", "Antony at Polycode"];
  assert.deepEqual(scanText(sample, "playtests/PLAYTEST_LOG_999.md", allow), []);
});
