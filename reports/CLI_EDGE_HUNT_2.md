# CLI edge hunt, second pass

A fresh playtest of the command-line surface and the HTTP endpoint at v5.0.6. Every finding below is
a transcript from `node bin/tmct.mjs` or `curl` against `tmct serve`, run over throwaway repos in a
scratch directory, with a fresh worlds pack, sprite facts and ask bundle built first.

The first hunt's fifteen findings are all closed. This pass re-tested each one and found them fixed:
`/untested` refuses on an empty index, `forget X is a Y` retracts instead of storing junk, plurals
singularise on both sides (`all wolves are mammals` stores `wolf subClassOf mammal`), the
spider-and-fly opener names `tick`, and a mistyped `--repo` refuses on all eight verbs that take it.

**Three honesty faults.** Two surfaces claim a write that never lands, and `tmct serve` gives two
contradictory answers about the same repo in the same minute. Everything after those is a wrong
message, a silently-swallowed flag, or a crash.

Ranks: **honesty** (answers when it should refuse, or claims what it did not do), then **high**,
**medium**, **cosmetic**. Each finding says how confident I am that it is a fault rather than
intended behaviour.

---

## 1. `tmct extract --repo` says it wrote the facts. It writes nothing.

Rank: **honesty**. Confidence: certain. Reproduced on the default backend, on `--memory-backend
sqlite`, and with `--canonical`.

The whole point of `--repo` on `extract` is the write. `tmct --help` says it "write[s] the facts into
that repo's own tmct memory". The command says the same on the way out. The facts are not there.

```
$ node bin/tmct.mjs init --repo /tmp/x1
$ printf 'A kestrel is a bird.\n' > /tmp/one.txt
$ node bin/tmct.mjs memory --repo /tmp/x1 --export /tmp/before.jsonl
wrote 688 facts to /tmp/before.jsonl

$ node bin/tmct.mjs extract /tmp/one.txt --repo /tmp/x1
1 sentence found, 1 recognized as fact (1 fact row), 0 skipped …
facts written into /tmp/x1's tmct memory, tagged one.txt

$ node bin/tmct.mjs memory --repo /tmp/x1 --export /tmp/after.jsonl
wrote 688 facts to /tmp/after.jsonl
$ grep -c kestrel /tmp/after.jsonl
0
$ node bin/tmct.mjs chat --repo /tmp/x1 --prompt "is a kestrel a bird"
I can't confirm that — I don't know "kestrel" at all yet. If it's true, teach me: "kestrel is a kind of bird".
```

Exit code 0 throughout. The sibling verb on the same sentence and the same kind of repo works:

```
$ node bin/tmct.mjs import --repo /tmp/x2 --file /tmp/one.txt
  taught — A kestrel is a bird.
1 taught, 0 declined, 0 comment line(s) skipped
$ node bin/tmct.mjs chat --repo /tmp/x2 --prompt "is a kestrel a bird"
yes — you told me: kestrel is a kind of bird (source: ace:chat:…)
```

Fault: `src/services/extract-facts.mjs:665`.

```js
const memoryDir = repo ? resolve(process.cwd(), repo) : null;
```

`extract` is the one verb that hands a raw repo path through as `memoryDir`. Every other verb in
`bin/tmct.mjs` goes through `openMemoryBackend(repo, backendChoice)` and gets an opaque backend
handle. So the fact lands in `<repo>/.tmct/memory/graph.json`, the retired flat-file path that
`chat-session.mjs:336-343` already describes as "a file no routed reader opens". Chat, `tmct memory`,
`tmct viz` and `tmct syllogise` all read the sqlite backend and never see it.

The line that claims the write is `extract-facts.mjs:694`.

## 2. `tmct serve` freezes its graph at startup, then contradicts itself

Rank: **honesty**. Confidence: certain that the two answers disagree; high that it is a fault.

One running server, one repo, two questions a minute apart. `/stats` says the graph is empty. The
tool route says it has twelve modules.

```
$ node bin/tmct.mjs serve --repo /tmp/n1 --port 8801 &
   # graph.json is replaced while the server runs, e.g. by `tmct index`

$ curl -s -X POST …/v1/messages -d '{"messages":[{"role":"user","content":"/stats"}]}'
graph overview — 0 entities.
entities by class:
relationships by predicate:
  (none recorded)
0 module(s) across 0 top-level package(s).

$ curl -s -X POST …/v1/messages -d '{ … "tools":[{"name":"tmct_architecture"}],
    "messages":[…,{"role":"assistant","content":[{"type":"tool_use","name":"tmct_architecture","input":{}}]}]}'
Architecture: 12 module(s) in 5 package(s).
packages (by module count): src/core (3), src/handlers (3), src/lib (2), src/server (2), test (2)
```

The CLI over the same file agrees with the second answer.

Fault: `src/surfaces/http/server-http.mjs:349`. `startServer` calls `parseEntities(await
source.fetchEntities(config))` once and closes over the result for the process's life. The
`respondToMessages` text path uses that frozen graph. The tool path goes through `dispatchTool`,
which calls `loadGraph` per call and reads the file fresh.

"0 entities" is an assertion about the user's repo, stated with no hedge, where the true answer is
twelve modules. A long-lived server is the normal way to run `tmct serve`, and `tmct index` is the
normal thing to run against a repo, so this is reachable without doing anything unusual.

## 3. `--ephemeral` and `--memory-backend memory` both say "remembered" for a fact they discard

Rank: **honesty**. Confidence: certain.

`--ephemeral` is documented as "read the graph but write nothing back". The session says the opposite
twice: once in the banner, once per teach turn.

```
$ node bin/tmct.mjs init --repo /tmp/e1
$ printf 'remember Bertha is a baker\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/e1 --ephemeral
tmct chat — /var/folders/…/tmct-ephemeral-FKyIOq — no code graph loaded — starting empty;
the conversation is remembered to .tmct/graph.json — log /var/folders/…/session-….md
tmct> noted — remembered: bertha is a kind of baker

$ printf 'is Bertha a baker\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/e1
tmct> I can't confirm that — I don't know "Bertha" at all yet.
```

Three separate claims in that transcript are false. The banner names a temp directory as the repo,
so the user cannot tell which repo they are talking to. It then says "the conversation is remembered
to .tmct/graph.json", and `chat-session.mjs:312` returns early from every graph upsert in this mode.
Then "noted — remembered" reports a durable write for a fact that dies with the process.

`--memory-backend memory` behaves identically, and `tmct --help` describes it as keeping "the store
in-process only":

```
$ printf 'remember Otto is a baker\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/e4 --memory-backend memory
tmct> noted — remembered: otto is a kind of baker
$ printf 'is Otto a baker\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/e4
tmct> I can't confirm that — I don't know "Otto" at all yet.
```

The HTTP endpoint already solves exactly this. `server-http.mjs:252-255` appends "(nothing was
stored — this endpoint reads the memory store and never writes to it…)" when a turn's fact count
grew inside a throwaway copy. The CLI's own read-only modes have no equivalent.

Banner: `src/services/chat-session.mjs:360-365`. Turn wrapper: `chat-session.mjs:418-459`.

## 4. An unwritable `.tmct/` kills the CLI with a raw Node stack trace

Rank: **high**. Confidence: certain it is a fault.

A read-only checkout, a directory owned by another user, a full disk. Any of them produce this:

```
$ chmod -R a-w /tmp/e7/.tmct
$ printf 'hi\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/e7
tmct — starting…
node:events:486
      throw er; // Unhandled 'error' event
      ^

Error: EACCES: permission denied, open '/tmp/e7/.tmct/session-019fc482-….md'
Emitted 'error' event on WriteStream instance at:
    at emitErrorNT (node:internal/streams/destroy:170:8)
    at emitErrorCloseNT (node:internal/streams/destroy:129:3)
    at process.processTicksAndRejections (node:internal/process/task_queues:89:21) {
  errno: -13, code: 'EACCES', syscall: 'open', …
}

Node.js v24.13.1
```

Exit 1, so the code is right. The module docblock promises the opposite: "Errors reach the caller as
clean tool errors — message only, never a stack." The session log is the first thing the session
opens, so nothing else in the session gets a chance to run.

Fault: `src/services/chat-session.mjs:293-294`. `createWriteStream` is called and never gets an
`error` listener, so the stream's failure becomes an unhandled `error` event.

## 5. `--config <path that does not exist>` is swallowed in silence

Rank: **high**. Confidence: high.

`--repo` was fixed to refuse a path that names nothing. `--config` still accepts one, ignores it, and
answers from the config it found anyway. Nothing on stdout or stderr says so.

```
$ node bin/tmct.mjs chat --repo /tmp/r1 --config /tmp/nosuch.toml --prompt "what is a dog"
dog is a kind of animal (source: corpus:human /r/IsA)
…
$ echo $?
0
```

A directory that does not exist behaves the same way. The user asked for one config, got another, and
believes their overrides applied. Every knob `tmct.toml` carries — corpus tier, memory backend,
graph paths, extension bundles, the read-only flag — silently keeps its old value.

Resolution: `src/services/cli-args.mjs:116-124`. The guard belongs next to
`refuseMissingRepoPath` in `bin/tmct.mjs:648`.

## 6. `--graph <path that does not exist>` refuses, but blames the repo

Rank: **medium**. Confidence: high.

The refusals are correct. None of the three surfaces mentions that the file you named is not there,
so all three read as "your repo has no code" when the real cause is a typo.

```
$ node bin/tmct.mjs chat --repo examples/mini-webapp --graph examples/mini-webapp/.tmct/graff.json \
    --prompt "what does src/lib/http.mjs import"
I can't answer that as a code question — no code graph is loaded in this session. Try "what is a dog" for general vocabulary.

$ node bin/tmct.mjs cli tmct_architecture '{}' --graph examples/mini-webapp/.tmct/graff.json
tmct: the graph at …/graff.json is empty — no entities to answer from yet (this repo starts with no graph;
the chat session folds the conversation into one).

$ node bin/tmct.mjs plan "what most needs a test" --graph examples/mini-webapp/.tmct/graff.json
no plan found — sub-goal (knows untested) not groundable in the declared toolset — escalate
```

The `cli` line is the worst of the three. It calls a file that does not exist "empty", and then
explains the emptiness with a story about the repo that is not what happened.

Without the typo, all three answer correctly over the same repo.

## 7. The HTTP surface tells an already-seeded repo to run `tmct init`

Rank: **medium**. Confidence: high.

Same repo, same question, two surfaces, different instructions. The repo was seeded with 688 facts by
`tmct init` before either call.

```
$ curl -s -X POST …/v1/messages -d '{"messages":[{"role":"user","content":"hi"}]}'
Hi. I'm tmct. Run `tmct init` to seed a starter vocabulary, or teach me directly, e.g. "every bug is an issue". …

$ node bin/tmct.mjs chat --repo /tmp/h1 --prompt "hi"
Hi. I'm tmct. Try "what is a dog" for general vocabulary. …
```

The CLI computes a `vocabHint` from the session's real seed state
(`chat-session.mjs:348-354`) and offers a term it has confirmed resolves. The HTTP path calls
`runTurn` without one, so it falls back to the unseeded wording every time. Running `tmct init` again
on a seeded repo is a no-op, so the advice wastes a step rather than breaking anything.

## 8. The HTTP "nothing was stored" note fires on turns that never tried to store

Rank: **medium**. Confidence: high.

The note exists to stop a teach reply being the last word on a write the endpoint does not make. It
also lands on a game move and on a Wikipedia lookup, where it tells you to go teach a fact you never
mentioned.

```
$ curl … -d '{"messages":[{"role":"user","content":"play spider and fly"}]}'
a spider waits in its web; a fly drifts in from the edge of the board. …
(nothing was stored — this endpoint reads the memory store and never writes to it. Teach the fact in a chat session to keep it.)

$ curl … -d '{"messages":[{"role":"user","content":"tick"}]}'
tick — The Acarina, or Acari, are the mites and ticks. … (source: reference article "Acarina", …)
(nothing was stored — this endpoint reads the memory store and never writes to it. Teach the fact in a chat session to keep it.)
```

Fault: `src/surfaces/http/server-http.mjs:247-255`. The test is "did the snapshot's individual count
grow", and a turn that records an Utterance or a Session individual grows it without teaching
anything.

## 9. `tmct digest --repo <path>` reads the flag's value as the term

Rank: **medium**. Confidence: certain.

`tmct digest` with no argument refuses correctly. Add a `--repo` and the path becomes the term.

```
$ node bin/tmct.mjs digest
tmct digest — name a term: `tmct digest <term>`          (exit 1)

$ node bin/tmct.mjs digest --repo /tmp/r1
I don't have anything stored about "/private/tmp/…/hunt/r1".          (exit 0)
```

The reply is a refusal, so nothing is claimed falsely. But the user asked one thing and was answered
about another, on exit 0, with no sign that the flag was eaten. The first form's message is the right
one for both.

## 10. `tmct viz --limit` accepts values that are not counts

Rank: **medium**. Confidence: high.

```
$ node bin/tmct.mjs viz --repo /tmp/r1 --limit abc --output /tmp/v1.html
tmct viz — wrote 688 fact row(s) around 'person' to /tmp/v1.html

$ node bin/tmct.mjs viz --repo /tmp/r1 --limit -5 --output /tmp/v2.html
tmct viz — wrote 683 fact row(s) around 'person' to /tmp/v2.html
showing 683 of 688 rows — narrow with --focus <term> or raise --limit
```

`--limit abc` is dropped, so you get every row and no warning. `--limit -5` drops the last five rows
and then advises you to raise the limit you never meant to set. `tmct syllogise` swallows a bad
`--depth` and a negative `--budget` the same way:

```
$ node bin/tmct.mjs syllogise --repo /tmp/r1 --depth abc
tmct syllogise — derived 50 entailed fact(s) (mode full, depth 32, budget 50) — budget reached, more available

$ node bin/tmct.mjs syllogise --repo /tmp/r1 --budget -1
tmct syllogise — derived 0 entailed fact(s) (mode full, depth 32, budget -1) — budget reached, more available
```

Every enum flag on the CLI already refuses a bad value by name (`--corpus`, `--persona-size`,
`--with-persona`, `--memory-backend`, `--render`, `--tools`). The numeric flags do not.

## 11. `play guess a number` mid-game offers to start the adventure

Rank: **medium**. Confidence: high. Fault is in `src/services/chat.mjs` — reported, not fixed.

```
$ lets play guess the number
Done — I've thought of a number between 1 and 100. Guess it, and I'll say higher, lower, or correct.
$ play guess a number
a guess-the-number game is active — say "I give up" to end it, then start the adventure.
```

The user asked for the game that is already running and was told to quit it and start a different
one. Also in this family: `guess a number` on its own does not start the game at all, and returns the
tmct self-description.

## 12. Game words still leak to the vocabulary lane

Rank: **medium**. Confidence: high. Fault is in `src/services/chat.mjs` — reported, not fixed.

The first hunt found this with `lower`, `watch` and `step`. The fix did not generalise. Mid-board in
spider-and-fly:

```
$ who is winning
I don't know "winning" yet — teach me directly, e.g. "winning is a <thing>" …
$ score
i learned: score is a kind of number (source: child:conceptnet:score)
$ stop
i learned: stop means the same as break (source: child:conceptnet:stop)
i learned: stop means the same as catch (source: child:conceptnet:stop)
```

`stop` is the sharpest: the game's own opener tells you to say "stop playing", so the bare word is
one keystroke from the documented exit. In the adventure, whose opener says `go north`, the bare
direction leaks too:

```
$ north
i learned: snow is found in north (source: child:conceptnet:north)
$ map
i learned: map is found in classroom (source: child:conceptnet:map)
i learned: map can be read (source: child:conceptnet:map)
```

## 13. `who is the president` answers with class facts

Rank: **medium**. Confidence: moderate that this is a fault.

```
$ who is the president
president is a kind of person (source: corpus:human /r/IsA)
president can lead (source: corpus:human /r/CapableOf)
president is found in country (source: corpus:human /r/AtLocation)
```

Every line is cited and true, so this is not a guess. It is also not an answer to the question asked,
and nothing in the reply says the store holds no office-holder. The sibling shapes handle this
better: `what is 2 + 2` gets "I don't do arithmetic — I answer questions about a code graph or
taught facts", which names the gap and stops.

## 14. `tmct extend --validate` on a missing directory blames its `tmct.toml`

Rank: **cosmetic**. Confidence: high.

```
$ node bin/tmct.mjs extend --validate /nonexistent/dir
tmct extend --validate: no host-declared [extensions.*] entries found in /nonexistent/dir/tmct.toml
```

The directory is not there. The message describes a file inside it as if it had been read and found
wanting.

## 15. Two write paths surface a raw Node error

Rank: **cosmetic**. Confidence: high.

```
$ node bin/tmct.mjs memory --export /nonexistent/d/out.jsonl --repo /tmp/r1
tmct: ENOENT: no such file or directory, open '/nonexistent/d/out.jsonl'

$ node bin/tmct.mjs extract /tmp/defs.txt --out /nonexistent/d/o.jsonl
tmct: ENOENT: no such file or directory, open '/nonexistent/d/o.jsonl'
```

Both exit 1 with the message on stderr, which is right. The `ENOENT`/`syscall` shape is the raw Node
error the tool docblock says never reaches a caller. `tmct viz --output` and `chat --render --output`
do the same.

## 16. `GET /` advertises three tools out of twenty-eight

Rank: **cosmetic**. Confidence: low that this is a fault.

The endpoint's own self-description is how a tool-loop client discovers what tmct can back.

```
$ curl -s http://127.0.0.1:8799/ | …
{"service":"tmct","graph":"…/graph.json","tools":3}
```

`tmct plan --tools bogus` names seventeen registered capabilities, and `src/tools/handlers/` holds
twenty-eight. The hot/cold tiering is deliberate and documented at `src/tools/server.mjs:42-46`; the
cold tier stays reachable through `tmct cli <tool>` and `.tmct/TOOLS.md`. What the payload does not
do is say a second tier exists, so a client that declares only what it discovered can never propose a
cold tool through `/v1/messages`.

---

## What holds up

Listed so the weight of the faults above is readable against the rest of the surface.

**Every one of the first hunt's fifteen findings is fixed.** Re-tested individually. The retract lane
in particular is now solid across phrasings a person would actually type:

```
$ remember Mira is a baker
noted — remembered: mira is a kind of baker
$ forget Mira is a baker
noted — forgotten: "Mira is a kind of baker" is no longer stored.
$ is Mira a baker
I can't confirm that — I don't know "Mira" at all yet.
$ delete that Nils is a pilot
I hold nothing about "Nils", so there's nothing to forget.
$ unlearn that Nils is a pilot
"Nils is a kind of pilot" isn't stored, so there's nothing to forget.
```

**Plurals singularise on both sides.** `all wolves are mammals` stores `wolf subClassOf mammal`, and
the next turn confirms it. `remember cats are animals` and `remember a kestrel is a bird` both go
through the ACE lane and cite it.

**`--repo` is guarded on every verb that takes it.** `chat`, `memory`, `digest`, `plan`, `cli`,
`syllogise`, `viz` and `index` each refuse a missing path with exit 2, name it, and say nothing was
created. Nothing was.

**Hostile input.** An empty line, whitespace, `?`, `!!!`, a bare `/`, `/bogus`, a 4,000-character
line, `WHAT IS A DOG` in caps, `$(rm -rf /)` typed as a question, and `what is a 🐕` all handled
cleanly. The emoji gets a proper miss that names the term. Neither shell metacharacters nor length
caused a crash.

**Enum flags refuse by name, with the alternatives.** `--corpus`, `--ontology`, `--lexicon`,
`--persona-size`, `--with-persona`, `--memory-backend`, `--render` and `--tools` all exit 2, name the
bad value, and list what is available. No repo directory was scaffolded by any of the failed runs.

**HTTP protocol handling.** A missing `messages` key and a non-array `messages` both return 400 with
a typed error. An unknown route returns 404. `/v1/plan` with no `request` returns 400; with a real
request it returns the full grounded loop result, proof steps and `$0` usage. Malformed JSON returns
400 rather than a 500.

**`tmct import --file` reports declines precisely** and exits non-zero when one is present, naming
each declined sentence and the reason. The facts that did ground are readable by chat immediately.

**`tmct extract` explains its skips well now.** The first hunt's 5.3 is closed:

```
3 sentences found, 1 recognized as fact (1 fact row), 2 skipped …
Some of those skips were shapes I do read, held up by terms nothing grounds yet: "wombat",
"marsupial". Ground one side first (e.g. "every wombat is a thing") and re-run.
```

**The cold-tool route reads the graph fresh on every call**, which is why finding 2 shows up as a
disagreement rather than as two stale answers.

---

## Reproduction notes

Worktree setup before any of the above:

```
node scripts/ensure-worlds-pack.mjs
node scripts/ensure-sprite-facts.mjs
npm run build:ask-bundle
```

Every `/tmp/` path is a throwaway directory made with `tmct init`. Finding 2 needs the repo's
`graph.json` to change while the server is up; copying `examples/mini-webapp/.tmct/graph.json` over
it reproduces what `tmct index` would do. Finding 4 needs `chmod -R a-w` on the repo's `.tmct/`, and
the directory has to be made writable again before the next run.
