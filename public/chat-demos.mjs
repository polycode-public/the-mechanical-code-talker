// chat-demos.mjs — scripted chat turns and the reference pack's demo term
// allowlist. Data only: e2e/web-chat-memory.test.mjs replays DEMOS at the
// engine level, and scripts/build-demo-pack.mjs reads REFERENCE_PACK_TERMS
// to cut the browser-fetchable pack subset (it norm-folds the entries
// itself).

/** Terms the demo reference pack ships articles for. Each must
 *  resolve in the full pack — build-demo-pack fails loudly on one that
 *  doesn't. "license" leads as the demo's lookup term: learn-on-miss needs a
 *  term the shipped chat seed does NOT already ground, and the seed's
 *  WordNet/persona bands cover the everyday animal/object nouns below. The
 *  page transcript's "quokka" stays an honest miss on purpose (not a lexicon
 *  noun, so the pack can never carry it — the two together show both sides
 *  of the fallback). */
export const REFERENCE_PACK_TERMS = [
  "license",
  "otter", "falcon", "badger", "beaver", "anchor", "compass", "saddle",
  "canoe", "harp", "flute", "marble", "barn", "canal", "ferry", "swan",
  "island", "meadow", "river", "mountain", "ocean", "torch", "oasis",
  "snow", "honey", "bread", "cheese", "butter", "candle", "mirror", "ladder",
  "hammer", "needle", "basket", "blanket", "bicycle", "moss", "drum", "bell",
  "clock", "umbrella", "whale", "reef",
];

/** The scripted demos the rail offers. Strings only — every turn is typed
 *  into the live engine and every answer is computed, never pasted. An entry
 *  with `ready: false` names a capability the engine does not answer yet;
 *  the rail shows it disabled until the flag flips. */
export const DEMOS = [
  {
    id: "syllogist",
    title: "Teach it a syllogism",
    ready: true,
    turns: ["every dog is a mammal", "rex is a dog", "is rex a mammal"],
  },
  {
    // The replies pin the secret at 68 against a floor-midpoint search over
    // 1–100: guesses run 50, 75, 62, 68.
    id: "guess-number",
    title: "Guess my number",
    ready: true,
    turns: [
      "I'm thinking of a number between 1 and 100",
      "higher", "lower", "higher", "correct",
    ],
  },
  {
    id: "learn-on-miss",
    title: "Watch it learn a word",
    ready: true,
    turns: [`what is a ${REFERENCE_PACK_TERMS[0]}`],
  },
];
