# Ideas And Future Directions

## Purpose

This document collects **well-understood enhancements** that are worth keeping in view even though they are not yet part of the settled core concept. The shape of each is reasonably clear; what is missing is mostly time, prioritisation, or a triggering use case.

For exploratory research (techniques where the underlying mechanism still needs investigation — property-based testing depth, hyperproperties, linearizability, fuzzing, mutation 2.0, TIA, AI augmentation, time-travel), see `novel-techniques.md`.

Some of these may become first-class packages later. Others may stay as integrations or idea donors.

## Contract Tests

### What This Means

Contract tests verify that a system still conforms to an agreed external contract.

The contract may describe:

-   an HTTP API
-   a JSON payload shape
-   an OpenAPI or GraphQL schema
-   a CLI behavior contract
-   an event stream or message format
-   a producer/consumer agreement between services

This is different from ordinary unit tests:

-   unit tests ask "does this code behave as expected in this example?"
-   contract tests ask "does this system still honor the agreement that other code depends on?"

### Why It Might Matter For Overkill

Contract tests fit Overkill surprisingly well because they often need:

-   stable artifact identity
-   reviewable baselines
-   structured diffs
-   runtime-aware execution
-   machine-readable reporting

They also overlap naturally with browser, integration, and baseline-oriented packages.

### Possible Product Shapes

Contract testing could eventually appear as:

-   baseline adapters for structured payloads
-   schema-aware assertion helpers
-   integration packages for OpenAPI, GraphQL, or event protocols
-   richer “workflow transcript” comparisons

Overkill probably should not start by inventing a universal contract-testing framework. It should first make sure the engine, baseline model, and artifact identity model are strong enough that such packages can be built cleanly.

## Approval And Golden Workflow Testing

### How This Differs From Snapshots

At first glance, golden tests look like snapshots. The difference is mostly in scope and semantics.

Ordinary snapshots usually compare a single captured output:

-   a rendered string
-   a DOM fragment
-   a JSON object
-   a screenshot

Golden or master workflow tests often compare a larger structured interaction over time:

-   a CLI session transcript
-   an HTTP exchange sequence
-   a series of emitted events
-   a trace timeline
-   a workflow with multiple steps and intermediate outputs

So the difference is not "snapshot vs not snapshot." The difference is:

-   snapshots often capture one observation
-   golden/master workflows often capture a multi-step narrative artifact

Approval testing is the broader workflow that covers both: print whatever the system observes, save it, manually approve once, and the saved file becomes the spec. Different in spirit from snapshots: snapshots are convenience; approvals are a deliberate ratchet.

### Why This Matters

A larger workflow artifact usually needs more than simple string equality:

-   step identity
-   normalization rules
-   partial masking or redaction
-   better diffs
-   stale-step detection
-   domain-aware comparison

This pushes the concept toward richer baseline adapters rather than one global snapshot format.

### Recommended Direction

Overkill should treat golden/master tests as a subtype of baseline-driven testing, but a richer subtype than the default "single string snapshot" mental model.

That means the baseline system should be able to support:

-   structured artifacts
-   multi-step transcripts
-   domain-specific comparison
-   explicit update workflows

### Concrete Approval Primitives

If approval testing earns its own first-class shape on top of baselines, the concrete primitives worth committing to:

-   a `baseline()` primitive distinct from `expect()`, signalling "I am locking observed behavior, not asserting a known truth"
-   combinatoric input generation (e.g. `baseline(cartesian(values, transforms))`)
-   diff-tool integration on update (open the user's preferred diff tool to review)
-   per-test approval status visible in metadata

Likely package home: `@overkill/baselines` extended, or a separate `@overkill/approval` if the workflow diverges enough.

## Test Data Generation

### Position

This deserves more thought. It is broader than fixtures, but it should not imply code generation.

For property-based generators specifically (integrated shrinking, splittable PRNGs, classify/coverage), the research-flavored treatment lives in `novel-techniques.md` § Property-Based Testing. This section covers the broader builder/factory direction.

### What It Could Mean

Test data generation can include:

-   deterministic object builders
-   seeded random data
-   domain-specific factories
-   combinators for valid and invalid values
-   reusable workload generation for integration tests or benchmarks

### Why It Is Hard

For a TypeScript-first toolchain, the challenge is not generating bytes. The challenge is doing it in a way that remains:

-   type-safe
-   explicit
-   composable
-   deterministic when needed

The concept should probably distinguish:

-   data builders for hand-authored scenarios
-   generated data for broad coverage
-   property-based generators for future advanced testing

### Recommended Direction

Do not jump directly to a giant faker-style package.

Instead, keep open the possibility of:

-   small builder-oriented helpers
-   seeded generator primitives
-   benchmark workload generation helpers
-   future bridges to property-based testing packages

This area is promising, but it needs deeper research before becoming a settled package concept.

## Deterministic Time And Clocks

The deterministic clock and scheduler story lives in `deterministic-simulation.md`, which positions simulators as user- or adapter-owned with Overkill providing the testing integration. Overkill should not ship a first-party clock package; the explicit-injection stance there is consistent with the "Keep Production Code Clean" principle.

## Scope Note

This doc covers broader product directions kept in view as future
possibilities. Directions that are _rejected for the current concept_
with research preserved (such as `@overkill/world` and in-source tests)
live in `non-goals.md` § Deferred With Research instead.
