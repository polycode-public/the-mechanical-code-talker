#!/usr/bin/env node
// tmct — The Mechanical Code Talker. The headline entry is CHAT: a bare
// invocation drops you into a tolerant, offline, $0 prompt that guides you
// toward precision queries about a repository (ELIZA/PARRY-style, but obsessed
// with software). No model calls; tmct keeps no codebase index of its own.
//
//   tmct                                   → interactive chat (the headline)
//   tmct chat [--repo <abs>]               → same, explicit
//   tmct cli <tool> '{…json}'              → invoke a graph tool directly (de-emphasized carry-over)
//   tmct --help                            → this help
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
  tmct cli <tool> '{…}'        invoke a graph tool directly (carry-over, de-emphasized)
  tmct --help                  show this help

In chat: /help lists slash-commands; /exit leaves. Session log → <repo>/.tmct/session-<id>.log.
`;

const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  process.stdout.write(HELP);
  process.exit(0);
}

// Headline behaviour: a bare invocation is CHAT. We rewrite argv so the carried
// dispatcher (bin/cli.mjs, kept verbatim for the test suite) sees `chat`, then
// hand off to it. Any explicit mode passes straight through unchanged.
if (args.length === 0) {
  process.argv.splice(2, 0, "chat");
}

// Delegate to the carried dispatcher. It runs its own main() on import.
await import("./cli.mjs");
