// tui/app.mjs — the Ink full-screen chat shell (the default on a TTY).
//
// The claude-code feel: an alternate-screen, full-height layout with a scrolling
// transcript pane (each visitor line echoed under the prompt it was typed at,
// the answer below it), a bottom input line carrying the live `tmct> ` /
// `tmct(label)> ` focus prompt, and a thin status bar (repo · module count ·
// session id · an honest "no graph — starting empty" when bootstrapping).
//
// EVERY turn goes through the SAME createSession sink (src/chat.mjs) the plain
// readline shell uses — the transcript log, structured sidecar, per-turn graph
// upsert and memory side-write are byte-identical to `--plain`; only the
// screen drawing differs. Slash-commands work unchanged (they're session.turn's
// job); `/exit` and a conversational "bye" end the session; Ctrl+C exits
// cleanly through the same close() (Ink's exitOnCtrlC → waitUntilExit → close).
//
// Library decision (ROADMAP Phase 1 shell work): Ink 7 + React 19 — plain Node
// ESM, no JSX/build step (React.createElement throughout). OpenTUI was ruled
// out for now: @opentui/core depends on Bun FFI (bun-ffi-structs / a native Zig
// renderer), so it doesn't run under plain Node; revisit when it does.
//
// The view-model is PURE and exported (statusText, appendTurn, transcriptLines,
// wrapLines) so node:test exercises it without a terminal; the component tree
// is thin glue over it.

import React, { useEffect, useState } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import { createSession } from "../chat.mjs";

const h = React.createElement;

/** The thin status-bar text: repo · module count · session id (short, like the
 *  Session graph label) — plus the honest bootstrap note when the graph is empty. */
export function statusText({ repo, moduleCount, sessionId, empty }) {
  const parts = [String(repo), `${moduleCount} module(s)`, `session ${String(sessionId).slice(0, 8)}`];
  if (empty) parts.push("no graph — starting empty");
  return parts.join(" · ");
}

/** Append one completed turn to the transcript model (pure — returns a new array).
 *  `prompt` is the prompt the question was typed at (so a focus label is preserved
 *  in the echo, exactly like a scrolled readline session reads). */
export function appendTurn(items, { prompt, query, answer }) {
  return [...items, { kind: "q", prompt: String(prompt), text: String(query) }, { kind: "a", text: String(answer) }];
}

/** Flatten the transcript model to display lines: the echoed `tmct> question`
 *  line, the answer's own lines, and a blank separator after each turn —
 *  mirroring the transcript log's visual rhythm. */
export function transcriptLines(items) {
  const lines = [];
  for (const item of items) {
    if (item.kind === "q") lines.push(`${item.prompt}${item.text}`);
    else { lines.push(...String(item.text).split("\n")); lines.push(""); }
  }
  return lines;
}

/** Hard-wrap display lines at `width` columns so the pane's line budget is honest
 *  (Ink would soft-wrap and overflow the fixed-height layout otherwise). */
export function wrapLines(lines, width) {
  const w = Math.max(1, Number(width) || 80);
  const out = [];
  for (const line of lines) {
    let s = String(line);
    if (s.length <= w) { out.push(s); continue; }
    while (s.length > w) { out.push(s.slice(0, w)); s = s.slice(w); }
    out.push(s);
  }
  return out;
}

// ---- line editor (pure, cursor-aware — readline-style in-line editing) ----
// The input line is a (value, cursor) pair: `cursor` is an index in [0, value.length]
// naming the gap BEFORE which the next character lands. Left/right move it; typing and
// backspace act AT it, so a message can be edited mid-line and resubmitted. Pure so
// node:test exercises the editing without a terminal.

/** Insert `str` at the cursor; the cursor advances past it. */
export function insertAt(value, cursor, str) {
  const c = clampCursor(value, cursor);
  return { value: value.slice(0, c) + str + value.slice(c), cursor: c + str.length };
}

/** Delete the character BEFORE the cursor (Backspace); the cursor steps left. A no-op
 *  at column 0. (This shell treats Backspace and Delete alike — delete-before-cursor.) */
export function backspaceAt(value, cursor) {
  const c = clampCursor(value, cursor);
  if (c <= 0) return { value, cursor: 0 };
  return { value: value.slice(0, c - 1) + value.slice(c), cursor: c - 1 };
}

/** Clamp a cursor index into [0, value.length]. */
export function clampCursor(value, cursor) {
  return Math.max(0, Math.min(String(value).length, Number(cursor) || 0));
}

/** Split the value around the cursor for rendering: the text before it, the single
 *  character UNDER it (a space when the cursor sits past the end), and the text after
 *  that character — so the caret block can highlight `at` in place. */
export function inputCells(value, cursor) {
  const c = clampCursor(value, cursor);
  const s = String(value);
  return { before: s.slice(0, c), at: s.slice(c, c + 1) || " ", after: s.slice(c + 1) };
}

/** Terminal size, live across resizes (falls back to 80×24 off-TTY). */
function useTerminalSize() {
  const { stdout } = useStdout();
  const size = () => ({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 });
  const [dim, setDim] = useState(size);
  useEffect(() => {
    if (!stdout) return undefined;
    const onResize = () => setDim(size());
    stdout.on("resize", onResize);
    return () => stdout.off("resize", onResize);
  }, [stdout]);
  return dim;
}

/** The Ink app over one createSession sink. Owns only VIEW state — the session
 *  (focus, files, records) lives in the sink, exactly as in the readline shell. */
export function App({ session }) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [items, setItems] = useState([]);
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0); // caret position within `input` (readline-style)
  const [prompt, setPrompt] = useState(session.promptFor());
  const [busy, setBusy] = useState(false);
  // Command history (up/down arrow recall, readline-style). `history` is oldest→newest;
  // `histCursor` is -1 for the live input, else the offset back from the newest entry.
  const [history, setHistory] = useState([]);
  const [histCursor, setHistCursor] = useState(-1);

  const submit = async (line) => {
    if (line === "/exit") { exit(); return; }
    setBusy(true);
    const echoedAt = prompt; // the prompt the question was typed at, kept in the echo
    try {
      const { answer, end, prompt: nextPrompt } = await session.turn(line);
      setItems((prev) => appendTurn(prev, { prompt: echoedAt, query: line, answer }));
      setPrompt(nextPrompt);
      if (end) { exit(); return; } // a conversational "bye" — same clean end as /exit
    } finally {
      setBusy(false);
    }
  };

  // Set the editable line to a whole string with the caret at its end (history recall,
  // submit-reset) — one place so `input` and `cursor` never drift apart.
  const setLine = (value) => { setInput(value); setCursor(value.length); };

  const trySubmit = (raw) => {
    if (busy) return; // one turn at a time — the engine is deterministic and fast
    const line = String(raw).trim();
    setLine("");
    setHistCursor(-1); // any submit resets history navigation to the live input
    if (line) {
      // record for up-arrow recall; collapse an immediate duplicate of the last line
      setHistory((h) => (h[h.length - 1] === line ? h : [...h, line]));
      void submit(line);
    }
  };

  useInput((ch, key) => {
    if (key.return) { trySubmit(input); return; }
    // Left/right arrow + Ctrl-A/E: move the caret so a typed line can be edited mid-string
    // and resubmitted (not just appended to / backspaced from the end).
    if (key.leftArrow) { setCursor((c) => clampCursor(input, c - 1)); return; }
    if (key.rightArrow) { setCursor((c) => clampCursor(input, c + 1)); return; }
    if (key.ctrl && ch === "a") { setCursor(0); return; }                // home
    if (key.ctrl && ch === "e") { setCursor(input.length); return; }     // end
    if (key.backspace || key.delete) { const r = backspaceAt(input, cursor); setInput(r.value); setCursor(r.cursor); return; }
    if (key.ctrl && ch === "u") { setLine(""); return; }
    // Up/down arrow: recall previous prompts (readline-style), oldest→newest history.
    if (key.upArrow) {
      if (!history.length) return;
      const nc = Math.min(histCursor + 1, history.length - 1);
      setHistCursor(nc);
      setLine(history[history.length - 1 - nc]);
      return;
    }
    if (key.downArrow) {
      if (histCursor <= 0) { setHistCursor(-1); setLine(""); return; } // back to a fresh line
      const nc = histCursor - 1;
      setHistCursor(nc);
      setLine(history[history.length - 1 - nc]);
      return;
    }
    if (key.ctrl || key.meta || key.escape || key.tab) return;
    if (!ch) return;
    // A PASTED chunk arrives as one multi-char event; a newline inside it means
    // "submit this line" (one line per turn — the readline shell's per-line read).
    const nl = ch.search(/[\r\n]/);
    if (nl === -1) { const r = insertAt(input, cursor, ch); setInput(r.value); setCursor(r.cursor); return; }
    trySubmit(input.slice(0, cursor) + ch.slice(0, nl) + input.slice(cursor));
  });

  // The pane's line budget: full height minus the input line and the status bar.
  const paneRows = Math.max(1, rows - 2);
  const banner = { kind: "a", text: session.bannerLines.join("\n") }; // one block, one separator
  const allLines = wrapLines(transcriptLines([banner, ...items]), columns);
  const visible = allLines.slice(-paneRows);

  return h(Box, { flexDirection: "column", height: rows, width: columns },
    h(Box, { flexDirection: "column", height: paneRows, overflow: "hidden" },
      ...visible.map((line, i) =>
        h(Text, { key: `l${i}`, wrap: "truncate-end" }, line === "" ? " " : line)),
    ),
    h(Box, { height: 1 },
      (() => {
        const { before, at, after } = inputCells(input, cursor);
        return h(Text, { wrap: "truncate-end" },
          h(Text, { bold: true }, prompt),
          before,
          busy ? h(Text, { dimColor: true }, "…") : h(Text, { inverse: true }, at), // caret block over the char at the cursor
          busy ? null : after,
        );
      })(),
    ),
    h(Box, { height: 1 },
      h(Text, { dimColor: true, wrap: "truncate-end" },
        statusText(session), " · /help commands · /exit leaves"),
    ),
  );
}

/** Run the full-screen TUI over a fresh session sink: alternate screen in, Ink
 *  render, wait for exit (Ctrl+C / /exit / bye), alternate screen out, then the
 *  SAME session close the readline shell performs (end lines, final upsert —
 *  which also triggers the memory fold — stream flush). Returns
 *  { logFile, sidecarFile, turns } exactly like runChat. */
export async function runTui({ repoPath, stdout = process.stdout, stdin = process.stdin, ...sessionOpts } = {}) {
  const session = await createSession({ repoPath, ...sessionOpts });
  stdout.write("\x1b[?1049h\x1b[H"); // alternate screen buffer + home — a clean full-screen canvas
  const app = render(h(App, { session }), { stdout, stdin, exitOnCtrlC: true });
  try {
    await app.waitUntilExit();
  } finally {
    app.unmount();
    stdout.write("\x1b[?1049l"); // restore the primary screen (shell scrollback intact)
    await session.close();
    stdout.write(`session ended — log ${session.logFile}\n`);
  }
  return { logFile: session.logFile, sidecarFile: session.sidecarFile, turns: session.turns };
}
