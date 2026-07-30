// scene-compose.mjs — the sprite catalog's "there is a…" box: which real
// catalog classes a free-typed sentence names, and with which of that class's
// own material labels.
//
// Naming a class is the engine's own job. This module segments the sentence
// into candidate spans and hands each one to ask.mjs's resolveObject — the same
// resolver the chat lanes use — over a graph whose individuals are the caller's
// real classes. So the caller owns where a name might start and stop, and
// nothing else: casing, leading articles and grain words come from the
// resolver's own tiers, and a span carrying a word the index has no reading for
// declines there rather than resolving past it.
//
// It lives in domain/ rather than beside the page that draws the scene because
// the page's browser bundle needs it: routing through the real resolver means
// the parser can't be spliced into the page as self-contained text any more.

import { resolveObject } from "./ask.mjs";
import { parseEntities } from "./codegraph.mjs";

/** `text`'s lowercase word runs, the unit class names are matched against —
 *  punctuation never fuses two real words into one token nor splits one real
 *  word into two. */
export function tokenizeSceneText(text) {
  const tokens = [];
  const re = /[A-Za-z]+/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) tokens.push({ word: m[0].toLowerCase() });
  return tokens;
}

const sceneClassGraphCache = new WeakMap();

/** The `classIndex`'s own class names as a resolvable graph, one individual per
 *  class, plus the longest class name's word count (the widest span worth
 *  offering the resolver). Cached per index object: a page builds its index once
 *  at load and then composes on every keystroke. */
function sceneClassGraph(classIndex) {
  const cached = sceneClassGraphCache.get(classIndex);
  if (cached) return cached;
  const names = Object.keys(classIndex).filter((name) => String(name).trim());
  const built = {
    graph: parseEntities({
      individuals: names.map((name) => ({ id: `sprite-class:${name}`, label: name, class: "Class" })),
      objectProperties: [],
    }),
    longestClassWordCount: names.reduce((max, name) => Math.max(max, name.trim().split(/\s+/).length), 0),
  };
  sceneClassGraphCache.set(classIndex, built);
  return built;
}

/** The one resolver tier the composer draws on. Composing paints a picture, and
 *  painting the wrong sprite is a silent lie the visitor can't audit, so only an
 *  exact-grade resolution (resolveObject's tier 1, which its own leading-article
 *  and grain-word retries reach too) earns a swatch. The containment and fuzzy
 *  tiers below it read "wood" as the food class and "glass" as grass — right for
 *  a question the engine answers in words and cites, wrong for a picture drawn
 *  without comment. */
const SCENE_EXACT_TIER = 1;

/** The catalog class named by the longest still-unclaimed token span starting at
 *  `start`, as `{className, wordCount}`, or null when the resolver grounds none
 *  of them. Spans are offered widest-first, so a multi-word class name ("body of
 *  water") always wins the position it starts at over a shorter class that would
 *  otherwise fragment it. An ambiguous resolution is a miss: a span that reads as
 *  several real classes names none of them. */
function resolveSpanToClass(graph, classIndex, tokens, used, start, longestClassWordCount) {
  const widest = Math.min(longestClassWordCount, tokens.length - start);
  for (let wordCount = widest; wordCount >= 1; wordCount -= 1) {
    let free = true;
    for (let k = 0; k < wordCount && free; k += 1) free = !used[start + k];
    if (!free) continue;
    const span = tokens.slice(start, start + wordCount).map((t) => t.word).join(" ");
    const resolved = resolveObject(graph, span);
    const label = resolved?.match?.label;
    if (!label || resolved.ambiguous || resolved.tier !== SCENE_EXACT_TIER) continue;
    if (Object.prototype.hasOwnProperty.call(classIndex, label)) return { className: label, wordCount };
  }
  return null;
}

/** Every real catalog class the free-typed `text` names, in the order each first
 *  appears, paired with the real material label (one of that SAME class's own
 *  swatch labels — never another class's, never a fabricated one) immediately
 *  preceding it, or `null`. `classIndex` is `{className: {materials}}` with
 *  `materials` keyed by lowercase label (sprites.html's own client-side
 *  `buildClassIndexFromDom` output, or an equivalent test fixture) — a class name
 *  absent from `classIndex` can never match, and a modifier word that isn't one
 *  of ITS matched class's own material labels is silently dropped rather than
 *  guessed at, the same honest-miss posture an unrecognized class name gets (an
 *  unmatched word, e.g. "red" before a lamp with no red material, is never an
 *  error, just silently not drawn). Pure. */
export function extractSceneItems(text, classIndex) {
  const index = classIndex || {};
  const { graph, longestClassWordCount } = sceneClassGraph(index);
  if (!longestClassWordCount) return [];
  const tokens = tokenizeSceneText(text);
  const used = new Array(tokens.length).fill(false);
  const items = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (used[i]) continue;
    const hit = resolveSpanToClass(graph, index, tokens, used, i, longestClassWordCount);
    if (!hit) continue;
    let materialLabel = null;
    if (i > 0 && !used[i - 1]) {
      const materials = index[hit.className]?.materials || {};
      const prevWord = tokens[i - 1].word;
      if (Object.prototype.hasOwnProperty.call(materials, prevWord)) {
        materialLabel = prevWord;
        used[i - 1] = true;
      }
    }
    for (let k = 0; k < hit.wordCount; k += 1) used[i + k] = true;
    items.push({ className: hit.className, materialLabel });
  }
  return items;
}
