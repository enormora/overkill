# Overkill Concept Documentation

This folder defines the desired behavior, architecture, and product boundaries
for `overkill`. It describes the concept independently of implementation status.
Implementation milestones are tracked in [issue #194](https://github.com/enormora/overkill/issues/194).

The documentation is organised into folders that mirror their role:

- [`decisions/`](./decisions/) - settled principles and rejected
  directions
- [`architecture/`](./architecture/) - how the system is shaped: packages,
  composition, runtime behaviour, identity, configuration
- [`authoring/`](./authoring/) - how tests are written and what each test
  kind needs: microtests, assertions, doubles, fixtures, baselines,
  benchmarks
- [`reference/`](./reference/) - lookup material: glossary, types index,
  CLI reference
- [`research/`](./research/) - supporting background: comparisons, audits,
  and prior-art notes that inform but do not define the settled concept
- top-level maintainer documentation such as
  [Documentation Strategy](./documentation-strategy.md) - how user-facing
  Overkill documentation should be written

## Recommended Reading Order

For a first read, follow this path:

1. [Overview](./overview.md) - what Overkill is, who it's for, product
   shape
2. [Principles](./decisions/principles.md) - the design rules that drive
   every decision
3. [Glossary](./reference/glossary.md) - canonical definitions of
   microtest, macro, profile, sink, baseline subtype, verdict, witness,
   etc.
4. [Testing Models](./authoring/testing-models.md) - the test categories
   Overkill recognises
5. [Microtests And Capabilities](./authoring/microtests-and-capabilities.md) -
   the capability-restricted default
6. [Tests As Values](./authoring/tests-as-values.md) - first-class
   value-oriented authoring mode with explicit runner-owned direct-file
   execution

After the first pass, the per-section catalogues below cover everything
else.

## Decisions

What has been settled or explicitly rejected.

- [Principles](./decisions/principles.md)
- [Non-Goals](./decisions/non-goals.md)

## Architecture

How the system is shaped.

- [Package Architecture](./architecture/package-architecture.md)
- [Composition Order](./architecture/composition-order.md) - reading aid
  threading plan-time and execution-time stages
- [Configuration](./architecture/configuration.md)
- [Executable Test Families](./architecture/test-families.md) - public family,
  direct engine execution, evidence, and lifetime contracts
- [Platform-First Implementation Notes](./architecture/platform-first-implementation-notes.md)
- [Fast Feedback Loops](./architecture/fast-feedback-loops.md)
- [Runtime Behavior](./architecture/runtime-behavior.md)
- [Run Timings](./architecture/run-timings.md)
- [Reporters](./architecture/reporters.md)
- [Test Data And Selection](./architecture/test-data-and-selection.md)
- [Coverage](./architecture/coverage.md)
- [Artifact Identity](./architecture/artifact-identity.md)
- [Reproducibility](./architecture/reproducibility.md)
- [Run Counts](./architecture/run-counts.md)

## Authoring

How tests are written and what each test kind needs.

- [Testing Models](./authoring/testing-models.md)
- [Tests As Values](./authoring/tests-as-values.md)
- [Microtests And Capabilities](./authoring/microtests-and-capabilities.md)
- [Assertions And Results](./authoring/assertions-and-results.md)
- [Capability Handles](./authoring/capability-handles.md)
- [Doubles](./authoring/doubles.md)
- [Test Ergonomics](./authoring/test-ergonomics.md)
- [Higher Test Layers](./authoring/higher-test-layers.md)
- [Failure Artifacts](./authoring/failure-artifacts.md)
- [Failure Walkthrough](./authoring/failure-walkthrough.md) - reading aid
  threading a property-test failure end-to-end
- [Test Debug Mode](./authoring/debug-mode.md)
- [Baselines And Snapshots](./authoring/baselines-and-snapshots.md)
- [Benchmarking](./authoring/benchmarking.md)
- [Deterministic Simulation](./authoring/deterministic-simulation.md)

## Reference

Lookup material.

- [Glossary](./reference/glossary.md)
- [Types Index](./reference/types-index.md)
- [CLI Reference](./reference/cli.md)

## Research

Optional background and comparison material, not part of the settled concept
surface.

- [Research Landscape](./research/research-landscape.md)
- [Browser Testing Landscape](./research/browser-testing-landscape.md)
- [Unified Browser Integration Proposal](./research/browser-integration-proposal.md)
- [Candidate Libraries](./research/candidate-libraries.md)

## Implementation Coverage

Issue #194 is the implementation checklist for the settled concept below,
not a second specification. Checked items preserve completed history; a later
unchecked correction or extension supersedes historical wording where the
concept changed. Follow the remaining dependency order in that issue. Research
inventories and rejected/deferred ideas are not additional implementation scope.

| Contract | Owning documents | Checklist coverage |
| --- | --- | --- |
| Product, principles, and boundaries | [Overview](./overview.md), [Principles](./decisions/principles.md), [Non-Goals](./decisions/non-goals.md), [Glossary](./reference/glossary.md) | Foundation/default authoring; final concept acceptance |
| Authoring and reusable APIs | [Tests As Values](./authoring/tests-as-values.md), [Test Ergonomics](./authoring/test-ergonomics.md), [Testing Models](./authoring/testing-models.md) | Default Test Authoring; Builder Layer; distribution |
| Assertions and doubles | [Assertions And Results](./authoring/assertions-and-results.md), [Doubles](./authoring/doubles.md) | Structured Assertions; Doubles; resource-check outcome extension |
| Packages and portable resources | [Package Architecture](./architecture/package-architecture.md), [Capability Handles](./authoring/capability-handles.md), [Types Index](./reference/types-index.md) | Resources And Runtime Composition; Shared Contract Extensions |
| Families and analysis | [Executable Test Families](./architecture/test-families.md), [Testing Models](./authoring/testing-models.md) | Executable Test Families; Native Type-Test Support; family migration acceptance |
| Resolution, policy, and commands | [Configuration](./architecture/configuration.md), [Composition Order](./architecture/composition-order.md), [CLI](./reference/cli.md), [Test Data And Selection](./architecture/test-data-and-selection.md) | Runner/discovery; benchmark profile reconciliation; distribution |
| Identity and counts | [Artifact Identity](./architecture/artifact-identity.md), [Run Counts](./architecture/run-counts.md) | Discovery/records; executable work identity and catalog acceptance |
| Supervision and scheduling | [Runtime Behavior](./architecture/runtime-behavior.md), [Microtests And Capabilities](./authoring/microtests-and-capabilities.md) | Minimal/Advanced Runner Execution; Shared Contract Extensions; browser planning |
| Reporters and timings | [Reporters](./architecture/reporters.md), [Run Timings](./architecture/run-timings.md) | First Human Output; timing diagnostics; Additional Reporters; identity acceptance |
| Artifacts, replay, and merging | [Failure Artifacts](./authoring/failure-artifacts.md), [Failure Walkthrough](./authoring/failure-walkthrough.md), [Reproducibility](./architecture/reproducibility.md) | Replay/records; shared observation/replay acceptance; Sharded Result Merging; browser reproduction |
| Baselines and debug | [Baselines And Snapshots](./authoring/baselines-and-snapshots.md), [Test Debug Mode](./authoring/debug-mode.md) | Replay/Records/Baselines/Debug; final contract acceptance |
| Performance and measurement | [Benchmarking](./authoring/benchmarking.md) | Benchmarking; asynchronous measurement extension; browser sampling/collectors |
| Simulation and scenario replay | [Deterministic Simulation](./authoring/deterministic-simulation.md), [Reproducibility](./architecture/reproducibility.md#replay-witnesses-for-properties-and-simulations) | Higher Test Layers; simulation replay/identity/HTML-host extensions |
| Property-derived and mutation behavior | [Higher Test Layers](./authoring/higher-test-layers.md) | Property-Based Testing; Property-Derived Contract Acceptance; Mutation Testing And Stryker; family migration regressions |
| Browser execution and quality checks | [Runtime Behavior](./architecture/runtime-behavior.md#browser-execution-and-placement), [Higher Test Layers](./authoring/higher-test-layers.md#browser-testing-product-boundary), [Benchmarking](./authoring/benchmarking.md#browser-and-frontend-performance-benchmarks) | Ordered browser execution, protected-session, measurement, audit, and remote milestones |
| Startup and platform integration | [Fast Feedback Loops](./architecture/fast-feedback-loops.md), [Platform-First Notes](./architecture/platform-first-implementation-notes.md), [Coverage](./architecture/coverage.md) | Coverage; benchmark startup guardrails; final platform acceptance |
| User-facing explanation | [Documentation Strategy](./documentation-strategy.md) | Per-feature public documentation; final guide/reference acceptance |

### Milestone Completion

A milestone includes its public/direct API and any specified runner/CLI path,
types/exports, identity/records, errors, cancellation/cleanup, and documentation.
Validate behavior through the public surface, including relevant negative and
interrupted paths. A package facade, metadata declaration, or universal
unsupported result alone does not implement a promised feature.

Platform-dependent features need at least one validated supported path plus
explicit compatibility rejection elsewhere. Record exact browser/controller/
protocol/tool support and prove required guard/measurement coverage before
building dependent adapters. Compatibility findings cannot silently weaken the
desired guarantee or count an unimplemented feature as complete.

Update owning documents, examples, reference sketches, and the checklist together
when a contract changes. Final acceptance checks the coverage table, supported
paths, rejected boundaries, direct/runner parity, and migration regressions;
it does not expand scope to every prior-art tool listed in research.

## How To Contribute To This Documentation

The documentation aims to be:

- normative where decisions are settled (the canonical documents and their
  owning topic documents are the source of truth)
- cross-linked rather than redundant (each concept has one canonical
  home; other documents reference it)

Research and candidate exploration should live outside the settled concept
surface in [`research/`](./research/) or external notes, not as mixed-status
sections inside the canonical concept documents.

When adding a new concept, prefer extending an existing doc over
introducing a new one unless the new concept is genuinely cross-cutting.
The glossary is the right place for one-line definitions; deeper
treatment lives in the relevant architectural doc.
