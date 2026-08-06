# results/claims

Every file in this folder is generated. A `claim:<name>` rig under
`scripts/claims/` measures one thing, calls `writeClaim()`, and the result
lands here as `<name>.json`. No one edits these files by hand.

Each JSON file matches `scripts/claims/schema.json`: a value (or a
before/after/delta for an extensibility claim), a unit, a regression
threshold, the hardware it ran on, the commit it ran at, and the source
files it drew from.

`npm run claims` runs every registered `claim:*` script and fails if any of
them regress past their committed threshold. `test/estate/claims.test.mjs`
checks every file here against the schema and confirms its cited sources
still exist.

No number that appears in a claim JSON file is restated anywhere else. Any
page or doc that wants a figure quotes it from here.
