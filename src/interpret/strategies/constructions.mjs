// interpret/strategies/constructions.mjs — construction-grammar template
// banks (pattern -> AST skeleton, slot types validated against
// RELATIONS/ENTITY_TO_TYPE), registered as their own additive class
// ("construction") so a match outranks a same-text keyword-spot guess rather
// than colliding with it.
//
// The banks are DATA that rides in from outside: a composition point
// (chat.mjs, server.mjs, index.mjs) reads data/templates/constructions/*.toml
// through corpus/construction-banks.mjs and registers the raw tables here via
// setConstructionBanks — this strategy never touches the filesystem. Compile
// is cached once per registration and defensive: an invalid entry is silently
// dropped, never thrown; no registration means an empty bank (the strategy
// simply never fires).

import { RELATIONS, ENTITY_TO_TYPE } from "../../ask-vocab.mjs";
import { escapeRegex } from "../normalize.mjs";

const VALID_KINDS = new Set(Object.keys(RELATIONS));
const VALID_ENTITY_TYPES = new Set(Object.values(ENTITY_TO_TYPE));
const VALID_SHAPES = new Set(["ask", "reverse", "forward", "where", "when", "meta", "mentions"]);

/** Validate + index the raw [[relation]] rows into noun -> {kind, entityType}.
 *  Closed-vocabulary validation: `kind` MUST be
 *  one of RELATIONS' own keys and `entityType` (when present) MUST be one of
 *  ENTITY_TO_TYPE's canonical class names — an entry failing either check is
 *  dropped, never coerced to the nearest-looking valid value. First occurrence
 *  of a noun wins (closed-table "first match" discipline, same as every other
 *  table in this codebase); a later duplicate is silently ignored. */
export function buildAgentNounTable(relations) {
  const table = {};
  for (const r of relations || []) {
    if (!r || typeof r.noun !== "string" || !r.noun.trim()) continue;
    if (typeof r.kind !== "string" || !VALID_KINDS.has(r.kind)) continue;
    if (r.entityType !== undefined && (typeof r.entityType !== "string" || !VALID_ENTITY_TYPES.has(r.entityType))) continue;
    const noun = r.noun.trim().toLowerCase();
    if (table[noun]) continue;
    table[noun] = { kind: r.kind, entityType: r.entityType || null };
  }
  return table;
}

/** Compile one pattern string ("<AGENT> of <TERM>") into {re, agentIndex,
 *  termIndex}, or null when it doesn't carry exactly one of each token. */
function compilePattern(pattern, agentNouns) {
  if (typeof pattern !== "string" || !pattern.trim() || !agentNouns.length) return null;
  const agentAlt = agentNouns.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const parts = pattern.split(/(<AGENT>|<TERM>)/).filter((p) => p !== "");
  let source = "";
  const slots = [];
  for (const part of parts) {
    if (part === "<AGENT>") {
      slots.push("agent");
      source += `(${agentAlt})`;
    } else if (part === "<TERM>") {
      slots.push("term");
      source += `(.+?)`;
    } else {
      source += part.split(/(\s+)/).map((seg) => (/^\s+$/.test(seg) ? "\\s+" : escapeRegex(seg))).join("");
    }
  }
  const agentCount = slots.filter((s) => s === "agent").length;
  const termCount = slots.filter((s) => s === "term").length;
  if (agentCount !== 1 || termCount !== 1) return null;
  return {
    re: new RegExp(`^${source}\\??$`, "i"),
    agentIndex: slots.indexOf("agent") + 1,
    termIndex: slots.indexOf("term") + 1,
  };
}

/** Validate + compile the raw [[construction]] rows into runnable templates:
 *  {id, name, shape, re, agentIndex, termIndex}. Requires a valid `id`
 *  (non-empty string, first-occurrence-wins on duplicates), a `shape` from the
 *  anchored-template shape vocabulary (VALID_SHAPES), and a pattern that
 *  compiles cleanly against the agent-noun table — anything else is dropped. */
export function buildConstructionTemplates(constructions, agentNounTable) {
  const agentNouns = Object.keys(agentNounTable);
  const seen = new Set();
  const out = [];
  for (const c of constructions || []) {
    if (!c || typeof c.id !== "string" || !c.id.trim() || seen.has(c.id)) continue;
    if (typeof c.shape !== "string" || !VALID_SHAPES.has(c.shape)) continue;
    const compiled = compilePattern(c.pattern, agentNouns);
    if (!compiled) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name || c.id, shape: c.shape, ...compiled });
  }
  return out;
}

let bankSource = null; // raw tables, or a () => raw-tables loader
let bankCache = null;

/** Register the raw construction tables ({relations, constructions}) or a
 *  lazy loader returning them (corpus/construction-banks.mjs's
 *  readConstructionFiles, in the live wiring). Re-registering invalidates the
 *  compiled cache. */
export function setConstructionBanks(source) {
  bankSource = source ?? null;
  bankCache = null;
}

/** The cached, compiled construction bank (relations table + runnable
 *  templates), compiled once per registration. Defensive: any failure
 *  anywhere in the load/validate/compile chain degrades to an empty bank (the
 *  strategy simply never fires) rather than crashing the pipeline that
 *  imports this module. */
export function constructionBank() {
  if (bankCache !== null) return bankCache;
  let bank;
  try {
    const raw = typeof bankSource === "function" ? bankSource() : bankSource;
    const { relations, constructions } = raw || { relations: [], constructions: [] };
    const agentNounTable = buildAgentNounTable(relations);
    const templates = buildConstructionTemplates(constructions, agentNounTable);
    bank = { agentNounTable, templates };
  } catch {
    bank = { agentNounTable: {}, templates: [] };
  }
  bankCache = bank;
  return bank;
}

/** Strategy 1: scan the compiled construction templates, first match wins
 *  (mirrors grammar.mjs's parseAnchored exactly). A structural regex match
 *  whose agent noun somehow isn't in the table (shouldn't happen — the
 *  alternation is built FROM the table) falls through defensively rather than
 *  building a half-formed parse. Pure. */
export function parseConstruction(text, bank = constructionBank()) {
  for (const t of bank.templates) {
    const m = text.match(t.re);
    if (!m) continue;
    const agentText = m[t.agentIndex].toLowerCase();
    const relation = bank.agentNounTable[agentText];
    if (!relation) continue;
    const object = m[t.termIndex].trim();
    if (!object) continue;
    return {
      shape: t.shape, entityType: relation.entityType || null,
      modifier: "direct", kind: relation.kind, object,
    };
  }
  return null;
}

/** Pipeline registration: own class ("construction"), confidence 0.9 — same
 *  weight as grammar.mjs's anchored templates, so it outranks a same-text
 *  keyword-spot guess (0.7) rather than tying against it. */
export const constructionsStrategy = {
  id: "constructions",
  class: "construction",
  run(text) {
    const parsed = parseConstruction(text);
    return parsed
      ? { strategyId: "constructions", class: "construction", candidates: [{ parsed, confidence: 0.9 }] }
      : null;
  },
};
