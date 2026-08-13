# PLAN_WIKIDATA_BAND.md — the Wikidata-derived corpus band

Status: GATED — the dump is downloaded and nothing has been done with it. The gate
is an evidence question, stated in §2, and it is the operator's to answer. Until
then this plan holds the procedure and the numbers, and no load runs.

Sibling: `PLAN_WIKIPEDIA_BAND.md` (the `corpus:simplewiki-derived` band, still a
stub scope). The load mechanics here moved out of `PLAN_MEMORY_ROLLOUT.md` §4,
which now points at this file.

## 1. What is on disk

```
/Users/antony/tmct-dumps/wikidata-20260810-all.json.gz
155,457,882,747 bytes
completed 2026-08-13 05:02 BST, ~4.2 MB/s sustained
```

`bash scripts/resume-wikidata-dump.sh` fetched it and verifies the final byte
count; it resumes from any interruption, so a broken transfer costs only the
remainder.

Note this is the PINNED DATED dump, not `latest-all`. `PLAN_MEMORY_ROLLOUT.md` §4
described the target as `wikidata-latest-all.json.gz` at 155,314,703,515 bytes;
the dated file differs in both name and size. A dated dump is the right choice —
a band built from `latest` cannot be rebuilt identically once the dump rolls, and
the corpus loader is digest-checked, so a moving source makes the digest
meaningless.

## 2. The gate, and why it has not opened

`PLAN_NEWS_FEED_QUALITY.md` §5.5 states the condition: build the bulk band **if
live lookups prove too thin or slow per term**, with the row count and DynamoDB
write cost printed before any spend.

Thirteen loop iterations say they are neither. Iterations 11, 12 and 13 each
resolved **6 of 8** queued terms through live reference lookups. Every miss across
the whole run has been a phrase or a person that a Wikidata dump would also miss:

| miss | why a dump does not help |
| --- | --- |
| `yemeni government says` | a clause the extractor queued, not an entity |
| `canadian companies` | a plural common-noun phrase |
| `genevieve glatsky` | a bylined reporter, not a notable entity |
| `deepseek v4` | a model release newer than any dump |

So the gate as written will not open on the evidence the loop is producing. That
leaves three honest positions, and choosing between them is what this plan is
waiting on:

1. **Load it for coverage breadth.** The argument is not today's misses but
   tomorrow's terms — a feed that runs beyond two English news sources meets
   entities the live lookups will miss. If this is the answer, §5.5's wording
   should change too, because it currently gates on a condition that will not
   occur.
2. **Do not load it.** Live lookups are carrying the feed. The dump stays on disk
   at no running cost; only the disk is spent.
3. **Get evidence that could falsify the reading first.** The loop has only ever
   run `hacker-news` and `nyt-world`. `usgs-quakes` and `wikimedia-featured` are
   captured, committed, and untouched by all thirteen iterations — and quake and
   place terms are exactly what a dump defines. One iteration against those two
   sources either produces the thin-lookup evidence §5.5 asks for, or settles that
   live lookups are enough.

Option 3 costs one loop iteration against fixtures already on disk.

## 3. The load procedure, when the gate opens

Moved verbatim in substance from `PLAN_MEMORY_ROLLOUT.md` §4, which carried it
while the download ran.

- **Pass A** streams `gzip -dc` over the dump and extracts the 12 committed
  `SEED_QIDS` entities' lines, stripping the dump's per-line trailing commas.
- A small node script derives the object QIDs from their mapped claims, via
  `WIKIDATA_PROPERTY_RELATIONS` — shared with `wikidata-live.mjs`, so the dump
  band and the live band agree about which properties become which relations.
- **Pass B** extracts those object entities' lines.
- Concatenate to a dump-derived JSON-lines slice, then
  `node scripts/corpus-bands/build-wikidata-slice.mjs --source <slice>`.
- `tmct corpus load wikidata-slice` against the live table. Operator-gated.
- CC0, so no `.NOTICE` file is required. Contrast conceptnet-full, which ships one.

Growing the slice later means adding to `SEED_QIDS` and re-running both passes.

**The corpus CLI needs the table name, and the stack output is the authority:**

```
aws cloudformation describe-stacks --region eu-west-2 \
  --stack-name tmct-prod-prod-website \
  --query "Stacks[0].Outputs[?OutputKey=='RowTableName'].OutputValue" --output text
```

awscli v1 ignores `AWS_REGION`, so always pass `--region`.

**Print the row count and the DynamoDB write cost before any load.** That is
§5.5's requirement and it is not optional — the number is what makes the spend a
decision rather than a side effect.

## 4. What the 12-QID slice is and is not

The committed slice band is a PIPELINE PROOF. It demonstrates that a dump-derived
band builds, loads, digest-checks and reads back. It is not coverage, and no
measurement should treat it as such.

The conceptnet-full band is the precedent for what a real load looks like:
2,344,809 rows in the live table, manifest read-back matching its source digest,
and `queryBandTerm("dog")` returning 565 well-formed rows. A Wikidata band earns
the same three checks before it counts as loaded.
