#!/usr/bin/env node
// mct — The Mechanical Code Talker. The headline entry is CHAT: a bare
// invocation drops you into a tolerant, offline, $0 prompt that guides you
// toward precision queries about a repository (ELIZA/PARRY-style, but obsessed
// with software). No model calls; mct keeps no codebase index of its own.
//
//   mct                                   → interactive chat (the headline)
//   mct chat [--repo <abs>]               → same, explicit
//   mct viz [--focus <sym>] [--out f.html] → render a focused sub-graph to HTML
//   mct cli <tool> '{…json}'              → invoke a graph tool directly (de-emphasized carry-over)
//   mct --help                            → this help
//
// This is a whole-package lift of the seonix chat surface (v0.1.0): internal
// module filenames and symbols are kept verbatim to preserve the shape and the
// green test suite; the branding is mct. The non-chat modes are carried but
// de-emphasized — see README.md for what mct is and deliberately is NOT, and
// ROADMAP.md for where it is going.

const HELP = `mct — The Mechanical Code Talker

A tolerant, offline, $0 chat that guides you toward precision queries about a
software repository. No model calls; no codebase index of its own.

Usage:
  mct                          interactive chat (the headline surface)
  mct chat [--repo <abs>]      chat over a specific repo's graph
  mct viz [--focus <sym>] …    render a focused sub-graph to HTML
  mct cli <tool> '{…}'         invoke a graph tool directly (carry-over, de-emphasized)
  mct --help                   show this help

In chat: /help lists slash-commands; /exit leaves. Session log → <repo>/.seonix/session-<id>.log.
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
