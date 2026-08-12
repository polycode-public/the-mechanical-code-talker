# test/fixtures/news-feeds — captured live source payloads

Every file under a source's own directory here is a dated, trimmed capture
of that source's real wire payload, recorded by
`scripts/news-bench/capture-fixtures.mjs` — the only script in this repo
that fetches these URLs over the network. A capture keeps only what that
source's own fetcher in `src/adapters/corpus/news-sources.mjs` actually
reads: titles, summaries or extracts, ids, timestamps and the handful of
structural fields each wire format needs to parse at all. No capture ever
stores a full article body.

## Sources

| source | origin | licence |
| --- | --- | --- |
| wikimedia-featured | https://api.wikimedia.org/feed/v1/wikipedia/en/featured | CC BY-SA 4.0 |
| hacker-news | https://hacker-news.firebaseio.com/v0 | user-submitted, discussion linked |
| usgs-quakes | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson | US public domain |
| nyt-world | https://rss.nytimes.com/services/xml/rss/nyt/World.xml | personal use with attribution |
| wikinews-published | https://en.wikinews.org/w/api.php | CC BY 2.5 |

## Layout

`test/fixtures/news-feeds/<source>/<yyyy-mm-dd>.json` — one file per source
per UTC capture date. A re-run on the same date overwrites that date's file
only; every earlier date stays on disk, so the set grows append-only across
capture runs. `scripts/news-bench/run.mjs` reads these files; nothing here
is ever fetched at bench time.
