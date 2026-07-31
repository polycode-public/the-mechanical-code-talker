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
import { resolveSpriteAsset, matchConstraints } from "../domain/sprite-templates.mjs";
import { MATERIAL_PALETTE } from "../domain/sprite-materials.mjs";
import { spriteFactRows } from "../domain/sprite-facts.mjs";
import { SEED_TAXONOMY } from "../domain/spider-fly-world.mjs";
import { loadSlice, loadMap, toFacts, WORDNET_DIR } from "../adapters/corpus/conceptnet.mjs";
import { join } from "node:path";
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText } from "./viz-theme.mjs";

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

// Each group's own full-gallery page filename — the demo site builds one
// page per group (scripts/build-demo-site.mjs) plus the sprites.html landing
// page's "view all" links, both read straight off this field so neither can
// name a group's page differently from the other.
export const CATALOG_GROUPS = Object.freeze([
  Object.freeze({ id: GROUP_ADVENTURE, label: "Ashcombe Hall's own adventure props", note: "the icon tier's named cast and furniture. Each has its own 44px sprite.", page: "sprites-adventure-props.html" }),
  Object.freeze({ id: GROUP_PERSON, label: "Person roles", page: "sprites-person-roles.html" }),
  Object.freeze({ id: GROUP_OBJECT, label: "Physical objects, creatures & places", page: "sprites-objects.html" }),
  Object.freeze({ id: GROUP_EMOJI, label: "Emotions & events", note: "abstract concepts with no single physical picture, drawn as the familiar emoji instead", page: "sprites-emotions.html" }),
]);

// The two sections large enough to need ancestor clustering rather than one
// flat card grid — same two groups sectionHtml's own caller already singled
// out before this was a named function.
const CLUSTERED_GROUPS = Object.freeze([GROUP_PERSON, GROUP_OBJECT]);

/** Whether `groupId`'s own full gallery clusters its cards under ancestor
 *  headings rather than rendering one flat grid. Pure. */
export function groupIsClustered(groupId) {
  return CLUSTERED_GROUPS.includes(groupId);
}

/** Which catalog section `cls` belongs in. Pure. `isIconTierClass`/`isEmoji`
 *  are handed in rather than recomputed here so this stays a one-line
 *  decision over already-known facts about the class. */
export function groupForClass(cls, { isIconTierClass, isEmoji }) {
  if (isEmoji) return GROUP_EMOJI;
  if (isIconTierClass && !SPIDER_FLY_CREATURE_CLASSES.includes(cls) && cls !== "person") return GROUP_ADVENTURE;
  if (PERSON_ROLE_CLASSES.includes(cls)) return GROUP_PERSON;
  return GROUP_OBJECT;
}

/** Cluster one presentation group's entries under each class's nearest
 *  ILLUSTRATED ancestor — the first term after the class itself, walking its
 *  own real chain outward, that carries a sprite template at either tier. A
 *  new leaf attached under that ancestor later resolves to the ancestor's
 *  own sprite through the same walk, so these headings show exactly where
 *  the graph can grow with no new art needed. A cluster needs two members
 *  to earn a heading; singletons (and classes whose chain reaches no
 *  illustrated ancestor) fold into one trailing `ancestor: null` bucket so
 *  the section never shreds into one-card headings. Pure. */
export function clusterEntriesByAncestor(entries, spritedClasses) {
  const byKey = new Map();
  for (const e of entries || []) {
    const key = (e.chain || []).slice(1).find((t) => spritedClasses.has(t)) || "";
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }
  const clusters = [];
  const rest = [];
  for (const [key, list] of byKey) {
    if (key && list.length >= 2) clusters.push({ ancestor: key, entries: list });
    else rest.push(...list);
  }
  clusters.sort((a, b) => b.entries.length - a.entries.length || a.ancestor.localeCompare(b.ancestor));
  if (rest.length) clusters.push({ ancestor: null, entries: [...rest].sort((a, b) => a.className.localeCompare(b.className)) });
  return clusters;
}

/** Every section this catalog's own pages break into, in on-page reading
 *  order — the four top-level groups, each expanded into its own ancestor
 *  clusters when groupIsClustered says so (clusterEntriesByAncestor's own
 *  cluster order — big clusters first, "everything else" trailing), or left
 *  as one section when a group carries no clustering at all (adventure,
 *  emoji). This is the landing page's own granularity: one example card per
 *  section, not per top-level group, since a group as broad as "physical
 *  objects, creatures & places" reads as dozens of unrelated sub-themes a
 *  single example could never stand in for. Each item is `{group, label,
 *  entries}` — `label` is the ancestor's own name, "everything else" for a
 *  clustered group's trailing bucket, or the group's own label when the
 *  group isn't clustered at all. Pure. */
export function catalogSections(entries, spritedClasses) {
  const sections = [];
  for (const g of CATALOG_GROUPS) {
    const rows = (entries || []).filter((e) => e.group === g.id);
    if (!rows.length) continue;
    if (!groupIsClustered(g.id)) {
      sections.push({ group: g, label: g.label, entries: rows });
      continue;
    }
    for (const c of clusterEntriesByAncestor(rows, spritedClasses)) {
      sections.push({ group: g, label: c.ancestor || "everything else", entries: c.entries });
    }
  }
  return sections;
}

/** The operator's own curated example sprites, one per landing-page section,
 *  in reading order — a closed, hand-picked list in the same idiom as
 *  PERSON_ROLE_CLASSES/CATALOG_TAXONOMY_GAPFILL above, not derived from any
 *  ordering rule. Checked directly against catalogSections' real output: each
 *  name here really is a member of exactly one of this catalog's 28 current
 *  sections (the whole adventure and emoji groups, the 9 person-role
 *  clusters, the 17 physical-object clusters), one per section. A future
 *  catalog change that drops one of these classes, or adds/removes a section,
 *  is exactly what landingExampleFor's own fallback below is for. */
export const LANDING_EXAMPLE_CLASSES = Object.freeze([
  "adventurer", "engineer", "king", "driver", "boss", "wife", "crowd", "worker",
  "person", "family", "bear", "house", "tomato", "fly", "stadium", "spider",
  "ocean", "planet", "metal", "boat", "breakfast", "town", "plant", "tiger",
  "rain", "bedroom", "frog", "autumn",
]);

/** The landing page's one example entry for a section (`sectionEntries`,
 *  already the exact class list that section's own full page shows): the
 *  first of LANDING_EXAMPLE_CLASSES that is really a member of this section,
 *  so the operator's own curated favourite wins whenever this catalog really
 *  carries it there. Falls back to the section's own first entry (its
 *  existing catalog order) when none of the 28 named favourites is a member —
 *  an honest real example rather than nothing, for a section the curated
 *  list doesn't happen to name. Pure. */
const LANDING_EXAMPLE_CLASS_SET = new Set(LANDING_EXAMPLE_CLASSES);

export function landingExampleFor(sectionEntries) {
  if (!sectionEntries?.length) return null;
  return sectionEntries.find((e) => LANDING_EXAMPLE_CLASS_SET.has(e.className)) || sectionEntries[0];
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
 *  resolveSpriteAsset with the exact property facts it declares — and a
 *  parameter sitting ON a [match] variant is rendered with BOTH facts, so a
 *  facing profile's mood swatch shows the profile wearing that mood and is
 *  labeled for the pair ("left + happy"). Rendering it on the parameter fact
 *  alone would resolve a different template altogether (the front-facing
 *  one) and label it as if it belonged to the profile. A value that a
 *  match-free template of the same class already offers is listed once, from
 *  that template: the facing pair and the `*-with-emotion.toml` file both
 *  carry all six moods, and one swatch per mood is the catalog's unit. A
 *  class
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
  const valueKey = (v) => `${v.paramName}:${v.rawValue}`;
  const shownByUnmatchedTemplate = new Set(
    forClass.filter((t) => !t.match).flatMap((t) => parameterVariantsFor(t).map(valueKey)),
  );
  for (const t of forClass) {
    // A variant may require several facts at once (sprite-templates.mjs's own
    // matchConstraints), so the swatch is rendered with EVERY fact its
    // [match] asks for and labeled for the whole set — "left + moving" for a
    // combined facing-and-pose file. A one-constraint variant reads exactly
    // as it did before the plural spelling existed.
    const constraints = matchConstraints(t);
    const matchFact = constraints.map((c) => ({ predicate: c.property, object: c.value }));
    const variantLabel = constraints.map((c) => c.value).join(" + ");
    const variantKey = constraints.map((c) => c.value).join("-");
    const matchPrefix = constraints.length ? `${variantLabel} + ` : "";
    if (constraints.length) {
      swatches.push({
        tier, label: variantLabel, kind: "variant", property: constraints.map((c) => c.property).join(" + "),
        svg: resolveSpriteAsset(cls, [], matchFact, templates, registry, { instanceKey: `${cls}-${tier}-match-${variantKey}` }),
      });
    }
    for (const v of parameterVariantsFor(t)) {
      if (constraints.length && shownByUnmatchedTemplate.has(valueKey(v))) continue;
      const propertyFacts = [...matchFact, { predicate: v.property, object: v.rawValue }];
      swatches.push({
        tier, label: `${matchPrefix}${v.rawValue}`, kind: "material", property: v.property, treatment: v.treatment,
        svg: resolveSpriteAsset(cls, [], propertyFacts, templates, registry, { instanceKey: `${cls}-${tier}-${matchPrefix ? `${variantKey}-` : ""}${v.paramName}-${v.rawValue}` }),
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

// ---- scene composer ----
//
// The free-text "there is a..." box (adventure-viz.mjs's roomSceneObjects/
// room-frame is the same shape) over the WHOLE catalog's real classes, never
// just whichever group's cards the current page happens to render — the
// sprites.html landing page shows one card per group, and each per-group
// page shows only its own group, but a visitor composing "a doctor with a
// hat, and a cabinet" needs all three classes to resolve regardless of which
// page they typed it into. The parser itself is scene-compose.mjs, which
// resolves a typed class name through the real resolver; this page owns only
// the class index it is matched against (className -> real swatch labels),
// computed HERE, in Node, over the full catalog (sceneComposerClassIndex)
// and embedded once per page — the only way the index can stay whole-catalog
// once no single page renders every card any more.

export { extractSceneItems } from "../domain/scene-compose.mjs";

/** The scene composer's class index, `{className: {defaultSvg, materials}}`
 *  with `materials` keyed by lowercase label — computed over the WHOLE
 *  catalog's `entries` (every group), never just the classes a particular
 *  page's cards happen to show. Pure. Mirrors exactly what the page's own
 *  large-tier card markup carries: a plain swatch is the default sprite, a
 *  fallback swatch stands in when there's no plain one, and every other
 *  swatch's own label becomes a material key. A class with no large-tier
 *  swatch at all (icon-only) contributes nothing — there is no sprite for
 *  the composer to draw for it either way. */
export function sceneComposerClassIndex(entries) {
  const index = {};
  for (const entry of entries || []) {
    const large = entry.largeSwatches || [];
    if (!large.length) continue;
    let defaultSvg = null;
    const materials = {};
    for (const s of large) {
      if (s.kind === "plain") defaultSvg = s.svg;
      else if (s.kind === "fallback") { if (!defaultSvg) defaultSvg = s.svg; }
      else materials[String(s.label).trim().toLowerCase()] = s.svg;
    }
    if (!defaultSvg) defaultSvg = large[0].svg;
    index[entry.className] = { defaultSvg, materials };
  }
  return index;
}

// ---- the catalog question lane ----
//
// There isn't one. Every catalog-shaped question the dock takes — "how many
// sprite classes are there", "list the sprite classes", "what parameters does
// a person sprite take", "what emotions does a person sprite accept" — is
// answered by the ordinary chat engine reading the same sprite-facts rows this
// page embeds, through the membership, count and property lanes it already runs
// for every other caller. The predicate spellings sprite-facts.mjs mints
// (mgx:take-parameter, mgx:accept-emotion, mgx:offer-variant) are what those
// lanes read, so the page hands the line over and renders what comes back.

// ---- the animated swatches (pure) ----
//
// Each card's large tier carries three animated swatches, one per axis the
// sprite tier actually varies on: mood (mgx:feels), facing (mgx:faces) and
// pose (mgx:pose). The page builds their frames client-side out of its own
// already-rendered swatches (see the inline script below — the same
// read-the-DOM posture the scene composer's class index takes), but the
// frame ORDER and the tempo are real logic worth pinning on their own, so
// they live here as pure functions the page splices in by `.toString()`.
// One delay constant serves all three, so the three can't drift apart into
// three tempos.
//
// A `frame` is `{svg, label}`. An empty return means there is nothing worth
// animating for that class, and the page leaves its static swatch alone.

/** The step between animated swatch frames, in milliseconds — the mood
 *  cycle's own established tempo, shared by the facing sweep and the pose
 *  toggle. */
export const CYCLE_FRAME_DELAY_MS = 800;

/** The turntable order the facing sweep steps through: one continuous
 *  rotation from the sprite's own left profile round to its right. `null`
 *  is the centre pose — the plain sprite, no mgx:faces fact at all — which
 *  sits in the middle of the sweep exactly where the geometry puts it, so
 *  the turn reads as a rotation rather than a jump back through front. */
export const FACING_TURN_ORDER = Object.freeze(["left", "half-left", null, "half-right", "right"]);

/** The mood cycle's frames: the class's plain sprite, then every mood it
 *  has a rendered swatch for, in the order the templates declare them. Two
 *  moods is the floor — one mood alternating with plain is a blink, not a
 *  cycle. Pure; self-contained (no outer refs), `.toString()`-splice safe. */
export function moodFrameSequence(plainFrame, moodFrames) {
  const moods = (moodFrames || []).filter(Boolean);
  if (moods.length < 2) return [];
  return plainFrame ? [plainFrame, ...moods] : moods;
}

/** The facing sweep's frames: `order` (FACING_TURN_ORDER) filtered down to
 *  the facings this class actually has a rendered swatch for, with
 *  `centreFrame` — the plain, undirected sprite — dropped into the centre
 *  slot. `facingFrames` is keyed by each swatch's own label, which is its
 *  real mgx:faces value. A class with one facing or none has no sweep.
 *  Pure; self-contained, `.toString()`-splice safe. */
export function turnFrameSequence(order, centreFrame, facingFrames) {
  const byFacing = facingFrames || {};
  const frames = [];
  for (const facing of order || []) {
    if (facing === null) {
      if (centreFrame) frames.push({ svg: centreFrame.svg, label: "centre" });
    } else if (byFacing[facing]) {
      frames.push({ svg: byFacing[facing].svg, label: facing });
    }
  }
  return frames.length >= 2 ? frames : [];
}

/** The pose toggle's frames: the class's plain idle sprite alternating with
 *  its mgx:pose = "moving" one. Both have to be there — a class with no
 *  moving sprite has no second state to toggle into, and gets nothing
 *  rather than a still frame pretending to animate. Pure; self-contained,
 *  `.toString()`-splice safe. */
export function movingFrameSequence(idleFrame, movingFrame) {
  if (!idleFrame || !movingFrame) return [];
  return [{ svg: idleFrame.svg, label: "idle" }, { svg: movingFrame.svg, label: "moving" }];
}

// ---- rendering ----

/** The DOM id a class's own card carries on whichever full-gallery page
 *  renders it — what a landing-page "view all" link anchors to
 *  (`${group.page}#${classAnchorId(className)}`), so the visitor lands
 *  exactly on the class they clicked through for rather than the top of a
 *  page with dozens or hundreds of other cards above it. Pure. */
export function classAnchorId(className) {
  return `card-${String(className).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

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
  const property = s.property ? ` data-property="${escapeHtml(s.property)}"` : "";
  return `<div class="${cls}"${property} title="${escapeHtml(title)}"><div class="swatch-img">${s.svg}</div><div class="swatch-caption">${parts.join("")}</div></div>`;
}

function tierRowHtml(tierName, swatches) {
  if (!swatches.length) return "";
  return `<div class="tier-row" data-tier="${tierName}">
      <span class="tier-label">${tierName === "icon" ? "icon &middot; 44px" : "sprite &middot; 400px"}</span>
      <div class="swatches">${swatches.map(swatchHtml).join("")}</div>
    </div>`;
}

function cardHtml(entry) {
  return `<article class="card" id="${classAnchorId(entry.className)}" data-cls="${escapeHtml(entry.className)}" data-group="${escapeHtml(entry.group)}">
    <h3 class="card-name">${escapeHtml(entry.className)}</h3>
    ${chainHtml(entry.chain)}
    ${tierRowHtml("icon", entry.iconSwatches)}
    ${tierRowHtml("large", entry.largeSwatches)}
  </article>`;
}

/** One ancestor cluster inside a section: a heading that carries the
 *  ancestor's OWN resolved sprite (the proof the fallback has art to land
 *  on), then that cluster's cards. `ancestorSvg` is null for the trailing
 *  no-illustrated-ancestor bucket. */
function clusterHtml(cluster, ancestorSvg) {
  const name = cluster.ancestor || "everything else";
  const chip = ancestorSvg ? `<span class="cluster-chip">${ancestorSvg}</span>` : "";
  return `<div class="cluster">
    <h3 class="cluster-head">${chip}<span class="cluster-name">${escapeHtml(name)}</span><span class="count">${cluster.entries.length}</span></h3>
    <div class="cards">${cluster.entries.map(cardHtml).join("")}</div>
  </div>`;
}

function sectionHtml(group, entries, { clusterBy = null } = {}) {
  const rows = entries.filter((e) => e.group === group.id);
  if (!rows.length) return "";
  const note = group.note ? `<p class="section-note">${escapeHtml(group.note)}</p>` : "";
  const body = clusterBy
    ? clusterEntriesByAncestor(rows, clusterBy.spritedClasses)
        .map((c) => clusterHtml(c, c.ancestor ? clusterBy.resolveChip(c.ancestor) : null))
        .join("")
    : `<div class="cards">${rows.map(cardHtml).join("")}</div>`;
  return `<section class="group" id="g-${group.id}" aria-label="${escapeHtml(group.label)}">
    <h2>${escapeHtml(group.label)} <span class="count">${rows.length}</span></h2>
    ${note}
    ${body}
  </section>`;
}

/** The sprite-catalog page. Pure given `iconTemplates` (readSpriteTemplateFiles'
 *  own output), `largeTemplates` (readSpriteLargeTemplateFiles' own output)
 *  and `factRows` (loadSpriteOntologyFactRows' own output) — the same
 *  "byte-identical for identical input" invariant every other viz page in
 *  this project holds. All three default to `[]` so a caller mid-migration
 *  (no ontology facts loaded yet, say) still gets a page that renders, just
 *  with plainer ancestor chains.
 *
 *  With no `groupId`, this is the FULL catalog on one page, every group's
 *  full gallery, anchor-nav between its own sections — the CLI's `--render
 *  sprites` standalone export, and this module's own test fixture. Given a
 *  real `groupId` (one of CATALOG_GROUPS' own ids), this instead renders
 *  ONLY that group's full gallery — the demo site's own sprites-<group>.html
 *  pages (scripts/build-demo-site.mjs) — with the topbar switched to
 *  cross-page links (crossPageNavHtml), since a `#g-<id>` anchor to a
 *  section that isn't on this page any more would go nowhere. Either way the
 *  footer counts describe only what THIS page actually shows.
 *
 *  `spritesBundleAvailable: true` (ledger-viz.mjs's own ledgerBundleAvailable
 *  idiom) is what adds the two interactive panels at all: the page then embeds
 *  the sprite-facts rows (src/domain/sprite-facts.mjs, derived purely from the
 *  same two template sets) and references the sprites-browser bundle. Both
 *  panels need that bundle — the dock for its chat session, the scene
 *  composer for the resolver its parser asks. Left false, the page is the
 *  catalog alone: no dock, no composer, no bundle reference, nothing extra to
 *  404 — including the favicon links.
 *
 *  `engineBundleJs` (the built sprites-browser bundle's own text, spider-fly-
 *  viz.mjs's own idiom) inlines that bundle into the page instead of
 *  referencing it as the sibling `./sprites-browser.bundle.js`
 *  scripts/build-demo-site.mjs writes alongside the deployed pages — for the
 *  CLI's standalone export, one downloadable file that runs from file://
 *  with no sibling assets. Default empty keeps the site build's sibling-file
 *  arrangement byte-identical, favicon links included; the standalone export
 *  drops those too, since a relative ./favicon.svg would be a dangling
 *  external reference the "no sibling assets" export can't carry.
 *
 *  Both the dock's fact rows and the composer's class index are always built
 *  from the WHOLE catalog, never just `groupId`'s own slice — a visitor on
 *  one group's page can still ask about, or compose, any real class from any
 *  other group. */
export function renderSpriteCatalogHtml({ title = DEFAULT_TITLE, iconTemplates = [], largeTemplates = [], factRows = [], spritesBundleAvailable = false, groupId = null, engineBundleJs = "" } = {}) {
  const entries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows });
  const spritedClasses = new Set([...iconTemplates, ...largeTemplates].flatMap((t) => t?.classes || []));
  const clusterBy = {
    spritedClasses,
    resolveChip: (ancestor) =>
      resolveSpriteAsset(ancestor, [], [], largeTemplates, SPRITE_REGISTRY, { instanceKey: `cluster-${ancestor}` }),
  };
  const groupsToRender = groupId ? CATALOG_GROUPS.filter((g) => g.id === groupId) : CATALOG_GROUPS;
  const bodyHtml = groupsToRender
    .map((g) => sectionHtml(g, entries, { clusterBy: groupIsClustered(g.id) ? clusterBy : null }))
    .join("");
  const navHtml = groupId
    ? crossPageNavHtml(entries, { currentGroupId: groupId, includeOverviewLink: true })
    : CATALOG_GROUPS
        .map((g) => `<a class="jump" href="#g-${g.id}">${escapeHtml(g.label)} <span class="count">${entries.filter((e) => e.group === g.id).length}</span></a>`)
        .join("");
  const footerEntries = groupId ? entries.filter((e) => e.group === groupId) : entries;
  const footerSwatches = footerEntries.reduce((n, e) => n + e.iconSwatches.length + e.largeSwatches.length, 0);
  return renderSpriteCatalogPage({
    title, entries, bodyHtml, navHtml, iconTemplates, largeTemplates, spritesBundleAvailable, engineBundleJs,
    footerClassCount: footerEntries.length, footerSwatchCount: footerSwatches,
  });
}

/** The topbar's cross-page nav for a per-group or landing site page: real
 *  links to each group's own full-gallery page (CATALOG_GROUPS' own `page`
 *  field), each carrying that group's real class count. Used wherever a page
 *  no longer holds every group's own section, so an in-page `#g-<id>` anchor
 *  would name a section that isn't there any more — the full single-page
 *  render (no `groupId`, CLI standalone) keeps the anchor nav instead, since
 *  every section really is on that one page. `currentGroupId` marks its own
 *  page's link `aria-current="page"` rather than dropping it, and
 *  `includeOverviewLink` adds a link back to the sprites.html landing page
 *  (every per-group page wants one; the landing page itself doesn't). */
function crossPageNavHtml(entries, { currentGroupId = null, includeOverviewLink = false } = {}) {
  const groupLinks = CATALOG_GROUPS.map((g) => {
    const count = entries.filter((e) => e.group === g.id).length;
    const current = g.id === currentGroupId ? ' aria-current="page"' : "";
    return `<a class="jump" href="./${g.page}"${current}>${escapeHtml(g.label)} <span class="count">${count}</span></a>`;
  }).join("");
  const overview = includeOverviewLink ? `<a class="jump jump-overview" href="./sprites.html">overview</a>` : "";
  return groupLinks + overview;
}

/** The shared page scaffold every sprite-catalog page renders through: the
 *  chrome (appbar, composer, ask dock, topbar+filter, footer) and every
 *  script, identical on the CLI's standalone full-catalog export, the
 *  sprites.html landing page, and each of the four per-group pages — only
 *  `bodyHtml`/`navHtml`/the footer counts differ per caller. `entries` is
 *  always the WHOLE catalog (never filtered to one group), because the
 *  composer's class index and the dock's fact rows must resolve any real
 *  catalog class regardless of which cards this particular page shows. */
function renderSpriteCatalogPage({ title, entries, bodyHtml, navHtml, iconTemplates, largeTemplates, spritesBundleAvailable, engineBundleJs = "", footerClassCount, footerSwatchCount }) {
  const totalSwatches = entries.reduce((n, e) => n + e.iconSwatches.length + e.largeSwatches.length, 0);
  const pageData = embedJson({ classCount: entries.length, swatchCount: totalSwatches });
  const dockRows = spritesBundleAvailable ? spriteFactRows({ iconTemplates, largeTemplates }) : [];
  // The composer's class index, computed here over the WHOLE catalog and
  // embedded once — see sceneComposerClassIndex's own header for why this
  // replaced reading it back off the page's own rendered card markup.
  const classIndexJs = !spritesBundleAvailable ? "{}" : embedJson(sceneComposerClassIndex(entries));

  const dockCss = !spritesBundleAvailable ? "" : `
  .dockwrap { margin: .2rem 0 1.3rem; }
  .dock-note { color: var(--muted); font-size: .8rem; margin: 0 0 .6rem; max-width: 72ch; }
  .docklog { display: flex; flex-direction: column; gap: .4rem; max-height: 240px; overflow-y: auto; margin-bottom: .5rem; }
  .docklog:empty { display: none; margin-bottom: 0; }
  .docklog .u { font-family: ${MONO_STACK}; font-size: .76rem; color: var(--muted); }
  .docklog .u::before { content: "tmct> "; color: var(--taught); }
  .docklog .a { font-size: .88rem; line-height: 1.45; white-space: pre-wrap; }
  .docklog .a.miss { color: var(--muted); font-style: italic; }
  .docklog .a.grounded { border-left: 2px solid var(--taught); padding-left: .5rem; }
  .dockask { display: flex; align-items: center; gap: .5rem; }
  .dockask .prompt { color: var(--taught); font-size: .78rem; }
  .dockask input { flex: 1; font-family: ${MONO_STACK}; font-size: .82rem; background: var(--ai-panel-hi); color: var(--ink); border: 1px solid var(--ai-edge); border-radius: 3px; padding: .38rem .6rem; min-width: 0; }
  .dockask input:focus-visible { outline: 2px solid var(--corpus); outline-offset: 2px; }
  .dockask input:disabled { opacity: .5; }
  .dock-status { font-size: .72rem; color: var(--muted); margin-top: .55rem; }
`;

  const dockHtml = !spritesBundleAvailable ? "" : `<div class="dockwrap">
    <section class="panel" aria-label="Ask about the sprite catalog">
      <h2>ask the catalog</h2>
      <p class="dock-note">every answer is read from the sprite templates&rsquo; own facts. A question they can&rsquo;t ground gets a refusal, never a guess.</p>
      <div class="docklog" id="dockLog" aria-live="polite"></div>
      <form class="dockask" id="dockForm">
        <span class="prompt mono">tmct&gt;</span>
        <input id="dockq" type="text" autocomplete="off"
          placeholder="what parameters does a person sprite take?"
          aria-label="Ask about the sprite catalog" disabled>
      </form>
      <div class="pills" id="dockPills" role="group" aria-label="quick questions to ask">
        <button type="button" class="pill" data-q="what parameters does a person sprite take?">person parameters</button>
        <button type="button" class="pill" data-q="what emotions does a person sprite accept?">person emotions</button>
        <button type="button" class="pill" data-q="what materials does a cabinet sprite accept?">cabinet materials</button>
        <button type="button" class="pill" data-q="how many sprite classes are there?">classes on record</button>
        <button type="button" class="pill" data-q="what is a portrait sprite?">about the portrait sprite</button>
      </div>
      <div class="dock-status mono" id="dockStatus">loading the engine&hellip;</div>
    </section>
  </div>`;

  // The bundle carries the scene composer's parser as well as the dock's
  // session, and the catalog script below calls it directly, so it loads ahead
  // of that script rather than beside the dock's own wiring at the end.
  // `engineBundleJs` present means the CLI's standalone export: inline the
  // bundle text instead of the sibling `<script src>` the deployed site uses,
  // the same choice spider-fly-viz.mjs/adventure-viz.mjs make for their own
  // engine bundles.
  const spriteBundleScript = !spritesBundleAvailable
    ? ""
    : engineBundleJs
      ? `<script>\n${embedScriptText(engineBundleJs)}\n</script>`
      : `<script src="./sprites-browser.bundle.js"></script>`;

  // The composer resolves a typed class name through the real resolver, which
  // reaches the page in that bundle. Without it there is nothing to type into,
  // so the panel stays out rather than rendering a box that can't answer.
  const composerHtml = !spritesBundleAvailable ? "" : `<div class="composer">
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
        <span class="empty-note" id="sceneEmpty">nothing recognized yet. Try &ldquo;a doctor with a hat, and a cabinet&rdquo;.</span>
      </div>
    </section>
  </div>`;

  const dockScripts = !spritesBundleAvailable ? "" : `<script>
const SPRITE_CHAT = ${embedJson({ rows: dockRows })};
</script>
<script>
(function () {
  "use strict";
  const dockLogEl = document.getElementById("dockLog");
  const dockFormEl = document.getElementById("dockForm");
  const dockqEl = document.getElementById("dockq");
  const dockPillsEl = document.getElementById("dockPills");
  const dockStatusEl = document.getElementById("dockStatus");

  // The SAME bounded-race wink load ledger/plan/chat use, against the site's
  // shared first-party ./vendor/wink.js — a missing or slow asset degrades to
  // the adapter-less tiers, never a broken dock.
  const WINK_LOAD_TIMEOUT_MS = 8000;
  const winkTimeout = (ms, reason) => new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));
  let winkReady = null;
  function tryLoadWink() {
    if (winkReady) return winkReady;
    winkReady = (async () => {
      try {
        const mod = await Promise.race([
          import("./vendor/wink.js"),
          winkTimeout(WINK_LOAD_TIMEOUT_MS, "wink vendor asset load timed out"),
        ]);
        tmct.page.registerWinkModel(() => ({ winkNLP: mod.winkNLP, model: mod.model }));
      } catch (err) {
        console.warn("tmct sprites: the wink vendor asset failed to load, continuing without the lemma/POS tier", err);
      }
    })();
    return winkReady;
  }
  tryLoadWink();

  function addDockLine(cls, text) {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    dockLogEl.appendChild(d);
    dockLogEl.scrollTop = dockLogEl.scrollHeight;
  }

  let session = null;
  // Serialize engine turns: overlapping calls share one in-memory store.
  let lock = Promise.resolve();
  const withLock = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

  dockFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = dockqEl.value.trim();
    if (!q) return;
    dockqEl.value = "";
    addDockLine("u", q);
    if (!session) { addDockLine("a miss", "the engine is still loading. Try again in a moment."); return; }
    withLock(async () => {
      const result = await tmct.turn(q);
      const missed = !!(result.record && result.record.miss);
      addDockLine(missed ? "a miss" : "a grounded", result.answer);
    });
  });

  dockPillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    dockqEl.value = btn.dataset.q || "";
    dockqEl.focus();
  });

  (async () => {
    try {
      await tryLoadWink();
      session = await tmct.open({ factRows: SPRITE_CHAT.rows });
      dockqEl.disabled = false;
      dockStatusEl.textContent = SPRITE_CHAT.rows.length + " sprite facts on record. Ask away, or use a quick question.";
    } catch (err) {
      dockStatusEl.textContent = "the chat engine failed to load. The catalog below still works.";
      console.error("tmct sprites: dock boot failed", err);
    }
  })();
})();
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${spritesBundleAvailable && !engineBundleJs ? `<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">` : ""}
<style>
${THEME_TOKENS_CSS}
  html { background: var(--ai-canvas); }
  /* Creative-app chrome: a dark document bar in BOTH themes (the app-window
     read), panels and a recessed canvas that follow the theme, and a
     transparency checker under every drawn swatch so each sprite proves it
     holds its own boundary with nothing behind it. */
  :root {
    --ai-bar: #26272B; --ai-bar-ink: #E7E5DF;
    --ai-panel: #EDECE8; --ai-panel-hi: #F4F3F0; --ai-canvas: #DFDEDA; --ai-edge: #C8C6C0;
    --checker: rgba(0, 0, 0, .07);
  }
  @media (prefers-color-scheme: dark) { :root { --ai-panel: #26272B; --ai-panel-hi: #2D2E33; --ai-canvas: #1A1B1F; --ai-edge: #34363C; --checker: rgba(255, 255, 255, .055); } }
  :root[data-theme="dark"] { --ai-panel: #26272B; --ai-panel-hi: #2D2E33; --ai-canvas: #1A1B1F; --ai-edge: #34363C; --checker: rgba(255, 255, 255, .055); }
  :root[data-theme="light"] { --ai-panel: #EDECE8; --ai-panel-hi: #F4F3F0; --ai-canvas: #DFDEDA; --ai-edge: #C8C6C0; --checker: rgba(0, 0, 0, .07); }
  body { margin: 0; background: var(--ai-canvas); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1240px; margin: 0 auto; padding: 0 1.2rem 3rem; }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--corpus); outline-offset: 2px; }
  .appbar { display: flex; align-items: flex-end; gap: 1rem; margin: 0 -1.2rem; padding: .6rem 1.2rem 0; background: var(--ai-bar); }
  .appbar h1 { font-family: ${MONO_STACK}; font-size: .84rem; font-weight: 600; letter-spacing: .02em; margin: 0; padding: .32rem .8rem .38rem; background: var(--ai-panel); color: var(--ink); border-radius: 4px 4px 0 0; }
  .appbar .doc-sub { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .07em; text-transform: uppercase; color: color-mix(in srgb, var(--ai-bar-ink) 65%, transparent); padding-bottom: .5rem; }
  .topbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .9rem; background: var(--ai-panel); border-bottom: 1px solid var(--ai-edge); margin: 0 -1.2rem 1.4rem; padding: .5rem 1.2rem; }
  .jump { font-family: ${MONO_STACK}; font-size: .7rem; padding: .2rem .6rem; border: 1px solid var(--ai-edge); border-radius: 3px; background: transparent; color: var(--ink); text-decoration: none; }
  .jump:hover { border-color: var(--corpus); color: var(--corpus); }
  .jump .count { color: var(--muted); }
  .jump[aria-current="page"] { border-color: var(--taught); color: var(--taught); }
  .jump-overview { margin-left: .3rem; opacity: .8; }
  .filter { margin-left: auto; display: flex; align-items: center; gap: .4rem; }
  .filter input { font-family: ${MONO_STACK}; font-size: .78rem; background: var(--ai-panel-hi); color: var(--ink); border: 1px solid var(--ai-edge); border-radius: 3px; padding: .3rem .6rem; width: 200px; }
  .filter .n { font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); white-space: nowrap; }
  .composer { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.2rem 0 1.3rem; }
  @media (max-width: 700px) { .composer { grid-template-columns: 1fr; } }
  .composer .panel, .dockwrap .panel { background: var(--ai-panel); border: 1px solid var(--ai-edge); border-radius: 4px; padding: .75rem .85rem; min-width: 0; box-shadow: 0 1px 2px rgba(0, 0, 0, .08); }
  .composer h2, .dockwrap h2 { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: -.75rem -.85rem .6rem; padding: .42rem .85rem; background: var(--ai-panel-hi); border-bottom: 1px solid var(--ai-edge); border-radius: 4px 4px 0 0; }
  .composeform { display: flex; align-items: center; gap: .5rem; }
  .composeform .prompt { color: var(--taught); font-size: .8rem; white-space: nowrap; }
  .composeform input { flex: 1; font-family: ${MONO_STACK}; font-size: .82rem; background: var(--ai-panel-hi); color: var(--ink); border: 1px solid var(--ai-edge); border-radius: 3px; padding: .38rem .6rem; min-width: 0; }
  .pills { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .6rem; }
  .pill { font-family: ${MONO_STACK}; font-size: .7rem; padding: .22rem .55rem; border: 1px solid var(--ai-edge); border-radius: 999px; background: var(--ai-panel-hi); color: var(--ink); cursor: pointer; }
  .pill:hover { border-color: var(--corpus); color: var(--corpus); }
  .scene-frame { min-height: 5.6rem; display: flex; align-items: center; }
  .scene-row { display: flex; flex-wrap: wrap; gap: .8rem; align-items: flex-start; width: 100%; }
  .scene-row:empty { display: none; }
  .scene-card { display: flex; flex-direction: column; align-items: center; width: 74px; }
  .scene-sprite { width: 60px; height: 60px; border-radius: 3px; border: 1px solid var(--ai-edge); display: flex; align-items: center; justify-content: center; padding: 6px; box-sizing: border-box; background-image: linear-gradient(45deg, var(--checker) 25%, transparent 25% 75%, var(--checker) 75%), linear-gradient(45deg, var(--checker) 25%, transparent 25% 75%, var(--checker) 75%); background-position: 0 0, 5px 5px; background-size: 10px 10px; background-color: var(--card); }
  .scene-sprite svg { width: 100%; height: 100%; display: block; filter: var(--sprite-pop); }
  .scene-label { font-size: .7rem; text-align: center; color: var(--ink); margin-top: .3rem; line-height: 1.2; }
  .empty-note { font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); }
  .group { margin: 2.2rem 0; content-visibility: auto; contain-intrinsic-size: 800px; }
  .group h2 { font-family: ${MONO_STACK}; font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; margin: 0 0 .2rem; display: flex; align-items: baseline; gap: .5rem; }
  .group h2 .count { font-size: .7rem; color: var(--muted); font-weight: 400; }
  .section-note { color: var(--muted); font-size: .82rem; margin: 0 0 .8rem; max-width: 68ch; }
  .landing-sections { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.1rem 1rem; }
  .landing-section { min-width: 0; }
  .landing-section-name { font-family: ${MONO_STACK}; font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 .4rem; display: flex; align-items: baseline; gap: .4rem; }
  .landing-section-name .count { font-weight: 400; opacity: .75; }
  .landing-section .cards { grid-template-columns: 1fr; }
  .viewall { display: inline-block; font-family: ${MONO_STACK}; font-size: .7rem; margin-top: .4rem; color: var(--taught); text-decoration: none; }
  .viewall:hover { color: var(--corpus); text-decoration: underline; }
  .cluster { margin: 1rem 0 1.5rem; }
  .cluster-head { display: flex; align-items: center; gap: .45rem; font-family: ${MONO_STACK}; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 .55rem; }
  .cluster-head .count { font-weight: 400; opacity: .75; }
  .cluster-head::after { content: ""; flex: 1; height: 1px; background: var(--ai-edge); }
  .cluster-chip { width: 26px; height: 26px; display: inline-flex; padding: 2px; box-sizing: border-box; border: 1px solid var(--ai-edge); border-radius: 3px; background-image: linear-gradient(45deg, var(--checker) 25%, transparent 25% 75%, var(--checker) 75%), linear-gradient(45deg, var(--checker) 25%, transparent 25% 75%, var(--checker) 75%); background-position: 0 0, 4px 4px; background-size: 8px 8px; background-color: var(--card); }
  .cluster-chip svg { width: 100%; height: 100%; display: block; filter: var(--sprite-pop); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: .7rem; }
  .card { background: var(--card); border: 1px solid var(--ai-edge); border-radius: 4px; padding: .55rem .7rem .7rem; box-shadow: 0 1px 2px rgba(0, 0, 0, .08); content-visibility: auto; contain-intrinsic-size: 220px; }
  .card[hidden] { display: none; }
  .card-name { font-family: ${MONO_STACK}; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 .35rem; }
  .chain { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); margin-bottom: .5rem; display: flex; flex-wrap: wrap; align-items: center; gap: .15rem; }
  .chain-link { padding: .04rem .35rem; border: 1px solid var(--ai-edge); border-radius: 99px; }
  .chain-link.own { border-color: var(--taught); color: var(--taught); }
  .chain-arrow { color: var(--muted); opacity: .6; }
  .chain-more { font-style: italic; opacity: .75; }
  .tier-row { margin-top: .4rem; }
  .tier-row:first-of-type { margin-top: 0; }
  .tier-label { font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .swatches { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .25rem; }
  .swatch { width: 64px; text-align: center; }
  .swatch-img { border: 1px solid var(--ai-edge); border-radius: 3px; box-sizing: border-box; padding: 3px; background-image: linear-gradient(45deg, var(--checker) 25%, transparent 25% 75%, var(--checker) 75%), linear-gradient(45deg, var(--checker) 25%, transparent 25% 75%, var(--checker) 75%); background-position: 0 0, 5px 5px; background-size: 10px 10px; background-color: var(--card); }
  .swatch.large .swatch-img { width: 64px; height: 64px; }
  .swatch.icon .swatch-img { width: 36px; height: 36px; margin: 0 auto; }
  .swatch-img svg { width: 100%; height: 100%; display: block; filter: var(--sprite-pop); }
  .swatch.fallback { opacity: .55; }
  .swatch.fallback .swatch-img { border-style: dashed; }
  .swatch-caption { font-family: ${MONO_STACK}; font-size: .58rem; color: var(--muted); line-height: 1.25; margin-top: .15rem; word-break: break-word; }
  .swatch-treat { display: block; opacity: .8; }
  .swatch.cycle .swatch-img { border-color: var(--taught); cursor: pointer; display: block; }
  .swatch.cycle .swatch-img:hover { border-color: var(--corpus); }
  .swatch.cycle .swatch-caption { color: var(--taught); }
  footer.page { max-width: 74ch; margin: 2.5rem 0 0; padding-top: 1rem; border-top: 1px solid var(--ai-edge); font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  @media (prefers-reduced-motion: no-preference) { .jump, .swatch, .pill { transition: border-color .12s ease, color .12s ease, opacity .12s ease; } }
${dockCss}</style>
</head>
<body>
<main>
  <header class="appbar">
    <h1>Sprites</h1>
    <span class="doc-sub">tmct &middot; the sprite library</span>
  </header>
  ${composerHtml}
  ${dockHtml}
  <div class="topbar">
    <nav aria-label="Jump to group">${navHtml}</nav>
    <div class="filter">
      <input id="q" type="text" placeholder="filter by class or group&hellip;" aria-label="Filter the catalog">
      <span class="n mono" id="qcount"></span>
    </div>
  </div>
  ${bodyHtml}
  <footer class="page">${footerClassCount} classes &middot; ${footerSwatchCount} swatches &middot; icon tier 44px, sprite tier 400px</footer>
</main>
<script>
const SPRITE_CATALOG = ${pageData};
const SPRITE_CLASS_INDEX = ${classIndexJs};
</script>
${spriteBundleScript}
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

  // ---- the scene composer — reads the class/material index from
  // SPRITE_CLASS_INDEX, computed server-side over the WHOLE catalog
  // (sceneComposerClassIndex) and embedded above, never scoped to whichever
  // cards THIS page happens to render — a landing page showing one card per
  // section, or a per-group page showing only one group, still composes any
  // real catalog class. Which class a typed word names is the bundle's
  // extractSceneItems, which asks the real resolver — the page never
  // matches a class name itself.
  const esc = ${escapeHtml.toString()};

  function wireSceneComposer() {
    const composeqEl = document.getElementById("composeq");
    if (!composeqEl) return;
    const extractSceneItems = tmct.page.extractSceneItems;
    const composeFormEl = document.getElementById("composeForm");
    const composePillsEl = document.getElementById("composePills");
    const sceneRowEl = document.getElementById("sceneRow");
    const sceneEmptyEl = document.getElementById("sceneEmpty");
    const classIndex = SPRITE_CLASS_INDEX;

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
  }
  wireSceneComposer();

  // ---- the animated swatches — a card's large tier gains one moving
  // swatch per axis its own templates actually vary on: mood (mgx:feels),
  // facing (mgx:faces) and pose (mgx:pose). Frames are the card's own
  // already-rendered swatches (read straight off the DOM here — unlike the
  // composer's classIndex above, this only ever needs whatever cards THIS
  // page actually renders, never the whole catalog), ordered by the pure
  // *FrameSequence functions spliced in below, and one shared interval
  // steps every cycle in sync at one shared delay. The mood cycle leads the
  // row; the facing sweep and the pose toggle take over the static plain
  // and happy swatches' own places rather than adding cells, so the row
  // keeps its width. Reduced motion disables the auto-step only; each frame
  // is a button, so a click or Enter always advances one frame by hand.
  const CYCLE_FRAME_DELAY_MS = ${CYCLE_FRAME_DELAY_MS};
  const FACING_TURN_ORDER = ${embedJson(FACING_TURN_ORDER)};
  const MOOD_PROPERTY = "mgx:feels";
  const FACING_PROPERTY = "mgx:faces";
  const POSE_PROPERTY = "mgx:pose";
  const moodFrameSequence = ${moodFrameSequence.toString()};
  const turnFrameSequence = ${turnFrameSequence.toString()};
  const movingFrameSequence = ${movingFrameSequence.toString()};
  const cycleSteppers = [];

  function frameFromSwatch(swatch) {
    const img = swatch && swatch.querySelector(".swatch-img");
    const label = swatch && swatch.querySelector(".swatch-label");
    if (!img || !label) return null;
    return { svg: img.innerHTML, label: label.textContent.trim() };
  }

  function makeCycleSwatch(frames, ariaLabel, kind) {
    const holder = document.createElement("div");
    holder.className = "swatch large cycle cycle-" + kind;
    holder.innerHTML = '<button type="button" class="swatch-img" aria-label="' + esc(ariaLabel)
      + '"></button><div class="swatch-caption"><span class="swatch-label"></span></div>';
    const frameImgEl = holder.querySelector(".swatch-img");
    const frameLabelEl = holder.querySelector(".swatch-label");
    let frameIndex = 0;
    const showFrame = () => {
      frameImgEl.innerHTML = frames[frameIndex].svg;
      frameLabelEl.textContent = frames[frameIndex].label;
    };
    const stepFrame = () => { frameIndex = (frameIndex + 1) % frames.length; showFrame(); };
    frameImgEl.addEventListener("click", stepFrame);
    showFrame();
    cycleSteppers.push(stepFrame);
    return holder;
  }

  for (const card of cards) {
    const swatchRow = card.querySelector('.tier-row[data-tier="large"] .swatches');
    if (!swatchRow) continue;
    const cls = card.dataset.cls;
    const rows = Array.from(swatchRow.querySelectorAll(".swatch"))
      .map((el) => ({ el, property: el.dataset.property || "", frame: frameFromSwatch(el) }))
      .filter((r) => r.frame);
    const baseSwatch = swatchRow.querySelector(".swatch.plain, .swatch.fallback");
    const baseFrame = frameFromSwatch(baseSwatch);

    const moodRows = rows.filter((r) => r.property === MOOD_PROPERTY);
    const moodFrames = moodFrameSequence(baseFrame && { svg: baseFrame.svg, label: cls }, moodRows.map((r) => r.frame));
    if (moodFrames.length) {
      swatchRow.insertBefore(makeCycleSwatch(moodFrames, "step through the " + cls + " expressions", "mood"), swatchRow.firstChild);
    }

    const facingFrames = {};
    for (const r of rows) { if (r.property === FACING_PROPERTY) facingFrames[r.frame.label] = r.frame; }
    const turnFrames = turnFrameSequence(FACING_TURN_ORDER, baseFrame, facingFrames);
    if (turnFrames.length && baseSwatch) {
      swatchRow.replaceChild(makeCycleSwatch(turnFrames, "watch the " + cls + " turn through every direction", "turn"), baseSwatch);
    }

    const movingRow = rows.find((r) => r.property === POSE_PROPERTY && r.frame.label === "moving");
    const movingFrames = movingFrameSequence(baseFrame, movingRow && movingRow.frame);
    if (movingFrames.length) {
      const happyRow = moodRows.find((r) => r.frame.label === "happy");
      swatchRow.replaceChild(makeCycleSwatch(movingFrames, "watch the " + cls + " move", "moving"), (happyRow || movingRow).el);
    }
  }
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (cycleSteppers.length && !reducedMotion) {
    setInterval(() => { for (const stepFrame of cycleSteppers) stepFrame(); }, CYCLE_FRAME_DELAY_MS);
  }
})();
</script>
${dockScripts}
</body>
</html>
`;
}

/** `sprites.html` itself: a lighter landing page over the WHOLE catalog —
 *  one real example card per section (catalogSections/landingExampleFor;
 *  a section is a top-level group when it isn't clustered, adventure and
 *  emoji, or one of person/object's own ancestor clusters otherwise), each
 *  linking straight to that class's own card on its group's full-gallery
 *  page (classAnchorId). A section this small never earns a page of its
 *  own — every section, big or small, already lives together with the rest
 *  of its group on that one shared full-gallery page, which is exactly
 *  where a landing card's link lands.
 *
 *  The composer and the ask dock still answer over the WHOLE catalog from
 *  here (sceneComposerClassIndex/spriteFactRows both read every class, never
 *  just the ~28 shown), so typing "a doctor with a hat, and a cabinet"
 *  composes correctly even though none of those three classes has a card on
 *  this page. Same chrome, same styling, same scripts as every per-group
 *  page — renderSpriteCatalogPage owns all of that; this function only
 *  picks which body and nav go in it. */
export function renderSpriteCatalogLandingHtml({ title = DEFAULT_TITLE, iconTemplates = [], largeTemplates = [], factRows = [], spritesBundleAvailable = false } = {}) {
  const entries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows });
  const spritedClasses = new Set([...iconTemplates, ...largeTemplates].flatMap((t) => t?.classes || []));
  const sections = catalogSections(entries, spritedClasses);
  const bodyHtml = CATALOG_GROUPS.map((g) => {
    const groupEntries = entries.filter((e) => e.group === g.id);
    if (!groupEntries.length) return "";
    const groupSections = sections.filter((s) => s.group.id === g.id);
    const note = g.note ? `<p class="section-note">${escapeHtml(g.note)}</p>` : "";
    const sectionsHtml = groupSections.map((section) => {
      const example = landingExampleFor(section.entries);
      if (!example) return "";
      // A group with only one section (adventure, emoji) needs no
      // sub-heading of its own — the group heading above already names it.
      const heading = groupSections.length > 1
        ? `<h3 class="landing-section-name">${escapeHtml(section.label)} <span class="count">${section.entries.length}</span></h3>`
        : "";
      return `<div class="landing-section">
        ${heading}
        <div class="cards">${cardHtml(example)}</div>
        <a class="viewall" href="./${g.page}#${classAnchorId(example.className)}">view all ${section.entries.length} &rsaquo;</a>
      </div>`;
    }).join("");
    return `<section class="group landing-group" id="g-${g.id}" aria-label="${escapeHtml(g.label)}">
      <h2>${escapeHtml(g.label)} <span class="count">${groupEntries.length}</span></h2>
      ${note}
      <div class="landing-sections">${sectionsHtml}</div>
    </section>`;
  }).join("");
  const navHtml = crossPageNavHtml(entries, {});
  const totalSwatches = entries.reduce((n, e) => n + e.iconSwatches.length + e.largeSwatches.length, 0);
  return renderSpriteCatalogPage({
    title, entries, bodyHtml, navHtml, iconTemplates, largeTemplates, spritesBundleAvailable,
    footerClassCount: entries.length, footerSwatchCount: totalSwatches,
  });
}
