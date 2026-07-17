# SEON — the code ontology tmct borrows from

**Canonical source:** SEON, the Software Evolution ONtologies, http://se-on.org/ — the
`code.owl` layer at http://se-on.org/ontologies/domain-specific/2012/02/code.owl
**Namespace:** `http://se-on.org/ontologies/domain-specific/2012/02/code.owl#` (prefix `seon:`).
**Version:** the ontology carries **no `owl:versionInfo`**. The only version signal is `2012/02` in
the IRI path. The mirror's last commit is 2013-01-23.
**Licence:** no licence file is published with the ontology. tmct borrows term *names* only, which
is reference, not redistribution. Nothing from SEON is committed here.
**Retrieval date:** 2026-07-17 — VERIFIED. `code.owl` fetched live (HTTP 200,
`application/rdf+xml`, 54,576 bytes) and every term below read out of that file, not from a summary.
**Consumer in repo:** `src/adapters/graph-build.mjs`, `src/domain/codegraph.mjs`,
`src/domain/router/registry.mjs`, `ontology/tmct-core.ttl`.

## Fetching it

**The namespace IRI resolves over `http://` only.** The apex domain is served by GitHub Pages and
presents a `*.github.com` certificate, so any `https://se-on.org/...` fetch fails on a certificate
altname mismatch. Do not rewrite the namespace IRI to `https:` to tidy it — the IRI is an
identifier, and changing it names a different ontology.

Mirror: https://github.com/sealuzh/onts-seon (of `bitbucket.org/sealuzh/onts-seon`). The mirror's
`code.owl` is byte-identical to the live one.

**Name collision:** "SEON: A Software Engineering Ontology Network" (Ruy et al.) is an unrelated
Brazilian project. The SEON tmct uses is the University of Zurich one that owns `se-on.org`.

## The pyramid

- **general/2012/02** — `main.owl`, `annotations.owl`, `measurement.owl`
- **domain-specific/2012/02** — `code.owl`, `history.owl`, `issues.owl`, `code-metrics.owl`, `rules_code.owl`
- **domain-spanning/2012/02** — `change-couplings.owl`, `clones.owl`, `code-flaws.owl`, `fine-grained-changes.owl`, and three integration layers
- **system-specific/2012/02** — `java.owl`, `bugzilla.owl`, `jira.owl`
- **nl/2012/02** — `code-nl.owl`, `annotations-nl.owl`

`code.owl` imports `http://se-on.org/ontologies/general/2012/02/main.owl`, whose classes are
`Activity`, `Artifact`, `Developer`, `Directory`, `File`, `Milestone`, `Product`, `Release`,
`SeonThing`, `Stakeholder`.

## code.owl — the complete term list

**Classes (16).** `CodeEntity` ⊑ `main:Artifact` · `Datatype` ⊑ CodeEntity · `PrimitiveType` ⊑
Datatype · `ComplexType` ⊑ Datatype · `ClassType` ⊑ ComplexType · `InterfaceType` ⊑ ComplexType ·
`EnumerationType` ⊑ ComplexType · `AnnotationType` ⊑ ComplexType · `ExceptionType` ⊑ **ClassType** ·
`Method` ⊑ CodeEntity · `Constructor` ⊑ CodeEntity · `Variable` ⊑ CodeEntity · `Field` ⊑ Variable ·
`Parameter` ⊑ Variable · `Namespace` ⊑ CodeEntity · `AccessModifier` ⊑ `main:SeonThing`

`Constructor` is deliberately **not** a subclass of `Method`. The file gives the reason: differing
signatures, no return type, no abstract/final/static.

**Object properties (24 named, plus inverses).**

| property | domain → range | inverse |
|---|---|---|
| `containsCodeEntity` | File → CodeEntity | — |
| `declaresMethod` | ComplexType → Method | `isDeclaredMethodOf` |
| `declaresField` | ComplexType → Field | `isDeclaredFieldOf` |
| `declaresConstructor` | → Constructor | `isDeclaredConstructorOf` |
| `invokesMethod` | → Method | `methodIsInvokedBy` |
| `invokesConstructor` | → Constructor | `constructorIsInvokedBy` |
| `accessesField` | → Field | `isAccessedBy` |
| `instantiatesClass` | → ClassType | `isInstantiatedBy` |
| `usesComplexType` | ComplexType → ComplexType | — |
| `hasSuperType` | (none declared) | `hasSubtype` |
| `hasSuperClass` | ClassType → ClassType | `hasSubClass` |
| `hasSuperInterface` | InterfaceType → InterfaceType | `hasSubInterface` |
| `implementsInterface` | ClassType → InterfaceType | `isImplementedBy` |
| `hasParameter` | → Parameter | `isParameterOf` |
| `hasReturnType` | Method → Datatype | `isReturnTypeOf` |
| `hasDatatype` | Variable → Datatype | `isDatatypeOf` |
| `expectsDatatype` | Method → Datatype | `isExpectedDatatype` |
| `throwsException` | → ExceptionType | `isThrownBy` |
| `catchesException` | Method → ExceptionType | `isCaughtBy` |
| `hasNamespaceMember` | Namespace → ComplexType | `isNamespaceMemberOf` |
| `hasAccessModifier` | → AccessModifier | — |

**Datatype properties (8).** `hasCodeIdentifier` (domain CodeEntity), `hasDoc`, `hasLength`
("lexical length of an entity within a source file"), `hasPosition` (Parameter — preserves parameter
order for overloading), `isAbstract`, `isConstant` (Variable), `isStatic`, `startsAt` ("offset of
the entity's declaration within a source file").

Selected verbatim definitions:

- `usesComplexType` — "One class can use another, when the first class' methods invoke or access
  methods or fields of the other class."
- `containsCodeEntity` — "Files can contain various code entities, such as classes, methods, etc."
- `invokesMethod` — "A constructor or method can invoke another method."

## Spellings to copy exactly

**`hasSuperType` has a capital T. Its inverse `hasSubtype` has a lowercase t.** SEON is internally
inconsistent here. Both are the real spellings. Match them; do not normalise. Neither declares a
domain or a range.

`seon:hasSupertype` (lowercase t on super) **does not exist**.

## Terms that do not exist in SEON

Checked by grepping the full import closure.

- **`seon:History` does not exist anywhere in SEON.** The history layer's classes are `Branch`,
  `ChangeSet`, `Commit`, `Committer`, `FileUnderVersionControl`, `Version`; its properties include
  `isCommittedIn`, `commitsChangeSet`, `precedesVersion`. tmct already knows this —
  `graph-build.mjs:374` carries the note "seon:history is not a real SEON property (cf.
  history:isCommittedIn)" and emits `mgx:touchedByCommit` instead. The `seon:history` key that
  remains in `codegraph.mjs`'s `PROP_KIND` is a read-side key for pre-realign artifacts, filed
  under "legacy tokens". Nothing writes it.
- **`seon:Module`, `seon:ClassDefinition`, `seon:Attribute`, `seon:subKind` do not exist.** These
  are live in tmct. See `PLAN_NORMATIVE.md` §4.3 for the verdicts and §7 for the ones that need a
  file this cycle's plan does not own.

## A latent bug in SEON itself

`code.owl` references two IRI spellings for the general layer: `general/2012/02/main.owl` (the
`owl:imports`, correct) and `general/2012/2/main.owl` (**`/2/`, not `/02/`**) for `#Artifact`,
`#File`, `#SeonThing`, `#dependsOn`, `#hasChild`, `#hasParent`. The `/2/` path is not the
ontology's actual IRI, so those cross-references dangle under a strict reasoner. tmct does not
reason over SEON, so this costs nothing today. It is recorded so a future session that adds a
reasoner is not surprised by it.

## Papers

- Würsch, Ghezzi, Reif, Gall. **"SEON: a pyramid of ontologies for software evolution and its
  applications."** *Computing* 94(11), 2012. https://doi.org/10.1007/s00607-012-0204-1
- Würsch, Ghezzi, Reif, Gall. **"Supporting developers with natural language queries."** ICSE 2010.
  Title and authorship confirmed from the SEON site's own citation; page numbers and DOI
  UNVERIFIED-pending-web-check. This is the Hawkshaw line, and the closest published work to what
  tmct does.

## Deepen-next

- `nl/2012/02/code-nl.owl` is SEON's natural-language layer and is the part nobody in tmct has
  read. It is the layer most likely to already name what `ask-vocab.mjs` hand-curates.
- `domain-spanning/2012/02/change-couplings.owl` is the published vocabulary for co-change, which
  tmct coins as `mgx:changeCoupledWith`. `graph-build.mjs:381` already cites it as a "cf.". Read it
  and settle whether the alignment is exact.
