// The worlds pack's two halves: the pure row/index contract and the lazy fs
// loader with its provider seam. Driven by the hand-written mini-world in
// test/fixtures/worlds-pack/, which mirrors the real pack's layout exactly,
// plus throwaway packs built in a temp dir for the corruption paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORLD_RULE_KINDS, isWorldName, isWorldsIndexEntry,
  isWorldFactRow, isWorldRuleRow, isWorldMetaRow, isWorldRow, worldProvenanceTag,
  expandWorldDefaultContents,
} from "../../src/domain/worlds-pack.mjs";
import {
  worldsPackDir, loadWorldsIndex, loadWorld,
  registerWorldsPackProvider, getWorldsPackProvider, clearWorldsPackCache,
} from "../../src/adapters/corpus/worlds-pack.mjs";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "worlds-pack");

const factRow = { world: "potting-shed", kind: "fact", subject: "shed", predicate: "rdf:type", object: "room" };
const ruleRow = {
  world: "potting-shed", kind: "rule", name: "go", ruleKind: "action-signature",
  slots: { subjectClass: "adventurer", targetClass: "room" },
};
const metaRow = { world: "potting-shed", kind: "meta", opening: "the shed opens." };

// ---- the pure contract ------------------------------------------------------

test("world names are lowercase hyphen-joined tokens", () => {
  assert.ok(isWorldName("ashcombe-hall"));
  assert.ok(isWorldName("shed"));
  assert.ok(!isWorldName("Ashcombe-Hall"));
  assert.ok(!isWorldName("ashcombe hall"));
  assert.ok(!isWorldName("-hall"));
  assert.ok(!isWorldName(""));
});

test("index entries and the three row kinds validate their shipped shapes and reject near-misses", () => {
  assert.ok(isWorldsIndexEntry({ s: "ashcombe-hall" }));
  assert.ok(!isWorldsIndexEntry({ s: "" }));
  assert.ok(!isWorldsIndexEntry(null));

  assert.ok(isWorldFactRow(factRow));
  assert.ok(!isWorldFactRow({ ...factRow, object: "" }));
  assert.ok(!isWorldFactRow({ ...factRow, kind: "rule" }));

  assert.ok(isWorldRuleRow(ruleRow));
  assert.ok(!isWorldRuleRow({ ...ruleRow, ruleKind: "compose2" }), "only the four action kinds may ship");
  assert.ok(!isWorldRuleRow({ ...ruleRow, slots: {} }));
  assert.ok(!isWorldRuleRow({ ...ruleRow, slots: { subjectClass: "" } }));

  assert.ok(isWorldMetaRow(metaRow));
  assert.ok(!isWorldMetaRow({ ...metaRow, opening: "" }));

  assert.ok(isWorldRow(factRow) && isWorldRow(ruleRow) && isWorldRow(metaRow));
  assert.ok(!isWorldRow({ world: "potting-shed", kind: "junk" }));
  assert.deepEqual([...WORLD_RULE_KINDS].sort(), [
    "action-constraint", "action-effect", "action-precond", "action-signature",
  ]);
});

test("a loaded world's provenance tag names the world", () => {
  assert.equal(worldProvenanceTag("ashcombe-hall"), "world:ashcombe-hall");
});

// ---- class-default contents -------------------------------------------------

test("a space's default contents mint one placed, portable, typed instance per default", () => {
  const facts = [
    { world: "w", kind: "fact", subject: "library", predicate: "rdf:type", object: "room" },
    { world: "w", kind: "fact", subject: "kitchen", predicate: "rdf:type", object: "room" },
    { world: "w", kind: "fact", subject: "library", predicate: "mgx:default-contains", object: "book" },
    { world: "w", kind: "fact", subject: "kitchen", predicate: "mgx:default-contains", object: "pan" },
  ];
  const out = expandWorldDefaultContents(facts);
  const has = (s, p, o) => out.some((r) => r.subject === s && r.predicate === p && r.object === o);
  assert.ok(has("book", "rdf:type", "book"), "the book is typed as its own class (so it resolves its own sprite)");
  assert.ok(has("book", "rdf:type", "portable"), "and as portable (so the take family accepts it)");
  assert.ok(has("book", "mgx:located-in", "library"), "and placed in the library");
  assert.ok(has("pan", "mgx:located-in", "kitchen"));
  assert.ok(out.every((r) => r.world === "w" && r.kind === "fact"), "minted rows keep the world-row wrapper");
});

test("a satisfied default mints nothing; a collision mints a numbered instance", () => {
  const satisfied = [
    { subject: "library", predicate: "mgx:default-contains", object: "book" },
    { subject: "tome", predicate: "rdf:type", object: "book" },
    { subject: "tome", predicate: "mgx:located-in", object: "library" },
  ];
  assert.equal(
    expandWorldDefaultContents(satisfied).length, satisfied.length,
    "the library already holds a book, so nothing is minted",
  );

  const collide = [
    { subject: "library", predicate: "mgx:default-contains", object: "book" },
    { subject: "book", predicate: "rdf:type", object: "trophy" },
  ];
  const out = expandWorldDefaultContents(collide);
  assert.ok(out.some((r) => r.subject === "book-2" && r.predicate === "mgx:located-in" && r.object === "library"),
    "the name 'book' is taken by an unrelated instance, so the minted one is 'book-2'");
});

test("no default-contains fact is a pure pass-through", () => {
  const facts = [{ subject: "a", predicate: "rdf:type", object: "room" }];
  assert.equal(expandWorldDefaultContents(facts), facts, "same array, untouched");
});

test("defaults mint in codepoint order, not locale order, and the same way whichever order the rows arrived", () => {
  // "zebra-room" sorts BEFORE "élan-room" in codepoint order (z=0x7A < é=0xE9),
  // but AFTER it under locale-aware collation (é collates next to e, well
  // before z). The two rooms compete for the same class name, so whichever
  // order wins the mint decides which room keeps the bare "widget" id.
  const facts = [
    { subject: "zebra-room", predicate: "rdf:type", object: "room" },
    { subject: "élan-room", predicate: "rdf:type", object: "room" },
    { subject: "zebra-room", predicate: "mgx:default-contains", object: "widget" },
    { subject: "élan-room", predicate: "mgx:default-contains", object: "widget" },
  ];
  const minted = (rows) => rows.filter((r) => !facts.includes(r));
  const forward = minted(expandWorldDefaultContents(facts));
  const reversed = minted(expandWorldDefaultContents([...facts].reverse()));
  assert.deepEqual(forward, reversed, "arrival order of the input rows never changes what gets minted");

  const mintedIn = (rows, room) => rows.find((r) => r.predicate === "mgx:located-in" && r.object === room)?.subject;
  assert.equal(mintedIn(forward, "zebra-room"), "widget", "codepoint order visits zebra-room first");
  assert.equal(mintedIn(forward, "élan-room"), "widget-2", "élan-room loses the name race under codepoint order");
});

// ---- the fs loader over the committed fixture -------------------------------

test("the fixture mini-world loads: facts, rules and the meta row, junk rows skipped", () => {
  clearWorldsPackCache();
  const index = loadWorldsIndex(FIXTURE_DIR);
  assert.ok(index && index["potting-shed"], "fixture index names potting-shed");
  const world = loadWorld(FIXTURE_DIR, "potting-shed");
  assert.ok(world, "the fixture world loads");
  assert.equal(world.name, "potting-shed");
  assert.equal(world.facts.length, 8);
  assert.equal(world.rules.length, 4);
  assert.equal(world.meta.opening, "the fixture shed opens. You are in the shed.");
  assert.ok(world.facts.every((f) => f.world === "potting-shed"));
});

test("an unknown world and an index entry whose shard is missing both read as null, never a throw", () => {
  clearWorldsPackCache();
  assert.equal(loadWorld(FIXTURE_DIR, "no-such-world"), null);
  assert.equal(loadWorld(FIXTURE_DIR, "lost-world"), null, "indexed but shardless world is an honest null");
});

test("an absent pack directory reads as a null index and null worlds", () => {
  clearWorldsPackCache();
  const nowhere = join(FIXTURE_DIR, "does-not-exist");
  assert.equal(loadWorldsIndex(nowhere), null);
  assert.equal(loadWorld(nowhere, "potting-shed"), null);
});

test("a corrupt index and a corrupt shard are tolerated as absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-worlds-corrupt-"));
  try {
    await mkdir(join(dir, "shards"), { recursive: true });
    await writeFile(join(dir, "index.json.gz"), Buffer.from("not gzip at all"));
    clearWorldsPackCache();
    assert.equal(loadWorldsIndex(dir), null);

    await writeFile(join(dir, "index.json.gz"), gzipSync(JSON.stringify({ "bad-shard": { s: "bad-shard" } })));
    await writeFile(join(dir, "shards", "bad-shard.jsonl.gz"), Buffer.from("still not gzip"));
    clearWorldsPackCache();
    assert.equal(loadWorld(dir, "bad-shard"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a bad line loses one row, not the world", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-worlds-badline-"));
  try {
    await mkdir(join(dir, "shards"), { recursive: true });
    await writeFile(join(dir, "index.json.gz"), gzipSync(JSON.stringify({ "tiny": { s: "tiny" } })));
    const lines = [
      JSON.stringify({ world: "tiny", kind: "meta", opening: "hello." }),
      "{ this is not json",
      JSON.stringify({ world: "tiny", kind: "fact", subject: "a", predicate: "rdf:type", object: "b" }),
      JSON.stringify({ world: "other-world", kind: "fact", subject: "x", predicate: "rdf:type", object: "y" }),
    ];
    await writeFile(join(dir, "shards", "tiny.jsonl.gz"), gzipSync(lines.join("\n")));
    clearWorldsPackCache();
    const world = loadWorld(dir, "tiny");
    assert.equal(world.facts.length, 1, "the other-world row and the bad line are both dropped");
    assert.equal(world.meta.opening, "hello.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the provider seam ------------------------------------------------------

test("the default provider is the fs loader; TMCT_WORLDS_PACK_DIR redirects it per env bag", async () => {
  clearWorldsPackCache();
  const viaEnv = getWorldsPackProvider({ TMCT_WORLDS_PACK_DIR: FIXTURE_DIR });
  assert.deepEqual(await viaEnv.list(), ["lost-world", "potting-shed"]);
  const world = await viaEnv.load("potting-shed");
  assert.equal(world?.meta?.opening, "the fixture shed opens. You are in the shed.");
  const nowhere = getWorldsPackProvider({ TMCT_WORLDS_PACK_DIR: join(FIXTURE_DIR, "absent") });
  assert.equal(await nowhere.list(), null);
});

test("a registered provider displaces the fs loader until unregistered", async () => {
  const canned = { name: "canned-world", facts: [], rules: [], meta: null };
  registerWorldsPackProvider({
    list: async () => ["canned-world"],
    load: async (name) => (name === "canned-world" ? canned : null),
  });
  try {
    assert.deepEqual(await getWorldsPackProvider().list(), ["canned-world"]);
    assert.equal(await getWorldsPackProvider({ TMCT_WORLDS_PACK_DIR: FIXTURE_DIR }).load("canned-world"), canned);
  } finally {
    registerWorldsPackProvider(null);
  }
  clearWorldsPackCache();
  assert.notEqual(await getWorldsPackProvider({ TMCT_WORLDS_PACK_DIR: FIXTURE_DIR }).load("potting-shed"), null);
});

test("the shipped pack directory resolves under corpus/worlds and carries ashcombe-hall", async () => {
  clearWorldsPackCache();
  assert.match(worldsPackDir({}), /corpus[/\\]worlds$/);
  const shipped = getWorldsPackProvider({});
  const names = await shipped.list();
  assert.ok(names?.includes("ashcombe-hall"), `shipped pack lists ashcombe-hall, got ${JSON.stringify(names)}`);
  const world = await shipped.load("ashcombe-hall");
  assert.ok(world.facts.length >= 40, "the shipped world carries its fact rows");
  assert.ok(world.rules.some((r) => r.name === "go" && r.ruleKind === "action-signature"));
  assert.ok(world.meta?.opening.includes("study"), "the opening names the starting room");
});
