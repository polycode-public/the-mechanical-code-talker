tmct playtest 027 — an operator's have-fact and inversion session, replayed as findings
========================================================================================

tmct version under test: 5.0.35 (operator session f8137211, 2026-08-09 20:05:25)

Area: the teach/ask loop across have-facts ("how many X does Y have"), what-is inversions
("X is what"), modal property asks ("can X be Y"), and the ambiguity/what-is/define lanes on a
live unscripted session. Runs one number ahead of PLAYTEST_LOG_007 in the same family: another
operator session replayed verbatim, not a scripted probe sweep.

Axes explored: has-count round-trip on a taught fact across three subject/attribute pairs;
possessive and compound-noun asks; the backwards instance-as-class teach; relative-clause asks;
two-reading ambiguity; corpus IsA/HasProperty/UsedFor/CapableOf reads; a subject inversion
("X is what"); an adjective-qualified inversion; a define lane; and modal-versus-plain property
asks over the same fact.

The session, verbatim
----------------------

### turn 1 (20:05:25) — how many legs does a dog have
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 2 (20:05:33) — a dog has 4 legs
noted — remembered: dog has 4 legs

Goal (inferred): Teach/remember a new fact.

### turn 3 (20:05:52) — how many legs does a dog have
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 4 (20:06:03) — what is a dogs name
I don't know "dogs name" yet — teach me directly, e.g. "remember dogs name is a <thing>".

### turn 5 (20:06:11) — what is a name
A name is a repute. It is found in directory. It forms part of an identity. People use it for
identification. (sources: corpus:conceptnet, corpus:human) Say "show the facts" for all 17
stored facts.

### turn 6 (20:07:04) — what is a human name
I don't know "human name" yet — teach me directly, e.g. "remember human name is a <thing>".

### turn 7 (20:07:19) — what is a name you could give to a human
I don't know "name you could give to a human" yet — teach me directly (e.g. "remember <name> is
a <thing>").

### turn 8 (20:07:38) — a human name is john
I couldn't store that — I don't recognize "human name" and "john" as words I know. I remember
facts in the shape "every X is a Y", where X and Y are words I know. I don't know "human name" or
"john" yet. Try grounding each one first, e.g. "every human name is a thing" and "every john is a
thing", then re-teach the original fact. Type /memory to see what I already remember.

Goal (inferred): Teach/remember a new fact.

### turn 9 (20:08:35) — how many eyes does a human have
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 10 (20:08:43) — a human has two eyes
noted — remembered: human has two eyes

Goal (inferred): Teach/remember a new fact.

### turn 11 (20:09:32) — how many arms does a human have
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 12 (20:09:40) — a human has two arms
noted — remembered: human has two arms

Goal (inferred): Teach/remember a new fact.

### turn 13 (20:11:01) — how many legs does a person have
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 14 (20:11:07) — a person has two legs
noted — remembered: person has two legs

Goal (inferred): Teach/remember a new fact.

### turn 15 (20:11:21) — how many eyes does a human have
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 16 (20:13:21) — what is AI
ai, the artificial intelligence: ai is a kind of artificial intelligence → computer science →
engineering → room → area → body part (source: corpus:conceptnet /r/IsA)

ai, the sloth: ai is a kind of sloth → edentate → placental → mammal → vertebrate → chordate
(source: corpus:human-large /r/IsA)

### turn 17 (20:16:48) — what is a computer
A computer is an electronic device, and so a device, a design, and an arrangement. It is found in
building. It can arithmetic. It is used for calculating. (sources: corpus entries) Say "show the
facts" for all stored facts.

### turn 18 (20:17:47) — what is binary
binary is a kind of program → set of instructions (source: corpus:human-large /r/IsA)

### turn 19 (20:21:27) — which two numbers are binary
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 20 (20:22:29) — a dog is what
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 21 (20:22:35) — what is a dog
A dog is a four legged animal. It is found in backyard. It can bark. It helps with companionship.
(sources: corpus entries) Say "show the facts" for all 97 stored facts.

### turn 22 (20:22:45) — a female dog is what
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 23 (20:23:38) — define alive
Ten lines covering antonym, prerequisite, and property relations against "alive": its opposite
"dead", the prerequisite "breathe", and property lines against "animal", "animals", "flower",
"plant", "tabby cat", "tree", and "trees" (operator's own summary of the reply; the exact ten
lines were not captured verbatim).

Goal (inferred): Understand a vocabulary/definition term ("alive").

### turn 24 (20:23:54) — are animals alive
yes — animal is alive (source: corpus:conceptnet /r/HasProperty)

### turn 25 (20:31:24) — is a pig an animal
yes — pig is a kind of animal (source: corpus:human /r/IsA)

### turn 26 (20:31:29) — are pigs alive
I don't have a fact saying pig is alive.

### turn 27 (20:31:37) — pigs are alive
noted — remembered: pig is alive

Goal (inferred): Teach/remember a new fact.

### turn 28 (20:31:50) — can animals be alive
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

### turn 29 (20:32:03) — could an animal be alive
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary. (I don't
know that yet — you can teach me: say "remember: <thing> is a <kind>".)

Per-turn findings
------------------

**Turn 1** — honest miss, correct: nothing taught yet about dog legs.

**Turn 2** — teach lands and confirms. Correct.

**Turn 3** — same question as turn 1, asked right after turn 2 taught it. The fact is in memory
and the question still walls. This is the first reproduction of finding 1.

**Turn 4** — possessive subject ("dogs name") never grounds. Candidate, not queued.

**Turn 5** — corpus what-is lane working as designed: property, location, part-of, and use lines
with sources and a facts-count trailer.

**Turn 6** — compound noun ("human name") never grounds, same shape as turn 4's possessive.
Candidate, not queued.

**Turn 7** — a relative-clause ask ("a name you could give to a human") never reaches the what-is
lane. Candidate, not queued.

**Turn 8** — "a human name is john" is an instance-naming statement, but the teach parser reads it
as a class-to-class fact and asks the operator to ground both "human name" and "john" as things.
Following that suggestion literally would store "every john is a thing", a nonsense class fact.
Candidate, not queued, but the wrong-direction repair suggestion is worth folding in if this ever
gets picked up.

**Turn 9** — same canned miss text as turn 1, this time for a question that hasn't been taught
yet (eyes come at turn 10). The miss itself is honest, but the suggestion inside it ("what is a
dog") is generic and unrelated to the human/eyes subject just asked about. Clearest instance of
finding 4.

**Turn 10** — teach lands and confirms. Correct.

**Turn 11** — honest miss: arms haven't been taught yet. Correct behavior, same generic
suggestion text as finding 4.

**Turn 12** — teach lands and confirms. Correct.

**Turn 13** — honest miss: person's legs haven't been taught yet. Correct behavior.

**Turn 14** — teach lands and confirms. Correct.

**Turn 15** — repeats turn 9's exact question, four turns after turn 10 taught "human has two
eyes". The fact is in memory and the question still walls. Second, cleaner reproduction of
finding 1 (turn 3 repeated the same question right after teaching it; this one has intervening
turns in between, showing the fact isn't decaying with time, it's never being read by this
question shape).

**Turn 16** — two-reading ambiguity handled correctly, both senses cited with sources. Worth a
data-quality note, not a lane bug: the artificial-intelligence chain runs
"engineering → room → area → body part", which looks like corpus noise in the ConceptNet
IsA chain rather than a parse fault.

**Turn 17** — corpus what-is lane working as designed.

**Turn 18** — corpus IsA lane working as designed.

**Turn 19** — "which two numbers are binary" never grounds. Candidate, not queued.

**Turn 20** — "a dog is what" never reaches the what-is lane, even though "what is a dog" (turn
21) answers cleanly moments later. First instance of finding 2.

**Turn 21** — corpus what-is lane working as designed, confirms the same subject that turn 20's
inversion just missed.

**Turn 22** — "a female dog is what" never grounds either. Second instance of finding 2: the
inversion fails again, and on top of that, an honest system would fall back to the bare head noun
("dog") when the adjective-qualified phrase doesn't match, the way turn 21 already answers for
"dog" alone.

**Turn 23** — define lane working as designed (structure only; exact wording wasn't captured
verbatim, see the transcript note above).

**Turn 24** — HasProperty read on a class-level statement ("animals alive") lands correctly.

**Turn 25** — IsA read lands correctly.

**Turn 26** — "are pigs alive" honestly misses, and the miss line names the actual subject:
"I don't have a fact saying pig is alive." This is the good miss shape, worth contrasting with the
generic "what is a dog" suggestion seen everywhere else in this session (finding 4). It is not a
bug; it's what the miss text elsewhere should look like.

**Turn 27** — teach lands and confirms. Correct.

**Turn 28** — "can animals be alive" walls, even though turn 24 just answered the plain-indicative
form of the identical fact ("are animals alive"). First instance of finding 3.

**Turn 29** — "could an animal be alive" walls the same way, singular subject this time. Second
instance of finding 3, confirming the modal gap isn't specific to plural subjects.

Fix analysis
------------

QUEUED (a chat.mjs fix agent is working these concurrently):

1. **Taught have-facts don't round-trip through "how many X does Y have"** — turns 1-3 (dog legs)
   and 9-15 (human eyes, arms; person legs). Turn 2 teaches "dog has 4 legs" and turn 3 asks the
   identical question straight after: still a miss. Turn 10 teaches "human has two eyes" and turn
   15 asks the identical question four turns later: still a miss. The fact reaches memory (the
   teach confirms and later turns like 26/27 show reads working for other shapes); the have-count
   question just never reads it back. Both digit forms ("4 legs") and number words ("two eyes",
   "two arms", "two legs") show the same gap.

2. **"X is what" inversion never reaches the what-is lane** — turn 20 ("a dog is what") walls
   where turn 21's "what is a dog" answers cleanly on the same subject moments later. Turn 22 ("a
   female dog is what") repeats the gap on an adjective-qualified subject, and also needs an
   honest fallback to the bare head noun ("dog") when the qualified phrase itself isn't known,
   the way the plain noun already resolves.

3. **Modal property asks miss facts that the plain indicative reads** — turn 28 ("can animals be
   alive") and turn 29 ("could an animal be alive") both wall on a fact turn 24 ("are animals
   alive") just confirmed by reading the same HasProperty fact. The modal wrapper is blocking a
   read that would otherwise succeed.

4. **The ground-nothing miss hint always suggests "what is a dog" regardless of the asked
   subject** — every miss in this session (turns 1, 3, 9, 11, 13, 15, 19, 20, 22, 28, 29) carries
   the identical suggestion text no matter what was actually asked. Turn 9 is the clearest case:
   the question is about a human's eyes, and the hint still points at dogs. Turn 26's miss line
   ("I don't have a fact saying pig is alive") shows what a subject-aware version already looks
   like elsewhere in the product.

CANDIDATES (recorded, not queued):

- **Possessive subject never grounds** (turn 4: "what is a dogs name").
- **Compound noun never grounds** (turn 6: "what is a human name"), same shape as the possessive
  above.
- **Relative-clause ask never reaches the what-is lane** (turn 7: "what is a name you could give
  to a human").
- **The backwards instance-as-class teach** (turn 8: "a human name is john"). The teach parser
  reads an instance-naming statement as a class-to-class fact and offers a repair path that would
  store "every john is a thing" if followed literally. A design fix needs to recognize this shape
  as naming an individual, not two classes.
- **"which two numbers are binary" never grounds** (turn 19).

Worth a note, not a fix:

- Turn 26's miss line is the good miss shape (names the actual subject), a useful contrast against
  the generic "what is a dog" hint that finding 4 above is queued to fix.
- Turn 16's ConceptNet IsA chain for the "artificial intelligence" reading of "AI" runs
  "engineering → room → area → body part". This reads as corpus noise in the source data, not a
  parse or lane fault.
