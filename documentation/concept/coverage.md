# Coverage

## Position

Code coverage is a planned integration from the start, but Overkill
treats it as **explicit, off by default, and scoped to microtests**.

Why microtests only:

-   coverage answers "what code do my unit-level tests exercise?" —
    the question fits microtests, where individual case attribution
    is meaningful
-   integration tests broad-path through code; their coverage
    typically reads as "everything was hit," which tells you little
-   benchmarks must not be instrumented — instrumentation distorts
    timing (an explicit non-goal: see `non-goals.md` § No always-on
    coverage in the default run mode)
-   browser tests have their own coverage story via the browser's
    own instrumentation (out of scope here)
-   restricting to microtests keeps the API surface small (see
    `principles.md` § Low API Surface) and aligns with
    `principles.md` § Capability-Oriented Microtests

Why off by default within microtests:

-   coverage instrumentation slows microtests measurably and rarely
    matters per-iteration
-   line coverage is a weak quality signal that should not be
    incentivised by being free
-   coverage tooling is a fast-moving area; reusing the platform's
    own coverage support avoids reinventing it

Why a first-class concept anyway:

-   teams that want microtest coverage need it to be one flag, not a
    separate tool chain
-   the runner already owns the boundaries (workers, subprocesses,
    test identity) where instrumentation has to attach
-   reporters need a structured way to surface coverage alongside
    failures and witnesses

## Settled Decisions

-   Coverage is restricted to microtest profiles. Other profiles
    (integration, browser, benchmark) reject `--coverage`.
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
coverage with source-map–accurate locations.

`c8` does two jobs in this pipeline, both consequences of V8's
shape:

1.  **All-files reporting.** V8 only emits coverage for files that
    were actually loaded by the process. To report 0% on files that
    were never loaded — typically the most useful signal in a
    coverage report — `c8`'s `all: true` mode globs the source tree
    using include/exclude patterns and synthesises empty coverage
    records for files V8 didn't see. Without this, a brand-new file
    with no tests would simply be invisible in the report.
2.  **Format emission.** `c8` post-processes V8 output into LCOV,
    JSON, or HTML.

Overkill orchestrates the V8 engine and configures `c8` for both
jobs. The include/exclude patterns that drive all-files reporting
live in `overkill.config.ts` (project policy, not per-run intent —
see `principles.md` § One First-Party Path Per Layer).

Format emission inside `c8` delegates to the `istanbul-lib-report`
family. We could in principle bypass `c8` and call those libraries
directly, but the all-files glob + V8-to-istanbul conversion is
substantive enough that re-implementing it would duplicate effort
`c8` already maintains. `c8` is the right pipeline wrapper as long as
V8 doesn't ship all-files synthesis itself.

## CLI And Config Split

Following `principles.md` § One First-Party Path Per Layer (each
setting has one canonical place: per-run intent on the CLI,
persistent project policy in the config file), the coverage surface
splits this way:

CLI — per-run intent, asks "do I want coverage on _this_ run":

```
overkill run --coverage --profile microtest
```

`--coverage` combined with a non-microtest profile is rejected at CLI
parse time. (Will be registered in `cli.md` once finalised.)

Config (`overkill.config.ts`) — project policy, settled across runs:

-   `coverage.formats` — which report formats to emit (`v8`, `lcov`,
    `json`, `html`); default: `['lcov', 'v8']`
-   `coverage.include` / `coverage.exclude` — glob patterns driving
    `c8`'s all-files reporting
-   `coverage.thresholds` — pass/fail thresholds (lines, functions,
    branches) when coverage gating is wanted
-   `coverage.outputDir` — override for `.overkill/runs/<run-id>/coverage/`

Other behaviour:

-   per-test attribution: tied to `CaseId`; the per-test slice lives
    inside the run-record coverage directory.
-   programmatic surface mirrors the CLI flag (orchestration-level
    option in `@overkill/run`); the microtest-profile restriction
    applies; format / threshold settings come from config in both
    surfaces.

## Worker-Pool And Process-Per-File Interaction

V8 coverage is collected per Node process. Microtest worker-pool runs
collect per-worker output and merge it into the run record at
completion; microtest process-per-file runs collect per-process output
the same way.

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
`micro-with-coverage` profile — the canonical (and only) coverage
profile — grants `--allow-fs-write` scoped to the run-specific
coverage directory:

```
--allow-fs-write=<absolute-run-coverage-dir>/*
```

The trailing `/*` wildcard is required because the coverage directory
does not exist at spawn time (the run record is created just before
workers start). For the general mechanism — how Node permission flags
are applied per worker, why workers are separate Node processes, and
the symlink and inheritance caveats — see
`microtests-and-capabilities.md` § Capability Defaults. There is no
Overkill-specific authority abstraction layered on top.

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
-   not a coverage facility for integration, browser, or benchmark
    profiles — those reject `--coverage`

## Open Items

-   whether the per-test slice is recorded per `CaseId` or per file
    (V8 native granularity is per file; per-case requires a wrapping
    layer)
-   integration with TIA when path-level change detection narrows the
    run — coverage of _only-affected-tests_ is less useful than total
    coverage; the run record should label which it is
