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
-   coverage tooling is a fast-moving area; reusing existing tools
    (V8, Istanbul) avoids reinventing a moving target

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

Two viable instrumentation engines:

-   **V8 / Node `--experimental-coverage`** — preferred default. No
    source rewriting, runs at native speed, integrates with Node's
    built-in TypeScript stripping without source-map dance. Output
    is V8 JSON; tools like `c8` post-process it into Istanbul or
    LCOV.
-   **Istanbul (`nyc`, `babel-plugin-istanbul`)** — alternative for
    teams that already standardise on Istanbul-style reports or need
    branch-precision coverage that V8 does not yet provide.

Concept direction: V8-first, with Istanbul as a documented
alternative. Reusable through `c8` for converting the V8 output to
Istanbul/LCOV when needed.

## CLI Surface

Single flag at the run level:

```
overkill run --coverage [--coverage-format <v8|lcov|istanbul|json>]
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

-   starting workers/subprocesses with `--experimental-coverage` (or
    the chosen instrumenter's hook) when `--coverage` is set
-   passing each worker a `CoverageWriter` token scoped to its slice
    of the artifact directory
-   merging slices into one report after the run completes

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
-   not a guarantee that V8 coverage will track every branch the way
    Istanbul does
-   not a built-in instrumenter; the runner orchestrates existing
    tools rather than ship its own

## Open Items

-   exact CLI shape (`--coverage <format>` vs. `--coverage --coverage-format`)
-   whether the per-test slice is recorded per `CaseId` or per file
    (V8 native granularity is per file; per-case requires a wrapping
    layer)
-   integration with TIA when path-level change detection narrows the
    run — coverage of *only-affected-tests* is less useful than total
    coverage; the run record should label which it is
