// session-log-format.mjs — the ONE Markdown shape every session-transcript
// writer renders turns into: the Node CLI/TUI's own .tmct/session-<id>.md
// (chat-session.mjs) and the browser chat page's "export .md" button
// (chat-page-viz.mjs). A `#` title carrying the version and a short session
// label, one `###` heading per turn at millisecond time-of-day precision,
// the user's line as a verbatim `>` blockquote, the reply in a fenced
// block, and a closing session-end line.
//
// Every export here is a pure, self-contained function — no imports, and no
// references outside its own body except calling its siblings in this file
// by name — so the browser writer can splice each one's own `.toString()`
// straight into chat.html's inline script, the same discipline
// provBucketFor/provenanceChipFor already hold in chat-page-viz.mjs.

/** An ISO-8601 string or epoch-ms number, as its own "HH:MM:SS.mmm" time of
 *  day — read straight off the timestamp's own UTC digits, never converted
 *  to a local zone, so it always names the wall-clock instant the session
 *  actually ran the turn on. */
export function sessionLogTimeOfDay(ts) {
  const iso = typeof ts === "number" ? new Date(ts).toISOString() : String(ts);
  return iso.slice(11, 23);
}

/** The session file's opening block: a `#` title naming the version and a
 *  short session label (the id's first segment), a byline with the
 *  calendar date, the started time, and — when given — the repo path, then
 *  the `---` divider before the first turn. `repo` is optional: a browser
 *  export has none, so that clause is simply left out rather than shown
 *  empty. */
export function sessionLogHeaderMarkdown({ version, sessionId, startedAt, repo }) {
  const iso = typeof startedAt === "number" ? new Date(startedAt).toISOString() : String(startedAt);
  const shortId = String(sessionId || "").split("-")[0].slice(0, 8);
  const date = iso.slice(0, 10);
  const time = sessionLogTimeOfDay(iso);
  const bylineParts = [date, "started " + time];
  if (repo) bylineParts.push("repo " + repo);
  const byline = "*" + bylineParts.join(" · ") + "*";
  return "# tmct chat " + version + " — session " + shortId + "\n\n" + byline + "\n\n---\n\n";
}

/** One turn's own Markdown block: a `###` heading naming the time of day and
 *  the turn number, the VERBATIM user line as a `>` blockquote (no
 *  rewriting, no truncation — whatever the recognizer actually saw), and
 *  the reply in a fenced text block. Ends in a blank line so consecutive
 *  turn blocks concatenate directly into one document, byte-identical to
 *  the reference sample. An empty answer (the closing "/exit" marker) opens
 *  and closes the fence with nothing between, rather than a stray blank
 *  line inside it. */
export function sessionLogTurnMarkdown({ startedAt, turnNumber, query, answer }) {
  const time = sessionLogTimeOfDay(startedAt);
  const body = answer ? answer + "\n" : "";
  return "### " + time + " · turn " + turnNumber + "\n\n"
    + "> " + query + "\n\n"
    + "```text\n" + body + "```\n\n";
}

/** The closing block: a `---` divider and the session-end line naming the
 *  end time and the total turn count (the closing "/exit" marker counts as
 *  the last turn, so this number is always that marker's own turn number).
 *  No leading blank line — the preceding turn block already supplied one. */
export function sessionLogEndMarkdown({ endedAt, turnCount }) {
  const time = sessionLogTimeOfDay(endedAt);
  return "---\n\n*session end " + time + " — " + turnCount + " turn" + (turnCount === 1 ? "" : "s") + "*\n";
}
