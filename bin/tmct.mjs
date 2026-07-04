#!/usr/bin/env node
// tmct — The Mechanical Code Talker. The headline entry is CHAT: a bare
// invocation drops you into a tolerant, offline, $0 prompt that guides you
// toward precision queries about a repository (ELIZA/PARRY-style, but obsessed
// with software). No model calls; tmct keeps no codebase index of its own.
//
//   tmct                                   → interactive chat (the headline)
//   tmct chat [--repo <abs>] [--plain]     → same, explicit
//   tmct cli <tool> '{…json}'              → invoke a graph tool directly (de-emphasized carry-over)
//   tmct --help                            → this help
//
// On a real terminal, chat is the full-screen Ink TUI (src/tui/app.mjs);
// `--plain` — or a non-TTY stdin/stdout (pipes, scripts, the test suite) —
// gets the classic readline shell. BOTH run the same session sink
// (src/chat.mjs createSession), so logs, sidecars and graph memory are
// identical either way.
//
// tmct began as a whole-package lift of an earlier chat surface (see README
// provenance): internal module filenames and symbols were kept to preserve the
// shape and the green test suite. The non-chat modes are carried but
// de-emphasized — see README.md for what tmct is and deliberately is NOT, and
// ROADMAP.md for where it is going.

const HELP = `tmct — The Mechanical Code Talker

A tolerant, offline, $0 chat that guides you toward precision queries about a
software repository. No model calls; no codebase index of its own.

Usage:
  tmct                         interactive chat (the headline surface)
  tmct chat [--repo <abs>]     chat over a specific repo's graph
       [--plain]               force the plain readline shell (the default when
                               stdin/stdout is not a terminal)
  tmct cli <tool> '{…}'        invoke a graph tool directly (carry-over, de-emphasized)
  tmct --help                  show this help

On a terminal, chat opens the full-screen TUI; piped input gets the plain shell.
In chat: /help lists slash-commands; /exit leaves. Session log → <repo>/.tmct/session-<id>.log.
`;

const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  process.stdout.write(HELP);
  process.exit(0);
}

// Headline behaviour: a bare invocation is CHAT. We rewrite argv so the mode
// dispatch below (and anything downstream reading process.argv) sees `chat`.
if (args.length === 0) {
  process.argv.splice(2, 0, "chat");
}

if (process.argv[2] === "chat") {
  const rest = process.argv.slice(3);
  const i = rest.indexOf("--repo");
  const repoPath = i !== -1 ? rest[i + 1] : undefined;
  // The shell gate: a real terminal gets the full-screen Ink TUI; `--plain` or a
  // non-TTY stream (pipes, scripts, the test suite) gets the readline shell. Both
  // drive the same createSession sink — only the drawing differs.
  const plain = rest.includes("--plain") || !process.stdin.isTTY || !process.stdout.isTTY;
  try {
    if (plain) {
      const { runChat } = await import("../src/chat.mjs");
      await runChat({ repoPath });
    } else {
      const { runTui } = await import("../src/tui/app.mjs");
      await runTui({ repoPath });
    }
  } catch (e) {
    process.stderr.write(`tmct: ${e?.message || e}\n`);
    process.exit(1);
  }
} else {
  // Delegate the carried `cli` arms to the dispatcher. It runs its own main() on import.
  await import("./cli.mjs");
}
