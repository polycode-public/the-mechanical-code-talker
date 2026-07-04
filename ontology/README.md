# ontology/

Home of `tmct-core.ttl` (Phase 2, not yet authored): the OWL 2 ontology
defining tmct's memory vocabulary — the classes and properties its graph
memory writes (visitor-said items, responses, declared lexicon categories) and
the ACE-OWL grammar emits.

It will be:

- aligned to the **OWL 2 / RDF / RDFS terms** catalogued in
  `docs/references/schemas/owl2-vocabulary.md`;
- reconciled with the **SEON-derived terms** already used in graphs tmct
  consumes (`seon:`, `mgx:` prefixes), so provider-supplied code graphs and
  tmct's own conversational memory share one type system.

See `ROADMAP.md` Phase 2 (item 3, ontology grounding).
