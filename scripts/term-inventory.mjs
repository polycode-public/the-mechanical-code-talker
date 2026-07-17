#!/usr/bin/env node
// Machine-generates the inventory of every term tmct coins: the mgx:/mgxneg:
// predicates and classes, the closed enum vocabularies (edge kinds, miss
// reasons, relation tokens, rule kinds, source types), and the service names.
//
// Terms are read from the modules that DEFINE them wherever a module exports
// them — an imported constant cannot drift from the runtime. Only the terms
// with no exported home are scanned out of source text, and the scan reports
// its own file:line evidence so a reader can check it.
//
// Prints a Markdown report by default; `--json` emits the raw record.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EDGE_KINDS,
  EDGE_KIND_TO_TMCT,
  MISS_REASONS,
  SERVICE_GROUPS,
  SERVICES,
  INTERFACE_VERSION,
  ONTOLOGY_IRI,
} from "../src/adapters/repository-interface.mjs";
import { emptyMemory } from "../src/adapters/memory/core.mjs";
import { RELATIONS } from "../src/domain/ask-vocab.mjs";
import { NEG_PREDICATE_PREFIX, NEG_SUBCLASS_PREDICATE } from "../src/domain/memory/capability.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// A generated bundle restates its inputs; counting it would double every term.
const SKIP_FILE = /\.bundle\.js$/;
const SCAN_DIRS = ["src", "ontology", "corpus"];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (!SKIP_FILE.test(entry)) yield path;
  }
}

/** Every mgx:/mgxneg: CURIE in the tree, with the file:line sites that spell it.
 *  Casing is preserved: an IRI is case-sensitive, so two casings are two terms
 *  and this scan must not fold them together. */
function scanCoinedTerms() {
  const sites = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const [, curie] of line.matchAll(/\b(mgx(?:neg)?:[A-Za-z][\w-]*)/g)) {
          if (!sites.has(curie)) sites.set(curie, []);
          sites.get(curie).push(`${relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
  }
  return sites;
}

/** Terms whose lowercase spellings collide — the case-sensitivity check. A pair
 *  here is only a defect if BOTH spellings reach a store; a lookup table keyed
 *  on a lowercased prop is not a second term. */
function casingCollisions(sites) {
  const byLower = new Map();
  for (const curie of sites.keys()) {
    const key = curie.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, []);
    byLower.get(key).push(curie);
  }
  return [...byLower.values()].filter((group) => group.length > 1);
}

function collectPrefixed(sites, prefix) {
  return [...sites.keys()].filter((c) => c.startsWith(prefix)).sort();
}

// A CURIE-shaped token whose prefix is a URL scheme or an id namespace, not a
// vocabulary — these name instances (`src:teach-chat`, `fact:9a1c`), not terms.
const ID_NAMESPACE = new Set([
  "http", "https", "urn", "file", "data", "mailto", "tel", "npm", "node",
  "git", "turn", "src", "fact", "ace", "rule", "session", "chatlog", "commit",
  "thread", "path", "example", "text", "sentence", "no",
  // corpus row provenance tags: semcor: names a Brown Corpus genre, corpus: names
  // a pack the facts came from — both identify a source, neither names a term
  "semcor", "corpus",
  // fixture/demo graph individual ids
  "mod", "cls", "m", "fn", "en", "appendix", "grammar",
  // resolver lookup keys of the shape "<direction>:<kind>" — map keys, not CURIEs
  "forward", "reverse", "when", "replace", "li", "id",
]);

/** Every CURIE-shaped token, grouped by prefix — the check that a namespace tmct
 *  spells is a namespace someone declared. A prefix used but never declared is a
 *  term with no home.
 *
 *  Only a `.ttl` body and a QUOTED string elsewhere can hold a CURIE. Scanning
 *  raw JS lines instead reads every object-literal key (`from:`, `reason:`) as a
 *  namespace, which buries the real finding under dozens of phantoms. */
function curieCandidates(file, line) {
  if (file.endsWith(".ttl")) return [line];
  return [...line.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)].map((m) => m[1] ?? m[2]);
}

function scanAllPrefixes() {
  const byPrefix = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const chunk of curieCandidates(file, line)) {
          for (const [, prefix, local] of chunk.matchAll(/\b([a-z][\w-]{1,9}):([A-Za-z][\w-]*)\b/g)) {
            if (ID_NAMESPACE.has(prefix)) continue;
            if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Map());
            const terms = byPrefix.get(prefix);
            const curie = `${prefix}:${local}`;
            if (!terms.has(curie)) terms.set(curie, []);
            terms.get(curie).push(`${relative(ROOT, file)}:${i + 1}`);
          }
        }
      });
    }
  }
  return byPrefix;
}

const ttl = readFileSync(join(ROOT, "ontology/tmct-core.ttl"), "utf8");
// Every ontology file declares prefixes; reading only the core one reports SHACL's
// sh: as undeclared when memory-shapes.ttl declares it.
const ontologyText = readdirSync(join(ROOT, "ontology"))
  .filter((f) => f.endsWith(".ttl"))
  .map((f) => readFileSync(join(ROOT, "ontology", f), "utf8"))
  .join("\n");
const declaredPrefixes = [...ontologyText.matchAll(/@prefix\s+([\w-]*):\s*<([^>]+)>/g)]
  .map(([, prefix, iri]) => ({ prefix: `${prefix}:`, iri }))
  .filter((p, i, all) => all.findIndex((q) => q.prefix === p.prefix) === i)
  .sort((a, b) => a.prefix.localeCompare(b.prefix));
const ttlDefines = new Set(
  [...ttl.matchAll(/^(mgx(?:neg)?:[A-Za-z][\w-]*)\s+a\s+(?:owl:|rdfs:)/gm)].map(([, c]) => c),
);

const sites = scanCoinedTerms();
const memoryPrefixes = emptyMemory().prefixes;
const memoryVocabulary = emptyMemory().vocabulary;

const allPrefixes = scanAllPrefixes();
// The two declaration sites disagree, and that disagreement is the point: a
// prefix the store writes but the ontology never declares has no formal home.
const ontologyNames = new Set(declaredPrefixes.map((p) => p.prefix.slice(0, -1)));
const storeNames = new Set(Object.keys(memoryPrefixes));
const prefixAudit = [...allPrefixes]
  .map(([prefix, terms]) => ({
    prefix,
    inOntology: ontologyNames.has(prefix),
    inStore: storeNames.has(prefix),
    termCount: terms.size,
    uses: [...terms.values()].reduce((n, s) => n + s.length, 0),
    terms: [...terms.keys()].sort(),
  }))
  .sort((a, b) => b.uses - a.uses);

const inventory = {
  interfaceVersion: INTERFACE_VERSION,
  ontologyIri: ONTOLOGY_IRI,
  prefixes: {
    declaredInOntology: declaredPrefixes,
    declaredInStorePayload: Object.entries(memoryPrefixes).map(([p, iri]) => ({ prefix: `${p}:`, iri })),
  },
  coined: {
    mgx: collectPrefixed(sites, "mgx:"),
    mgxneg: collectPrefixed(sites, NEG_PREDICATE_PREFIX),
  },
  ttlDefines: [...ttlDefines].sort(),
  prefixAudit,
  casingCollisions: casingCollisions(sites),
  memoryVocabulary: memoryVocabulary.map((v) => ({ prop: v.prop, predicate: v.predicate ?? null })),
  edgeKinds: [...EDGE_KINDS],
  edgeKindToTmct: { ...EDGE_KIND_TO_TMCT },
  missReasons: Object.values(MISS_REASONS),
  relationTokens: Object.keys(RELATIONS),
  serviceGroups: Object.fromEntries(Object.entries(SERVICE_GROUPS).map(([g, s]) => [g, [...s]])),
  services: [...SERVICES],
  negSubclassPredicate: NEG_SUBCLASS_PREDICATE,
  sites: Object.fromEntries([...sites].map(([c, s]) => [c, s])),
};

/** The register check: every term that claims a verdict must still occur in the
 *  tree. A row that outlives its code is a citation for something that is not
 *  there, which is worse than no citation — it reads as current. */
function checkRegister() {
  const register = JSON.parse(readFileSync(join(ROOT, "docs/references/term-register.json"), "utf8"));
  const haystack = ["src", "test", "docs", "scripts", "ontology"]
    .flatMap((d) => [...walk(join(ROOT, d))])
    .filter((f) => !/term-register\.json|PLAN_NORMATIVE|term-inventory/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  const orphans = [];
  const byArea = new Map();
  const byVerdict = new Map();
  for (const row of register.terms) {
    const probe = row.probe ?? row.term;
    if (!haystack.includes(probe)) orphans.push(`${row.term} (probe ${JSON.stringify(probe)})`);
    byArea.set(row.area, (byArea.get(row.area) ?? 0) + 1);
    byVerdict.set(row.verdict, (byVerdict.get(row.verdict) ?? 0) + 1);
    if (!row.cite) orphans.push(`${row.term} — no citation`);
  }
  return { register, orphans, byArea, byVerdict };
}

if (process.argv.includes("--register")) {
  const { register, orphans, byArea, byVerdict } = checkRegister();
  const out = [];
  out.push(`# term register — ${register.terms.length} terms`);
  out.push("");
  out.push("| area | terms |");
  out.push("|---|--:|");
  for (const [a, n] of [...byArea].sort((x, y) => y[1] - x[1])) out.push(`| ${a} | ${n} |`);
  out.push("");
  out.push("| verdict | terms |");
  out.push("|---|--:|");
  for (const [v, n] of [...byVerdict].sort((x, y) => y[1] - x[1])) out.push(`| \`${v}\` | ${n} |`);
  out.push("");
  if (orphans.length) {
    out.push("## Orphans — a registered term that no longer occurs, or carries no citation");
    out.push("");
    for (const o of orphans) out.push(`- ${o}`);
  } else {
    out.push("Every registered term still occurs in the tree and carries a citation.");
  }
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(orphans.length ? 1 : 0);
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
} else {
  const undeclared = [...inventory.coined.mgxneg].filter((c) => !ttlDefines.has(c));
  const undefinedMgx = inventory.coined.mgx.filter((c) => !ttlDefines.has(c));
  const out = [];
  out.push("# tmct coined-term inventory (generated)");
  out.push("");
  out.push(`Interface version ${inventory.interfaceVersion}; ontology \`${inventory.ontologyIri}\`.`);
  out.push("");
  out.push("| group | count |");
  out.push("|---|--:|");
  out.push(`| \`mgx:\` terms in tree | ${inventory.coined.mgx.length} |`);
  out.push(`| \`mgxneg:\` terms in tree | ${inventory.coined.mgxneg.length} |`);
  out.push(`| terms the ontology defines | ${inventory.ttlDefines.length} |`);
  out.push(`| \`mgx:\` terms the ontology does NOT define | ${undefinedMgx.length} |`);
  out.push(`| \`mgxneg:\` terms the ontology does NOT define | ${undeclared.length} |`);
  out.push(`| memory-vocabulary props | ${inventory.memoryVocabulary.length} |`);
  out.push(`| edge kinds | ${inventory.edgeKinds.length} |`);
  out.push(`| miss reasons | ${inventory.missReasons.length} |`);
  out.push(`| relation tokens | ${inventory.relationTokens.length} |`);
  out.push(`| services | ${inventory.services.length} |`);
  out.push(`| lowercase-colliding term groups | ${inventory.casingCollisions.length} |`);
  out.push("");
  out.push("## Prefixes declared in the ontology");
  out.push("");
  for (const { prefix, iri } of inventory.prefixes.declaredInOntology) out.push(`- \`${prefix}\` \`${iri}\``);
  out.push("");
  out.push("## Prefixes declared in the store payload");
  out.push("");
  for (const { prefix, iri } of inventory.prefixes.declaredInStorePayload) out.push(`- \`${prefix}\` \`${iri}\``);
  out.push("");
  out.push("## Every prefix the tree spells");
  out.push("");
  const mark = (ok) => (ok ? "yes" : "**no**");
  out.push("| prefix | in ontology | in store payload | terms | uses |");
  out.push("|---|---|---|--:|--:|");
  for (const p of inventory.prefixAudit) {
    out.push(`| \`${p.prefix}:\` | ${mark(p.inOntology)} | ${mark(p.inStore)} | ${p.termCount} | ${p.uses} |`);
  }
  out.push("");
  out.push("## Case-colliding spellings");
  out.push("");
  if (!inventory.casingCollisions.length) out.push("None.");
  for (const group of inventory.casingCollisions) {
    out.push(`### ${group.join(" vs ")}`);
    out.push("");
    for (const curie of group) {
      out.push(`- \`${curie}\` — ${inventory.sites[curie].join(", ")}`);
    }
    out.push("");
  }
  out.push("## `mgxneg:` terms with no ontology definition");
  out.push("");
  for (const c of undeclared) out.push(`- \`${c}\` — ${inventory.sites[c].join(", ")}`);
  out.push("");
  out.push("## `mgx:` terms with no ontology definition");
  out.push("");
  for (const c of undefinedMgx) out.push(`- \`${c}\``);
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
}
