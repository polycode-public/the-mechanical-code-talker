// discourse.test.mjs — the pure typed discourse record: closed tables, the
// register/bind/retire lifecycle, and every deterministic retirement rule
// (same-slot replacement, topic shift, cap eviction). No I/O anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REFERENT_KINDS, REFERENT_ATTRS, BINDABLE_FORMS, MAX_REFERENTS,
  resolveDiscourseConfig, emptyRecord, advanceTurn, formsAdmitting,
  referentProblems, register, bind, retire,
} from "../../src/domain/discourse.mjs";

/** A complete, valid event referent spec — the commit-filter pivot shape. */
const eventSpec = (over = {}) => ({
  kind: "event", class: "Commit", label: "1b2c3d4e5f60",
  ids: ["commit:1b2c3d4e5f60"], attrs: { date: "2026-05-24" },
  from: { lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  ...over,
});

/** A complete, valid set referent spec — the commit-filter result shape. */
const setSpec = (over = {}) => ({
  kind: "set", class: "Commit", label: "7 commits before 1b2c3d4e5f60",
  ids: ["commit:a", "commit:b", "commit:c"],
  attrs: { count: 3, op: "before", pivot: "commit:1b2c3d4e5f60" },
  from: { lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  ...over,
});

test("the four vocabularies are closed and frozen", () => {
  assert.deepEqual([...REFERENT_KINDS], ["entity", "set", "event", "measure"]);
  assert.deepEqual([...REFERENT_ATTRS], ["date", "count", "op", "pivot", "metric", "kind", "provenance"]);
  assert.ok(Object.isFrozen(REFERENT_KINDS));
  assert.ok(Object.isFrozen(REFERENT_ATTRS));
  assert.ok(Object.isFrozen(BINDABLE_FORMS));
  assert.equal(MAX_REFERENTS, 6);
  // singular forms admit entity/event/measure, plural forms only sets,
  // and `here` only a (location-classed) entity.
  for (const f of ["it", "this", "that", "this one", "that one"]) {
    assert.deepEqual([...BINDABLE_FORMS[f]], ["entity", "event", "measure"], f);
  }
  for (const f of ["those", "them", "these"]) assert.deepEqual([...BINDABLE_FORMS[f]], ["set"], f);
  assert.deepEqual([...BINDABLE_FORMS.here], ["entity"]);
});

test("resolveDiscourseConfig: the [discourse] max_referents knob overrides the default; junk falls back", () => {
  assert.deepEqual(resolveDiscourseConfig(null), { maxReferents: MAX_REFERENTS });
  assert.deepEqual(resolveDiscourseConfig({}), { maxReferents: MAX_REFERENTS });
  assert.deepEqual(resolveDiscourseConfig({ discourse: { max_referents: 3 } }), { maxReferents: 3 });
  assert.deepEqual(resolveDiscourseConfig({ discourse: { max_referents: 0 } }), { maxReferents: MAX_REFERENTS });
  assert.deepEqual(resolveDiscourseConfig({ discourse: { max_referents: "9" } }), { maxReferents: MAX_REFERENTS });
});

test("emptyRecord starts at turn 0 with no referents and the cap folded in", () => {
  assert.deepEqual(emptyRecord(), { turn: 0, maxReferents: MAX_REFERENTS, seq: 0, referents: [] });
  assert.equal(emptyRecord({ maxReferents: 2 }).maxReferents, 2);
  assert.equal(advanceTurn(emptyRecord()).turn, 1);
});

test("register fills every field: a fresh handle, the record's turn, and binds derived from the kind", () => {
  const rec = register(advanceTurn(emptyRecord()), eventSpec());
  assert.equal(rec.referents.length, 1);
  const r = rec.referents[0];
  assert.equal(r.ref, "r1");
  assert.equal(r.kind, "event");
  assert.equal(r.class, "Commit");
  assert.deepEqual(r.ids, ["commit:1b2c3d4e5f60"]);
  assert.deepEqual(r.attrs, { date: "2026-05-24" });
  assert.deepEqual(r.from, { turn: 1, lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" });
  assert.deepEqual(r.binds, ["it", "this", "that", "this one", "that one"]);
  assert.deepEqual(formsAdmitting("set"), ["those", "them", "these"]);
});

test("register never mutates its argument and a partial referent registers nothing", () => {
  const rec0 = emptyRecord();
  const rec1 = register(rec0, eventSpec());
  assert.equal(rec0.referents.length, 0, "the input record is untouched");
  assert.equal(rec1.referents.length, 1);
  const bad = [
    eventSpec({ kind: "thing" }),
    eventSpec({ label: " " }),
    eventSpec({ ids: [] }),
    eventSpec({ ids: ["a", "b"] }),
    setSpec({ ids: [] }),
    eventSpec({ class: null }),
    eventSpec({ attrs: { colour: "red" } }),
    eventSpec({ binds: ["those"] }),
    eventSpec({ from: {} }),
    { kind: "measure", class: "Commit", label: "7", ids: [], attrs: { count: 7 }, from: { lane: "x" } },
  ];
  for (const spec of bad) {
    assert.ok(referentProblems(spec).length > 0, JSON.stringify(spec));
    assert.equal(register(rec1, spec), rec1, "an unregistrable spec returns the record unchanged");
  }
  const measure = { kind: "measure", class: null, label: "7 commits", ids: [], attrs: { count: 7 }, from: { lane: "count" } };
  assert.deepEqual(referentProblems(measure), []);
});

test("same-slot replacement: re-registering the same kind+ids replaces in place, keeps the handle, moves to the front", () => {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, setSpec());
  rec = register(rec, eventSpec());
  rec = advanceTurn(rec);
  rec = register(rec, setSpec({ ids: ["commit:c", "commit:b", "commit:a"], label: "same set, later turn" }));
  assert.equal(rec.referents.length, 2, "asking the same question twice does not fill the record");
  assert.equal(rec.referents[0].ref, "r1", "the replaced referent keeps its handle");
  assert.equal(rec.referents[0].label, "same set, later turn");
  assert.equal(rec.referents[0].from.turn, 2);
  assert.equal(rec.referents[1].ref, "r2", "the untouched sibling stays");
});

test("topic shift: a same-kind referent of a class no live sibling shares retires the same-kind referents", () => {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, setSpec());
  rec = register(rec, eventSpec());
  rec = advanceTurn(rec);
  const moduleSet = setSpec({ class: "Module", label: "3 modules", ids: ["mod:a", "mod:b", "mod:c"], attrs: { count: 3 } });
  const shifted = register(rec, moduleSet);
  assert.equal(shifted.referents.filter((r) => r.kind === "set").length, 1, "the commit set is gone");
  assert.equal(shifted.referents[0].class, "Module");
  assert.ok(shifted.referents.some((r) => r.kind === "event"), "other kinds are untouched");
  // a turn that bound a form against the record derives from the standing
  // set, so it must not evict it.
  const boundReg = register(rec, moduleSet, { bound: true });
  assert.equal(boundReg.referents.filter((r) => r.kind === "set").length, 2);
});

test("cap eviction: a full record drops its oldest referent, straight FIFO", () => {
  let rec = emptyRecord({ maxReferents: 2 });
  for (const [i, sha] of ["a1", "b2", "c3"].entries()) {
    rec = advanceTurn(rec);
    rec = register(rec, eventSpec({ label: sha, ids: [`commit:${sha}`], from: { lane: "commitFilter", query: `q${i}` } }));
  }
  assert.equal(rec.referents.length, 2);
  assert.deepEqual(rec.referents.map((r) => r.label), ["c3", "b2"], "newest first, oldest evicted");
});

test("bind: one admitting referent binds; several resolve by recency; none is null", () => {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, setSpec());
  rec = register(rec, eventSpec());
  const that = bind(rec, "that");
  assert.equal(that.referent.label, "1b2c3d4e5f60", "'that' is singular, so only the event admits it");
  const those = bind(rec, "those");
  assert.equal(those.referent.kind, "set");
  assert.equal(bind(rec, "banana"), null, "an unknown form binds nothing");
  assert.equal(bind(emptyRecord(), "that"), null, "an empty record binds nothing");
  assert.equal(bind(rec, " That ").referent, that.referent, "forms normalize case and whitespace");
  // recency: a second event registered later wins the singular form.
  rec = advanceTurn(rec);
  rec = register(rec, eventSpec({ label: "e5f6a1b2c3d4", ids: ["commit:e5f6a1b2c3d4"], attrs: { date: "2026-05-15" } }));
  assert.equal(bind(rec, "it").referent.label, "e5f6a1b2c3d4");
  assert.equal(bind(rec, "it").candidates.length, 2);
});

test("bind with tieRefuses: two admitting referents from the same turn are a tie, listed rather than picked", () => {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, eventSpec());
  rec = register(rec, eventSpec({ label: "e5f6a1b2c3d4", ids: ["commit:e5f6a1b2c3d4"], attrs: { date: "2026-05-15" } }));
  const tied = bind(rec, "that", { tieRefuses: true });
  assert.equal(tied.referent, undefined);
  assert.equal(tied.tie.length, 2);
  // recency still resolves when the newer candidate is from a later turn.
  rec = advanceTurn(rec);
  rec = register(rec, eventSpec({ label: "0a1b2c3d4e5f", ids: ["commit:0a1b2c3d4e5f"], attrs: { date: "2026-05-21" } }));
  assert.equal(bind(rec, "that", { tieRefuses: true }).referent.label, "0a1b2c3d4e5f");
});

test("retire removes one referent by handle and leaves an unknown handle alone", () => {
  let rec = advanceTurn(emptyRecord());
  rec = register(rec, setSpec());
  rec = register(rec, eventSpec());
  const [newest] = rec.referents;
  const after = retire(rec, newest.ref);
  assert.equal(after.referents.length, 1);
  assert.ok(!after.referents.some((r) => r.ref === newest.ref));
  assert.equal(retire(rec, "r99"), rec, "an unknown handle returns the record unchanged");
});
