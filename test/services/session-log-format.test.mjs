// The one Markdown shape both session-transcript writers render into —
// pinned byte-for-byte against the reference sample's own layout: a title
// line, a byline, the `---` divider, one turn block per turn, and a
// closing session-end line.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionLogTimeOfDay,
  sessionLogHeaderMarkdown,
  sessionLogTurnMarkdown,
  sessionLogEndMarkdown,
} from "../../src/services/session-log-format.mjs";

test("sessionLogTimeOfDay: an ISO string or epoch-ms number reads its own UTC HH:MM:SS.mmm, never a local zone", () => {
  assert.equal(sessionLogTimeOfDay("2026-07-21T21:26:00.206Z"), "21:26:00.206");
  assert.equal(sessionLogTimeOfDay(Date.parse("2026-07-21T21:26:00.206Z")), "21:26:00.206");
});

test("sessionLogHeaderMarkdown: title + byline + divider, byte-identical to the reference sample", () => {
  const header = sessionLogHeaderMarkdown({
    version: "2.9.6",
    sessionId: "019f8692-430d-79f3-9ee2-c38792f56746",
    startedAt: "2026-07-21T21:26:00.206Z",
    repo: "/srv/projects/the-mechanical-code-talker",
  });
  assert.equal(
    header,
    "# tmct chat 2.9.6 — session 019f8692\n\n"
    + "*2026-07-21 · started 21:26:00.206 · repo /srv/projects/the-mechanical-code-talker*\n\n"
    + "---\n\n",
  );
});

test("sessionLogHeaderMarkdown: an absent repo drops the clause instead of showing it empty", () => {
  const header = sessionLogHeaderMarkdown({
    version: "dev", sessionId: "019f8692-abcd-abcd-abcd-abcdabcdabcd", startedAt: "2026-07-21T21:26:00.206Z",
  });
  assert.equal(header, "# tmct chat dev — session 019f8692\n\n*2026-07-21 · started 21:26:00.206*\n\n---\n\n");
});

test("sessionLogTurnMarkdown: a non-empty answer renders as a heading, a verbatim blockquote, and a fenced block", () => {
  const block = sessionLogTurnMarkdown({
    startedAt: "2026-07-21T21:26:00.237Z", turnNumber: 1, query: "list facts",
    answer: 'couldn\'t compile this compositional question.\n\nCanonical: a compositional query (miss) — composite(miss)',
  });
  assert.equal(
    block,
    "### 21:26:00.237 · turn 1\n\n"
    + "> list facts\n\n"
    + "```text\ncouldn't compile this compositional question.\n\nCanonical: a compositional query (miss) — composite(miss)\n```\n\n",
  );
});

test("sessionLogTurnMarkdown: an empty answer opens and closes the fence with nothing between", () => {
  const block = sessionLogTurnMarkdown({ startedAt: "2026-07-21T21:33:49.022Z", turnNumber: 103, query: "/exit", answer: "" });
  assert.equal(block, "### 21:33:49.022 · turn 103\n\n> /exit\n\n```text\n```\n\n");
});

test("sessionLogTurnMarkdown: the blockquote carries the query VERBATIM — no rewriting, no trimming", () => {
  const raw = "  what   does the   spider see?  ";
  const block = sessionLogTurnMarkdown({ startedAt: "2026-07-21T21:26:00.237Z", turnNumber: 1, query: raw, answer: "x" });
  assert.ok(block.includes("> " + raw + "\n"), "the exact raw line rides the blockquote unchanged");
});

test("sessionLogEndMarkdown: matches the reference sample's closing line", () => {
  assert.equal(
    sessionLogEndMarkdown({ endedAt: "2026-07-21T21:33:49.022Z", turnCount: 103 }),
    "---\n\n*session end 21:33:49.022 — 103 turns*\n",
  );
});

test("sessionLogEndMarkdown: a one-turn session reads singular", () => {
  assert.equal(
    sessionLogEndMarkdown({ endedAt: "2026-07-21T21:33:49.022Z", turnCount: 1 }),
    "---\n\n*session end 21:33:49.022 — 1 turn*\n",
  );
});

test("a full document — header + two turns + the closing marker — concatenates with no stray blank lines", () => {
  const doc = sessionLogHeaderMarkdown({ version: "2.9.6", sessionId: "019f8692-x", startedAt: "2026-07-21T21:26:00.000Z" })
    + sessionLogTurnMarkdown({ startedAt: "2026-07-21T21:26:00.100Z", turnNumber: 1, query: "hi", answer: "hello." })
    + sessionLogTurnMarkdown({ startedAt: "2026-07-21T21:26:01.000Z", turnNumber: 2, query: "/exit", answer: "" })
    + sessionLogEndMarkdown({ endedAt: "2026-07-21T21:26:01.000Z", turnCount: 2 });
  assert.equal(
    doc,
    "# tmct chat 2.9.6 — session 019f8692\n\n"
    + "*2026-07-21 · started 21:26:00.000*\n\n---\n\n"
    + "### 21:26:00.100 · turn 1\n\n> hi\n\n```text\nhello.\n```\n\n"
    + "### 21:26:01.000 · turn 2\n\n> /exit\n\n```text\n```\n\n"
    + "---\n\n*session end 21:26:01.000 — 2 turns*\n",
  );
});
