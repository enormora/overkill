# Overkill Concept Docs

This folder captures the product concept for `overkill` before runtime
implementation resumes. The documents in `documentation/concept/` are the
current product narrative; they will eventually be condensed into a
project-level `README.md` and design RFCs.

The docs are organised into folders that mirror their role:

-   [`decisions/`](./decisions/) — settled principles, rejected directions,
    planned future work
-   [`architecture/`](./architecture/) — how the system is shaped: packages,
    composition, runtime behaviour, identity, configuration
-   [`authoring/`](./authoring/) — how tests are written and what each test
    kind needs: microtests, assertions, doubles, fixtures, baselines,
    benchmarks
-   [`reference/`](./reference/) — lookup material: glossary, types index,
    CLI reference
-   [`research/`](./research/) — comparisons, audits, and research-flavored
    surveys
-   [`meta/`](./meta/) — how the docs themselves are organised, plus a
    snapshot of the current repo state

## Recommended Reading Order

For a first read, follow this path:

1.  [Overview](./overview.md) — what Overkill is, who it's for, product
    shape
2.  [Principles](./decisions/principles.md) — the design rules that drive
    every decision
3.  [Glossary](./reference/glossary.md) — canonical definitions of
    microtest, macro, profile, sink, baseline subtype, verdict, witness,
    etc.
4.  [Testing Models](./authoring/testing-models.md) — the test categories
    Overkill recognises
5.  [Fast Feedback Loops](./architecture/fast-feedback-loops.md) — the
    engineering commitments behind sub-second startup
6.  [Package Architecture](./architecture/package-architecture.md) —
    package families, ownership boundaries, builder layer
7.  [Microtests And Capabilities](./authoring/microtests-and-capabilities.md) —
    the capability-restricted default
8.  [Assertions And Results](./authoring/assertions-and-results.md) —
    the assertion model and the structured-outcome protocol underneath
9.  [Tests As Values](./authoring/tests-as-values.md) — first-class
    value-oriented authoring mode with direct-file execution
10. [Test Ergonomics](./authoring/test-ergonomics.md) — the small set of
    first-party DX helpers worth keeping
11. [Configuration](./architecture/configuration.md) — low-surface config
    philosophy
12. [Capability Handles](./authoring/capability-handles.md) — the
    alternative to mocking
13. [Higher Test Layers](./authoring/higher-test-layers.md) — what
    integration, browser, visual, and property-test layers imply for
    Overkill
14. [Runtime Behavior](./architecture/runtime-behavior.md) — console
    capture, exit codes, signals, parallelism, sharding, monorepo, CI
15. [Baselines And Snapshots](./authoring/baselines-and-snapshots.md)
16. [Benchmarking](./authoring/benchmarking.md)
17. [Research Landscape](./research/research-landscape.md)

## Decisions

What has been settled, rejected, or planned.

-   [Principles](./decisions/principles.md)
-   [Non-Goals](./decisions/non-goals.md)
-   [Ideas And Future Directions](./decisions/ideas-and-future-directions.md)

## Architecture

How the system is shaped.

-   [Package Architecture](./architecture/package-architecture.md)
-   [Composition Order](./architecture/composition-order.md) — reading aid
    threading plan-time and execution-time stages
-   [Configuration](./architecture/configuration.md)
-   [Platform-First Implementation Notes](./architecture/platform-first-implementation-notes.md)
-   [Fast Feedback Loops](./architecture/fast-feedback-loops.md)
-   [Runtime Behavior](./architecture/runtime-behavior.md)
-   [Reporters](./architecture/reporters.md)
-   [Metadata And Selection](./architecture/metadata-and-selection.md)
-   [Coverage](./architecture/coverage.md)
-   [Artifact Identity](./architecture/artifact-identity.md)
-   [Reproducibility](./architecture/reproducibility.md)

## Authoring

How tests are written and what each test kind needs.

-   [Testing Models](./authoring/testing-models.md)
-   [Tests As Values](./authoring/tests-as-values.md)
-   [Microtests And Capabilities](./authoring/microtests-and-capabilities.md)
-   [Assertions And Results](./authoring/assertions-and-results.md)
-   [Capability Handles](./authoring/capability-handles.md)
-   [Doubles](./authoring/doubles.md)
-   [Test Ergonomics](./authoring/test-ergonomics.md)
-   [Higher Test Layers](./authoring/higher-test-layers.md)
-   [Failure Artifacts](./authoring/failure-artifacts.md)
-   [Failure Walkthrough](./authoring/failure-walkthrough.md) — reading aid
    threading a property-test failure end-to-end
-   [Test Debug Mode](./authoring/debug-mode.md)
-   [Baselines And Snapshots](./authoring/baselines-and-snapshots.md)
-   [Benchmarking](./authoring/benchmarking.md)
-   [Deterministic Simulation](./authoring/deterministic-simulation.md)

## Reference

Lookup material.

-   [Glossary](./reference/glossary.md)
-   [Types Index](./reference/types-index.md)
-   [CLI Reference](./reference/cli.md)

## Research

Comparisons, audits, and research-flavored surveys.

-   [Research Landscape](./research/research-landscape.md)
-   [Candidate Libraries](./research/candidate-libraries.md)

## Meta

About the docs themselves and the current repo state.

-   [Documentation Strategy](./meta/documentation-strategy.md)
-   [Concept Status Vocabulary](./meta/concept-status.md)
-   [Current Repo Notes](./meta/current-repo-notes.md)

## How To Contribute To These Docs

The docs aim to be:

-   normative where decisions are settled (the canonical docs and their
    owning topic docs are the source of truth)
-   speculative where decisions are not (clearly marked as future
    directions, future package families, or open items)
-   cross-linked rather than redundant (each concept has one canonical
    home; other docs reference it)

When adding a new concept, prefer extending an existing doc over
introducing a new one unless the new concept is genuinely cross-cutting.
The glossary is the right place for one-line definitions; deeper
treatment lives in the relevant architectural doc.
