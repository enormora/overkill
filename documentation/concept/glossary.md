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
speed are _consequences_ of the capability boundary; the boundary is the
defining property.

A test is a microtest if and only if it runs in a microtest _capability
profile_. Two tests with identical bodies but different profiles are
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

## Generated-Case Macro

A macro whose main purpose is to expand into multiple concrete test cases at
once.

Typical uses:

-   schema field matrices
-   parser cases
-   reusable law or contract checks

Generated-case macros are still macros, not a separate parameterization
philosophy. The important extra requirement is that generated failures keep
meaningful names and useful stack traces.

Source: `test-ergonomics.md`.

## Case Context

The injected context object passed to a first-party `@overkill/test` test
body. The documentation examples prefer the local variable name `case`.

The case context may expose:

-   `assert`
-   `require`
-   `plan`
-   advanced helpers such as `flushAsync()`, `microtasks()`, `immediate()`,
    or `inFlight(...)`

Users may still choose different local variable names.

Source: `assertions-and-results.md`, `test-ergonomics.md`.

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

A capability profile is a _permission_ concept. It is distinct from
execution strategy.

Source: `microtests-and-capabilities.md`.

## Execution Strategy

A resolved decision about how the runner _executes_ a set of tests:
process model, worker count, isolation grain, scheduling policy. Examples:

-   `serial` — one test at a time in a single process
-   `concurrent-in-process` — multiple tests' async work interleaves in
    one process
-   `worker-pool` — N worker threads, file-level distribution
-   `process-per-file` — subprocess per test file
-   `single-worker-serial` — single worker thread, no concurrency

An execution strategy is resolved by `@overkill/run` from package-provided
constraints (resources, benchmarks, browser runtimes) and runner
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
parameterized-test shape. Macros remain the primary reuse mechanism; a macro
may itself return a table when parameterization is the right representation.

Source: `tests-as-values.md`.

## Test Outcome

The engine-level outcome of a test run. The `TestOutcome` ADT (see
`results-not-exceptions.md`) has four cases:

-   `pass` — assertions held
-   `fail` — assertions did not hold (specific failed checks reported)
-   `skip` — explicitly skipped with a reason
-   `inconclusive` — the runner could not observe the test (runtime
    unhealthy, missing precondition)

Each outcome has a payload: a list of failed checks for `fail`, a reason
string for `skip`/`inconclusive`, etc.

Source: `results-not-exceptions.md`.

## Test Verdict

The reporter-facing category for a test run. A verdict is derived from
the engine `TestOutcome` plus metadata available at orchestration time.
Three additional verdicts beyond the four outcomes:

-   `expected-fail` (xfail) — outcome was `fail` and the test carried
    xfail metadata; reported as success-equivalent
-   `unexpected-pass` (xpass) — outcome was `pass` despite xfail
    metadata; reported as a failure of the xfail expectation
-   `crashed` — the worker process died during the test; the engine
    never produced a `TestOutcome`. Reported as a runner-error sub-kind
    (see `failure-artifacts.md`)

Verdicts are a presentation concept owned by orchestration and
reporters, not by `@overkill/engine`. The engine returns outcomes;
verdicts come from `(outcome, metadata, runner-error?)`.

Source: `results-not-exceptions.md`, `failure-artifacts.md`,
`novel-techniques.md`.

## AssertionNode

A typed low-level value produced by assertion constructors such as
`assertion.equal(...)`. Builder APIs may record these nodes implicitly and
return them through `assert.done()`. The engine consumes structured assertion
results; ordinary users usually interact with injected `assert` / `require`
instead of raw nodes.

Source: `assertions-and-results.md`, `results-not-exceptions.md`.

## Plan

A declared assertion-count contract on a test. `plan(3)` requires the test to
record exactly three leaf assertions before completion. A test that runs more
or fewer leaves is a `fail`. Plans are explicit test-local state, not hidden
global counters, and they work with both builder-style assertions and the
explicit throwing mode.

Source: `assertions-and-results.md`, `results-not-exceptions.md`.

## Capability Handle

A typed value implementing an effect interface (`Clock`, `Random`,
`FileSystem`, `HttpClient`, `Logger`, ...). Tests may receive a runtime
object composed from capability handles; the production runtime is built from real
implementations, the test runtime from deterministic or recording variants.

Capability handles are one promising alternative to mocking.

Source: `capability-handles.md`.

## Harness

A reusable test-side constructor that assembles a subject under test plus the
parts needed to observe or override it. Harnesses usually provide:

-   default doubles or fixtures
-   sparse override support
-   the constructed subject
-   direct access to the interaction handles used in assertions

Harnesses are test-only ergonomics. They do not imply production-side
framework coupling.

Source: `test-ergonomics.md`.

## Interaction Transcript

A recorded ordered log of interactions such as:

-   function calls
-   emitted events
-   subscription callbacks
-   state notifications

The important abstraction is the ordered transcript, not a specific event
emitter type.

Source: `test-ergonomics.md`.

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
gate _runner_ operations, not _effect_ operations.

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

A serialised reproduction artifact produced by failing property tests
and deterministic-simulation tests. Loading the witness reproduces the
failure without re-running shrinking. The canonical schema
(`WitnessFile`) is defined in `failure-artifacts.md` § Witnesses And
Replay Artifacts.

Source: `failure-artifacts.md`, `novel-techniques.md`,
`deterministic-simulation.md`.

## Artifact Identity

A stable structured identifier for a test, case, runtime, workload, or
artifact. The engine-level identity stays generic; higher-level packages such
as `@overkill/test` may derive richer identity parts from file/module origin,
suite name, test name, parameterization key, runtime metadata, and workload
metadata.

The identity is a value, not a path. The path is a readable derivation of the
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

Source: `runtimes-and-fixtures.md`, `package-architecture.md`,
`architecture-decisions.md`.

## Run Result

The final structured outcome of a run: per-test verdicts, per-test
captured artifacts, run-level summary, runner errors, runtime
metadata, seed, total wall-time, plan identity. Final-result reporters
consume this value; real-time reporters consume the events that produce
it.

Source: `failure-artifacts.md`, `package-architecture.md`.

## World

A typed bag of capability handles passed to a test as part of its context.
The production world is built from real implementations; the test world
is built from test-specific implementations. This is one possible pattern
for explicit dependency injection, not an Overkill requirement or official
package shape.

Source: `capability-handles.md`.

## Scenario

A stable, speaking preset of simulation or runtime behavior. A scenario may
bundle fixture data, authentication state, seeded defaults, service responses,
latency behavior, or fault modes under one reviewed key such as `default`,
`logged-in`, or `payments-500`.

Scenarios are especially useful for deterministic local services and other
simulation-aware runtimes because they give failures and replay artifacts a
shared vocabulary beyond raw flags.

Source: `deterministic-simulation.md`.

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

## Microtask vs Macrotask Scheduling

JavaScript runs work in two queues: microtasks (`queueMicrotask`,
Promise callbacks) and macrotasks (`setTimeout`, I/O callbacks). The
deterministic-simulation layer virtualises both. Documents that mention
"scheduler" without further qualification refer to whichever layer of
Overkill owns the queue at that moment (real platform scheduler outside
simulation; the virtual scheduler inside simulation).

Source: `deterministic-simulation.md`.
