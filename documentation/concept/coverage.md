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
-   The runner-side surface is a single CLI flag plus a
    `CoverageWriter` authority token (see `capability-handles.md`)
    that grants the right to write into the coverage artifact
    directory.
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

Single flag at the run level:

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
-   passing each worker a `CoverageWriter` token scoped to its slice
    of the artifact directory
-   merging V8 slices into one report after the run completes (via
    `c8` or equivalent)

Tests do not interact with coverage instrumentation directly.

## Authority Token

`CoverageWriter` is the only first-party use of the authority-token
pattern named in `capability-handles.md`:

```ts
type CoverageWriter = unknown & { readonly __brand: 'CoverageWriter' };
```

Owning the token grants the right to write into the run-scoped
coverage artifact directory. The runner constructs and passes it;
user code cannot forge one. Microtest profiles deny filesystem
writes by default; the `micro-with-coverage` profile is the narrow
exception that grants the write capability via the token.

## Reporter Interaction

The default reporter does not render coverage inline; it points at
the report directory. Dedicated coverage reporters (likely
third-party, packaged as `@overkill/reporter-coverage` or similar)
consume the structured coverage data alongside the rest of the run
result.

## What This Doc Is Not

-   not a coverage *quality* recommendation (Overkill takes no
    position on what counts as enough coverage)
-   not a built-in instrumenter; the runner orchestrates V8's native
    coverage rather than ship its own

## Open Items

-   exact CLI shape (`--coverage <format>` vs. `--coverage --coverage-format`)
-   whether the per-test slice is recorded per `CaseId` or per file
    (V8 native granularity is per file; per-case requires a wrapping
    layer)
-   integration with TIA when path-level change detection narrows the
    run — coverage of *only-affected-tests* is less useful than total
    coverage; the run record should label which it is
