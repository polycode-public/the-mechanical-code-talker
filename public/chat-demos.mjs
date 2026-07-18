// chat-demos.mjs — the home page chat's scripted demos and the reference
// pack's demo term allowlist. Data only: chat-ui.mjs drives the demos, and
// scripts/build-demo-pack.mjs reads REFERENCE_PACK_TERMS to cut the
// browser-fetchable pack subset (it norm-folds the entries itself).

/** Everyday terms the demo reference pack ships articles for. Each must
 *  resolve in the full pack — build-demo-pack fails loudly on one that
 *  doesn't. "quokka" leads because the page's own transcript shows it as the
 *  honest miss the pack lookup answers. */
export const REFERENCE_PACK_TERMS = [
  "quokka", "lantern", "kettle", "anchor", "compass", "saddle", "canoe",
  "lighthouse", "windmill", "waterfall", "glacier", "volcano", "desert",
  "island", "meadow", "river", "mountain", "ocean", "rainbow", "thunder",
  "snow", "honey", "bread", "cheese", "butter", "candle", "mirror", "ladder",
  "hammer", "needle", "basket", "blanket", "bicycle", "kite", "drum", "bell",
  "clock", "umbrella", "whale", "penguin",
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
    ready: false,
    turns: [
      "I'm thinking of a number between 1 and 100",
      "higher", "lower", "higher", "correct",
    ],
  },
  {
    id: "learn-on-miss",
    title: "Watch it learn a word",
    ready: false,
    turns: [`what is a ${REFERENCE_PACK_TERMS[0]}`],
  },
];
