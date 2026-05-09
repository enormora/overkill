# Non-Goals

## Purpose

Concept docs scatter their rejections across many files. This doc
collects them in one place so the rejections are visible to reviewers,
contributors, and downstream package authors without re-litigation per
topic.

Two categories live here:

-   **Settled rejections** — directions Overkill has decided against. Each
    entry names what is rejected, why, where the rejection lives in the
    canonical docs, and the accepted alternative.
-   **Deferred with research** (see the section near the end) — directions
    rejected for the _current_ concept but with a preserved record of the
    research already done and the conditions under which the decision
    would be revisited. `@overkill/world` and in-source tests live here.

## Authoring And API Shape

### No always-on global test API

Overkill does not inject `describe`/`it`/`test` as ambient globals.

Why: hidden injection makes registration order, isolation, and types
opaque, and forces the runner to control every entry point.

Where: `principles.md` § No Magic, `architecture-decisions.md` § Default
Authoring Model.

Alternative: explicit imports from `@overkill/test`.

### No first-party `.skip` / `.only`

Overkill rejects `.only` / `.skip` chains as the in-source iteration
mechanism.

Why: inline modifiers encourage one-test-at-a-time hacks that escape
review and conflict with selection-as-orchestration.

Where: `architecture-decisions.md` § Default Authoring Model,
`metadata-and-selection.md` § Local Iteration Workflow.

Alternative: CLI selection (`--name`, `--file`, `--id`, `--last-failed`,
`--changed`).

### No Sinon-style doubles surface

`@overkill/doubles` does not ship `spy` / `fake` / `stub` / `mock` /
`sandbox` as separate concepts.

Why: overlapping nouns and mutable chaining trade clarity for power.

Where: `doubles.md` § Why Not A Sinon-Style Surface.

Alternative: a single `testDouble()` plus composable rule helpers
(`when`, `onCall`, `returns`, `resolves`, `rejects`, `throws`, etc.).

### No object-method or module replacement in first-party doubles

Overkill does not ship a first-party API for replacing methods on
existing objects or for module mocking.

Why: both depend on private internals or loader interception that
breaks under refactoring and conflicts with capability-restricted
microtests.

Where: `doubles.md` § Position, `architecture-decisions.md` § Doubles.

Alternative: explicit dependency injection plus capability handles when
the collaborator is a typed effect interface.

## Runtime Architecture

### No persistent runner daemon

Overkill does not ship a long-lived `overkill daemon` socket-based
runner.

Why: warm reuse adds long-lived state, socket protocol, and lifecycle
management — and the optimization target is cold start, not warm
steady-state (see `principles.md` § Cold Start Is The Budget).

Where: `fast-feedback-loops.md` § 11. Out-of-the-box ideas for fast
startup.

Alternative: V8 startup snapshot of the runner core, lazy plugin
imports, pre-resolved file lists.

### No bespoke loader hooks in the default story

Overkill does not require `module.register` / `module.registerHooks`
hooks for ordinary use.

Why: loader hooks add startup overhead and complicate cold-start
budgets (see `principles.md` § Cold Start Is The Budget); they also
tend to surprise tooling.

Where: `fast-feedback-loops.md` § 5. Loader Hooks.

Alternative: Node's built-in TypeScript stripping; transform mode only
where the file actually needs it.

### No module-graph dependency tracking in core

Overkill does not maintain its own per-test reverse-import graph.

Why: building, persisting, and invalidating a graph adds complexity
that the path-level `--changed` selector covers for most teams.

Where: removed from `fast-feedback-loops.md` (was § 11. Module graph
caching without Vite); `metadata-and-selection.md` § Local Iteration
Workflow notes the path-level scope.

Alternative: path-level change detection. True TIA is tracked as open
research in `novel-techniques.md`.

### No custom strip / V8 cache layer by default

Overkill does not ship its own strip cache or bytecode cache.

Why: Node's module compile cache covers bytecode reuse, and the strip
cost is single-digit milliseconds per file. A custom warm cache would
need to clear `principles.md` § Cold Start Is The Budget — it cannot
penalize the cold path.

Where: `fast-feedback-loops.md` § 4. Sharing parsed sources between
tests in the same process.

Alternative: rely on Node's compile cache. Add a custom cache only if
measurement on a real workload justifies it.

### No custom watch implementation

Overkill does not maintain its own file watcher.

Why: Node's `--watch` is sufficient as the default; closure-aware
reruns require the dependency graph that we explicitly do not maintain.

Where: `runtime-behavior.md` § Watch-Mode Targeting,
`fast-feedback-loops.md` § 7. Watch and reload.

Alternative: Node `--watch`. Future TIA-driven smart watch is open
research.

### No custom type-test engine

Overkill does not implement its own TypeScript type checker for
`expect-type` / `assert-type` style tests.

Why: type checking belongs to `tsc`; reimplementing it duplicates a
moving target and ties Overkill releases to TS releases.

Where: `architecture-decisions.md` § Planned Integration Direction,
`fast-feedback-loops.md` § 11.

Alternative: integrate with [tstyche](https://tstyche.org/) and surface
its results through the Overkill reporter pipeline.

### No CI auto-detection

Overkill does not switch behavior based on `process.env.CI` or
per-provider env vars. There is no `--ci` / `--no-ci` flag, no
auto-switched reporter, no environment-based gate on baseline writes,
and no auto-tightened defaults in CI.

Why: environment-based behavior switching is a hidden side channel
(see `principles.md` § No Magic, § Explicit Over Implicit). The same
invocation should produce the same behavior on a developer host and a
CI host; differences belong in explicit configuration or explicit
flags.

Where: `runtime-behavior.md` (the previous § CI Auto-Detection has
been removed in favour of unconditional defaults).

Alternative: pick the reporter, timeouts, and stale-baseline policy
in `overkill.config.ts`. CI workflows that want different behavior
configure it explicitly.

## Distribution And Coverage

### No always-on coverage in the default run mode

Overkill does not enable code coverage instrumentation by default.

Why: instrumentation slows microtests and rarely matters per-iteration.

Where: `microtests-and-capabilities.md`, `coverage.md`.

Alternative: explicit opt-in (`overkill run --coverage`) using
external coverage tooling.

### No coverage outside microtest profiles

Coverage is restricted to microtest profiles. Integration, browser,
and benchmark profiles reject `--coverage`.

Why: integration tests broad-path through code (their coverage reads
as "everything was hit," uninformative); benchmarks cannot be
instrumented without distorting timing; browser tests have their own
coverage story via the browser's instrumentation. Restricting to
microtests keeps the API surface small.

Where: `coverage.md` § Position.

Alternative: per-profile coverage stories handled outside Overkill —
browser instrumentation in the browser test rig, integration coverage
via external tooling if a team genuinely wants it.

## Reporting And Identity

### No allowEmpty escape hatch for zero-assertion tests

Overkill rejects `{ allowEmpty: true }` per-test metadata and any
global override that lets a zero-assertion test pass.

Why: an "exit ramp" from the contract — see `principles.md` § The
Suite Is A Contract.

Where: `assertions-and-results.md` § Zero-Assertion Detection As
Default Failure.

### No automatic rename inference for renamed tests

Overkill does not match renamed tests to old baselines via heuristics
(no fuzzy name match, no content similarity, no path-prefix guessing).

Why: silent reuse is more dangerous than visible staleness.

Where: `artifact-identity.md` § Identity Across Renames,
`baselines-and-snapshots.md` § Stale Artifact Handling.

Alternative: a renamed test surfaces as a stale orphan (the old
baseline) plus a missing new baseline. The developer accepts both
deliberately by running `overkill baseline apply`, which creates the
new baseline and removes the orphan in one reviewable diff.

### No dedicated package/workspace identity field

Overkill identity does not carry a separate package or workspace key
inside `CaseId`.

Why: the `file` field, repo-relative to the resolved project root, is
already enough to disambiguate.

Where: `artifact-identity.md` § Resolved Identity Rules.

### No exit-code remap

Overkill does not collapse zero-test exit code 4 onto failure exit
code 1.

Why: collapsing destroys the distinction between "test failure" and
"no tests collected" exactly where consumers most need it.

Where: `runtime-behavior.md` § Zero-Test Runs, § Exit Codes And
`process.exit`.

Alternative: consumers that want a single failure threshold can treat
any non-zero exit as failure themselves.

## Testing Models

### No flaky-test retry in microtests

Overkill does not retry microtests as a normal mode.

Why: an "exit ramp" from the contract — see `principles.md` § The
Suite Is A Contract.

Where: `metadata-and-selection.md` § Stability Markers,
`microtests-and-capabilities.md`.

Alternative: integration-style profiles may opt into retries with
attribution-preserving artifacts. Microtests do not.

### No quarantine workflow

Overkill does not ship a "known-flaky, allow to fail without gating"
mode.

Why: an "exit ramp" from the contract — see `principles.md` § The
Suite Is A Contract.

Where: `metadata-and-selection.md` § Stability Markers (Quarantine
glossary entry was removed in the same direction).

Alternative: stability markers as reporting metadata only; CI gates use
verdict, not quarantine. A flaky test is fixed or deleted, not parked.

## Plugin And Extension Surface

### No heavy plugin runtime

Overkill does not ship a plugin container, lifecycle bus, or
configuration-driven hook system.

Why: stable package contracts are enough; a plugin runtime adds
indirection without unique reach.

Where: `extensions-and-plugins.md` § Plugin Philosophy,
`architecture-decisions.md` § Bundles, Metadata, And Extensions.

Alternative: stable APIs in `@overkill/engine`, orchestration-level
composition in `@overkill/run`, and config-driven attachment for
discovered surfaces (reporters, baseline adapters).

## Deferred With Research

These directions are rejected for the _current_ concept but the door is
not fully closed. Each preserves the research already done, names what
would have to change for revival, and explains why the deferral is not
just a parking-lot punt.

### `@overkill/world` (production-facing capability container)

Status: rejected for the current concept; revisit if the production-code
boundary changes.

What it would have been: a first-class package for declaring application
capabilities — explicit boundaries, typed recording handles, deterministic
helpers for effectful collaborators, reusable recorder and snapshot
helpers.

Why deferred: consumer production code should not need to import Overkill
packages (see `principles.md` § Keep Production Code Clean). If
`@overkill/world` became the canonical way to define application handles,
it would turn into a production-facing architecture dependency. That
crosses a boundary the current concept will not cross.

What would change to revive: a test-only helper layer that does not pull
Overkill into production runtime, or a deliberate scope expansion of
Overkill's role beyond the testing side of the boundary.

Where: `principles.md` § Keep Production Code Clean,
`capability-handles.md` § Current Stance,
`ideas-and-future-directions.md` (cross-reference).

Alternative: capability handles documented as a _user architecture_
pattern; `@overkill/doubles` covers test-side function replacement.

### In-source / colocated tests

Status: rejected as the default authoring model; tracked as background
research only.

What it would have been: tests living alongside production code, in the
shape of Rust's `#[cfg(test)]` blocks or Zig's `test "name" {}` bodies.
The "test next to the code" argument has merit, and Rust and Zig
demonstrate the general shape works in compiled languages.

Why deferred:

-   the JS tooling ecosystem treats tests as file-pattern-based; an
    in-source model would have to fight that grain
-   production stripping requires a compiler step Overkill does not own;
    a custom loader or transform fights the Node-builtins-first
    direction
-   sentinel-based approaches such as `if (import.meta.test) { ... }`
    put an Overkill-aware import in production code, breaking the
    "consumer production code does not import Overkill" rule
-   the DX is not clearly better than separate test files

What would change to revive: the JS shipping and tooling story changes
materially (e.g. native in-source-test stripping in a runtime), or
Overkill's scope shifts to own a transform pipeline.

Where: `architecture-decisions.md` § Default Authoring Model,
`microtests-and-capabilities.md` § In-Source Microtests,
`novel-techniques.md` Recommended Path note.

## What This Doc Is Not

This file does not list every feature deferred to a later release. It
lists _decided-against_ directions — both settled rejections and the
deferred-with-research entries above. For deferred-but-likely items see
`ideas-and-future-directions.md`; for open research items see
`novel-techniques.md`.
