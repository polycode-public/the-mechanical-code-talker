// A bare install (no code graph, no code-domain pack active) must never hint
// at code-domain vocabulary on any of its own surfaces — the session banner,
// the greeting, a count question, a code-structure question, /help,
// orientation ("what can you do") and /stats. test/corpus/neutrality.jsonl
// pins each surface's exact wording, bare and with the code pack active;
// this guard sweeps every one of those surfaces at once for a single closed
// list of code-domain markers, so a leak in a surface the corpus rows don't
// happen to phrase this way still fails loudly.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

// Vocabulary a code-domain pack contributes — its count nouns' plurals, its
// command rows, and the phrases its own miss/orientation clauses use. None of
// these may appear anywhere in a bare session's output.
const CODE_DOMAIN_MARKERS = [
  "code graph", "code index", "code structure", "code question",
  "tmct index", "npm run example:mini",
  "/find <query>", "/context <symbol>", "/snippet <symbol>", "/describe <symbol>",
  "/signature <symbol>", "/members <class>", "/subclasses <class>", "/impact <module>",
  "/callers <symbol>", "/callees <symbol>", "/tests <symbol>", "/untested",
  "/history <symbol>", "/exports <module>", "/arch [package]",
  "plus counts:", "classes, functions, modules",
];

function assertNoCodeDomainVocabulary(text, label) {
  const lower = String(text).toLowerCase();
  for (const marker of CODE_DOMAIN_MARKERS) {
    assert.ok(!lower.includes(marker.toLowerCase()), `${label} leaks code-domain vocabulary: "${marker}"\n${text}`);
  }
}

test("a bare session's banner, greeting, counts, code-shaped questions, help, orientation and /stats stay domain-silent", async () => {
  clearCache();
  const dir = await mkdtemp(join(tmpdir(), "tmct-neutrality-estate-"));
  try {
    const session = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    try {
      assert.equal(session.moduleCount, 0, "a bare session carries no code graph");
      assertNoCodeDomainVocabulary(session.bannerLines.join("\n"), "the session banner");

      const probes = [
        "hi",
        "how many classes are there",
        "which modules import a.mjs",
        "/help",
        "what can you do",
        "/stats",
        "/capabilities",
      ];
      for (const line of probes) {
        const { answer } = await session.turn(line);
        assertNoCodeDomainVocabulary(answer, `the "${line}" turn`);
      }
      const { answer: capabilities } = await session.turn("/capabilities");
      assert.ok(!capabilities.includes("loaded domains"), `a bare session's /capabilities names a domain:\n${capabilities}`);
    } finally {
      await session.close();
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
