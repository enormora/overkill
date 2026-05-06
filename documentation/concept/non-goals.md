# Non-Goals

## Purpose

Concept docs scatter their rejections across many files. This doc
collects them in one place so the *settled* rejections are visible to
reviewers, contributors, and downstream package authors without
re-litigation per topic.

Each entry names what is rejected, why, where the rejection lives in the
canonical docs, and what (if anything) is the accepted alternative.

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

### No in-source tests as the default authoring model

Overkill does not promote `if (import.meta.test) { ... }`-style in-file
test bodies in source.

Why: it requires a compiler/stripper before shipping production code,
contradicts the "production code does not import Overkill" rule, and
its DX is not clearly better than separate test files.

Where: `architecture-decisions.md` § Default Authoring Model,
`microtests-and-capabilities.md` § In-Source Tests.

Status: tracked as possible future research only (`novel-techniques.md`
Recommended Path note).

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
management that conflict with the "just `node ./foo.test.ts`"
principle. The optimization target is cold start.

Where: `fast-feedback-loops.md` § 11. Out-of-the-box ideas for fast
startup.

Alternative: V8 startup snapshot of the runner core, lazy plugin
imports, pre-resolved file lists.

### No bespoke loader hooks in the default story

Overkill does not require `module.register` / `module.registerHooks`
hooks for ordinary use.

Why: loader hooks add startup overhead, complicate cold-start budgets,
and tend to surprise tooling.

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
cost is single-digit milliseconds per file.

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

## Distribution And Coverage

### No always-on coverage in the default run mode

Overkill does not enable code coverage instrumentation by default.

Why: instrumentation slows microtests and rarely matters per-iteration.

Where: `architecture-decisions.md` § Rejected Or Deferred Directions,
`microtests-and-capabilities.md`.

Alternative: explicit opt-in (`overkill --coverage` / config) using
external coverage tooling.

### No first-party `@overkill/world` package

Overkill does not ship a production-facing capability-handle container.

Why: consumer production code should not need to import Overkill
packages.

Where: `principles.md` § Keep Production Code Clean,
`capability-handles.md` § Current Stance.

Alternative: capability handles documented as a *user architecture*
pattern; `@overkill/doubles` covers test-side function replacement.

## Reporting And Identity

### No allowEmpty escape hatch for zero-assertion tests

Overkill rejects `{ allowEmpty: true }` per-test metadata and any
global override that lets a zero-assertion test pass.

Why: a test that asserts nothing is broken; an opt-out hides defects.

Where: `assertions-and-results.md` § Zero-Assertion Detection As
Default Failure.

### No automatic rename inference for renamed tests

Overkill does not match renamed tests to old baselines via heuristics.

Why: silent reuse is more dangerous than visible staleness.

Where: `artifact-identity.md` § Identity Across Renames.

Alternative: stale baselines are reported as orphans; the developer
removes or re-approves explicitly.

### No dedicated package/workspace identity field

Overkill identity does not carry a separate package or workspace key
inside `CaseId`.

Why: the `file` field, repo-relative to the resolved project root, is
already enough to disambiguate.

Where: `artifact-identity.md` § Resolved Identity Rules.

### No exit-code remap in CI mode

Overkill does not collapse zero-test exit code 4 onto failure exit
code 1 when running on CI.

Why: collapsing destroys the distinction between "test failure" and
"no tests collected" exactly where CI consumers most need it.

Where: `runtime-behavior.md` § CI Auto-Detection.

Alternative: CI consumers that want a single failure threshold can
treat any non-zero exit as failure themselves.

## Testing Models

### No flaky-test retry in microtests

Overkill does not retry microtests as a normal mode.

Why: a flaky microtest is a design failure, not an expected state.

Where: `metadata-and-selection.md` § Stability Markers,
`microtests-and-capabilities.md`.

Alternative: integration-style profiles may opt into retries with
attribution-preserving artifacts. Microtests do not.

### No quarantine workflow

Overkill does not ship a "known-flaky, allow to fail without gating"
mode.

Why: quarantine normalises flake; investigations stop happening.

Where: `metadata-and-selection.md` § Stability Markers (Quarantine
glossary entry was removed in the same direction).

Alternative: stability markers as reporting metadata only; CI gates use
verdict, not quarantine.

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

## What This Doc Is Not

This file does not list every feature deferred to a later release. It
lists *settled rejections* — directions Overkill has decided against,
not parking-lot items waiting on time. For deferred-but-likely items
see `ideas-and-future-directions.md` and the open-research items in
`novel-techniques.md`.
