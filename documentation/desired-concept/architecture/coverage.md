# Coverage

## Position

Code coverage is part of the concept from the start, but Overkill
treats it as **explicit, off by default, and scoped to microtests**.

Why microtests only:

-   coverage answers "what code do my unit-level tests exercise?" —
    the question fits microtests, where individual case attribution
    is meaningful
-   integration tests broad-path through code; their coverage
    typically reads as "everything was hit," which tells you little
-   benchmarks must not be instrumented — instrumentation distorts
    timing (an explicit non-goal: see [Non-Goals § No always-on coverage in the default run mode](../decisions/non-goals.md#no-always-on-coverage-in-the-default-run-mode))
-   browser tests have their own coverage story via the browser's
    own instrumentation (out of scope here)
-   restricting to microtests keeps the API surface small (see
    [Principles § Low API Surface](../decisions/principles.md#low-api-surface)) and aligns with
    [Principles § Capability-Oriented Microtests](../decisions/principles.md#capability-oriented-microtests)

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
-   Coverage runs single-threaded — one worker process executes all
    selected microtests serially. Worker-pool and process-per-file
    modes do not collect coverage. Supervised microtest mode is
    supported because supervision does not introduce parallelism.
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
see [Principles § One First-Party Path Per Layer](../decisions/principles.md#one-first-party-path-per-layer)).

Format emission inside `c8` delegates to the `istanbul-lib-report`
family. We could in principle bypass `c8` and call those libraries
directly, but the all-files glob + V8-to-istanbul conversion is
substantive enough that re-implementing it would duplicate effort
`c8` already maintains. `c8` is the right pipeline wrapper as long as
V8 doesn't ship all-files synthesis itself.

## CLI And Configuration Split

Following [Principles § One First-Party Path Per Layer](../decisions/principles.md#one-first-party-path-per-layer) (each
setting has one canonical place: per-run intent on the CLI,
persistent project policy in the configuration file, and no setting
reachable from both surfaces), the coverage surface splits this way:

CLI — per-run intent, asks "do I want coverage on _this_ run":

```
overkill run --coverage --profile microtest
```

`--coverage` combined with a non-microtest profile is rejected at CLI
parse time.

Configuration (`overkill.config.ts`) — project policy, settled across runs:

-   `coverage.formats` — which report formats to emit (`v8`, `lcov`,
    `json`, `html`); default: `['lcov', 'v8']`
-   `coverage.include` / `coverage.exclude` — glob patterns driving
    `c8`'s all-files reporting
-   `coverage.thresholds` — pass/fail thresholds (lines, functions,
    branches) when coverage gating is wanted
-   `coverage.outputDir` — override for `.overkill/runs/<run-id>/coverage/`

### Why The Split, Not Both Surfaces?

Some tools (ESLint, Jest) let the same setting be configured from
either the CLI or the configuration file, with the CLI winning when both are
set. Coverage does not work that way.

Each coverage setting fits cleanly on one side of the split. Enabling
coverage is a per-run choice (an audit, a CI check, a debug session).
Formats and thresholds are project decisions written down in configuration
and reviewed in code. There is no single coverage setting where
someone would want to set it in configuration and then override it on the
CLI just for one run.

Letting both surfaces own the same setting would mean adding
precedence rules ("CLI wins over configuration") and twice the documentation
surface. The canonical-input rule rejects that trade unless a setting
truly needs both lifetimes — and coverage does not.

### Other Behaviour

-   coverage scope = the `coverage.include`/`coverage.exclude` source
    set ∩ the executed-test set. A filtered or narrowed run does not
    claim suite-wide coverage; the run record (see
    [Metadata And Selection § Selection Model](./metadata-and-selection.md#selection-model)) records which
    cases were actually executed so reports remain interpretable.
-   the programmatic API in `@overkill/run` accepts both the per-run
    flag (`coverage: true`) and the policy values (formats,
    thresholds, etc.) in a single `run(config)` call — it is the
    unified target the CLI and configuration file both reduce to (see
    [Principles § One First-Party Path Per Layer](../decisions/principles.md#one-first-party-path-per-layer) for why the
    API is a different layer from the human-facing surfaces).

## Single-Process Execution Model

Coverage runs **single-threaded**: one Node worker process executes
all selected microtests serially. Worker-pool and process-per-file
modes do not collect coverage, even when invoked under a microtest
profile. `--coverage` forces serial execution for the run.

Coverage attribution is **per-test**: each executed case has its
own coverage record (keyed by `CaseId`) in the run-record coverage
directory. Single-process collection makes that trivial — one
timeline of test boundaries, one V8 slice — so per-case attribution
falls out of the model without extra machinery.

Why single-threaded:

-   V8 coverage is collected per Node process. Cross-worker
    aggregation requires merging slices, mapping per-worker output
    back to `CaseId` boundaries, and reconciling all-files
    synthesis across slices. None of this is technically blocked,
    but it adds machinery whose only justification is "coverage
    runs faster."
-   Coverage is opt-in and typically run for audits or in CI, not
    in the inner-loop microtest workflow. Trading parallelism for
    simpler internals is a reasonable bargain.

Supervised microtest mode (where the parent supervises the child
process for crash recovery) still works — supervision does not
introduce parallelism; the supervised process executes tests
serially. The `microtest-supervised` runner profile may be combined with
`--coverage` for that scenario.

The runner is responsible for:

-   starting the worker subprocess with `NODE_V8_COVERAGE` set to
    the run's coverage directory when `--coverage` is on
-   adding `--allow-fs-write=<run-coverage-dir>/*` to the worker's
    Node permission flags (see [Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults) for the mechanism)
-   handing the V8 output to `c8` for all-files synthesis and format
    emission once the run completes

Tests do not interact with coverage instrumentation directly.

## Permission Surface

Microtest profiles deny filesystem writes by default. The
`microtest-with-coverage` runner profile — the canonical public
coverage-enabled profile — grants `--allow-fs-write` scoped to the
resolved coverage directory for the current run:

```
--allow-fs-write=<absolute-coverage-dir>/*
```

The wildcard is required because the directory does not exist at
spawn time (the run record is created just before workers start).
The runner resolves the configured path to absolute and adds the
wildcard before passing it to Node.

For the general permission mechanism — how Node flags are applied per
worker, why workers are separate Node processes, the symlink caveat,
and that permissions do not inherit — see
[Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults). There is no
Overkill-specific authority abstraction layered on top.

## Coverage Output Path

The `coverage.outputDir` configuration value is the only user-tunable piece
of the coverage permission grant. Because it determines the path the
runner trusts to grant FS-write to, several rules apply.

### Default And Why It Exists

The default is `.overkill/runs/<run-id>/coverage/` because that path
is:

-   inside the project (always writable; no permission surprises)
-   per-run (no overwrite races between concurrent runs)
-   garbage-collected with the run record (no disk-fill over time)
-   hidden from source control (`.overkill/` is conventionally
    gitignored)

A user who overrides the default trades one or more of those
properties. A path like `coverage/` matches the convention some CI
systems expect for artifact upload but loses the per-run isolation:
one coverage run overwrites the previous one. Worth doing knowingly.

### Resolution Of Relative Paths

Relative paths in `coverage.outputDir` are resolved against the
directory containing the `overkill.config.ts` that defined them. In
a monorepo with per-package configuration files, each package's coverage path
is relative to its own configuration file unless the user writes an
absolute path. (Convention worth generalising to other paths in
configuration; left for [Configuration](./configuration.md) to formalise.)

### Validation

Before granting `--allow-fs-write`, the runner resolves the
configured path, follows symlinks, and refuses to start workers if
the result:

-   is `/`, `/etc`, `/usr`, or another well-known system path
-   contains a symlink that escapes the project root — same caveat
    as [Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults), with
    extra weight because the path is user-supplied

### Replay

The path used for a run is recorded in the run record alongside the
V8 output. `overkill replay` reads from that recorded path, not the
current `coverage.outputDir`. A configuration change does not invalidate
older records.

## Reporter Interaction

The default reporter does not render coverage inline; it points at the
report directory. Dedicated coverage reporters, if introduced, consume the
structured coverage data alongside the rest of the run result.
