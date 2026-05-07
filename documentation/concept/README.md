# Overkill Concept Docs

This folder captures the product concept for `overkill` before runtime
implementation resumes. The documents in `documentation/concept/` are the
current product narrative; they will eventually be condensed into a
project-level `README.md` and design RFCs.

## Recommended Reading Order

For a first read, follow this path:

1. [Overview](./overview.md) — what Overkill is, who it's for, product shape
2. [Principles](./principles.md) — the design rules that drive every
   decision
3. [Glossary](./glossary.md) — canonical definitions of microtest, macro,
   profile, sink, baseline subtype, verdict, witness, etc.
4. [Testing Models](./testing-models.md) — the test categories Overkill
   recognises
5. [Fast Feedback Loops](./fast-feedback-loops.md) — the engineering
   commitments behind sub-second startup
6. [Package Architecture](./package-architecture.md) — package families,
   ownership boundaries, builder layer
7. [Microtests And Capabilities](./microtests-and-capabilities.md) — the
   capability-restricted default
8. [Architecture Decisions](./architecture-decisions.md) — compact summary
   of the now-settled design choices
9. [Results, Not Exceptions](./results-not-exceptions.md) — protocol-layer
   rationale behind the assertion model
10. [Tests As Values](./tests-as-values.md) — first-class value-oriented
    authoring mode with direct-file execution
11. [Test Ergonomics](./test-ergonomics.md) — the small set of
    first-party DX helpers worth keeping
12. [Configuration](./configuration.md) — low-surface config philosophy
13. [Capability Handles](./capability-handles.md) — the alternative to
    mocking
14. [Higher Test Layers](./higher-test-layers.md) — what integration,
    browser, visual, and property-test layers imply for Overkill
15. [Runtime Behavior](./runtime-behavior.md) — console capture, exit
    codes, signals, parallelism, sharding, monorepo, CI
16. [Baselines And Snapshots](./baselines-and-snapshots.md)
17. [Benchmarking](./benchmarking.md)
18. [Research Landscape](./research-landscape.md)

## Architecture And Cross-Cutting Concepts

-   [Package Architecture](./package-architecture.md)
-   [Artifact Identity](./artifact-identity.md)
-   [Architecture Decisions](./architecture-decisions.md)
-   [Assertions And Results](./assertions-and-results.md)
-   [Capability Handles](./capability-handles.md)
-   [Configuration](./configuration.md)
-   [Coverage](./coverage.md)
-   [Credits](./credits.md)
-   [Documentation Strategy](./documentation-strategy.md)
-   [Doubles](./doubles.md)
-   [Runtimes And Fixtures](./runtimes-and-fixtures.md)
-   [Extensions And Plugins](./extensions-and-plugins.md)
-   [Failure Artifacts](./failure-artifacts.md)
-   [Failure Walkthrough](./failure-walkthrough.md)
-   [Fast Feedback Loops](./fast-feedback-loops.md)
-   [Glossary](./glossary.md)
-   [Higher Test Layers](./higher-test-layers.md)
-   [Metadata And Selection](./metadata-and-selection.md)
-   [Non-Goals](./non-goals.md)
-   [Reporters](./reporters.md)
-   [Reproducibility](./reproducibility.md)
-   [Results, Not Exceptions](./results-not-exceptions.md)
-   [Runtime Behavior](./runtime-behavior.md)
-   [Tests As Values](./tests-as-values.md)
-   [Test Ergonomics](./test-ergonomics.md)
-   [Types Index](./types-index.md)

## Distribution And Platform

-   [Bundles And Distribution](./bundles-and-distribution.md)
-   [Candidate Libraries](./candidate-libraries.md)
-   [Platform-First Implementation Notes](./platform-first-implementation-notes.md)

## Forward-Looking And Research

-   [Deterministic Simulation](./deterministic-simulation.md)
-   [Ideas And Future Directions](./ideas-and-future-directions.md)
-   [Novel Techniques](./novel-techniques.md)
-   [Research Landscape](./research-landscape.md)

## Repo State

-   [Current Repo Notes](./current-repo-notes.md)

## How To Contribute To These Docs

The docs aim to be:

-   normative where decisions are settled (the canonical docs and
    `architecture-decisions.md` are the source of truth)
-   speculative where decisions are not (clearly marked as future
    directions, future package families, or open items)
-   cross-linked rather than redundant (each concept has one canonical
    home; other docs reference it)

When adding a new concept, prefer extending an existing doc over
introducing a new one unless the new concept is genuinely cross-cutting.
The glossary is the right place for one-line definitions; deeper
treatment lives in the relevant architectural doc.
