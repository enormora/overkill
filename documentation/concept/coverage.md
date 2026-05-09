# Coverage

## Position

Code coverage is a planned integration from the start, but Overkill
treats it as **explicit and off by default** rather than a built-in
always-on instrument.

Why off by default:

-   coverage instrumentation slows microtests measurably and rarely
    matters per-iteration
-   line coverage is a weak quality signal that should not be
    incentivised by being free
-   coverage tooling is a fast-moving area; reusing the platform's
    own coverage support avoids reinventing it

Why a first-class concept anyway:

-   teams that want coverage need it to be one flag, not a separate
    tool chain
-   the runner already owns the boundaries (workers, subprocesses,
    test identity) where instrumentation has to attach
-   reporters need a structured way to surface coverage alongside
    failures and witnesses

## Settled Decisions

-   Coverage is opt-in per run; there is no global "always on"
    default mode in any first-party profile.
-   Overkill does not ship its own instrumenter or coverage reporter
    package — it integrates with existing tools.
-   The runner-side surface is a single CLI flag plus a Node
    permission grant scoping filesystem writes to the coverage
    artifact directory; no Overkill-specific authority abstraction.
-   Coverage data lives under `.overkill/runs/<run-id>/coverage/` by
    default and is garbage-collected with the rest of the run record.

## Engine Choice

Coverage uses **V8 native instrumentation only** (`NODE_V8_COVERAGE`
plus `node --experimental-test-coverage` style hooks where they
apply). No source rewriting, no Babel/Istanbul instrumenter, no
transform step. Native speed wins; the cost of carrying a second
engine is not justified.

V8 native coverage in 2026 produces line, function, and block
coverage with source-map–accurate locations. `c8` is used purely as a
post-processor to emit LCOV, JSON, or HTML reports from the raw V8
output — Overkill orchestrates the engine; `c8` formats the output.

## CLI Surface

Single flag at the run level (still under design; will be registered
in `cli.md` once finalised):

```
overkill run --coverage [--coverage-format <v8|lcov|json|html>]
```

Defaults:

-   format: `lcov` for CI compatibility, `v8` raw output written
    alongside
-   per-test attribution: tied to `CaseId`; the per-test slice lives
    inside the run-record coverage directory

Programmatic surface mirrors the flag (orchestration-level option in
`@overkill/run`).

## Worker-Pool And Process-Per-File Interaction

V8 coverage is collected per Node process. Worker-pool runs collect
per-worker output and merge it into the run record at completion;
process-per-file runs collect per-process output the same way.
Single-worker-serial runs (benchmarks, simulation) collect a single
output stream.

The runner is responsible for:

-   starting workers/subprocesses with `NODE_V8_COVERAGE` set to a
    per-worker directory under the run record when `--coverage` is on
-   adding `--allow-fs-write=<run-coverage-dir>` to the worker's Node
    permission flags so the V8 coverage writer can persist its output
    despite the microtest profile's blanket FS-write denial
-   merging V8 slices into one report after the run completes (via
    `c8` or equivalent)

Tests do not interact with coverage instrumentation directly.

## Permission Surface

Microtest profiles deny filesystem writes by default. The
`micro-with-coverage` profile is the narrow exception: it adds
`--allow-fs-write=.overkill/runs/<run-id>/coverage/` to the Node
permission flags it starts the worker with. The grant is path-scoped
by the OS-level Node permission model; no Overkill-specific
abstraction layers on top.

## Reporter Interaction

The default reporter does not render coverage inline; it points at
the report directory. Dedicated coverage reporters (likely
third-party, packaged as `@overkill/reporter-coverage` or similar)
consume the structured coverage data alongside the rest of the run
result.

## What This Doc Is Not

-   not a coverage _quality_ recommendation (Overkill takes no
    position on what counts as enough coverage)
-   not a built-in instrumenter; the runner orchestrates V8's native
    coverage rather than ship its own

## Open Items

-   exact CLI shape (`--coverage <format>` vs. `--coverage --coverage-format`)
-   whether the per-test slice is recorded per `CaseId` or per file
    (V8 native granularity is per file; per-case requires a wrapping
    layer)
-   integration with TIA when path-level change detection narrows the
    run — coverage of _only-affected-tests_ is less useful than total
    coverage; the run record should label which it is
