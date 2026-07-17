// synthbench/rules/enumerate.mjs — PLAN_CODE.md Track 1, Stage 2 (§1.3/§6):
// the BOUNDED field-grammar enumerator over the exact shape
// src/domain/router/goal-reasoner.mjs's GOAL_RULES entries declare. Produces
// candidate rule OBJECTS only — nothing here runs a candidate through the
// real engine (that is oracle.mjs, Stage 3) or narrows the set against
// labeled examples (that is synthesize.mjs, Stage 4).
//
// GROUNDED IN THE REGISTRY, NOT HARDCODED. Every enumerated field ranges over
// a set src/domain/router/registry.mjs or src/domain/router/resolver.mjs already declares —
// the topic list is READ from the registry's own `knows(...)` add-effects
// (never a copied string list), so this enumerator's search space grows
// automatically the day a new capability is registered (PLAN_CODE.md §7: "every
// future capability added to the registry linearly grows Track 1's space
// too"). This mirrors resolver.mjs's own `nlReachableTopics()` — derive from
// the registry, never invent a topic outside it.
//
// CONSERVATIVE REDUCTIONS from the plan's own C(15,<=3) upper-bound estimate
// (§1.3), documented rather than silent (the task's own "make the most
// conservative, most consistent-with-existing-code choice" instruction):
//   1. subGoals is fixed at size 2 — one COVERAGE-style topic (its capability
//      declares NO required parameter, so gathering it never binds an
//      entity) and one RELATION-style topic (its capability DOES declare a
//      required parameter, so gathering it binds the focus). Justification:
//      BOTH hand-written ground-truth rules (coverage-invariant,
//      cochange-risk-invariant, goal-reasoner.mjs:76-127) have exactly 2
//      subGoals, and `compose` only ever folds exactly 2 gathered topics
//      (`compose.a`/`compose.b`) — a 3rd gathered-but-uncomposed topic has no
//      hand-written precedent to validate the choice against, so this
//      enumerator does not invent one.
//   2. priorityTopic is always the RELATION topic — matches both hand-written
//      rules exactly (priorityTopic === the entity-bound topic in both).
//   3. `of:"focus"` on the relation side is DERIVED from the registry (is its
//      capability's slot required?), never a free enumeration choice — an
//      ungroundable binding is not a valid candidate, so there is nothing to
//      choose here.
//   4. `withFocus` and the compose a/b ORIENTATION together range over 4
//      canonical templates (composeTemplates below) that specifically
//      reproduce BOTH hand-written rules' exact shapes (coverage-invariant is
//      template 0; cochange-risk-invariant is template 3) plus their two
//      natural variants — not a free-form combinatorial product of the two,
//      which the plan's own text (§1.3: "2 sides-with-withFocus") already
//      treats as a small closed factor, not an independent axis of `a`/`b`
//      swap x boolean.
//
// With the current registry (15 topics; 12 relation-topics, 3 no-required-arg
// topics — matches/untested/architecture) this enumerates 3 focusClasses x 3
// mode-subsets x 3 coverage-topic candidates x 12 relation-topic candidates x
// 2 subGoal orderings x 3 compose ops x 4 compose templates = 7776 candidates
// — the same order of magnitude as the plan's own "low thousands, not
// combinatorial explosion" claim (the size-2-subGoals reduction above is what
// keeps the plan's own C(15,<=3) formula, which is far larger, tractable at
// all). See test/synth-rules.test.mjs's stage-2 test for the exact count.

import { capabilities, effectsOf, KINDS } from "../../src/domain/router/registry.mjs";
import { backwardChain } from "../../src/domain/router/resolver.mjs";

// The resolvable entity-kind names registry.mjs's KINDS declares — the ones
// backed by a real graph class (a seon: ontology class or an mgx: code-graph
// class), never the free-text/enum slots Query/Kind/Package, whose kinds live
// in the cap: vocabulary and resolve to no graph entity. Object.keys order is
// registry.mjs's own declaration order, so this is deterministic without an
// explicit sort.
export const FOCUS_CLASSES = Object.freeze(
  Object.keys(KINDS).filter((k) => !String(KINDS[k]).startsWith("cap:")),
);

// The closed 2-element powerset of {"scoped","global"} minus the empty set —
// PLAN_CODE.md §1.1's own literal "3 possibilities" for the `modes` field.
export const MODE_SETS = Object.freeze([
  Object.freeze(["scoped"]),
  Object.freeze(["global"]),
  Object.freeze(["scoped", "global"]),
]);

// set-algebra.mjs's exported operator names (PLAN_CODE.md §1.1's `compose.op`
// field) — read as literal names here because the OPERATORS themselves are
// consumed as declarative data by goal-reasoner.mjs's `compose` interpreter,
// not applied directly by this enumerator (candidates are DATA, never code).
export const COMPOSE_OPS = Object.freeze(["intersect", "fallbackIfEmpty", "guardIfEmpty"]);

/** Every epistemic topic the registry declares, one per `knows(...)` add
 *  effect, in registry declaration order (never hardcoded — mirrors
 *  resolver.mjs's nlReachableTopics: derive from the registry). */
export function allTopics() {
  const topics = [];
  for (const cap of capabilities()) {
    for (const eff of effectsOf(cap.name).add) if (!topics.includes(eff.topic)) topics.push(eff.topic);
  }
  return Object.freeze(topics);
}

/** True iff `topic`'s backward-chained capability declares a REQUIRED
 *  parameter — i.e. gathering it needs an entity bound to the focus. Mirrors
 *  goal-reasoner.mjs's own private `bindsEntity` (same registry read, not an
 *  independent guess at the same fact). */
export function topicBindsEntity(topic) {
  const cap = backwardChain(topic);
  return Boolean(cap && cap.parameters.some((p) => p.required));
}

/** The topic set partitioned by topicBindsEntity — RELATION topics need a
 *  bound focus to gather; COVERAGE-candidate topics do not (only "untested"
 *  is a genuine coverage predicate among the current registry's no-arg
 *  topics, but this enumerator does not hardcode that judgement — a
 *  non-coverage no-arg topic like "architecture" is left IN the search space
 *  and pruned by the verification oracle instead, the same "let the oracle
 *  decide, don't pre-judge" discipline PLAN_CODE.md §1.4 describes). */
export function partitionTopics() {
  const topics = allTopics();
  return {
    relationTopics: Object.freeze(topics.filter(topicBindsEntity)),
    coverageTopics: Object.freeze(topics.filter((t) => !topicBindsEntity(t))),
  };
}

/** The 4 canonical compose-spec templates for a (coverageTopic, relTopic)
 *  pair — see the module docblock's reduction #4. Index 0 reproduces
 *  coverage-invariant's exact shape; index 3 reproduces cochange-risk-
 *  invariant's exact shape (goal-reasoner.mjs:93-99,118-122). */
function composeTemplates(coverageTopic, relTopic) {
  const rel = Object.freeze({ topic: relTopic, of: "focus" });
  const relWithFocus = Object.freeze({ topic: relTopic, of: "focus", withFocus: true });
  const cov = Object.freeze({ topic: coverageTopic });
  return Object.freeze([
    Object.freeze({ a: cov, b: relWithFocus }), // T0 == coverage-invariant
    Object.freeze({ a: cov, b: rel }),          // T1
    Object.freeze({ a: relWithFocus, b: cov }), // T2
    Object.freeze({ a: rel, b: cov }),          // T3 == cochange-risk-invariant
  ]);
}

/** Mechanically build ONE frozen candidate rule — the exact GOAL_RULES shape
 *  (goal-reasoner.mjs:61-74's own docblock pins the field set). `invariant`
 *  is POST-HOC free text composed FROM the rule's own fields (PLAN_CODE.md
 *  §1.1: "not searched"), never independently authored. `id`/`achieves` are
 *  mechanically slugged from the same fields, so two calls with the same
 *  logical candidate always produce the same id (determinism). */
function makeCandidate({ index, focusClass, modes, coverageTopic, relTopic, order, op, compose }) {
  const slug = `${relTopic}-${coverageTopic}-${order === 0 ? "rc" : "cr"}-${op}-${index}`;
  return Object.freeze({
    id: `synth-${slug}`,
    kind: "maintenance",
    invariant: `a module related to the focus by "${relTopic}" that is "${coverageTopic}" violates the invariant`,
    focusClass,
    modes,
    subGoals: order === 0 ? Object.freeze([relTopic, coverageTopic]) : Object.freeze([coverageTopic, relTopic]),
    priorityTopic: relTopic,
    coverageTopic,
    compose: Object.freeze({
      op,
      a: compose.a,
      b: compose.b,
      names: `${relTopic} ${op} ${coverageTopic}`,
      empty: `no ${coverageTopic} in the ${relTopic} set`,
    }),
    achieves: `synth-goal-${slug}`,
  });
}

/** Enumerate the full bounded candidate set (deterministic order — nested
 *  loops over FIXED, frozen arrays; no Set/Map iteration order dependency, no
 *  randomness). See the module docblock for the exact factor breakdown. */
export function enumerateCandidates() {
  const { relationTopics, coverageTopics } = partitionTopics();
  const out = [];
  let index = 0;
  for (const focusClass of FOCUS_CLASSES) {
    for (const modes of MODE_SETS) {
      for (const coverageTopic of coverageTopics) {
        for (const relTopic of relationTopics) {
          const templates = composeTemplates(coverageTopic, relTopic);
          for (let order = 0; order < 2; order += 1) {
            for (const op of COMPOSE_OPS) {
              for (const compose of templates) {
                out.push(makeCandidate({ index, focusClass, modes, coverageTopic, relTopic, order, op, compose }));
                index += 1;
              }
            }
          }
        }
      }
    }
  }
  return out;
}
