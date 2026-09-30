# Coverage

## Position

Code coverage is part of the concept from the start, but Overkill
treats it as **explicit, off by default, and scoped to microtests**.

Why microtests only:

- coverage answers "what code do my unit-level tests exercise?" -
  the question fits the focused source and selection boundaries of
  microtest runs
- integration tests broad-path through code; their coverage
  typically reads as "everything was hit," which tells you little
- benchmarks must not be instrumented - instrumentation distorts
  timing (an explicit non-goal: see [Non-Goals § No always-on coverage in the default run mode](../decisions/non-goals.md#no-always-on-coverage-in-the-default-run-mode))
- browser tests have their own coverage story via the browser's
  own instrumentation (out of scope here)
- restricting to microtests keeps the API surface small (see
  [Principles § Low API Surface](../decisions/principles.md#low-api-surface)) and aligns with
  [Principles § Capability-Oriented Microtests](../decisions/principles.md#capability-oriented-microtests)

Why off by default within microtests:

- coverage instrumentation slows microtests measurably and rarely
  matters per-iteration
- line coverage is a weak quality signal that should not be
  incentivised by being free
- coverage tooling is a fast-moving area; reusing the platform's
  own coverage support avoids reinventing it

Why a first-class concept anyway:

- teams that want microtest coverage need it to be one flag, not a
  separate tool chain
- the runner already owns the boundaries (workers, subprocesses,
  test identity) where instrumentation has to attach
- reporters need a structured way to surface coverage alongside
  failures and witnesses

## Settled Decisions

- Coverage is restricted to microtest profiles. Integration, property,
  type-test, and benchmark profiles reject coverage requests and coverage
  configuration.
- Coverage is aggregate run data. It follows the selected microtest profile's
  process model, worker count, concurrency, and scheduling instead of changing
  execution semantics to obtain per-case attribution.
- Coverage is opt-in per run through `--coverage` or
  `RunRequest.coverage`. Profile coverage configuration is policy only and
  never activates collection.
- Overkill does not ship its own instrumenter or coverage reporter
  package - it integrates with existing tools.
- The runner-side surface is coverage run intent plus a Node permission grant
  scoping filesystem writes to the coverage artifact directory; no
  Overkill-specific authority abstraction.
- Coverage data lives under `.overkill/runs/<run-id>/coverage/` by
  default and is garbage-collected with the rest of the run record.

## Instrumentation And Reporting Requirements

Coverage uses **V8 native instrumentation only** (`NODE_V8_COVERAGE`
plus `node --experimental-test-coverage` style hooks where they
apply). No source rewriting, no Babel/Istanbul instrumenter, no
runtime transform step. Native speed wins; the cost of carrying a second
instrumentation engine is not justified.

V8 native coverage in 2026 produces line, function, and block
coverage with source-map–accurate locations.

The reporting integration must handle two jobs that V8 does not:

1. **All-files reporting.** V8 only emits coverage for files that
   were actually loaded by the process. To report 0% on files that
   were never loaded - typically the most useful signal in a
   coverage report - the backend discovers matching source files and
   synthesises empty coverage for runtime-bearing files V8 did not see.
   Type-only TypeScript modules have no executable statements and must not
   count as uncovered. The backend should provide the TypeScript transform
   and parser support needed for this classification; Overkill should not
   implement a coverage-only parser.
2. **Format emission.** The backend converts raw V8 data into the configured
   V8, LCOV, JSON, HTML, and text outputs, preserves source-map accuracy, and
   evaluates thresholds.

The integration aggregates raw coverage from the complete run process tree.
It must support in-process, supervised, worker-pool, serial, and concurrent
microtest execution.

The later V8 coverage integration work chooses the reporting backend after a
direct comparison of the pinned `c8` integration and
`monocart-coverage-reports`. `c8` remains a compatibility candidate rather
than a settled architectural dependency. The include/exclude patterns that
drive all-files reporting live in `overkill.config.ts` as project policy, not
per-run intent (see [Principles § One First-Party Path Per Layer](../decisions/principles.md#one-first-party-path-per-layer)).

## Activation And Profile Policy

Coverage is activated for one run with `--coverage`. The selected profile must
have `testFamily: 'microtest'`. Its optional `coverage` configuration customizes
policy but does not activate collection.

```ts
export const config = defineConfig({
    profiles: {
        unit: {
            testFamily: 'microtest',
            files: {
                include: [ 'source/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/**/*.test.ts' ]
            },
            coverage: {
                formats: [ 'text', 'lcov' ],
                include: [ 'source/**/*.ts' ],
                exclude: [ 'source/**/*.type-test.ts' ]
            },
            execution: {
                processModel: 'in-process',
                scheduling: 'concurrent'
            }
        }
    }
});
```

Coverage policy fields:

- `coverage.formats`: which report formats to emit (`v8`, `lcov`, `json`,
  `html`, `text`); default: `['lcov', 'v8']`
- `coverage.include` and `coverage.exclude`: glob patterns driving `c8`'s
  all-files reporting
- `coverage.thresholds`: pass/fail thresholds for lines, functions, and
  branches
- `coverage.outputDir`: override for `.overkill/runs/<run-id>/coverage/`

Omitting `coverage` uses the built-in coverage policy defaults. Presence of
the field never enables collection. The same profile supports ordinary and
coverage runs:

```text
overkill run --profile unit
overkill run --profile unit --coverage
```

Programmatic callers express the same intent with
`request: { profile: 'unit', coverage: true, ... }`. `RunRequest.coverage`
defaults to `false` in first-party callers.

`--coverage` with a non-microtest profile is an invalid run request. The
runner rejects it after loading configuration and resolving the selected
profile, but before file discovery or user-module imports.

### Other Behaviour

- coverage scope uses the selected profile's `coverage.include` and
  `coverage.exclude` source set. A filtered or narrowed run does not claim
  suite-wide coverage; the run record (see
  [Test Data And Selection § Selection](./test-data-and-selection.md#selection))
  records which cases were executed so the aggregate report remains
  interpretable.
- the programmatic API in `@overkill-dev/run` records the selected profile
  plus the coverage request and resolved policy in the run record so reports remain
  reproducible.

## Aggregate Execution Model

Coverage follows the selected profile's ordinary execution model. In-process,
supervised, and worker-pool profiles remain in their configured serial or
concurrent mode. Coverage data from every instrumented process or worker is
merged into one run-level report.

Overkill does not promise per-`CaseId` coverage slices. V8 counters are local
to an execution boundary, and concurrent cases overlap those counters. Source
rewriting or case-level process isolation would change the instrumentation or
execution model for an attribution feature that users can obtain when needed
by filtering the run to one case.

The runner is responsible for:

- arranging V8 instrumentation before each relevant execution boundary starts
- preserving and merging raw coverage across the run's process tree
- adding `--allow-fs-write=<run-coverage-dir>/*` to each instrumented boundary's
  Node permission flags (see [Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults) for the mechanism)
- handing the raw V8 output to the selected reporting integration for
  all-files synthesis and format emission once the run completes

Tests do not interact with coverage instrumentation directly.

## Permission Surface

Microtest profiles deny filesystem writes by default. A microtest run with
coverage requested grants `--allow-fs-write` scoped to the resolved coverage
directory for that run:

```text
--allow-fs-write=<absolute-coverage-dir>/*
```

The wildcard is required because the directory does not exist at
spawn time (the run record is created just before workers start).
The runner resolves the configured path to absolute and adds the
wildcard before passing it to Node.

For the general permission mechanism - how Node flags are applied per
worker, why workers are separate Node processes, the symlink caveat,
and that permissions do not inherit - see
[Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults). There is no
Overkill-specific authority abstraction layered on top.

## Coverage Output Path

The `coverage.outputDir` configuration value is the only user-tunable piece
of the coverage permission grant. Because it determines the path the
runner trusts to grant FS-write to, several rules apply.

### Default And Why It Exists

The default is `.overkill/runs/<run-id>/coverage/` because that path
is:

- inside the project (always writable; no permission surprises)
- per-run (no overwrite races between concurrent runs)
- garbage-collected with the run record (no disk-fill over time)
- hidden from source control (`.overkill/` is conventionally
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

- is `/`, `/etc`, `/usr`, or another well-known system path
- contains a symlink that escapes the project root - same caveat
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
