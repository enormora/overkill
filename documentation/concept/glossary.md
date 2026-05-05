# Glossary

## Purpose

Several terms in the Overkill concept docs are used in slightly different
ways across files. This glossary is the canonical definition. When other
docs use these terms, they should be read as referring to the definitions
here.

## Microtest

A test that runs under a strict capability model by default (denied
filesystem writes, network access, child processes, workers, addons), is
expected to be deterministic and locally scoped, and is optimized for the
fastest feedback loop.

"Microtest" is **not** synonymous with "small" or "fast" or "unit." Size and
speed are *consequences* of the capability boundary; the boundary is the
defining property.

A test is a microtest if and only if it runs in a microtest *capability
profile*. Two tests with identical bodies but different profiles are
different tests.

Source: `microtests-and-capabilities.md`.

## Test Macro

A function that takes parameters and returns a `TestNode` (typically a
`Suite` or a `Table`). Macros are the recommended cross-cutting reuse
mechanism for tests, replacing hooks and shared mutable setup.

Examples: `lawsOfMonoid({ ... })` returns three property tests for monoid
laws; `crudCases(resource)` returns a table of CRUD tests for a resource;
`themeSnapshots(component)` returns one snapshot test per registered
theme.

A macro is not a metaprogramming construct. It is just a function that
constructs values. The TypeScript type system is the only "macro engine."

Source: `tests-as-values.md`.

## Test Kind

A closed enumeration that classifies the testing mode of a `TestNode`. The
first-party kinds:

-   `microtest`
-   `integration`
-   `browser`
-   `benchmark`
-   `type-test`
-   `property`
-   `simulation` (deterministic-simulation tests)
-   `approval`

Higher-level packages may extend the enumeration with additional kinds via
the engine's metadata contract; the core kinds are stable.

Source: `metadata-and-selection.md`, `testing-models.md`.

## Capability Profile

A named set of allowed runtime capabilities (filesystem read, filesystem
write, network, child process, worker, addons, WASI). The runner applies
the profile via Node's `--permission` flags plus runner-owned escape
hatches (coverage artifact directory, baseline update directory, strip
cache, V8 cache).

Standard profiles:

-   `micro-strict` — denies almost everything; the default microtest
    profile
-   `micro-supervised` — same denials, plus subprocess supervision for
    crash-only recovery
-   `micro-with-coverage` — micro-strict with a narrow exception for
    coverage writes
-   `integration-local` — allows FS write within a per-test temp dir,
    loopback net, child process
-   `benchmark-process` — integration-local plus single-worker
    serialization

A capability profile is a *permission* concept. It is distinct from
execution strategy.

Source: `microtests-and-capabilities.md`.

## Execution Strategy

A resolved decision about how the runner *executes* a set of tests:
process model, worker count, isolation grain, scheduling policy. Examples:

-   `serial` — one test at a time in a single process
-   `concurrent-in-process` — multiple tests' async work interleaves in
    one process
-   `worker-pool` — N worker threads, file-level distribution
-   `process-per-file` — subprocess per test file
-   `single-worker-serial` — single worker thread, no concurrency

An execution strategy is resolved by `@overkill/run` from package-provided
constraints (resources, benchmarks, browser environments) and runner
configuration. It is distinct from a capability profile.

A given run uses one execution strategy at a time, but different parts of
the test plan may run under different strategies (e.g. microtests in
worker-pool, benchmarks in single-worker-serial).

Source: `runtime-behavior.md`, `package-architecture.md`.

## Runner Profile

A bundle of `(capability profile, execution strategy, runner configuration)`
that is referred to by name. Common profiles:

-   `default` — the integration-local profile with a worker pool
-   `microtest` — the micro-strict profile with serial execution in-process
-   `benchmark` — the benchmark-process profile with single-worker-serial
-   `simulation` — deterministic-simulation profile

Users select a runner profile via CLI or config. The profile resolves to
specific capability + execution + reporter choices.

Source: `microtests-and-capabilities.md`, `package-architecture.md`.

## Suite

A `TestNode` that groups other nodes (`TestCase`, `Table`, nested
`Suite`) under a name. Suites are minimal grouping constructs in
Overkill; they do not carry hooks, shared mutable state, or hierarchical
lifecycle. They exist for naming, identity composition, and metadata
inheritance only.

Source: `tests-as-values.md`, `package-architecture.md`.

## Table / Parameterized Test

A `TestNode` that pairs a single test body with a list of cases. Each case
becomes a distinct expanded test in the run plan. Tables are the
recommended replacement for `it.each` / `test.each` patterns and produce
stable per-case identities.

Source: `tests-as-values.md`.

## Test Verdict

The outcome category of a test run. Overkill uses a richer ADT than
`pass | fail | skip`:

-   `pass` — assertions held
-   `fail` — assertions did not hold (specific failed checks reported)
-   `skip` — explicitly skipped with a reason
-   `inconclusive` — the runner could not observe the test (environment
    unhealthy, missing precondition)
-   `expected-fail` (xfail) — the test failed and was expected to
-   `unexpected-pass` (xpass) — the test passed despite being marked xfail
-   `quarantined` — known-flaky, allowed to fail without gating
-   `crashed` — the worker process died during the test (runner-error
    sub-kind)

Each verdict has a payload: a list of failed checks for `fail`, a reason
string for `skip`/`inconclusive`/`quarantined`, etc.

Source: `results-not-exceptions.md`, `novel-techniques.md`.

## Check

A typed value produced by an assertion, with kind `'pass'` or `'fail'`. A
test body returns a check (or a tree of checks). The runner reads the
result; assertions do not throw.

Source: `results-not-exceptions.md`.

## Plan

A declared assertion-count contract on a test. `plan(3, check)` requires
the wrapped composite check to contain exactly three leaf checks. A test
that runs more or fewer leaves is a `fail`. Plans are decorators on
returned check values, not mutable global counters.

Source: `assertions-and-results.md`, `results-not-exceptions.md`.

## Capability Handle

A typed value implementing an effect interface (`Clock`, `Random`,
`FileSystem`, `HttpClient`, `Logger`, ...). Tests receive a `World` of
capability handles; the production world is built from real
implementations, the test world from deterministic recorders.

Capability handles are the canonical alternative to mocking.

Source: `capability-handles.md`.

## Recording Handle

A capability handle that, in addition to implementing its interface, logs
every invocation as a typed event. Tests assert on the recorded log
directly; this replaces `expect(mock).toHaveBeenCalledWith(...)` patterns.

Source: `capability-handles.md`.

## Authority Token

An opaque branded value that grants permission for a runner-owned
operation (writing coverage artifacts, updating baselines, collecting
snapshots). User code cannot forge a token; the runner constructs and
passes them. Distinct from capability handles in that authority tokens
gate *runner* operations, not *effect* operations.

Source: `capability-handles.md`.

## Baseline

A checked-in artifact compared during runs and updated only intentionally.
Subtypes: content snapshot, visual baseline, terminal baseline,
performance baseline. The shared workflow (review, diff, explicit update,
stale detection) is unified under one baseline concept; the semantics
diverge per subtype.

Source: `baselines-and-snapshots.md`.

## Baseline Subtype

One of:

-   `content-snapshot` — serialized data, exact comparison
-   `visual-snapshot` — image / DOM / aria-tree, domain-aware comparison
-   `terminal-snapshot` — terminal rendering with normalisation rules
-   `performance-baseline` — metric values with thresholds, percentiles,
    calibration

Subtypes share storage and update workflow, differ in comparison logic
and policy semantics.

Source: `baselines-and-snapshots.md`.

## Witness

A serialised reproduction artifact produced by failing property tests and
deterministic-simulation tests. Contains the seed, shrink path, captured
world snapshot, fault configuration, and library version. Loading the
witness reproduces the failure bit-for-bit without re-shrinking.

Source: `novel-techniques.md`, `deterministic-simulation.md`.

## Artifact Identity

A stable structured identifier for a test, case, environment, workload, or
artifact. Composed from file/module origin, suite name, test name,
parameterization key, environment key, workload key, and artifact subtype.
Used for selection, baseline lookup, stale detection, reproducibility,
benchmark policies, and reporter output.

The identity is a value, not a path. The path is a derivation of the
identity.

Source: `artifact-identity.md`.

## Reporter

A package that consumes structured run events or finished run results and
produces human-readable or machine-readable output. Reporters are
attachable per-run; multiple reporters may be active simultaneously,
subject to sink-conflict resolution.

Two lifecycle modes:

-   real-time — observes `start`, progress, completion events
-   final-result — only consumes the finished result

Source: `package-architecture.md`.

## Sink

A typed output target a reporter writes to. Kinds:

-   `stdout` — process standard output (TTY or pipe)
-   `stderr` — process standard error
-   `file` — a path or directory under runner control
-   `directory` — multiple files under a directory
-   `memory` — in-process buffer for programmatic consumers
-   `stream` — a `WritableStream` provided by the embedder

Sinks declared by reporters allow the orchestration layer to detect
conflicts (e.g. two reporters claiming `stdout`).

Source: `package-architecture.md`, `runtime-behavior.md`.

## Execution Plan

A resolved, ordered, structured representation of what the runner will do:
the set of expanded test cases, their identities, their assigned execution
strategy, their assigned worker / process, their resource requirements,
their pre/post hooks (where present in higher-level packages), and the
seed / metadata under which they will run.

Produced by `@overkill/run` from a `TestNode` tree, runner profile,
filters, and resource constraints. Consumed by execution machinery and
preserved as part of the run record for reproducibility.

Source: `package-architecture.md`, `reproducibility.md`.

## Execution Requirement

A constraint contributed by a resource or higher-level package that
influences execution-strategy resolution. Two flavors:

-   hard — must be satisfied (e.g. exclusive access to a shared resource)
-   soft — preference (e.g. preferred worker count)

Resolution rules:

-   hard constraints are unioned; conflicts are reported as orchestration
    errors
-   soft preferences are reconciled by deterministic priority order

Source: `environments-and-fixtures.md`, `package-architecture.md`,
`open-questions.md`.

## Run Result

The final structured outcome of a run: per-test verdicts, per-test
captured artifacts, run-level summary, runner errors, environment
metadata, seed, total wall-time, plan identity. Final-result reporters
consume this value; real-time reporters consume the events that produce
it.

Source: `failure-artifacts.md`, `package-architecture.md`.

## World

A typed bag of capability handles passed to a test as part of its context.
The production world is built from real implementations; the test world
is built from deterministic recorders. Tests receive a `World` (or a
narrower subset) and perform all effects through it.

Source: `capability-handles.md`.

## Quarantine

A metadata flag on a test indicating it is known-flaky and allowed to
fail without gating the overall run. Quarantined failures are reported
distinctly from non-quarantined failures and from passes. Quarantine is
visible to filters, reporters, and CI gates.

Source: `metadata-and-selection.md`, `runtime-behavior.md`.

## Stale Baseline

A baseline artifact that no longer corresponds to any collected test
identity. Detected after a run by comparing baseline files on disk
against the set of identities seen. Stale baselines fail the run by
default; an explicit cleanup or update mode is required to remove them.

Source: `baselines-and-snapshots.md`.

## Selection

The orchestration-level operation of filtering a `TestNode` tree to a
subset based on metadata, identity, file path, or kind. Selection is
deterministic given the same tree and filter expression. Composes with
sharding (sharding partitions the result of selection).

Source: `metadata-and-selection.md`.

## In-Source Test

A test whose source lives inside a non-test source file, gated by
`if (import.meta.test) { ... }` or an equivalent sentinel. The runner's
loader registers the inner suite when in test mode and strips the block
in production builds.

Source: `microtests-and-capabilities.md`, `novel-techniques.md`,
`fast-feedback-loops.md`.

## Microtask vs Macrotask Scheduling

JavaScript runs work in two queues: microtasks (`queueMicrotask`,
Promise callbacks) and macrotasks (`setTimeout`, I/O callbacks). The
deterministic-simulation layer virtualises both. Documents that mention
"scheduler" without further qualification refer to whichever layer of
Overkill owns the queue at that moment (real platform scheduler outside
simulation; the virtual scheduler inside simulation).

Source: `deterministic-simulation.md`.
