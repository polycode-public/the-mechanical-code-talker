// timeline tests — the commit-timeline extractor + page renderer (src/timeline.mjs),
// moved into the package from the old scripts/gen-site-timeline.mjs. Pure, no git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTimeline, renderTimelineHtml } from "../src/timeline.mjs";

const fixture = {
  generated_at: "2026-07-01T00:00:00.000Z",
  individuals: [
    // Modules carry per-commit churn via derived_from (git:<short sha>)
    { id: "mod:a.mjs", class: "Module", label: "a.mjs", derived_from: ["git:aaa1111", "git:bbb2222"] },
    { id: "mod:b.mjs", class: "Module", label: "b.mjs", derived_from: ["git:bbb2222"] },
    // Commits deliberately out of date order in the artifact
    {
      id: "commit:bbb2222000000", class: "Commit", label: "bbb2222",
      attributes: [
        { key: "date", value: "2026-06-02T10:00:00+00:00" },
        { key: "author", value: "Bea" },
        { key: "message", value: "second change" },
      ],
    },
    {
      id: "commit:aaa1111000000", class: "Commit", label: "aaa1111",
      attributes: [
        { key: "date", value: "2026-06-01T10:00:00+00:00" },
        { key: "author", value: "Ada" },
        { key: "message", value: "first change" },
      ],
    },
    {
      id: "commit:ccc3333000000", class: "Commit", label: "ccc3333",
      attributes: [
        { key: "date", value: "2026-06-03T10:00:00+00:00" },
        { key: "author", value: "Cyd" },
        { key: "message", value: "touches nothing tracked" },
      ],
    },
  ],
};

test("extractTimeline: commits sorted oldest-first by date, churn counted per short sha", () => {
  const commits = extractTimeline(fixture);
  assert.deepEqual(commits.map((c) => c.short), ["aaa1111", "bbb2222", "ccc3333"]);
  assert.deepEqual(commits.map((c) => c.touched), [1, 2, 0]); // bbb touched both modules; ccc none
  assert.equal(commits[0].sha, "aaa1111000000"); // full sha, commit: prefix stripped
  assert.equal(commits[0].author, "Ada");
  assert.equal(commits[1].message, "second change");
});

test("extractTimeline: empty graph → []", () => {
  assert.deepEqual(extractTimeline({}), []);
  assert.deepEqual(extractTimeline({ individuals: [] }), []);
});

test("renderTimelineHtml: nav entries render as header links; no nav → no nav links at all", () => {
  const commits = extractTimeline(fixture);
  const withNav = renderTimelineHtml({
    commits,
    nav: { home: "/", graph: "./seonix-graph.html", browser: "./code-browser.html", timeline: "./timeline.html" },
  });
  assert.match(withNav, /<a href="\/">← home<\/a>/);
  assert.match(withNav, /<a href="\.\/seonix-graph\.html">graph<\/a>/);
  assert.match(withNav, /<a href="\.\/code-browser\.html">browser<\/a>/);
  const bare = renderTimelineHtml({ commits });
  assert.doesNotMatch(bare, /<a href="\/">/); // the old hardcoded '/' link is gone
  assert.doesNotMatch(bare, /seonix-graph\.html/); // …and so is '/seonix-graph.html'
});

test("renderTimelineHtml: content — bars + rows, GitLab commit links only with a repoUrl, message escaped", () => {
  const commits = extractTimeline({
    ...fixture,
    individuals: fixture.individuals.map((i) =>
      i.label === "aaa1111"
        ? { ...i, attributes: i.attributes.map((a) => (a.key === "message" ? { ...a, value: "<b>evil</b>" } : a)) }
        : i,
    ),
  });
  const linked = renderTimelineHtml({ commits, repoUrl: "https://gitlab.example/a/b/" });
  assert.match(linked, /3 commits/);
  assert.match(linked, /https:\/\/gitlab\.example\/a\/b\/-\/commit\/aaa1111000000/); // trailing slash stripped
  assert.match(linked, /&lt;b&gt;evil&lt;\/b&gt;/);
  assert.doesNotMatch(linked, /<b>evil<\/b>/);
  assert.doesNotMatch(renderTimelineHtml({ commits }), /-\/commit\//); // no repoUrl → no dead links
});

test("renderTimelineHtml: 0 commits renders an honest empty page (Math.max guard, no NaN heights)", () => {
  const html = renderTimelineHtml({ commits: [] });
  assert.match(html, /0 commits/);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /Infinity/);
  assert.match(html, /<div id="bars"><\/div>/); // no bars, page structure intact
});

// ---- chat sessions on the timeline (sessions.mjs's Session individuals) ----

const sessionFixture = {
  ...fixture,
  individuals: [
    ...fixture.individuals,
    {
      id: "session:01890000-0000-7000-8000-000000000001", class: "Session", label: "01890000",
      attributes: [
        { key: "started", value: "2026-06-02T15:00:00.000Z" }, // between bbb2222 and ccc3333
        { key: "ended", value: "2026-06-02T15:05:00.000Z" },
        { key: "turns", value: "2" },
      ],
    },
  ],
};

test("extractTimeline: Session individuals join the timeline at their started timestamp, type-tagged", () => {
  const entries = extractTimeline(sessionFixture);
  assert.deepEqual(entries.map((e) => e.short), ["aaa1111", "bbb2222", "01890000", "ccc3333"], "sorted among commits by date");
  const sess = entries.find((e) => e.type === "session");
  assert.equal(sess.turns, 2);
  assert.equal(sess.id, "01890000-0000-7000-8000-000000000001");
  assert.ok(entries.filter((e) => e.type !== "session").every((e) => e.sha), "commit entries keep their exact shape");
});

test("extractTimeline: zero sessions → entries deep-equal the commit-only extraction (fixtures unchanged)", () => {
  assert.deepEqual(extractTimeline(fixture).map((c) => ({ ...c })), extractTimeline(fixture));
  assert.ok(extractTimeline(fixture).every((c) => c.type === undefined));
});

test("renderTimelineHtml: sessions render as a visually distinct entry with a turn count", () => {
  const html = renderTimelineHtml({ commits: extractTimeline(sessionFixture) });
  assert.match(html, /3 commits · 1 chat session\(s\)/);
  assert.match(html, /class="sess"[^>]*>.*chat session — 2 turn\(s\)/);
  assert.match(html, /class="bar sess"/);
  assert.doesNotMatch(html, /-\/commit\/01890000/, "a session never gets a commit link");
  // and a session-free render still says plain commits, no session chrome in the header
  assert.match(renderTimelineHtml({ commits: extractTimeline(fixture) }), /3 commits</);
});

// ---- P4: cross-repo timelines (merged multi-repo graph) -------------------------

// A merged 2-repo graph: modules carry `mod:<repo>/…` prefixes; commit provenance
// (derived_from git:<short>) links each short sha to the repo(s) it touched. Dates
// interleave the two histories on one global axis: x1 < y1 < x2.
const mergedFixture = {
  individuals: [
    { id: "mod:repo-x/a.mjs", class: "Module", label: "repo-x/a.mjs", derived_from: ["git:x1", "git:x2"] },
    { id: "mod:repo-y/b.mjs", class: "Module", label: "repo-y/b.mjs", derived_from: ["git:y1"] },
    // repo-z has a module but no commit provenance — the zero-commit-repo case.
    { id: "mod:repo-z/c.mjs", class: "Module", label: "repo-z/c.mjs", derived_from: [] },
    { id: "commit:x1aaaaaa", class: "Commit", label: "x1",
      attributes: [{ key: "date", value: "2026-06-01T10:00:00+00:00" }, { key: "author", value: "Ann" }, { key: "message", value: "x first" }] },
    { id: "commit:y1bbbbbb", class: "Commit", label: "y1",
      attributes: [{ key: "date", value: "2026-06-02T10:00:00+00:00" }, { key: "author", value: "Ben" }, { key: "message", value: "y first" }] },
    { id: "commit:x2cccccc", class: "Commit", label: "x2",
      attributes: [{ key: "date", value: "2026-06-03T10:00:00+00:00" }, { key: "author", value: "Ann" }, { key: "message", value: "x second" }] },
  ],
};

test("extractTimeline: merged graph tags each commit with its repo, globally date-ordered", () => {
  const entries = extractTimeline(mergedFixture);
  assert.deepEqual(entries.map((e) => e.short), ["x1", "y1", "x2"]); // one global date axis
  assert.deepEqual(entries.map((e) => e.repo), ["repo-x", "repo-y", "repo-x"]);
  assert.deepEqual(entries.map((e) => e.touched), [1, 1, 1]); // x2 touches a.mjs (still repo-x)
});

test("renderTimelineHtml: merged graph shows both repos — header count, legend, per-entry badge", () => {
  const html = renderTimelineHtml({ commits: extractTimeline(mergedFixture) });
  assert.match(html, /3 commits · 2 repos/);
  assert.match(html, /class="repolegend"/);
  assert.match(html, /class="rl"[^>]*>.*repo-x/);
  assert.match(html, />repo-y</); // both repo labels appear
});

test("extractTimeline: a repo with zero commits doesn't break the merged timeline", () => {
  // repo-z (module only, no commits) contributes no entries and no crash.
  const entries = extractTimeline(mergedFixture);
  assert.ok(entries.every((e) => e.repo !== "repo-z"));
  assert.equal(entries.length, 3);
});

test("renderTimelineHtml: single-repo render carries NONE of the multi-repo chrome (byte-identical guard)", () => {
  const entries = extractTimeline(fixture);
  assert.ok(entries.every((e) => !("repo" in e)), "single-repo entries never gain a repo key");
  const html = renderTimelineHtml({ commits: entries, repoUrl: "https://gitlab.example/a/b/" });
  assert.doesNotMatch(html, /repolegend/);
  assert.doesNotMatch(html, /class="rl"/);
  assert.doesNotMatch(html, / repos</);
  // and the render is stable/deterministic
  assert.equal(html, renderTimelineHtml({ commits: extractTimeline(fixture), repoUrl: "https://gitlab.example/a/b/" }));
});
