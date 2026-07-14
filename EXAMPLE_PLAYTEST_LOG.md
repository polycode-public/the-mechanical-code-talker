
tmct playtest
=============

Set up for the tests and orientation.

tmct: the-mechanical-code-talker

tmct uses symbolic AI which is a distinct set of techniques from LLMs we use
inference based on deductive reasoning applied to a knowledge base.
(LLMs use "machine learning" techniques to train weightings and match patterns.)
My theory is that the human world has been quantized in every examinable direction
lingusics has been studied for hundreds of years, and propositional logic
was defined 2300 years ago, therefore you can rationalise about the world
using language applied to classified data using logic.

Once oriented the goal is to find the edges where tmct can process a request
and what tips it over the edge to a preventable failure.

It's only worth doing a couple of examples (max 3) of each sentence structure
once an issue is found because the grammar rules are seperate from the lexicon.

You can also go here https://gitlab.com/polycode-projects/the-mechanical-code-talker clone the code locally have have
Cluade code code help you write queries and even suggest fixes. If interested sign up for https://gitlab.com and create
a 'fork' to play around in your own copy.

Claude said:
```txt
The weak link is "quantized in every examinable direction." Mature tooling (2,300-year-old propositional logic, 
centuries of linguistics) proves the instruments for classifying and reasoning about language are solid — it doesn't 
prove the world has actually been fully classified by them. Huge swaths of human experience resist clean categories: 
ambiguity, context-dependence, contradiction, vagueness. Notably, your own playtest methodology assumes this — the whole 
point is hunting for "the edges where tmct tips over into a preventable failure," and if the world really were quantized 
everywhere, there'd be no edges left to find.

The weaker version of the theory holds up fine, though, and it's the one that actually matters: for the large subset of 
the world that is well-classified — taxonomies, code structure, kinship, basic commonsense IsA/HasA/CapableOf facts — 
logic applied to that structure gives genuine, auditable reasoning, and that subset is bigger than skeptics assume. 
Today's bug is a good miniature of the real tension: isTaughtRow assumed a clean binary (taught vs. corpus-known), and 
the actual world handed it a fact that was legitimately both. The theory's right that quantization goes a long way; it's 
wrong that it goes all the way, and the interesting work — yours and tmct's — is mapping exactly where it stops.
```



Installation
------------

Prerequisite: https://nodejs.org/en/download

Install the latest version, ideally in a fresh folder from the command prompt:
```bash
node --version
npm --version
npm install @polycode-projects/the-mechanical-code-talker
cat package.json
npx tmct init --memory-backend sqlite
npx tmct --help
npx tmct chat
```
Also see: https://www.npmjs.com/package/@polycode-projects/the-mechanical-code-talker

Exmples
-------

Then chat at the `tmct>` prompt (queries):
```txt
tmct> what is a dog
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)

Goal (inferred): Understand a vocabulary/definition term ("dog").
exit
```

Then chat at the `tmct>` prompt (with teaching):
```txt
ahab is the father of john
john is the father of ishmael
a father is a kind of parent
remember that ahab is male
a grandparent is a parent of a parent
a grandfather is a grandparent who is male
```

Now ask the questions (using inferences):
```txt
is ahab a grandparent of ishmael
is ahab the grandfather of ishmael
who is the grandfather of ishmael
```

And capture the session log:
```txt
tmct> is ahab a grandparent of ishmael

yes — you told me: ahab fathers john

(source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:10:57.402Z | te
ach:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3442b@2026-07-14T00:32:55.318Z); father is a kind of parent (source: corpus:human /
r/IsA | ace:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:11:30.521Z | ace:chat:019f5e0a-61e4-7f59-9d0a-b2a475e34
42b@2026-07-14T00:33:19.676Z); you told me: john fathers ishmael (source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2
026-07-14T00:11:16.882Z | teach:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3442b@2026-07-14T00:33:07.560Z)

tmct> is ahab the grandfather of ishmael

yes — you told me: ahab fathers john

(source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:10:57.402Z | te
ach:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3442b@2026-07-14T00:32:55.318Z); father is a kind of parent (source: corpus:human /
r/IsA | ace:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:11:30.521Z | ace:chat:019f5e0a-61e4-7f59-9d0a-b2a475e34
42b@2026-07-14T00:33:19.676Z); you told me: john fathers ishmael (source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2
026-07-14T00:11:16.882Z | teach:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3442b@2026-07-14T00:33:07.560Z); you told me: ahab is m
ale (source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:11:43.718Z | teach:chat:019f5e0a-61e4-7f59-9d0a-
b2a475e3442b@2026-07-14T00:33:32.932Z)

tmct> who is the grandfather of ishmael

ahab — you told me: ahab fathers john

(source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:10:57.402Z | t
each:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3442b@2026-07-14T00:32:55.318Z); father is a kind of parent (source: corpus:human
/r/IsA | ace:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:11:30.521Z | ace:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3
442b@2026-07-14T00:33:19.676Z); you told me: john fathers ishmael (source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@
2026-07-14T00:11:16.882Z | teach:chat:019f5e0a-61e4-7f59-9d0a-b2a475e3442b@2026-07-14T00:33:07.560Z); you told me: ahab is
male (source: teach:chat:019f5df6-5766-7e82-9549-85e4e67d1b5a@2026-07-14T00:11:43.718Z | teach:chat:019f5e0a-61e4-7f59-9d0a
-b2a475e3442b@2026-07-14T00:33:32.932Z)

tmct>  
```

Visualisations
--------------

Generate a visualisation:
```bash
npx tmct viz
open graph.html
```

test: what is a horse
=====================

(This would be the whole document starting at the test name.)


Expectations
------------

(example)

Given this previous answer:

```log
tmct> what is a horse
horse is used for riding (source: corpus:human /r/UsedFor)
```

When the following prompts were entered:
```log
tmct> what can be used for riding
tmct> what is used for riding
tmct> what is for riding
```

Expected: a horse

Actual: No results

Result
------

Fail (example)


Play test session log
---------------------

(example)

```txt
tmct> what is a horse
horse is a kind of animal (source: corpus:human /r/IsA)
horse can run (source: corpus:human /r/CapableOf)
horse is used for riding (source: corpus:human /r/UsedFor)

Goal (inferred): Understand a vocabulary/definition term ("horse").

tmct> what can be used for riding
couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls <name>". Type /help for all query s
hapes.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mi
ni`; tmct doesn't index code itself.)

tmct> what is used for riding
still couldn't parse that — /help lists every query shape.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mi
ni`; tmct doesn't index code itself.)
I don't know "used for riding" yet — teach me directly (e.g. "remember <name> is an <thing>").

tmct> what is for riding
couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls <name>". Type /help for all query s
hapes.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mi
ni`; tmct doesn't index code itself.)
I don't know "for riding" yet — teach me directly, e.g. "remember for riding is a <thing>".

tmct> exit 
```

Retest
======


Retest result
-------------

Pass (example)


Retest session log
------------------

(example)

```txt
> @polycode-projects/the-mechanical-code-talker@1.8.20 chat
> node bin/tmct.mjs

tmct — starting…

tmct chat — /Users/antony/projects/polycode-projects/the-mechanical-code-talker — no code graph loaded — graph has no code ent
ities; the conversation is remembered to .tmct/graph.json — log /Users/antony/projects/polycode-projects/the-mechanical-code-t
alker/.tmct/session-019f5714-8433-73c4-bd48-9240311cec6f.log
for code structure, point me at a .tmct/graph.json with --repo <path> or try `npm run example:mini` (tmct reads graphs, it doe
sn't index code). Try "what is a dog" for general vocabulary.
pass --repo <path> to target a different repo
ask a question, or /help for commands (/stats for an overview) — /exit to leave

tmct> what is for riding
horse is used for riding (source: corpus:human /r/UsedFor)

tmct> what is used for riding
horse is used for riding (source: corpus:human /r/UsedFor)

tmct> what can be used for riding
horse is used for riding (source: corpus:human /r/UsedFor)
```

