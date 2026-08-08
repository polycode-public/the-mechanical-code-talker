// scene-random: the random-scene button's vocabulary and sentence builder.
// The vocabulary is derived from real sources only (the catalog's class
// index, the sprite facts' emotion rows, a world's room facts), and the
// sentence is a pure function of the rng stream handed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roomClassesFromWorldFacts, isSpeakableClassName, sceneVocabulary, randomSceneSentence,
} from "../../src/domain/scene-random.mjs";
import { extractSceneItems } from "../../src/domain/scene-compose.mjs";

const CLASS_INDEX = {
  hat: { defaultSvg: "<svg/>", materials: { red: "<svg/>", straw: "<svg/>" } },
  table: { defaultSvg: "<svg/>", materials: { wood: "<svg/>" } },
  doctor: { defaultSvg: "<svg/>", materials: { happy: "<svg/>", sad: "<svg/>", left: "<svg/>", "left + moving": "<svg/>", moving: "<svg/>" } },
  cat: { defaultSvg: "<svg/>", materials: { black: "<svg/>", moving: "<svg/>", "half-left": "<svg/>" } },
  library: { defaultSvg: "<svg/>", materials: {} },
  "drawing-room": { defaultSvg: "<svg/>", materials: {} },
};

const SPRITE_ROWS = [
  { subject: "doctor sprite", predicate: "mgx:accept-emotion", object: "happy" },
  { subject: "doctor sprite", predicate: "mgx:accept-emotion", object: "sad" },
  { subject: "hat sprite", predicate: "mgx:accept-material", object: "straw" },
];

const WORLD_ROWS = [
  { subject: "library", predicate: "rdf:type", object: "room" },
  { subject: "drawing-room", predicate: "rdf:type", object: "room" },
  { subject: "garden", predicate: "rdf:type", object: "room" },
  { subject: "key", predicate: "rdf:type", object: "portable" },
];

test("roomClassesFromWorldFacts reads exactly the rdf:type room subjects, sorted", () => {
  assert.deepEqual(roomClassesFromWorldFacts(WORLD_ROWS), ["drawing-room", "garden", "library"]);
  assert.deepEqual(roomClassesFromWorldFacts([]), []);
  assert.deepEqual(roomClassesFromWorldFacts(null), []);
});

test("a speakable class name is one the scene parser can tokenize back to itself", () => {
  assert.equal(isSpeakableClassName("library"), true);
  assert.equal(isSpeakableClassName("body of water"), true);
  assert.equal(isSpeakableClassName("drawing-room"), false, "a hyphen never survives tokenizing");
  assert.equal(isSpeakableClassName(""), false);
});

test("the vocabulary keeps only drawable, speakable rooms and files facing/pose/combined labels out of the material pool", () => {
  const vocab = sceneVocabulary({ classIndex: CLASS_INDEX, spriteFactRows: SPRITE_ROWS, roomClasses: roomClassesFromWorldFacts(WORLD_ROWS) });
  assert.deepEqual(vocab.rooms, ["library"], "garden has no sprite here and drawing-room is not speakable");
  assert.deepEqual(vocab.emotions, ["happy", "sad"]);
  const doctor = vocab.classes.find((c) => c.name === "doctor");
  assert.deepEqual(doctor.materials, [], "facing, pose, combined and emotion labels are not materials");
  assert.deepEqual(doctor.emotions, ["happy", "sad"]);
  assert.equal(doctor.moving, true);
  const cat = vocab.classes.find((c) => c.name === "cat");
  assert.deepEqual(cat.materials, ["black"]);
  assert.equal(cat.moving, true);
  assert.ok(!vocab.classes.some((c) => c.name === "library"), "a room is a backdrop, never a standing entity");
});

test("the vocabulary is deterministic for identical inputs", () => {
  const args = { classIndex: CLASS_INDEX, spriteFactRows: SPRITE_ROWS, roomClasses: ["library"] };
  assert.deepEqual(sceneVocabulary(args), sceneVocabulary(args));
});

test("an identical rng stream builds the identical sentence, and every word traces to the vocabulary", () => {
  const vocab = sceneVocabulary({ classIndex: CLASS_INDEX, spriteFactRows: SPRITE_ROWS, roomClasses: ["library"] });
  const rngAt = (seed) => {
    let x = seed;
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
  };
  const a = randomSceneSentence(vocab, rngAt(7));
  const b = randomSceneSentence(vocab, rngAt(7));
  assert.equal(a, b);
  assert.ok(a.length > 0);
  const known = new Set(["a", "on", "and", "in", "the", "moving", "library",
    ...vocab.emotions, ...vocab.classes.flatMap((c) => [...c.name.split(" "), ...c.materials])]);
  for (const word of a.split(/\s+/)) assert.ok(known.has(word), `"${word}" appears in no vocabulary source`);
});

test("the generated sentence reads back through the scene parser with at least one drawable item", () => {
  const vocab = sceneVocabulary({ classIndex: CLASS_INDEX, spriteFactRows: SPRITE_ROWS, roomClasses: ["library"] });
  let x = 3;
  const rng = () => {
    x = (x * 48271) % 2147483647;
    return x / 2147483647;
  };
  for (let i = 0; i < 20; i += 1) {
    const sentence = randomSceneSentence(vocab, rng);
    const items = extractSceneItems(sentence, CLASS_INDEX);
    assert.ok(items.length >= 1, `"${sentence}" composed nothing`);
  }
});

test("an empty vocabulary builds an empty sentence rather than inventing words", () => {
  assert.equal(randomSceneSentence({ rooms: [], emotions: [], classes: [] }, () => 0.5), "");
  assert.equal(randomSceneSentence({ rooms: ["library"], emotions: [], classes: [] }, () => 0.5), "the library");
});
