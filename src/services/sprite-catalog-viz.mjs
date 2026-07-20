// sprite-catalog-viz.mjs — `public/sprites.html` (PLAN_GAMES_UPLIFT_V3.md
// Part C.2's "Sprite library" link-card item): every class the sprite
// library actually resolves a sprite for, at both tiers (data/sprites/
// *-icon.toml, 44px; data/sprites-large/*.toml, 400px), grouped for
// browsing, each swatch carrying its own real ontology mapping — the class
// name, its resolved template, and the rdfs:subClassOf ancestor chain the
// engine would actually walk to reach it — computed through the SAME
// resolver code the product itself runs (src/domain/sprite-map.mjs's
// classAncestorChain, src/domain/sprite-templates.mjs's resolveSpriteAsset),
// never a hand-simulated stand-in.
//
// Three pure/impure-separated pieces, mirroring ledger-viz.mjs's own
// computeLedgerData / computeLedgerDataFromPayload / renderLedgerHtml split:
//   - loadSpriteOntologyFactRows()   — I/O: the real ancestor-fact source
//   - buildSpriteCatalogEntries(...) — pure derivation over templates+facts
//   - renderSpriteCatalogHtml(...)   — pure string builder
//
// ---- Ancestor facts: real, not invented ----
// classAncestorChain needs a flat {subject, predicate:"rdfs:subClassOf",
// object} row set to walk. Two REAL, already-committed sources are combined:
//   - the spider-and-fly world's own SEED_TAXONOMY (src/domain/
//     spider-fly-world.mjs) — poodle/dog/animal, spider/arachnid/animal,
//     fly/insect/animal — the exact worked example sprite-map.mjs's own
//     header names.
//   - corpus/wordnet/wordnet-xl.jsonl (23,805 rows), the SAME opt-in
//     "wordnet-xl" corpus extension the product itself ships (src/services/
//     extensions.mjs), converted to rdfs:subClassOf facts through the
//     existing src/adapters/corpus/conceptnet.mjs loader (loadSlice/loadMap/
//     toFacts) — no bespoke parsing invented for this page.
// corpus/wordnet/wordnet-full.jsonl (192k rows, every WordNet sense
// unfiltered) was tried and rejected: with no word-sense disambiguation its
// hypernym graph conflates a word's every sense onto one node, so a class as
// ordinary as "poodle" walks into 3000+ unrelated ancestors and the walk
// itself takes minutes. wordnet-xl's own "prioritized subset" curation
// avoids most of that; what's left is capped for DISPLAY (see
// MAX_CHAIN_DISPLAY below) rather than hidden — still the real chain,
// just not printed to its full, occasionally very long, length.
//
// Every class catalogued here already carries its own template (that's
// what put it in the catalog), so live sprite resolution always stops at
// the chain's own first link — the fuller ancestor chain this page prints
// is real ancestry ON RECORD in the corpus, not a claim that resolution
// walks that far for THESE classes (it would, for an unregistered subtype
// like "sheepdog" — sprite-map.mjs's own worked example — which is exactly
// why the mechanism exists, just not exercised by any class shown here).

import { classAncestorChain, SPRITE_REGISTRY } from "../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../domain/sprite-templates.mjs";
import { MATERIAL_PALETTE } from "../domain/sprite-materials.mjs";
import { SEED_TAXONOMY } from "../domain/spider-fly-world.mjs";
import { loadSlice, loadMap, toFacts, WORDNET_DIR } from "../adapters/corpus/conceptnet.mjs";
import { join } from "node:path";
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson } from "./viz-theme.mjs";

const DEFAULT_TITLE = "tmct — the sprite library";
const MAX_CHAIN_DISPLAY = 6;

/** A curated gap-fill for classes wordnet-xl's own prioritized subset
 *  happens to carry NO rdfs:subClassOf row for at all (115 of 198 catalog
 *  classes, checked directly against a build of this page) — every pair
 *  here is real WordNet-derived data, the same corpus/wordnet/
 *  wordnet-full.jsonl this module's header already describes evaluating
 *  and rejecting as a BLANKET source (sense-conflation, 3000+ ancestors for
 *  "poodle", minutes to walk). That rejection doesn't apply to a single
 *  hand-verified relation per class: each pair below is the one /r/IsA row
 *  (of however many wordnet-full.jsonl actually carries for that word) that
 *  reads as the correct sense for a physical/common-noun catalog entry —
 *  chosen the same way SEED_TAXONOMY above is hand-curated, not generated.
 *  A term with only implausible senses on record (e.g. "pig" -> only
 *  "ingot"/"live", "portable" -> only the archaic noun "typewriter") is
 *  left OUT here on purpose rather than forced — it keeps today's honest
 *  self-only chain instead of a confidently wrong one. Same for a term with
 *  no /r/IsA row anywhere in wordnet-full.jsonl at all (autumn, grandmother,
 *  human, manager) — a real, checked absence, not an oversight. */
const CATALOG_TAXONOMY_GAPFILL = Object.freeze([
  ["airport", "airfield"], ["ant", "hymenopterous insect"], ["artist", "creator"],
  ["audience", "gathering"], ["baby", "child"], ["beach", "land"],
  ["bee", "hymenopterous insect"], ["bicycle", "wheeled vehicle"], ["bird", "vertebrate"],
  ["birthday", "anniversary"], ["boat", "vessel"], ["body of water", "thing"],
  ["breakfast", "meal"], ["butler", "manservant"], ["butterfly", "lepidopterous insect"],
  ["cabinet", "furniture"], ["car", "motor vehicle"], ["castle", "fortification"],
  ["chair", "seat"], ["champion", "defender"], ["cheese", "dairy product"],
  ["church", "place of worship"], ["citizen", "national"], ["city", "municipality"],
  ["coin", "coinage"], ["container", "instrumentality"], ["crowd", "gathering"],
  ["customer", "consumer"], ["daughter", "female offspring"], ["desk", "table"],
  ["dinner", "meal"], ["doctor", "medical practitioner"], ["drink", "helping"],
  ["elephant", "proboscidean"], ["factory", "plant"], ["family", "kin"],
  ["farm", "workplace"], ["farmer", "creator"], ["fish", "aquatic vertebrate"],
  ["food", "substance"], ["forest", "biome"], ["frog", "amphibian"],
  ["furniture", "furnishing"], ["garden", "yard"], ["glove", "handwear"],
  ["gold", "precious metal"], ["grandfather", "grandparent"], ["guest", "visitor"],
  ["hate", "emotion"], ["home", "residence"], ["horse", "equine"],
  ["hospital", "medical institution"], ["housekeeper", "domestic"], ["jewelry", "adornment"],
  ["joy", "emotion"], ["lamp", "source of illumination"], ["lawyer", "professional"],
  ["letter", "document"], ["lion", "big cat"], ["meal", "foodstuff"],
  ["meat", "solid food"], ["meeting", "assembly"], ["money", "currency"],
  ["mother", "parent"], ["mountain", "natural elevation"], ["museum", "depository"],
  ["nurse", "health professional"], ["ocean", "body of water"], ["officer", "mariner"],
  ["owl", "bird of prey"], ["planet", "celestial body"], ["portrait", "likeness"],
  ["president", "head of state"], ["priest", "spiritual leader"], ["rabbit", "leporid"],
  ["rain", "precipitation"], ["resident", "inhabitant"], ["river", "stream"],
  ["road", "way"], ["room", "area"], ["sheep", "bovid"],
  ["shoe", "footwear"], ["shop", "mercantile establishment"], ["snow", "precipitation"],
  ["sock", "hosiery"], ["soldier", "enlisted person"], ["son", "male offspring"],
  ["spring", "season"], ["star", "celestial body"], ["street", "thoroughfare"],
  ["student", "enrollee"], ["sugar", "sweetening"], ["summer", "season"],
  ["sun", "star"], ["table", "furniture"], ["teacher", "educator"],
  ["team", "group"], ["town", "municipality"], ["train", "public transport"],
  ["tree", "woody plant"], ["vehicle", "conveyance"], ["village", "settlement"],
  ["visitor", "traveler"], ["waterway", "body of water"], ["wedding", "ceremony"],
  ["wine", "alcohol"], ["winter", "season"], ["wolf", "canine"],
  ["woman", "adult"],
]);

/** The real rdfs:subClassOf fact rows this catalog's ancestor chains walk —
 *  see this module's own header for why these two sources and not a third.
 *  I/O (reads corpus/wordnet/wordnet-xl.jsonl + its relation map); never
 *  called from renderSpriteCatalogHtml itself, which stays pure. */
export async function loadSpriteOntologyFactRows() {
  const seedRows = SEED_TAXONOMY.map(([subject, object]) => ({ subject, predicate: "rdfs:subClassOf", object }));
  const gapfillRows = CATALOG_TAXONOMY_GAPFILL.map(([subject, object]) => ({ subject, predicate: "rdfs:subClassOf", object }));
  const assertions = await loadSlice(join(WORDNET_DIR, "wordnet-xl.jsonl"));
  const map = await loadMap();
  const wordnetRows = toFacts(assertions, map, "corpus:wordnet-xl")
    .filter((f) => f.predicate === "rdfs:subClassOf")
    .map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object }));
  return [...seedRows, ...gapfillRows, ...wordnetRows];
}

// ---- grouping (presentation only — every class still resolves through the
// real resolver above; this only decides which section of the page a
// class's card lands in) ----

// The icon tier's own two world families (sprite-map.mjs's header): the
// spider-and-fly board's creatures share the flat SPRITE_REGISTRY with the
// adventure world's own props. The creatures fold into "physical objects,
// creatures & places" below with every other animal; what's left after
// removing them (and "person", generic to both worlds) is Ashcombe Hall's
// own unique cast and furniture — never shared with another game.
const SPIDER_FLY_CREATURE_CLASSES = Object.freeze(["spider", "fly", "egg", "poodle", "dog", "animal"]);

// A curated closed list (the SOURCE_PRIOR/SPRITE_REGISTRY flat-table idiom
// this project already uses elsewhere) of every data/sprites-large/ class
// that reads as a person, a family relation, a social role/occupation, or a
// collective of people. A class named neither here nor an icon-tier
// adventure prop nor detected as an emoji-fallback class (both below) falls
// through to "physical objects, creatures & places" by default, so a future
// added class is never left uncategorized — it just lands in the generic
// bucket rather than vanishing.
export const PERSON_ROLE_CLASSES = Object.freeze([
  "person", "human", "adult", "baby", "child", "boy", "girl", "man", "woman",
  "mother", "father", "parent", "grandfather", "grandmother", "brother", "sister",
  "son", "daughter", "husband", "wife", "family", "friend", "neighbor", "stranger",
  "guest", "visitor", "customer", "employee", "boss", "manager", "leader",
  "president", "king", "queen", "judge", "lawyer", "priest", "doctor", "nurse",
  "teacher", "student", "engineer", "artist", "writer", "farmer", "driver",
  "soldier", "officer", "servant", "worker", "volunteer", "citizen", "resident",
  "champion", "crowd", "audience", "team",
]);

export const GROUP_ADVENTURE = "adventure";
export const GROUP_PERSON = "person";
export const GROUP_OBJECT = "object";
export const GROUP_EMOJI = "emoji";

export const CATALOG_GROUPS = Object.freeze([
  Object.freeze({ id: GROUP_ADVENTURE, label: "Ashcombe Hall's own adventure props", note: "the icon tier's own named cast and furniture — a dedicated 44px sprite exists for each" }),
  Object.freeze({ id: GROUP_PERSON, label: "Person roles" }),
  Object.freeze({ id: GROUP_OBJECT, label: "Physical objects, creatures & places" }),
  Object.freeze({ id: GROUP_EMOJI, label: "Emotions & events", note: "abstract concepts with no honest single physical picture — rendered as the ubiquitous emoji instead" }),
]);

/** Which catalog section `cls` belongs in. Pure. `isIconTierClass`/`isEmoji`
 *  are handed in rather than recomputed here so this stays a one-line
 *  decision over already-known facts about the class. */
export function groupForClass(cls, { isIconTierClass, isEmoji }) {
  if (isEmoji) return GROUP_EMOJI;
  if (isIconTierClass && !SPIDER_FLY_CREATURE_CLASSES.includes(cls) && cls !== "person") return GROUP_ADVENTURE;
  if (PERSON_ROLE_CLASSES.includes(cls)) return GROUP_PERSON;
  return GROUP_OBJECT;
}

function templatesForClass(cls, templates) {
  return (templates || []).filter((t) => Array.isArray(t?.classes) && t.classes.includes(cls));
}

/** The MATERIAL_PALETTE treatment key whose {light,base,dark} triple exactly
 *  matches `value` — the reverse of sprite-materials.mjs's own
 *  expandMaterialReferences, so a swatch can show e.g. "gold -> metal
 *  treatment" (sprite-materials.mjs's own header: "gold and metal both read
 *  as the same warm shiny-metal treatment"). null for a plain single-
 *  placeholder colour value (a string, not an object) or a one-off hand-
 *  authored triple that matches no shared treatment. Pure. */
export function paletteTreatmentFor(value) {
  if (!value || typeof value !== "object") return null;
  for (const [name, triple] of Object.entries(MATERIAL_PALETTE)) {
    if (triple.light === value.light && triple.base === value.base && triple.dark === value.dark) return name;
  }
  return null;
}

/** Every real value a template's own [parameters.*] declares, as
 *  {paramName, property, rawValue, treatment} rows — one row per value key,
 *  read directly off the template's own data, never invented. Pure. */
export function parameterVariantsFor(template) {
  const out = [];
  for (const [paramName, param] of Object.entries(template?.parameters || {})) {
    for (const [rawValue, value] of Object.entries(param?.values || {})) {
      out.push({ paramName, property: param.property, rawValue, treatment: paletteTreatmentFor(value) });
    }
  }
  return out;
}

/** Swatches for one tier's template set: a plain swatch ONLY when a real
 *  `{class}.toml`-shaped plain template exists (no [parameters]/[match] at
 *  all) — never a synthesized "plain" label for a material-only class,
 *  since with zero taught facts that class's real resolved output is the
 *  generic root-fallback shape, not its own silhouette (this module's own
 *  header names the 19 large-tier classes this applies to). Every
 *  [parameters.*] value and every [match] variant renders through the real
 *  resolveSpriteAsset with the exact property fact it declares. A class
 *  with templates but no plain among them also gets one extra swatch,
 *  labeled `fallback: true`, showing exactly what the real resolver returns
 *  for that class with NO taught fact — honest engine behaviour, never
 *  hidden, just never mislabeled "plain". Pure given `templates` (already
 *  loaded) and `registry` (SPRITE_REGISTRY). */
export function tierSwatchesFor(cls, templates, registry, tier) {
  const forClass = templatesForClass(cls, templates);
  if (!forClass.length) return [];
  const plain = forClass.find((t) => !t.parameters && !t.match);
  const swatches = [];
  if (plain) {
    swatches.push({
      tier, label: "plain", kind: "plain",
      svg: resolveSpriteAsset(cls, [], [], templates, registry, { instanceKey: `${cls}-${tier}-plain` }),
    });
  }
  for (const t of forClass) {
    if (t.match) {
      const propertyFacts = [{ predicate: t.match.property, object: t.match.value }];
      swatches.push({
        tier, label: t.match.value, kind: "variant", property: t.match.property,
        svg: resolveSpriteAsset(cls, [], propertyFacts, templates, registry, { instanceKey: `${cls}-${tier}-match-${t.match.value}` }),
      });
    }
    for (const v of parameterVariantsFor(t)) {
      const propertyFacts = [{ predicate: v.property, object: v.rawValue }];
      swatches.push({
        tier, label: v.rawValue, kind: "material", property: v.property, treatment: v.treatment,
        svg: resolveSpriteAsset(cls, [], propertyFacts, templates, registry, { instanceKey: `${cls}-${tier}-${v.paramName}-${v.rawValue}` }),
      });
    }
  }
  if (!plain && swatches.length) {
    swatches.push({
      tier, label: "no material taught", kind: "fallback", fallback: true,
      svg: resolveSpriteAsset(cls, [], [], templates, registry, { instanceKey: `${cls}-${tier}-fallback` }),
    });
  }
  return swatches;
}

/** The full catalog: one entry per class the icon and/or large tier
 *  actually carries a template for, each with its real ancestor chain and
 *  every real tier/material swatch. Pure given the three loaded inputs.
 *  `factRows` defaults to `[]` (every chain then reads as just the class's
 *  own name — an honest, if less illustrative, chain rather than a crash)
 *  so a caller that hasn't loaded the ontology facts yet still gets a
 *  working catalog. */
export function buildSpriteCatalogEntries({ iconTemplates = [], largeTemplates = [], factRows = [] } = {}) {
  const iconClasses = new Set(iconTemplates.flatMap((t) => t?.classes || []));
  const largeClasses = new Set(largeTemplates.flatMap((t) => t?.classes || []));
  const allClasses = [...new Set([...iconClasses, ...largeClasses])].sort();

  return allClasses.map((cls) => {
    const chain = classAncestorChain(cls, factRows);
    const iconSwatches = tierSwatchesFor(cls, iconTemplates, SPRITE_REGISTRY, "icon");
    const largeSwatches = tierSwatchesFor(cls, largeTemplates, SPRITE_REGISTRY, "large");
    const isEmoji = [...iconSwatches, ...largeSwatches].some((s) => s.svg.includes("<text"));
    const group = groupForClass(cls, { isIconTierClass: iconClasses.has(cls), isEmoji });
    return { className: cls, group, chain, iconSwatches, largeSwatches };
  });
}

// ---- scene composer (pure) ----
//
// The free-text "there is a..." box (PLAN_GAMES_UPLIFT_V3.md's own precedent:
// adventure-viz.mjs's roomSceneObjects/room-frame) over THIS page's own
// already-real classes — never a general NLU pass. extractSceneItems is the
// one pure, unit-testable piece; the DOM index it's matched against
// (className -> real swatch labels, read straight off this page's own
// already-rendered `.card`/`.swatch-label` markup at load time — see this
// module's own header for why that beats re-embedding the same SVG data a
// second time) is built client-side in the inline script below, since
// walking rendered DOM has no meaning in this pure module.

/** `text`'s lowercase word runs with their token index, the unit
 *  extractSceneItems matches class names against — punctuation never fuses
 *  two real words into one token nor splits one real word into two. */
function tokenizeSceneText(text) {
  const tokens = [];
  const re = /[A-Za-z]+/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) tokens.push({ word: m[0].toLowerCase() });
  return tokens;
}

/** Every real catalog class the free-typed `text` names, in the order each
 *  first appears, paired with the real material label (one of that SAME
 *  class's own swatch labels — never another class's, never a fabricated
 *  one) immediately preceding it, or `null`. `classIndex` is
 *  `{className: {materials}}` with `materials` keyed by lowercase label
 *  (sprite-catalog-viz's own client-side `buildClassIndexFromDom` output, or
 *  an equivalent test fixture) — a class name absent from `classIndex` can
 *  never match, and a modifier word that isn't one of ITS matched class's
 *  own material labels is silently dropped rather than guessed at, the same
 *  honest-miss posture an unrecognized class name gets (an unmatched word,
 *  e.g. "red" before a lamp with no red material, is never an error, just
 *  silently not drawn). A multi-word class name (e.g. "body of water") is
 *  checked, at every token position, before any shorter class that would
 *  otherwise claim part of it — candidates are tried longest-word-count
 *  first, so the longer name always wins the position it starts at. Pure. */
export function extractSceneItems(text, classIndex) {
  const index = classIndex || {};
  const candidates = Object.keys(index)
    .map((name) => ({ name, words: name.toLowerCase().split(/\s+/).filter(Boolean) }))
    .filter((c) => c.words.length)
    .sort((a, b) => b.words.length - a.words.length || b.name.length - a.name.length);
  const tokens = tokenizeSceneText(text);
  const used = new Array(tokens.length).fill(false);
  const items = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (used[i]) continue;
    const hit = candidates.find(({ words }) => {
      if (i + words.length > tokens.length) return false;
      for (let k = 0; k < words.length; k += 1) {
        if (used[i + k] || tokens[i + k].word !== words[k]) return false;
      }
      return true;
    });
    if (!hit) continue;
    let materialLabel = null;
    if (i > 0 && !used[i - 1]) {
      const materials = index[hit.name]?.materials || {};
      const prevWord = tokens[i - 1].word;
      if (Object.prototype.hasOwnProperty.call(materials, prevWord)) {
        materialLabel = prevWord;
        used[i - 1] = true;
      }
    }
    for (let k = 0; k < hit.words.length; k += 1) used[i + k] = true;
    items.push({ className: hit.name, materialLabel });
  }
  return items;
}

// ---- rendering ----

function chainHtml(chain) {
  const shown = chain.slice(0, MAX_CHAIN_DISPLAY);
  const rest = chain.length - shown.length;
  const links = shown
    .map((term, i) => `<span class="chain-link${i === 0 ? " own" : ""}">${escapeHtml(term)}</span>`)
    .join('<span class="chain-arrow">&rsaquo;</span>');
  const more = rest > 0 ? `<span class="chain-more">+${rest} more on record</span>` : "";
  return `<div class="chain">${links}${more}</div>`;
}

function swatchHtml(s) {
  const parts = [`<span class="swatch-label">${escapeHtml(s.label)}</span>`];
  if (s.treatment) parts.push(`<span class="swatch-treat">&rarr; ${escapeHtml(s.treatment)} treatment</span>`);
  const title = s.property ? `${s.property} = ${s.label}` : s.label;
  const cls = ["swatch", s.tier, s.kind].filter(Boolean).join(" ");
  return `<div class="${cls}" title="${escapeHtml(title)}"><div class="swatch-img">${s.svg}</div><div class="swatch-caption">${parts.join("")}</div></div>`;
}

function tierRowHtml(tierName, swatches) {
  if (!swatches.length) return "";
  return `<div class="tier-row" data-tier="${tierName}">
      <span class="tier-label">${tierName === "icon" ? "icon &middot; 44px" : "sprite &middot; 400px"}</span>
      <div class="swatches">${swatches.map(swatchHtml).join("")}</div>
    </div>`;
}

function cardHtml(entry) {
  return `<article class="card" data-cls="${escapeHtml(entry.className)}" data-group="${escapeHtml(entry.group)}">
    <h3 class="card-name">${escapeHtml(entry.className)}</h3>
    ${chainHtml(entry.chain)}
    ${tierRowHtml("icon", entry.iconSwatches)}
    ${tierRowHtml("large", entry.largeSwatches)}
  </article>`;
}

function sectionHtml(group, entries) {
  const rows = entries.filter((e) => e.group === group.id);
  if (!rows.length) return "";
  const note = group.note ? `<p class="section-note">${escapeHtml(group.note)}</p>` : "";
  return `<section class="group" id="g-${group.id}" aria-label="${escapeHtml(group.label)}">
    <h2>${escapeHtml(group.label)} <span class="count">${rows.length}</span></h2>
    ${note}
    <div class="cards">${rows.map(cardHtml).join("")}</div>
  </section>`;
}

/** The self-contained sprite-catalog page. Pure given `iconTemplates`
 *  (readSpriteTemplateFiles' own output), `largeTemplates`
 *  (readSpriteLargeTemplateFiles' own output) and `factRows`
 *  (loadSpriteOntologyFactRows' own output) — the same "byte-identical for
 *  identical input" invariant every other viz page in this project holds.
 *  All three default to `[]` so a caller mid-migration (no ontology facts
 *  loaded yet, say) still gets a page that renders, just with plainer
 *  ancestor chains. */
export function renderSpriteCatalogHtml({ title = DEFAULT_TITLE, iconTemplates = [], largeTemplates = [], factRows = [] } = {}) {
  const entries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows });
  const totalSwatches = entries.reduce((n, e) => n + e.iconSwatches.length + e.largeSwatches.length, 0);
  const pageData = embedJson({ classCount: entries.length, swatchCount: totalSwatches });
  const navHtml = CATALOG_GROUPS
    .map((g) => `<a class="jump" href="#g-${g.id}">${escapeHtml(g.label)} <span class="count">${entries.filter((e) => e.group === g.id).length}</span></a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${THEME_TOKENS_CSS}
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1180px; margin: 0 auto; padding: 1.4rem 1.2rem 3rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: 1.4rem; margin: .3rem 0 .6rem; text-wrap: balance; }

  .composer { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: .6rem 0 1.3rem; }
  @media (max-width: 700px) { .composer { grid-template-columns: 1fr; } }
  .composer .panel { background: var(--card); border: 1px solid var(--line); border-top: 2px solid var(--taught); padding: .75rem .85rem; min-width: 0; }
  .composer h2 { font-family: ${SERIF_STACK}; font-variant: small-caps; font-size: .82rem; letter-spacing: .04em; color: var(--muted); font-weight: 600; margin: 0 0 .55rem; }
  .composeform { display: flex; align-items: center; gap: .5rem; }
  .composeform .prompt { color: var(--taught); font-size: .8rem; white-space: nowrap; }
  .composeform input { flex: 1; font-family: ${MONO_STACK}; font-size: .82rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; padding: .38rem .6rem; min-width: 0; }
  .composeform input:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
  .pills { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .6rem; }
  .pill { font-family: ${MONO_STACK}; font-size: .7rem; padding: .22rem .55rem; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; }
  .pill:hover { border-color: var(--taught); }
  .pill:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
  .scene-frame { min-height: 5.6rem; display: flex; align-items: center; }
  .scene-row { display: flex; flex-wrap: wrap; gap: .8rem; align-items: flex-start; width: 100%; }
  .scene-card { display: flex; flex-direction: column; align-items: center; width: 74px; }
  .scene-sprite { width: 60px; height: 60px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; padding: 8px; box-sizing: border-box; }
  .scene-sprite svg { width: 100%; height: 100%; display: block; }
  .scene-label { font-size: .7rem; text-align: center; color: var(--ink); margin-top: .3rem; line-height: 1.2; }
  .empty-note { font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); }
  .topbar { position: sticky; top: 0; z-index: 2; background: var(--bg); display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .9rem; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: .6rem 0; margin: 1rem 0 1.2rem; }
  .jump { font-family: ${MONO_STACK}; font-size: .72rem; padding: .18rem .55rem; border: 1px solid var(--line); border-radius: 99px; background: var(--card); color: var(--ink); text-decoration: none; }
  .jump:hover { border-color: var(--taught); }
  .jump .count { color: var(--muted); }
  .filter { margin-left: auto; display: flex; align-items: center; gap: .4rem; }
  .filter input { font-family: ${MONO_STACK}; font-size: .8rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .32rem .6rem; width: 200px; }
  .filter .n { font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); white-space: nowrap; }
  .group { margin: 2rem 0; content-visibility: auto; contain-intrinsic-size: 800px; }
  .group h2 { font-size: 1.05rem; margin: 0 0 .2rem; display: flex; align-items: baseline; gap: .5rem; }
  .group h2 .count { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--muted); font-weight: 400; }
  .section-note { color: var(--muted); font-size: .82rem; margin: 0 0 .8rem; max-width: 68ch; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: .7rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .6rem .7rem .7rem; content-visibility: auto; contain-intrinsic-size: 220px; }
  .card[hidden] { display: none; }
  .card-name { font-size: .92rem; margin: 0 0 .3rem; font-weight: 600; }
  .chain { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); margin-bottom: .5rem; display: flex; flex-wrap: wrap; align-items: center; gap: .15rem; }
  .chain-link { padding: .04rem .35rem; border: 1px solid var(--line); border-radius: 99px; }
  .chain-link.own { border-color: var(--taught); color: var(--taught); }
  .chain-arrow { color: var(--muted); opacity: .6; }
  .chain-more { font-style: italic; opacity: .75; }
  .tier-row { margin-top: .4rem; }
  .tier-row:first-of-type { margin-top: 0; }
  .tier-label { font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .swatches { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .25rem; }
  .swatch { width: 64px; text-align: center; }
  .swatch.large .swatch-img { width: 64px; height: 64px; }
  .swatch.icon .swatch-img { width: 34px; height: 34px; margin: 0 auto; }
  .swatch-img svg { width: 100%; height: 100%; display: block; }
  .swatch.fallback { opacity: .55; }
  .swatch.fallback .swatch-img { outline: 1px dashed var(--line); outline-offset: 2px; }
  .swatch-caption { font-family: ${MONO_STACK}; font-size: .58rem; color: var(--muted); line-height: 1.25; margin-top: .15rem; word-break: break-word; }
  .swatch-treat { display: block; opacity: .8; }
  footer.page { max-width: 74ch; margin: 2.5rem 0 0; padding-top: 1rem; border-top: 1px solid var(--line); font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  @media (prefers-reduced-motion: no-preference) { .jump, .swatch, .pill { transition: border-color .12s ease, opacity .12s ease; } }
</style>
</head>
<body>
<main>
  <div class="eyebrow">tmct &middot; the sprite library</div>
  <h1>Sprites</h1>
  <div class="composer">
    <section class="panel compose-panel" aria-label="Describe a scene">
      <h2>describe a scene</h2>
      <form class="composeform" id="composeForm">
        <span class="prompt mono">there is a</span>
        <input id="composeq" type="text" autocomplete="off"
          placeholder="red lamp, a doctor with a hat, and a cabinet"
          aria-label="Continue the sentence: there is a&hellip;">
      </form>
      <div class="pills" id="composePills" role="group" aria-label="quick words to add">
        <button type="button" class="pill" data-fill="doctor">doctor</button>
        <button type="button" class="pill" data-fill="hat">hat</button>
        <button type="button" class="pill" data-fill="wood cabinet">wood cabinet</button>
        <button type="button" class="pill" data-fill="glass lamp">glass lamp</button>
        <button type="button" class="pill" data-fill="cat">cat</button>
        <button type="button" class="pill" data-fill="garden">garden</button>
      </div>
    </section>
    <section class="panel viewer-panel" aria-label="The composed scene">
      <h2>the scene</h2>
      <div class="scene-frame" id="sceneFrame">
        <div class="scene-row" id="sceneRow" aria-live="polite"></div>
        <span class="empty-note" id="sceneEmpty">nothing recognized yet &mdash; try &ldquo;a doctor with a hat, and a cabinet&rdquo;.</span>
      </div>
    </section>
  </div>
  <div class="topbar">
    <nav aria-label="Jump to group">${navHtml}</nav>
    <div class="filter">
      <input id="q" type="text" placeholder="filter by class or group&hellip;" aria-label="Filter the catalog">
      <span class="n mono" id="qcount"></span>
    </div>
  </div>
  ${CATALOG_GROUPS.map((g) => sectionHtml(g, entries)).join("")}
  <footer class="page">${entries.length} classes &middot; ${totalSwatches} swatches &middot; icon tier 44px, sprite tier 400px</footer>
</main>
<script>
const SPRITE_CATALOG = ${pageData};
</script>
<script>
(function () {
  "use strict";
  const q = document.getElementById("q");
  const qcount = document.getElementById("qcount");
  const cards = Array.from(document.querySelectorAll(".card"));
  function apply() {
    const needle = q.value.trim().toLowerCase();
    let shown = 0;
    for (const card of cards) {
      const hit = !needle || card.dataset.cls.includes(needle) || card.dataset.group.includes(needle);
      card.hidden = !hit;
      if (hit) shown += 1;
    }
    for (const section of document.querySelectorAll(".group")) {
      const anyShown = section.querySelectorAll(".card:not([hidden])").length > 0;
      section.style.display = anyShown ? "" : "none";
    }
    qcount.textContent = needle ? shown + " / " + cards.length : "";
  }
  q.addEventListener("input", apply);
  apply();

  // ---- the scene composer — reads the class/material index straight off
  // THIS page's own already-rendered card and swatch-label markup (this
  // module's own header explains why: never a second embedded copy of the
  // same swatch data), so the composed scene below only ever shows a sprite
  // this same page already proved the resolver draws.
  const esc = ${escapeHtml.toString()};
  const tokenizeSceneText = ${tokenizeSceneText.toString()};
  const extractSceneItems = ${extractSceneItems.toString()};

  function buildClassIndexFromDom() {
    const index = {};
    for (const card of cards) {
      const largeRow = card.querySelector('.tier-row[data-tier="large"]');
      if (!largeRow) continue;
      let defaultSvg = null;
      const materials = {};
      for (const swatch of largeRow.querySelectorAll(".swatch")) {
        const labelEl = swatch.querySelector(".swatch-label");
        const svgEl = swatch.querySelector(".swatch-img");
        if (!labelEl || !svgEl) continue;
        const svg = svgEl.innerHTML;
        if (swatch.classList.contains("plain")) defaultSvg = svg;
        else if (swatch.classList.contains("fallback")) { if (!defaultSvg) defaultSvg = svg; }
        else materials[labelEl.textContent.trim().toLowerCase()] = svg;
      }
      if (!defaultSvg) {
        const firstSvg = largeRow.querySelector(".swatch-img");
        if (firstSvg) defaultSvg = firstSvg.innerHTML;
      }
      index[card.dataset.cls] = { defaultSvg, materials };
    }
    return index;
  }

  const classIndex = buildClassIndexFromDom();
  const composeqEl = document.getElementById("composeq");
  const composeFormEl = document.getElementById("composeForm");
  const composePillsEl = document.getElementById("composePills");
  const sceneRowEl = document.getElementById("sceneRow");
  const sceneEmptyEl = document.getElementById("sceneEmpty");

  function renderScene(text) {
    const items = extractSceneItems(text, classIndex);
    if (!items.length) {
      sceneRowEl.innerHTML = "";
      sceneEmptyEl.hidden = false;
      return;
    }
    sceneEmptyEl.hidden = true;
    sceneRowEl.innerHTML = items.map((item) => {
      const entry = classIndex[item.className];
      if (!entry) return "";
      const svg = (item.materialLabel && entry.materials[item.materialLabel]) || entry.defaultSvg || "";
      const label = item.materialLabel ? item.materialLabel + " " + item.className : item.className;
      return '<div class="scene-card"><div class="scene-sprite">' + svg + '</div><div class="scene-label">' + esc(label) + "</div></div>";
    }).join("");
  }

  composeqEl.addEventListener("input", () => renderScene(composeqEl.value));
  composeFormEl.addEventListener("submit", (e) => { e.preventDefault(); renderScene(composeqEl.value); });
  composePillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    const phrase = btn.dataset.fill || "";
    const current = composeqEl.value.trim();
    composeqEl.value = current ? current + ", a " + phrase : phrase;
    composeqEl.focus();
    renderScene(composeqEl.value);
  });
  renderScene("");
})();
</script>
</body>
</html>
`;
}
