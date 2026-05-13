# Testing Models

## Purpose

Overkill should define test categories clearly enough that package
boundaries, defaults, and authoring expectations make sense.

This doc is a taxonomy and entry point, not the full specification for each
family. The owning docs named below carry the detailed mechanics.

## Microtests

Microtests are:

-   small in scope
-   deterministic
-   local in dependencies
-   side-effect-restricted by default

Typical use:

-   pure logic
-   parser behavior
-   data transformation
-   local state transitions

Microtests should not casually depend on:

-   filesystem I/O
-   network I/O
-   subprocesses
-   worker orchestration
-   mutable global environment

## Integration Tests

Integration tests verify that multiple components cooperate correctly. They may legitimately use:

-   filesystem state
-   HTTP or IPC
-   generated fixtures
-   snapshots or baselines
-   external services started locally

They need stronger runtime and orchestration support than microtests.

The most repeated integration pattern is an owned fixture or runtime wrapper
such as:

-   start a deterministic app server, yield a base URL, then stop it
-   start a temporary registry, yield auth details, then clean up storage
-   create a page-object runtime and validate it after the test

That means Overkill should treat typed resource and runtime composition as
the main integration primitive rather than trying to stretch microtest
helpers upward.

Integration-style runs may also legitimately use:

-   retries
-   richer failure artifacts
-   stability-marked tests

Those should remain visible runner concepts rather than hidden defaults.

## Browser And Workflow Tests

These tests validate UI, CLI, or multi-step workflows. The primary browser
meaning should be: run tests in real browsers for frontend code. That is
closer to the `karma` / `@web/test-runner` family than to building a full
Playwright replacement.

The central model is runtime-driven execution, often with:

-   matrixed runtimes
-   screenshots or structural snapshots
-   process or browser lifecycle
-   richer diagnostics

Concrete browser-layer needs include:

-   browser-executed microtests or component-style tests
-   page objects as test-facing handles only in richer adapter-driven layers
-   transport-level request and event transcripts
-   explicit attachments such as accessibility scan JSON
-   visual baselines across browser and resolution matrices

These should be modeled above the engine through browser-oriented runtimes,
fixtures, and baseline adapters.

The important boundary is:

-   Overkill should have a first-party browser-execution story
-   richer end-to-end browser automation should come through integrations or
    adapters, with Playwright the obvious example, rather than through
    Overkill reimplementing that entire stack

## Baseline-Driven Tests

Some tests compare current output against checked-in baseline artifacts.

Subtypes:

-   serialized content snapshots
-   accessibility or structural snapshots
-   terminal rendering baselines
-   screenshot baselines

These are usually better suited to integration-oriented packages than to the microtest default.

## Benchmarks

Benchmarks model workflow performance under controlled workloads. Their
output is not just pass/fail correctness but measured behavior relative to
budgets, baselines, and policies.

Benchmarks may measure:

-   runtime
-   throughput
-   latency percentiles
-   responsiveness
-   domain-specific metrics captured during execution

SLO or latency-sensitive checks belong in this family too: benchmarks
measure, and SLO policies decide whether the measured latency or
responsiveness stays within declared budgets.

## Type Tests

Type tests verify type-level behavior rather than runtime behavior.

They are a real test family for a TypeScript-first ecosystem, but Overkill should support them through adapter or integration layers rather than implementing its own type-test engine.

Typical concerns:

-   inference behavior
-   overload selection
-   conditional and mapped type behavior
-   public declaration ergonomics

They should be able to participate in run planning, reporting, and selection even if the underlying checking engine is external.

## Property-Based And Model-Based Tests

These are first-class higher-layer families rather than default microtest
behavior. They need different primitives such as generators, integrated
shrinking, edge cases, witnesses, corpora, model state, and targeted
search.

The settled package split is:

-   `@overkill/property` for generator-driven property testing
-   `@overkill/model` for rule-based/state-machine testing above that core

Related advanced styles such as metamorphic, differential, and
linearizability-oriented testing also belong in that higher-layer family.
Contract-oriented suites belong there too, but primarily through
protocol-specific adapters.

See [Higher Test Layers](./higher-test-layers.md) for the detailed package
and authoring model.

## Why The Separation Matters

Overkill should not pretend that one API shape is the perfect surface for
all of these. The shared core should unify execution and reporting
contracts; higher-level packages should specialize the authoring model and
defaults.
