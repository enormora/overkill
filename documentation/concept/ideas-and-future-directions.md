# Ideas And Future Directions

## Purpose

This document collects broader feature areas and product directions that are worth keeping in view even though they are not yet part of the settled core concept.

Some of these may become first-class packages later. Others may stay as integrations or idea donors. The point of this document is to expand the design space without pretending every idea is already a commitment.

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
-   environment-aware execution
-   machine-readable reporting

They also overlap naturally with browser, integration, and baseline-oriented packages.

### Possible Product Shapes

Contract testing could eventually appear as:

-   baseline adapters for structured payloads
-   schema-aware assertion helpers
-   integration packages for OpenAPI, GraphQL, or event protocols
-   richer “workflow transcript” comparisons

Overkill probably should not start by inventing a universal contract-testing framework. It should first make sure the engine, baseline model, and artifact identity model are strong enough that such packages can be built cleanly.

## Golden And Master Workflow Tests

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

So the difference is not “snapshot vs not snapshot.” The difference is:

-   snapshots often capture one observation
-   golden/master workflows often capture a multi-step narrative artifact

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

Overkill should treat golden/master tests as a subtype of baseline-driven testing, but a richer subtype than the default “single string snapshot” mental model.

That means the baseline system should be able to support:

-   structured artifacts
-   multi-step transcripts
-   domain-specific comparison
-   explicit update workflows

## Test Data Generation

### Position

This deserves more thought. It is broader than fixtures, but it should not imply code generation.

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

### Position

The anti-pattern warning is correct: monkey patching global clocks should not be the Overkill default story.

### Recommended Direction

If Overkill touches clocks at all, the good model is:

-   dependency-injected clock interfaces
-   fake clock implementations passed explicitly
-   no global time patching as the default

### Should This Live Under Overkill?

Probably not as an immediate core family.

Reasons against:

-   it is a generally useful application design primitive, not only a testing primitive
-   it risks growing into another broad utility library

Reasons it still might belong later:

-   benchmarks, microtests, and integration packages may all benefit from a shared clock abstraction
-   the package could reinforce Overkill's explicit-injection philosophy

Current recommendation:

-   treat clocks as an adjacent idea, not a committed Overkill package
-   only pull it under the umbrella later if multiple Overkill packages genuinely need the same abstraction

## Rejected For Now: `@overkill/world`

The idea of a first-class `@overkill/world` package remains attractive.
There is real value in:

-   explicit capability boundaries
-   typed recording handles
-   deterministic testing helpers for effectful collaborators
-   reusable recorder and snapshot helpers

But it is rejected for the current concept for one important reason:

-   consumer production code should not need to import Overkill packages

If `@overkill/world` became the canonical way to define application handles,
it would quickly turn into a production-facing architecture dependency. That
crosses a boundary the current concept should not cross yet.

Current stance:

-   keep capability handles as a documented architectural pattern
-   make Overkill’s testing APIs work well with user-owned interfaces
-   do not ship a first-class world package in the current concept

This may be revisited later if the boundary changes or if Overkill develops a
test-only helper layer that avoids production-code dependency.
