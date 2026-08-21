# Glossary

## Purpose

Several terms in the Overkill concept documentation are used in slightly
different ways across files. This glossary is the canonical definition. When
other documents use these terms, they should be read as referring to the
definitions here.

## Microtest

A test that runs under a strict capability profile by default, is expected
to be deterministic and locally scoped, and is optimized for the fastest
feedback loop. The capability boundary is the defining property; size and
speed are consequences.

Source: [Microtests And Capabilities](../authoring/microtests-and-capabilities.md).

## Test Macro

A function that takes parameters and returns a `TestNode` such as a
`Suite` or `Table`. Macros are the preferred reuse mechanism for tests.

Source: [Tests As Values](../authoring/tests-as-values.md).

## Test Scope

The injected context object passed to a first-party `@overkill-dev/test` body.
Docs prefer the local variable name `scope`. It may expose `assert`,
`require`, `plan`, and selected helper methods.

Source: [Assertions And Results](../authoring/assertions-and-results.md), [Test Ergonomics](../authoring/test-ergonomics.md).

## Test Facade

A project-local typed authoring entrypoint built with
`createTestFacade(...)` and re-exported through a stable alias such as
`#tests/micro`. A facade owns the authoring surface for one suite family;
root runner configuration still owns orchestration.

Source: [Package Architecture](../architecture/package-architecture.md), [Assertions And Results](../authoring/assertions-and-results.md).

## Standard Distribution

The normal user-facing install package, `@overkill-dev/test`. It ships the
`overkill` binary, exposes the ordinary authoring root import, and re-exports
standard-stack surfaces through explicit subpaths. It does not replace the
fine-grained package ownership model.

Source: [Package Architecture](../architecture/package-architecture.md).

## Test Family

A closed enumeration that classifies the semantic family a profile runs.
First-party families:

- `microtest`
- `integration`
- `benchmark`
- `type-test`
- `property`

Browser execution, deterministic simulation, model checking, and similar
runtime styles are expressed through fixtures, resources, runtimes, or
higher-layer packages. They are not separate families unless they define a
different semantic contract for planning, reporting, and policy.

Source: [Metadata And Selection](../architecture/metadata-and-selection.md), [Testing Models](../authoring/testing-models.md).

## Capability Profile

A named set of allowed runtime capabilities such as filesystem access,
network, child process, worker, addon, or WASI access. It is a permission
concept, distinct from execution strategy.

Source: [Microtests And Capabilities](../authoring/microtests-and-capabilities.md).

## Process Model

A profile-level decision about the process boundary used for execution.
Ordinary microtests support `in-process` and `supervised-process`.
Other families may define their own valid process models.

Source: [Runtime Behavior](../architecture/runtime-behavior.md).

## Scheduling

A profile-level decision about how selected cases are started once the
process model is chosen. Common values are `serial` and `concurrent`.
Scheduling is distinct from process isolation.

Source: [Runtime Behavior](../architecture/runtime-behavior.md).

## Runner Profile

A project-owned run target in configuration. A profile has a required
`testFamily` and may define discovery, reporters, resource usage policy,
timeouts, coverage policy, process model, and scheduling. Users select a
profile per run via CLI or programmatic request. Global configuration may
provide fallback reporters, but profile reporters replace them when present.

Source: [Microtests And Capabilities](../authoring/microtests-and-capabilities.md), [Package Architecture](../architecture/package-architecture.md).

## Suite

A `TestNode` that groups child nodes under a name. Suites are for naming,
identity composition, and metadata inheritance; they do not carry hooks or
shared mutable lifecycle.

Source: [Tests As Values](../authoring/tests-as-values.md), [Package Architecture](../architecture/package-architecture.md).

## Table / Parameterized Test

A `TestNode` that pairs one body with a list of cases. Each case becomes a
distinct expanded test in the run plan. Tables are the local
parameterization shape; macros remain the primary reuse mechanism.

Source: [Tests As Values](../authoring/tests-as-values.md).

## Test Outcome

The engine-level outcome of one test run. The `TestOutcome` ADT has four
cases: `pass`, `fail`, `skip`, and `inconclusive`, each with its own
payload.

Source: [Assertions And Results § Protocol Layer](../authoring/assertions-and-results.md#protocol-layer-structured-outcomes).

## Test Verdict

The reporter-facing category for a test run. Verdicts are derived by
orchestration from `TestOutcome` plus runner/error context. One additional
common verdict is `crashed`, where the engine never produced an outcome.
Another is `resource-exhausted`, where an enforced resource budget was
breached while the test was active.

Source: [Assertions And Results § Protocol Layer](../authoring/assertions-and-results.md#protocol-layer-structured-outcomes), [Failure Artifacts](../authoring/failure-artifacts.md),
[Glossary § Test Outcome](#test-outcome).

## AssertionNode

A lazy assertion-protocol value consumed by the engine and normalized into
structured outcomes. Direct engine consumers may return an `AssertionNode` or
a non-empty list of them. Ordinary users interact with injected
`scope.assert` / `scope.require` instead of constructing protocol nodes
directly.

Source: [Assertions And Results](../authoring/assertions-and-results.md).

## TestFailure

One structured cause inside a failing `TestOutcome`. Current causes separate
assertion failures, ordinary test-body errors, and test-contract failures
such as no assertions or a plan mismatch.

Source: [Assertions And Results § Protocol Layer](../authoring/assertions-and-results.md#protocol-layer-structured-outcomes).

## Plan

A declared assertion-count contract on a test. `plan(3)` requires exactly
three assertion boundaries before completion.

Source: [Assertions And Results](../authoring/assertions-and-results.md).

## Capability Handle

A typed value implementing an effect interface such as `Clock`, `Random`,
`FileSystem`, or `HttpClient`. Runtimes may be composed from capability
handles using real, deterministic, or recording implementations.

Source: [Capability Handles](../authoring/capability-handles.md).

## Harness

A reusable test-side constructor that assembles a subject under test plus
the parts needed to observe or override it, typically with defaults and
sparse overrides.

Source: [Test Ergonomics](../authoring/test-ergonomics.md).

## Interaction Transcript

A recorded ordered log of interactions such as function calls, emitted
events, subscription callbacks, or state notifications.

Source: [Test Ergonomics](../authoring/test-ergonomics.md).

## Recording Handle

A capability handle that also records each invocation as a typed event for
later assertions.

Source: [Capability Handles](../authoring/capability-handles.md).

## Baseline

A checked-in artifact compared during runs and updated only intentionally.
Subtypes share review, diff, explicit update, and stale-detection workflow
but differ in semantics.

Source: [Baselines And Snapshots](../authoring/baselines-and-snapshots.md).

## Baseline Subtype

One of the supported baseline kinds such as `content-snapshot`,
`visual-snapshot`, `terminal-snapshot`, or `performance-baseline`. They
share storage/update workflow but differ in comparison logic and policy
semantics.

Source: [Baselines And Snapshots](../authoring/baselines-and-snapshots.md).

## Witness

A serialised reproduction artifact produced by failing property or
deterministic-simulation tests. Replaying a witness reproduces one failing
case directly.

Source: [Failure Artifacts](../authoring/failure-artifacts.md),
[Deterministic Simulation Testing](../authoring/deterministic-simulation.md).

## Artifact Identity

A stable structured identifier for a test, case, runtime, workload, or
artifact. Identity is a value, not a path; paths are derived from it.

Source: [Artifact Identity](../architecture/artifact-identity.md).

## Reporter

A package that consumes structured run events or finished run results and
produces human-readable or machine-readable output. Reporters have either a
real-time or final-result lifecycle.

Source: [Package Architecture](../architecture/package-architecture.md).

## Sink

A typed output target a reporter writes to, such as `stdout`, `stderr`,
`file`, `directory`, `memory`, or an embedder-provided `stream`.

Source: [Package Architecture](../architecture/package-architecture.md), [Runtime Behavior](../architecture/runtime-behavior.md).

## Run

One Overkill invocation, from caller intent through resolution, execution,
reporting, and optional record persistence.

Source: [Package Architecture](../architecture/package-architecture.md), [Reproducibility](../architecture/reproducibility.md).

## TestPlan

The engine-owned executable test plan. It contains selected in-process case
entries and callable bodies that `execute(testPlan)` can run. It is not
persisted as a run record because functions are not serializable. Direct
engine execution does not involve `@overkill-dev/run`, discovery,
configuration loading, or CLI behavior.

Source: [Package Architecture](../architecture/package-architecture.md), [Reproducibility](../architecture/reproducibility.md).

## RunFacts

The serializable facts that describe one resolved invocation for reports,
records, replay, and remote work assignment: seed, identities, runtime
matrix, execution strategy, capability profile, loader configuration,
versions, and debug selection.

Source: [Reproducibility](../architecture/reproducibility.md), [Types Index](./types-index.md).

## ResolvedRun

The in-memory value returned by `resolveRun(command)`. It links the original
`RunRequest`, explicit `RunConfig`, serializable `RunFacts`, executable
`TestPlan`, and reporter instances for one invocation.

Source: [Package Architecture](../architecture/package-architecture.md), [Types Index](./types-index.md).

## Execution Requirement

A constraint contributed by a resource or higher-level package that
influences execution-strategy resolution. Requirements may be hard
(mandatory) or soft (preference).

Source: [Higher Test Layers § Resource Factories](../authoring/higher-test-layers.md#1-resource-factories-as-the-main-higher-layer-primitive), [Package Architecture](../architecture/package-architecture.md).

## Run Result

The final structured outcome of a run: per-test verdicts, captured
artifacts, run-level summary, runner errors, and related metadata.

Source: [Failure Artifacts](../authoring/failure-artifacts.md), [Package Architecture](../architecture/package-architecture.md).

## Orphaned Node

A `TestNode` that was constructed during collection but that no run
root reaches, so the runner never executes it. Detected exactly, by
identity, as the set difference between the engine-constructed nodes and the
reachable nodes; surfaced as an informational list in the run record,
not a failure.

Source: [Run Counts § Orphan Detection](../architecture/run-counts.md#orphan-detection).

## World

A typed bag of capability handles passed to a test as part of its context.
This is one possible injection pattern, not an Overkill requirement or
official package shape.

Source: [Capability Handles](../authoring/capability-handles.md).

## Scenario

A stable, speaking preset of simulation or runtime behavior, such as
`default`, `logged-in`, or `payments-500`.

Source: [Deterministic Simulation Testing](../authoring/deterministic-simulation.md).

## Stale Baseline

A baseline artifact that no longer corresponds to any collected test
identity. Stale baselines fail the run by default and require an explicit
cleanup verb such as `overkill baseline apply`.

Source: [Baselines And Snapshots](../authoring/baselines-and-snapshots.md).

## Selection

The orchestration-level operation of filtering a `TestNode` tree to a
subset based on metadata, identity, file path, or kind.

Source: [Metadata And Selection](../architecture/metadata-and-selection.md).

## Microtask vs Macrotask Scheduling

JavaScript runs work in two queues: microtasks (`queueMicrotask`, Promise
callbacks) and macrotasks (`setTimeout`, I/O callbacks). The
deterministic-simulation layer may virtualise both.

Source: [Deterministic Simulation Testing](../authoring/deterministic-simulation.md).

## RunRequest

Caller intent for one Overkill invocation. It is owned by
`@overkill-dev/run` and mirrors meaningful CLI run flags as typed
programmatic fields.

Source: [Package Architecture](../architecture/package-architecture.md), [Types Index](./types-index.md).

## RunRecord

The persisted artifact describing one completed run: the `RunFacts` plus
per-test outcomes/verdicts, artifacts, summary, runner errors, and runtime
metadata.

Source: [Reproducibility § Run Record Shape](../architecture/reproducibility.md#run-record-shape), [Types Index](./types-index.md).

## Runner Error

Distinct from a test failure. A runner error is an unexpected exception,
rejection, crash, permission denial, or runtime failure that prevents the
runner from producing a clean `TestOutcome`.

Source: [Assertions And Results § Error Separation](../authoring/assertions-and-results.md#error-separation), [Failure Artifacts](../authoring/failure-artifacts.md).

## Crash Budget

The maximum number of worker process crashes Overkill tolerates in one run
before aborting with a runner error.

Source: [Runtime Behavior § Process Crash Handling](../architecture/runtime-behavior.md#process-crash-handling).

## Resource Budget

A per-profile ceiling for runtime resources such as JavaScript engine heap,
resident set size, resident-set growth, or active resource count. Node-first
resource budgets are enforced in supervised process-boundary profiles.

Source: [Runtime Behavior § Resource Budgets](../architecture/runtime-behavior.md#resource-budgets).

## Resource Exhaustion

A distinct test verdict and runner-error subtype used when an active test
exceeds an enforced resource budget. It is not an assertion failure and not a
timeout.

Source: [Runtime Behavior § Resource Budgets](../architecture/runtime-behavior.md#resource-budgets), [Failure Artifacts § Resource Exhaustion Artifacts](../authoring/failure-artifacts.md#resource-exhaustion-artifacts).

## Attribution Drift

When the runner cannot reliably attribute an async failure to the test that
caused it, the misattribution is called attribution drift.

Source: [Runtime Behavior § Unhandled Rejections And Uncaught Exceptions](../architecture/runtime-behavior.md#unhandled-rejections-and-uncaught-exceptions), [Failure Artifacts § Attribution Rules](../authoring/failure-artifacts.md#attribution-rules).

## Soft Timeout vs Hard Timeout

A **soft timeout** flags a test that exceeded its deadline but allows it to
finish. A **hard timeout** force-terminates execution where the profile can
own a worker/process boundary.

Source: [Runtime Behavior § Timeouts](../architecture/runtime-behavior.md#timeouts), [Microtests And Capabilities § Hang Detection And Forced Termination](../authoring/microtests-and-capabilities.md#hang-detection-and-forced-termination).

## Assertion-Recording Boundary

The boundary at which a property-family primitive contributes one recorded
assertion regardless of how many internal iterations or checks it performs.

Source: [Assertions And Results § Property Tests And The Assertion Boundary](../authoring/assertions-and-results.md#property-tests-and-the-assertion-boundary).

## Microtask Flush

The async-control helper that drains the microtask queue without advancing
macrotasks.

Source: [Test Ergonomics § Async-Control Helpers](../authoring/test-ergonomics.md#async-control-helpers).
