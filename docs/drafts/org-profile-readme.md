# Polycode

We build deterministic software. No model calls in the product path, offline-first, $0 to run.

## Projects

**tmct (the mechanical code talker).** A pure-JS, deterministic, no-LLM chatbot. It turns
natural language into a graph database and answers only from what it was taught, or refuses
when it can't. Live demos: https://tmct.polycode.co.uk

**Seonix.** A deterministic, offline, $0 code-graph indexer for repos. `seonix chat` opens
tmct's conversational client over Seonix's own code graph. Seonix supplies the graph, tmct
runs the conversation.

**Marginalia.** A public, shared persistent-memory chat service. It is migrating from its own
MemTree and Oxigraph/SPARQL pipeline onto tmct as its core chat and graph engine.

## Where the code lives

GitLab is canonical. These GitHub repos are read-only mirrors, synced hourly from GitLab. Open
issues and merge requests on GitLab, not here.
