# Playtest: the five areas the last pass skipped

Follows on from `reports/PLAYTEST_DEMO_PAGES.md`, which named five areas it did not cover. This
pass covers all five, against the deployed site (`https://tmct.polycode.co.uk`), driven with
Playwright at 1440x900/950. Screenshot paths are in this session's scratchpad
(`/private/tmp/claude-501/-Users-antony-projects-polycode-projects-the-mechanical-code-talker/12eccc48-39ea-4605-b40c-6b822295c540/scratchpad/t57/shots/`),
shortened below to `shots/`.

Two of the five areas found nothing wrong — the p2p handshake past the invite, and every file
upload path. One area found one real, reproducible bug. The other two areas confirmed existing,
already-documented behaviour rather than turning up anything new.

---

## Worst three findings

1. **Document mode's own header never says a typed fact was typed.** The label freezes on
   "drop or browse for a file" even after you type real text and it ingests successfully.
2. Nothing else rose to the level of a real fault. The p2p handshake, teach replication,
   retraction propagation, and all four file-upload paths worked exactly as promised.
3. (No third finding — see "What worked" below for the full account of what this pass checked
   and found clean.)

---

## 1. Document mode's stuck source label

**What I did.** On ingest.html, clicked the **Document** mode pill, then typed
`Florps are a kind of plant.` directly into the textarea (no file, no browse) and clicked
**ingest**.

**What happened.** The ingest itself worked: `1 sentence read, 1 grounded, 0 skipped`, and the
fact (`florp rdfs:subClassOf plant`) landed correctly with a clean `teach:chat:...` citation. But
the header label above the textarea, which should describe where the current input came from,
still reads `drop or browse for a file` — the same string it showed before I typed anything.
Screenshot: `shots/ingest-document-typed.png`.

**What I expected.** The label to read `pasted text`, the same string Text mode shows for typed
input.

**Where it sits.** `src/services/ingest-viz.mjs:336-340`:

```js
sourceEl.addEventListener("input", () => {
  // Typing or pasting makes this "pasted text" again, not a named file.
  if (srcLabel.textContent !== "pasted text") { sourceTag = "pasted text"; }
  updateIngestEnabled();
});
```

This sets the `sourceTag` variable but never writes it back to `srcLabel.textContent`. In Text
mode the bug is invisible, because `setMode(false)` separately reassigns
`srcLabel.textContent = sourceTag` whenever you switch modes. In Document mode nothing ever
calls that line again, so the label is stuck at whatever `setMode(true)` last wrote
(`"drop or browse for a file"`, or a stale filename if you'd loaded one earlier) no matter what
you type afterward.

**How bad.** Moderate. The ingest and the provenance are both correct — this is a display bug,
not a data bug — but it sits right above the box you're typing into and keeps telling you no
text has been provided while your typed text sits visibly below it and gets used anyway. A
visitor who trusts the label over their own eyes could believe typing here does nothing.

---

## 2. The p2p handshake past minting the invite — nothing wrong found

**What I did.** Two browser contexts against chat.html. Minted an invite on one (the inviter),
opened the link on the other (the joiner), exchanged the reply, and confirmed both sides reached
`connected`. Then: asked the joiner an unknown term (`what is a zorbnug`) before any teaching,
taught the fact on the inviter (`every zorbnug is a dog`), asked the joiner again, retracted the
fact on the inviter (`forget that zorbnug is a dog`), waited for the wire to carry it, and asked
the joiner a third time.

**What happened, in order:**

| step | side | result |
| --- | --- | --- |
| before teaching | joiner | `I don't know "zorbnug" yet — teach me directly...` |
| teach | inviter | `noted — remembered: zorbnug is a kind of dog` |
| after teach | joiner | `i learned: zorbnug is a kind of dog → animal → ... (source: teach:peer:<inviter-node>@...)` |
| retract | inviter | `noted — forgotten: "zorbnug is a kind of dog" is no longer stored.` |
| after retract | joiner | `I don't know "zorbnug" yet — teach me directly...` (reverted to the original miss) |

Both sides reported zero console errors throughout. Screenshots:
`shots/p2p-connected-inviter.png`, `shots/p2p-connected-joiner.png`,
`shots/p2p-joiner-after-teach.png`, `shots/p2p-inviter-after-retract.png`,
`shots/p2p-joiner-after-retract.png`.

**What I expected.** Exactly this: a fact taught on one side reaches the other with correct
provenance, and a retraction on one side reverts the other side's answer back to an honest miss.

**How bad.** Not a finding. This is the area the previous playtest most needed covered, since it
carries the retraction-propagates claim nobody had driven before, and it held on the first real
run.

---

## 3. File upload paths — nothing wrong found

**What I did.** Checked every page that offers a file input, not just ingest.html:
`ingest.html` (`#fileInput`, gated behind the Document mode pill), `research.html`
(`#ingestFile`, always visible in the "ingest documents" panel), `ledger.html` (`#ingestFile`,
behind the "ingest text..." toggle), and `chat.html` (`#ingestInput`, in the composer dock). All
four uploaded the same small sample file
(`Zorbles are a kind of animal. Zorbles are closely connected with wodgetry.`) and, where the
page has a separate ingest button, clicked it.

**What happened.** All four loaded the file's text and ingested it correctly:

| page | result |
| --- | --- |
| ingest.html | `2 sentences read, 2 grounded, 0 skipped` |
| research.html | `2 sentences read, 2 grounded, 0 skipped.` |
| ledger.html | `2 sentences, 2 added` |
| chat.html | `ingested sample-upload.txt — 2 sentences read, 2 facts added.` |

Screenshots: `shots/upload-ingest-document.png`, `shots/upload-research-2.png`,
`shots/upload-ledger-2.png`, `shots/upload-chat.png`.

**One thing worth noting, not a new bug.** All four runs stored the two facts as
`zorble rdfs:subClassOf animal` and `zorbles mgx:connected-with wodgetry` — the same
singular/plural split `PLAYTEST_DEMO_PAGES.md` already filed as F20 against ingest.html's paste
path. This confirms the same recognizer quirk reaches every ingest surface, file upload included,
not just the paste box. Filed there already; not re-filed here.

**How bad.** Not a finding beyond the already-filed F20. Every file-upload affordance on the site
works.

---

## 4. The four sprite group pages — nothing new wrong found

**What I did.** Loaded `sprites-adventure-props.html`, `sprites-person-roles.html`,
`sprites-objects.html` and `sprites-emotions.html` directly (not via the sprites.html landing
page). On each: counted cards, checked console errors, used the ask dock's own first quick-
question pill, and filtered the catalog by a class name that belongs to a *different* group than
the one the page shows.

**What happened.**

| page | cards | console errors | dock pill | cross-group filter |
| --- | --: | --: | --- | --- |
| sprites-adventure-props.html | 23 | 0 | answered correctly | 0 cards (correct — that term lives on another page) |
| sprites-person-roles.html | 57 | 0 | answered correctly | 0 cards (correct) |
| sprites-objects.html | 130 | 0 | answered correctly | 0 cards (correct) |
| sprites-emotions.html | 20 | 0 | answered correctly | 0 cards (correct) |

The dock pill (`what parameters does a person sprite take?`) answered identically and correctly
on all four pages: `person sprite takes parameter emotion (source: corpus:sprites)`. Filtering
by an own-page class name (checked separately, e.g. `adventurer` on the adventure-props page)
returns exactly one matching card, so the filter itself works correctly here — unlike
`sprites.html`'s landing-page filter (already filed as F15), these per-group pages render their
whole group up front, so there is no preview-vs-filter mismatch to trigger. Screenshots:
`shots/sprite-group-sprites-adventure-props.png`, `shots/sprite-group-sprites-person-roles.png`,
`shots/sprite-group-sprites-objects.png`, `shots/sprite-group-sprites-emotions.png`, plus one
filter screenshot per page.

**One thing confirmed, not new.** `sprites-adventure-props.html` carries the same "describe a
scene" compose box as the landing page (shared code, `src/services/sprite-catalog-viz.mjs`).
Typing the landing page's own broken example, `red lamp, a doctor with a hat, and a cabinet`,
reproduces the exact same fault already filed as F14: lamp and cabinet both draw as the generic
black four-legged fallback, even though this page's own card grid shows `lamp` and `cabinet`
rendering correctly in every other context (their catalog swatches: gold/metal/ceramic/glass
lamp, wood/metal cabinet). Screenshot: `shots/sprite-group-compose-check.png`. Same bug, same
shared module, not re-filed as new.

**How bad.** No new finding. The four group pages are in the same shape as the landing page:
clean navigation, working dock, working own-group filter, and the one already-known compose bug
inherited from shared code.

---

## 5. Reduced-motion behaviour — confirms the documented design, no fault found

**What I did.** Loaded `mud.html`, `mudiii.html`, `spider-fly.html`, `plan.html` and
`ledger.html` twice each, once with Playwright's `reducedMotion: 'reduce'` context option and
once with `'no-preference'`, and compared the auto-play state and a screenshot from each.

**What happened.**

| page | normal-motion state | reduced-motion state |
| --- | --- | --- |
| mud.html | paused at turn 0 (never auto-plays) | paused at turn 0 (same) |
| mudiii.html | **auto-playing**, turn 16 after 2s, "⏸ pause" shown | **paused** at turn 0, "▶ play" shown |
| spider-fly.html | paused at turn 0 (never auto-plays) | paused at turn 0 (same) |
| plan.html | paused, "▶ play" shown | paused, "▶ play" shown (identical screenshot) |
| ledger.html | no play control on this page | (same) |

`mudiii.html` is the one page in this set that auto-starts under normal motion, and it is also
the one page where reduced motion visibly changes anything: the board stays on its opening frame
and the toggle reads `aria-pressed="false"` instead of `"true"`. That is exactly what the
source comment at `src/services/mudiii-viz.mjs:1683` describes: "reduced motion gets the opening
board drawn and left still — the play button covers them too." Screenshots:
`shots/motion-mudiii-normal.png`, `shots/motion-mudiii-reduce.png`.

The other four pages showed no difference between the two motion settings, because none of them
auto-play regardless of the setting (`mud.html` and `spider-fly.html` both start paused by
design — `PLAYTEST_DEMO_PAGES.md` already noted mud.html starts paused) or because the page
carries no play control to begin with (`ledger.html`; its own reduced-motion CSS rule at
`src/services/ledger-viz.mjs:778` only affects a meter transition, not anything this check could
see in a static screenshot).

**How bad.** Not a finding. The one page that auto-plays honours reduced motion exactly as its
own code comment says it should; the pages that never auto-play have nothing for reduced motion
to change.

---

## What worked, summarized

- p2p: invite → join → connect → teach → replicate → retract → un-replicate, all correct, zero
  console errors either side.
- File upload: all four upload surfaces (ingest, research, ledger, chat) load and ingest a file
  correctly.
- Sprite group pages: all four render, filter their own classes correctly, and answer their dock
  questions correctly.
- Reduced motion: the one auto-playing page (mudiii.html) suppresses its autoplay exactly as
  documented; the rest have nothing to suppress.

## What I left out

- I did not drive a three-peer mesh or a disconnect/rejoin scenario for p2p — the task named a
  two-browser handshake plus retraction, which this covers; the heavier multi-peer scenarios
  already have dedicated e2e coverage (`test-e2e/p2p-mesh-three-peers.test.mjs`,
  `test-e2e/p2p-disconnect-rejoin.test.mjs`).
- I did not re-test the sprite compose bug (F14) as a new finding on the group pages — it is the
  same shared module already filed against sprites.html, confirmed here only to establish scope.
- I did not fix anything. This is a measurement pass; the page files are owned by other tracks.

## Count

One new finding (the Document-mode source label). Four of the five assigned areas turned up
nothing wrong beyond what was already filed.
