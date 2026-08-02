# Playtest: the eleven demo pages and their about pages

A curious-visitor pass over the whole site. Built with `npm run demo:build` (version 5.0.5), served
from `public/` over a local static server, driven with Playwright at 1440x950, 375x667, 812x375 and
1920x1080.

Findings are grouped by page, worst first inside each group, and the groups run roughly in the order
a first-time visitor meets them.

Screenshot paths are in this session's scratchpad
(`/private/tmp/claude-501/-Users-antony-projects-polycode-projects-the-mechanical-code-talker/12eccc48-39ea-4605-b40c-6b822295c540/scratchpad/t40/shots/`),
shortened below to `shots/`.

---

## The three worst

1. **A common question freezes the tab for 17 minutes** on chat.html, ingest.html, research.html and
   code.html.
2. **Every chat pill on mudiii.html is dead**, and so is the page's own placeholder sentence.
3. **Four about pages scroll sideways on a 375px phone**, clipping the headline and the body text.

---

## Whole-engine: a question that locks the tab

### F1. "who is the president of France" freezes the page for 17 minutes

**What I did.** Opened chat.html, waited for the boot banner, typed `who is the president of France`
and pressed Enter.

**What happened.** The tab stopped responding. Nothing scrolled, nothing typed, and the keypress
itself did not return for **1054 seconds**. After 17.5 minutes it printed one line:

```
I don't know a relation or rule called 'president' yet.
```

**What I expected.** That refusal, in under a second. The answer is right. The wait is not.

**Which pages.** I asked the same question on seven pages:

| page | result |
|---|---|
| chat.html | blocked (1054s measured to completion) |
| ingest.html | blocked (>45s, >300s on a second run) |
| research.html | blocked (>45s) |
| code.html | blocked on `what is the capital of Peru` (>30s) |
| index.html | answered, 123ms |
| ledger.html | answered, 259ms |
| sprites.html | answered, 580ms |

The pages that block are the ones that load the 63,470-fact seed. The three that answer run over a
much smaller graph.

**Which phrasings.** Tested one question per fresh page load on ingest.html, 45s budget:

| question | result |
|---|---|
| who is the president of France | blocked |
| who is the president of france | blocked |
| who is the president of Spain | blocked |
| who is the queen of England | blocked |
| who is the king of France | blocked |
| what is the capital of Peru | blocked |
| what is the capital of France | blocked |
| what is the colour of the sky | blocked |
| who is the president | answered, 5.0s |
| the president of France | answered, 3.3s |
| the capital of Peru | answered, 3.8s |
| what is the capital | answered, 5.0s |
| how tall is the Eiffel Tower | answered, 3.7s |
| who is the prime minister of Belgium | answered, 4.2s |
| what is a quokka | answered, 4.5s |
| who is Napoleon | answered, 3.5s |

The shape that blocks is `<wh> is the <one-word relation> of <thing>`. Drop the `wh` lead or the
`of <thing>` tail and it answers normally.

**Where it sits.** A CDP CPU profile over 60 seconds of the freeze puts 99% of self time in one
function: `findIsaChain` (`src/domain/syllogise.mjs:1715`), reached from `relationFactsFor` in
`src/services/chat.mjs:9141-9156`. That helper walks all 63,470 fact rows and runs a bounded
breadth-first search per row, and it is handed to `resolveRelationChase`
(`src/services/chat.mjs:9180`) as the per-hop edge lookup, so the walk repeats. The same helper is
built again in the reverse "who is the X of Y" block at `src/services/chat.mjs:9207` onwards, which
is the block my question actually lands in.

**How bad.** The worst thing on the site. It is a plain English question, on the flagship chat page,
and the page becomes unusable. A visitor closes the tab long before the refusal arrives, and what
they take away is that the demo hung.

---

## index.html — the home page

Everything structural is sound. The boot theatre runs, the five history turns replay, the live
question is computed in-page, all 22 relative links resolve, the share sheet opens, the
`index.html?q=what%20calls%20Task` deep link primes and answers correctly, no console errors, and no
horizontal overflow at any of the three viewports.

### F2. The page advertises `/help` and refuses it

**What I did.** Read the boot line the page prints for itself: `ask a question, or /help for
commands — running live, client-side, no server`. Typed `/help` into the box below it.

**What happened.**

```
couldn't parse this as a graph question. Try: "which <functions|classes|modules>
<imports|calls|uses|inherits from|tests> <name>" or "what does <name> <import|call|export>" …
```

Roughly 100 words of query-shape advice.

**What I expected.** A command list, or no mention of `/help` in the banner.

**Where it sits.** The banner is `public/demo-ui.mjs:126`. `demo-ui.mjs` has no slash-command
handling at all — `askAndRender` passes the line straight to `askBrowser`.

**How bad.** A dead affordance the page itself puts in front of you, in the first three lines you
read. Cheap to fix either way: wire it, or cut the words from the banner.

### F3. The page's own transcript suggests `describe Task`, which it cannot parse

**What I did.** Read the replayed history, which ends with:

```
tmct> what is a Task?
Task is a class in this codebase, found in src/core/model.mjs — try "describe Task" or
"which classes inherit from Task".
```

Typed `describe Task`.

**What happened.** The same 100-word parse wall as F2.

**What I expected.** What code.html gives for the same words: a full symbol card with attributes and
edges. `describe Task` works there.

**Where it sits.** The hint text is built in `src/domain/ask.mjs:1463`. It is correct for the code
explorer, which handles a bare `describe`, and wrong for the home page's lane, which does not. The
line is also frozen into `public/demo-ui.mjs:37` as part of the replayed history, so it is on screen
before anyone types.

**How bad.** Serious. The page tells you what to type next and then refuses it. Screenshot:
`shots/home-describe.png`.

### F4. The other suggestion answers, then gives advice about commits

**What I did.** Typed the second half of that same hint: `which classes inherit from Task`.

**What happened.**

```
No classes found whose module directly inherits Task. Try "who touched <a module that actually
has commits>" or "/describe <module>" to see what's in the index.
```

**What I expected.** The "no classes" part is right — nothing inherits Task in the demo graph. The
follow-up advice is about commit history, which has nothing to do with what I asked, and it offers
`/describe`, which this surface also cannot run (see F2).

**Where it sits.** `src/domain/ask.mjs:2497` builds that follow-up string.

**How bad.** Moderate. The answer is grounded; the advice attached to it is off-topic.

### F5. The share sheet says five posts and shows six

**What I did.** Clicked **Share Natural Language Understanding** on the first demo card.

**What happened.** The sheet's subtitle reads "Five ways to post about it." Below it are six posts,
six links, and six pairs of Copy buttons.

**Where it sits.** The string is hardcoded at `public/share.mjs:216`. Counting `angle:` entries per
demo in the same file: chat 6, spider-fly 5, plan 5, adventure 6, ledger 5, code 5, ingest 5,
sprites 5, research 5, mud 5, mudiii 6. Three of eleven sheets contradict their own subtitle.

**How bad.** Cosmetic, but it is a number in a shop window that a reader can check in two seconds.
Screenshot: `shots/home-share-sheet.png`.

---

## mudiii.html — every chat pill is dead

### F6. All seven pills refuse

**What I did.** Paused the sim, then clicked each pill in the chat rail in turn.

**What happened.**

| pill | reply |
|---|---|
| `look` | `response templates unavailable — ask a question, or /help for commands.` |
| `@fox-1 look` | `I heard you address the fox but couldn't read a position from that — try "@fox the goblin is east"…` |
| `@fox-2 look` | same |
| `@goblin-1 look` | `I heard you address the goblin but couldn't read a position from that — try "@goblin the goblin is east"…` |
| `@goblin-3 look` | same |
| `@goblin-4 look` | same |
| `@goblin-5 look` | same |

Seven pills, seven refusals. The eighth control, `PLACE FOOD`, is a world toggle rather than a chat
line and does work (`aria-pressed` flips false to true).

**What I expected.** A pill the page offers should produce an answer.

**Where it sits.** `renderChatPills` at `src/services/mudiii-viz.mjs:1001-1013` builds the rail as
exactly `look` plus `@<id> look` per agent. Nothing in the mudiii turn grammar accepts either shape.

**How bad.** The worst page-level fault on the site. The chat rail is the page's main written
affordance and none of it works. Screenshot of the log: `shots/mudiii-chatlog.png`.

### F7. The page's placeholder is one of the refused sentences

**What I did.** Read the chat box placeholder: `@fox-1 look`. Typed it.

**What happened.** `I heard you address the fox but couldn't read a position from that`.

**Where it sits.** `src/services/mudiii-viz.mjs:590` sets that placeholder.

**How bad.** Same family as F6, and it is the very first thing the input field tells you to type.

### F8. The refusal tells you to tell a goblin where the goblin is

**What I did.** Addressed a goblin with anything unparseable, e.g. `@goblin-1 look`.

**What happened.**

```
I heard you address the goblin but couldn't read a position from that — try "@goblin the goblin
is east" or "@goblin the goblin is at cell-7-3".
```

**What I expected.** The suggestion should name something the goblin cares about — the fox, or a
crumb. Telling a goblin where itself is means nothing.

**Where it sits.** `src/services/mudiii-turn.mjs:973` hardcodes `the goblin` as the subject of the
suggested sentence regardless of who is addressed. The spider-fly sibling at
`src/services/spider-fly-turn.mjs:632` has the same shape, and there it happens to read correctly
because the addressee kinds and the subject differ.

**How bad.** Moderate. It makes the refusal useless as guidance.

### F9. The pill rail is hard to click while the sim runs

**What I did.** With the sim playing, tried to click a pill. A MutationObserver on the rail's parent
counted the churn.

**What happened.** 133 node additions/removals in 5 seconds. Playwright retried a click 26 times over
30 seconds and never landed one — the element detached mid-click every time. Pausing the sim first
makes the pills clickable.

**Where it sits.** `renderChatPills` sets `el("chatPills").innerHTML = …`
(`src/services/mudiii-viz.mjs:1005`), replacing every button node. It is called from `renderAll`
(`src/services/mudiii-viz.mjs:1303`), which runs every tick.

**How bad.** Real for a touch user, who has a moving target under their finger. Less visible than F6
only because the pills do nothing useful anyway.

### F10. `/help` prints the code explorer's command list

**What I did.** Typed `/help` on the town-square page.

**What happened.** A wall of text about `/context <symbol>`, `/snippet <symbol>`, `/ingest <path>`,
`tmct memory --export`, commit queries and module listings. None of it is about foxes, goblins or
cells.

**How bad.** Moderate. It is at least a real command list, but it belongs to a different product
surface. Screenshot: `shots/mudiii-chatlog.png`.

### Also noticed

The overhead map draws agents as plain coloured dots on a flat green field, and the whole left half
of the deck panel is empty beige at 1440 wide. Screenshot: `shots/mudiii-pills.png`. The missing
goblin render is already a known item, so I am recording the empty panel only as an observation.

---

## The about pages at 375px

### F11. Four of the eleven about pages scroll sideways on a phone

**What I did.** Loaded each about page at 375x667 with touch emulation and compared
`document.documentElement.scrollWidth` against `clientWidth`.

**What happened.**

| page | document scroll width |
|---|---|
| chat-about.html | 581px |
| plan-about.html | 507px |
| research-about.html | 711px |
| mud-about.html | 557px |

The other seven are exactly 375. On the four that overflow, the h1 and every paragraph run off the
right edge: research-about's headline reads "Search backed knowledge b" and stops.

**What I expected.** No horizontal scroll, and the headline on screen.

**Where it sits.** Each of the four has at least one `.factlist li` whose text is longer than the
viewport:

- chat-about: `rover  rdfs:subClassOf  dog          (source: ace:chat:<session>@<timestamp>)` — 542px
- plan-about: `disk-1  mgx:smaller-than  disk-2` — 468px
- research-about: `polar bear — <summary> (source: research article "Polar bear", Simple English…` — 672px
- mud-about: `mole-1  mgx:knows-about  carrot   (source: mud:mole-1:epoch1:turn2)` — 518px

`public/site.css:507-512` gives `.factlist li` `white-space: nowrap` with `overflow-x: auto`, which
should scroll inside the row. It does not, because the phone media query at `public/site.css:513`
sets `.about-shell { grid-template-columns: 1fr }`. A bare `1fr` track takes its minimum from its
widest child's max-content width, so the nowrap row widens the whole grid instead of scrolling inside
itself. The desktop rule at `public/site.css:450` already uses `minmax(0, 1fr)`, which is the shape
the media query wants too.

**How bad.** High. Every phone visitor who opens one of these four reads a clipped page, and the site
is otherwise clean at that width. One CSS line fixes all four. Screenshots:
`shots/phone-research-about.png`, `shots/phone-chat-about.png`.

### The rest of the about-page navigation is correct

I walked every left-nav crumb, every Next button and every link on all eleven pages, and checked each
relative target with a HEAD request:

- 11 pages x 7 crumbs, every crumb resolves to a real section id, in the same order as the sections.
- 11 pages x 6 in-page Next links, every one lands on the section that follows it.
- Every last Next moves to the next demo's about page, in the home page's own order. mudiii's ends
  the chain with "Back to all eleven demos", which is right.
- Every "open `<demo>`.html" and "all eleven demos" link resolves.
- No broken relative links, no failed images.

---

## spider-fly.html

### F12. Clicking a second direction pill silently builds an unparseable sentence

**What I did.** Clicked `@spider`, then `the fly is north`, then `the fly is east`, then Enter — the
natural thing to do when a row of four options invites you to look at them.

**What happened.** The input read `@spider the fly is north the fly is east`, and submitting it gave:

```
I heard you address the spider but couldn't read a position from that — try "@spider the fly is
east" or "@spider the fly is at cell-7-3".
```

Clicking through all four directions builds `@fly the spider is north the spider is south the spider
is east the spider is west`.

**What I expected.** The second click replaces the claim. A direction pill is an alternative, not an
addition. The dynamic deception pills on the same page already replace
(`src/services/spider-fly-viz.mjs`, the `dyn-claim` branch), so the two rails behave differently.

**Where it sits.** `src/services/spider-fly-viz.mjs:1011-1020`. The handler appends:
`chatqEl.value = value.replace(/\s+$/, "") + " " + btn.textContent`.

**How bad.** High. One click works; two clicks quietly break the sentence with no visible warning,
and the refusal does not tell you why. Screenshot: `shots/spider-pill-append.png`.

### F13. An unknown addressee falls through to code-graph advice

**What I did.** Typed `@wombat the fly is east`.

**What happened.**

```
couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls
<name>". Type /help for all query shapes.
(I don't know that yet — you can teach me: say "remember: <thing> is a <kind>".)
```

**What I expected.** Something about the board, e.g. that there is no wombat on it.

**How bad.** Moderate. It refuses rather than guessing, so the promise holds, but "which modules
import" on a board-game page reads like a different program answered.

### Working

`@spider the fly is east` and `@fly the spider is at cell-9-9` both land, move the pieces and print
the belief lines. `where is the fly` and `what is a spider` both answer with sources.
`@spider what is the capital of Peru` refuses cleanly.

---

## sprites.html

### F14. Two of the four items in the page's own placeholder draw as the wrong thing

**What I did.** Typed the page's own placeholder sentence into the compose box: `red lamp, a doctor
with a hat, and a cabinet`.

**What happened.** Four sprites appeared, labelled lamp, doctor, hat, cabinet. The doctor and the hat
are drawn correctly. **The lamp and the cabinet are both drawn as a black four-legged animal** — the
taxonomy-root fallback. The word "red" is dropped.

**What I expected.** A lamp and a cabinet. `data/sprites/lamp-icon.toml` and
`data/sprites/cabinet-icon.toml` both exist, so the shapes are in the library and the compose lane is
not reaching them.

**How bad.** High. It is the page's own suggested sentence, it is the first thing anyone types, and
half the result is visibly wrong on a page whose whole subject is drawing the right shape.
Screenshot: `shots/sprites-scene-zoom.png`.

The same fallback fires for `a purple wombat riding a bicycle`, which yields one sprite labelled
"bicycle" drawn as the same animal, with "purple" and "wombat" dropped entirely. Screenshot:
`shots/sprites-scene-wombat.png`.

### F15. The catalog filter finds nothing for the page's own vocabulary

**What I did.** Typed terms into "filter by class or group…".

**What happened.**

| filter | result |
|---|---|
| (none) | 28 cards |
| `lamp` | 0 / 28, catalog blank |
| `cabinet` | 0 / 28, catalog blank |
| `doctor` | 0 / 28, catalog blank |
| `person` | 9 / 28 |
| `adventurer` | 1 / 28 |
| `zzzz` | 0 / 28 |

`lamp`, `cabinet` and `doctor` are all compose pills on the same page, one panel above.

**What I expected.** Either the matching cards, or a line saying the class lives on one of the four
group pages. The footer reads "230 classes · 1447 swatches" while the filter counts against 28.

**Where it sits.** This page renders a 28-card preview and links out to `sprites-adventure-props.html`,
`sprites-person-roles.html`, `sprites-objects.html` and `sprites-emotions.html`. The filter searches
only what is rendered.

**How bad.** Moderate. Not a broken filter so much as a filter that looks broken, because the empty
state gives no clue that the class exists elsewhere. Screenshot: `shots/sprites-catalog-lamp2.png`.

### F16. A sprite question is answered in code-index language

**What I did.** Asked the dock the sheepdog question the about page works through in detail:
`what sprite does a sheepdog use`.

**What happened.**

```
no module matching "sprite sheepdog" found in the index. "sheepdog" names nothing here, and
reading past it would answer a different question. Did you mean adult sprite, adventurer sprite,
airport sprite and anger sprite?
Goal (inferred): Understand a dependency/usage relationship (imports and/or calls).
Canonical: what "sprite sheepdog" itself uses — forward(uses, "sprite sheepdog")
```

**What I expected.** Either the ancestor walk the about page describes, or a refusal phrased in
sprite terms. "module", "index" and "imports and/or calls" say nothing true about a sprite library.

**How bad.** Moderate. It refuses, so nothing is guessed, but the wording is from another surface.

### Working

All five dock pills answer with cited facts: person parameters, person emotions, cabinet materials,
`230 sprite classes.`, and the portrait sprite card. `what is a poodle` refuses cleanly. `who won the
1998 world cup` refuses.

---

## mud.html

### F17. The "what do you know about food" pill is empty until you press PLAY

**What I did.** Loaded the page, which starts paused, and clicked the second pill in window A:
`what do you know about food`. Then played properly and asked again after each of: `look` in a room
holding a carrot, `examine the carrot`, `take carrot`, `talk to mole-1`.

**What happened.** Every time: `you don't know of any food yet.` The carrot was in the room, then in
my hands, and the answer never changed.

Pressing **PLAY** and letting the sim run 30 seconds fixes it — the same question then lists fifteen
food items.

**What I expected.** Taking or examining a carrot should count as knowing about it, or the pill
should not be offered in a state where it can only answer empty.

**Where it sits.** The answer reads `mgx:knows-about` facts
(`src/services/adventure.mjs:2133-2152`). Those facts are written by `recordExamined` and
`recordTold`, and grepping the tree shows `recordExamined` is called only from
`src/services/mud-turn.mjs:426` and `:458` — the NPC tick loop. No player command writes one.

**How bad.** Moderate. The page loads paused, the pill is the second one on screen, and a visitor who
clicks it before pressing PLAY sees a flat empty answer and moves on.

### F18. `examine the carrot` answers "Carrot is a carrot."

**What I did.** Typed `examine the carrot` in the garden.

**What happened.**

```
Carrot is a carrot. Carrot is in the garden.
```

**What I expected.** Something the world actually records about a carrot — that it is food, that it
is portable, its mass.

**Where it sits.** `src/services/adventure.mjs:1895` calls `worldDigest` for the object and prints
whatever it composes. The self-referential line survives it.

**How bad.** Cosmetic, but it is the kind of sentence that undercuts a page selling grounded answers.

### Working

Both windows drive independently. All six affordance pills auto-submit and land: look, go down, go
east, talk to groundhog-1, take lettuce, and the wave. `dig north` opens a new den and narrates the
mouse who lives there. `go down` from a room with no down exit refuses. `eat the fox` gives "I don't
see a fox here."

---

## ingest.html

### F19. The about page describes a sample text the page does not ship

**What I did.** Read `ingest-about.html` section `#play`, which says: "The page's own sample text is
chosen to include a sentence that cannot ground. Here is what it does with it." Then opened
ingest.html.

**What happened.** The paste box is empty on load and the **ingest** button is disabled. There is
nothing to run. The Zorbles sample the about page quotes exists only in
`test-e2e/pages-ingest.test.mjs:80`.

**What I expected.** The box pre-filled with that sample, or the about page not claiming it.

**Where it sits.** `public/ingest-about.html:50`.

**How bad.** Moderate. It is the one page whose about text sends you to the demo expecting something
that is not there, and the disabled button gives a visitor nothing to click. Screenshot:
`shots/ingest-empty-on-load.png`.

### F20. One ingest run stores the same term under two spellings

**What I did.** Pasted the about page's sample by hand: `Zorbles are a kind of animal. How are you
today? Zorbles are closely connected with wodgetry.[7]` and clicked ingest.

**What happened.** The status line is right: `4 sentences read, 2 grounded, 2 skipped (not a
recognized fact shape, as expected)`. The two rows are not:

```
zorble    rdfs:subClassOf      animal
zorbles   mgx:connected-with   wodgetry
```

One row singularised, the other did not. The taught panel then lists both as separate terms.

**What I expected.** One subject. The about page quotes both rows as `zorble`.

**How bad.** Moderate. The two facts no longer join up, so asking about `zorble` misses the second
one. The e2e assertion at `test-e2e/pages-ingest.test.mjs:154-155` matches `/^zorbles?$/`, so it
passes either way and would not catch this drifting further. Screenshot: `shots/ingest-after.png`.

### Working

The status line, the fact rows, the source tally and the "forget everything" note all behave.
`what is a zorble` reads the taught fact back with its provenance. `what is a quokka` gives
`I can't ground that in what you've ingested. The kinds it holds: animal.` — a good refusal that says
what it does hold.

---

## ledger.html

### F21. A whole question becomes a focus breadcrumb

**What I did.** Typed `what is a dog` into the dock.

**What happened.** The answer is correct, three cited facts. The focus breadcrumb above the ledger
then reads:

```
peg  ›  what is a dog
```

**What I expected.** `peg › dog`. The crumb trail is a list of terms.

**How bad.** Cosmetic, but it is in the page's main navigation strip and it looks like a bug on
sight. Screenshot: `shots/ledger-crumb-sentence.png`.

### F22. "go to term…" says nothing about a term it does not have

**What I did.** Typed `zzzznonexistentzzz` into the "go to term… (enter)" box and pressed Enter.

**What happened.** Nothing. No message, no change, no crumb.

**What I expected.** A one-line miss. This is the honest-miss product; a silent no-op is the one
response that says nothing.

**How bad.** Moderate. Screenshot: `shots/ledger-unknown-term.png`.

### F23. The document title never updates

**What I did.** Loaded the page (`tmct ledger — 29 facts (focus: peg)`), taught `blue is a peg`, and
watched the on-page total go 29 to 30 and the focus move to `blue`.

**What happened.** The browser tab still reads `tmct ledger — 29 facts (focus: peg)`.

**How bad.** Cosmetic.

### F24. A toggled source filter keeps its "off" class and loses its dot

**What I did.** Clicked the "you taught" segment in the WHO SAYS SO filter.

**What happened.** It turns green and `aria-pressed` becomes true, but the class list is
`seg on c-taught off` — both states at once — and the coloured dot disappears while the two
unselected rows keep theirs.

**How bad.** Cosmetic. Screenshots: `shots/ledger-seg-before.png`, `shots/ledger-seg-after.png`.

### Working

Teaching through the dock updates the total and moves the focus card. `what is a blue` reads the
taught fact back. `what is a quokka` refuses. `go to term` for a real term (`disk-1`) works.

---

## plan.html

### F25. The board box answers a board question with code-graph advice

**What I did.** Typed `which disk is on peg-c` into the board box, whose placeholder is `list the
locations of disks`.

**What happened.** The same 100-word code-graph parse wall as F2, on a page about three pegs and
three disks.

**What I expected.** Either the disks on peg-c, or a refusal phrased in board terms.

**How bad.** Moderate. It refuses rather than guessing, but the guidance is from another surface, and
"which disk is on peg-c" is a very natural next question after the pill that lists disk locations.

### F26. "how many moves are there?" answers "7 results."

**What I did.** Clicked the pill of that name and pressed Enter.

**What happened.** `7 results.` The number is right.

**What I expected.** "7 moves." The pill asked about moves.

**How bad.** Cosmetic.

### Working

Both chat pills land: `solve it.` returns the full seven-move plan with a because-line, and `what
moves are legal now?` lists two. The three board pills all answer. Teaching `disk-1 is smaller than
disk-4.` (the box's own placeholder) stores the fact, and asking it back cites the teach provenance.

### A note on pill behaviour across the site

Pills do two different things depending on the page. On mud.html, mudiii.html and the sprites dock
they submit on click. On index.html, spider-fly.html, plan.html, adventure.html and the sprites
compose box they only fill the input and wait for Enter. Neither is wrong, but a visitor who learns
one page learns the wrong lesson for the next. Worth a decision rather than a fix.

---

## adventure.html — nothing wrong found

All three pills work: `unlock cabinet` asks what to use it with, `examine desk` describes it and
names the lamp on it, `take lamp` takes it.

I replayed the whole fourteen-turn transcript the about page prints, from `look` through `take the
letter`, and every turn matched: the portrait refuses to be taken because it is fixed, opening it
reveals the key, the key unlocks the cabinet, the cabinet holds the letter. The housekeeper turned up
in the library on schedule.

Refusals are clean. `take the moon` gives "I don't see a moon here." `what is the capital of Peru`
gives "I don't know a relation or rule called 'capital' yet."

## code.html — nothing wrong found beyond F1

Every exchange the about page prints replays correctly, including the pronoun carry: `what talks to
store.mjs?` then `what calls it?`. `does myFile import logging` answers with the named edge.
`which modules import logging` and `which modules transitively import logging` differ by exactly the
one two-hop result. `who calls Router` refines up to the containing module rather than claiming
nothing calls it. `describe Task` returns the full symbol card — the same words index.html refuses
(F3).

## research.html — one data-quality note

Teach, ingest, research, digest and ask all work, and the scoping story the about page tells holds
up. `what is a quokka` gives `No grounded answer from any checked source. It abstains rather than
guess.` `digest zzzznonexistentzzz` refuses with no card. `digest florp` composes a paragraph over
the taught chain with a sources line.

One thing to note: after `research "owl"`, the recent-facts list shows

```
owl   rdfs:subClassOf   specialists night
```

which is a mis-parse of a sentence about owls being specialists in night hunting, sitting in the
page's own recent list where a visitor reads it. Not a bug in the page, but it is the extraction
quality on display.

## chat.html — nothing wrong found beyond F1

The boot banner reports its 63,470 starter facts. `what is a dog` answers with eight cited lines
across five corpora. `list facts` pages properly and offers "more". Teach, recall and proof all work:
`remember: Rover is a dog`, then `does Rover bark` chains through with both facts named, then `why`
expands it. `what is a quokka` refuses and offers to be taught. The invite overlay opens, mints an
offer and explains the WebRTC handshake.

One small thing: `who is the prime minister of Belgium` refuses with `I can't answer that as a code
question — no code graph is loaded in this session. Try "what is a dog" for general vocabulary.` It
is a refusal, and the suggestion is good, but it misfiles the question as a code question first.

---

## What I did not cover

- The p2p/WebRTC handshake past minting the invite. It needs two browsers.
- File upload paths (`ingest file`, `browse for a file…`).
- The four sprite group pages (`sprites-person-roles.html` and siblings). Only the eleven demo pages
  and eleven about pages were in scope.
- The `Document` mode on ingest.html.
- Any page under `prefers-reduced-motion`, which changes whether the sims auto-start.

## Count

26 findings. Three of them (F1, F6, F11) are the ones a visitor cannot work around. Four pages —
adventure.html, code.html, chat.html and research.html — are in good shape apart from the engine
freeze. The whole about-page navigation estate (11 pages, 77 crumbs, 77 Next links) is correct, and
no page has a console error or a layout overflow at 812x375 or 1920x1080.
