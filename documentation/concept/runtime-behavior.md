# Runtime Behavior

## Purpose

This document fills in the runtime-shaped concerns most existing concept
docs name only in passing: console capture, exit codes, signal handling,
unhandled rejections, leaked resources, parallelism semantics, sharding,
monorepo discovery, CI behavior, terminal capability detection,
configuration layering, watch-mode targeting.

It is meant to be normative rather than aspirational. Each section states
the default, names the override surface where one exists, and leaves
genuinely-unsettled items to `open-questions.md`.

## Console Output Capture

Tests routinely call `console.log`, `console.error`, `process.stdout.write`.
The runner must decide what happens to that output.

Default policy:

-   stdout and stderr writes from inside a test body are **captured** by
    the runner during execution and attributed to the running test
-   captured output is preserved as a structured failure artifact (see
    `failure-artifacts.md`) — typed as `{ stream: 'stdout' | 'stderr',
    chunks: ReadonlyArray<{ at: bigint; bytes: Uint8Array }> }`
-   in the default reporter, captured output is **suppressed** for passing
    tests and **printed** for failing tests immediately after the failure
    summary
-   capture has a default cap (e.g. 1 MiB per test) beyond which output is
    truncated with a marker; the cap is configurable

Override surfaces:

-   `--no-capture` — pass everything through live (useful for debugging,
    `console.log` driven exploration)
-   per-test metadata `{ capture: 'live' }` — opt out for one test
-   reporter-level config — choose to print captured output for passing
    tests as well

Capture must respect orderings within a test. Captured chunks are timestamped
at capture time so reporters can render them interleaved with assertion
events.

## Exit Codes And `process.exit`

Default exit codes for the `overkill` CLI:

| Outcome                                  | Exit code |
| ---------------------------------------- | --------- |
| All tests pass and no runner errors       | 0         |
| At least one test failed (assertion)      | 1         |
| At least one runner error                 | 2         |
| Configuration / argument error            | 3         |
| No tests collected                        | 4 (configurable, see below) |
| Runner crashed (internal bug)             | 70        |

Test code calling `process.exit(code)` is treated as a runner-level error
and attributed to the currently-running test. The default policy is to
**throw** when the test attempts `process.exit` in a profile that disallows
process termination (microtest profile blocks it via the Node permission
model; integration profile may permit it).

A test profile may opt out of capture-on-exit if the SUT genuinely needs to
test process-exit behavior; that test should run in an isolated subprocess
where `process.exit` is observable as the subprocess exit code.

## Zero-Test Runs

A run that collects zero tests is a **failure** by default. This catches
typos in patterns, broken filters, and accidentally-empty test sets.

Override: `--allow-empty` (or `allowEmpty: true` in config) for monorepo
incremental runs and CI shards that may legitimately have no tests
allocated.

## Unhandled Rejections And Uncaught Exceptions

Async failures are messy. The runner's policy:

-   any unhandled rejection or uncaught exception emitted **during** a
    test's `run` (including its async tail until the next test starts) is
    attributed to that test as a **runner error** (see
    `failure-artifacts.md`)
-   any such error after the last test has finished but before the run
    completes is attributed to the run itself
-   any such error from the runner's own machinery is a runner crash

Detection uses `process.on('unhandledRejection')` and `process.on(
'uncaughtException')` plus a per-test correlation via
`AsyncLocalStorage` (see `platform-first-implementation-notes.md`). The
correlation is best-effort: an async leak that escapes the test's logical
window may be attributed to a sibling test. The runner should warn on
detected attribution drift rather than silently mis-blaming a test.

Tests that intend to test rejection paths use the assertion library's
explicit support (`assert.rejects(promise, expected)`) rather than relying
on the global hooks.

## Signal Handling And Cancellation

`SIGINT` (Ctrl-C) and `SIGTERM` policy:

-   first signal: graceful cancellation. The runner emits an `AbortSignal`
    at the run scope. Each running test sees its `AbortSignal` flip; tests
    are expected to respect it. Reporters flush partial results.
    Resources are disposed in reverse acquisition order.
-   second signal within 5 seconds: hard termination. Workers are killed.
    Partial results are flushed if reachable, otherwise the run exits
    with a runner-error result.
-   third signal: immediate `process.exit(130)`.

Cancellation propagates via `AbortController` chains, in keeping with
`platform-first-implementation-notes.md`. Tests that ignore the abort
signal cannot be force-killed in-process; supervised profiles can kill the
worker (see `microtests-and-capabilities.md` § hang detection).

## Process Crash Handling

When a worker process dies mid-test (segfault, OOM, native-addon crash):

-   the test that was running is recorded as a runner error with an
    explicit `crash` cause
-   tests already enqueued to that worker are reassigned to other workers
-   the worker is replaced from the pool
-   if crashes exceed a budget (default 3 within a run), the run aborts
    with a runner error to prevent infinite-replay loops

The crash report includes the captured output, the worker's exit signal,
core-dump pointer where available, and the test identity that was active.
This complements `microtests-and-capabilities.md`'s discussion of crash-
only supervision.

## Leaked Promises, Timers, And Handles

Detection:

-   on-process: `process._getActiveHandles()` and `_getActiveRequests()`
    snapshot before and after each test (in supported profiles); reported
    as resource-leak diagnostics
-   AsyncLocalStorage-instrumented Promise tracking flags Promises whose
    parent test has completed but which are not yet settled
-   the diagnostic is a *warning* by default and a *failure* in strict
    profiles

This is the leak-vs-hang split named in `microtests-and-capabilities.md`.
The runner reports leaks as structured diagnostics, not as test failures
unless policy elevates them.

## Parallelism Semantics

Parallelism happens at multiple grains. The default for `@overkill/test`
is **single-process, in-order** (per `open-questions.md` 5.4). Other modes
are explicitly opt-in:

| Mode                            | Description                                                              | When useful                                            |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `serial`                        | One test at a time, single process                                       | default for microtests                                 |
| `concurrent-in-process`         | Multiple tests' async work interleaves in one process                    | I/O-bound integration suites                           |
| `worker-pool`                   | N worker threads, file-level distribution                                | CPU-bound suites, big monorepos                        |
| `process-per-file`              | Subprocess per test file                                                 | strong isolation, capability resets, native crashes    |
| `single-worker-serial`          | Single worker thread, no concurrency                                     | benchmarks, deterministic-simulation                   |

Selection rules:

-   the runner profile names a default mode
-   resource execution requirements (`environments-and-fixtures.md`) can
    upgrade the mode (e.g. exclusive resource forces serialization within
    its scope)
-   `--mode` overrides at the CLI

Default worker count is `Math.min(cpus().length - 1, 8)` for worker-pool
modes, capped to keep the host responsive. Override via `--workers N`.

## Sharding

`--shard <i>/<n>` selects shard `i` of `n`. Sharding partitions the
collected test set deterministically by stable test identity (see
`artifact-identity.md`), so two shards never share a test and the union
covers everything. The partition is reproducible across runs given the
same identities.

Sharding composes with selection: filters apply first, sharding applies to
the filtered set.

CI integration: GitHub Actions, GitLab, and CircleCI matrices map directly
to `--shard`. Reporters can merge per-shard JSON outputs into a single
final report.

## Monorepo Discovery

Default monorepo behavior:

-   the runner detects workspace roots by walking up from the cwd looking
    for `package.json` with a `workspaces` field, `pnpm-workspace.yaml`,
    or `lerna.json`
-   if a workspace root is found and the cwd is at the root, the runner
    discovers tests across all workspace packages by default
-   per-package configuration is layered on top of the root config (see
    "Configuration layering" below)
-   selection by package: `--package <name>` filters to one package;
    glob patterns supported
-   baselines and failure artifacts are scoped per-package by default,
    living under each package's `test-baselines/` directory

Cross-package test ordering is alphabetic by package name, then by file
path within each package, deterministic and reproducible without a seed.

## CI Auto-Detection

Default behavior on detected CI environments (`process.env.CI === 'true'`,
or one of the well-known per-provider env vars):

-   color output: enabled if `FORCE_COLOR` is set, otherwise auto-detected
    from terminal capabilities
-   reporter: switch from `line` to `tap` (or a configurable CI default)
-   `--no-update-baselines` enforced; baseline updates require explicit
    intent
-   stale-baseline detection: any stale baseline fails the run
-   zero-test runs: failure (no `--allow-empty` unless explicit)
-   timeouts: tighter defaults; longer execution budget for benchmarks
-   `console.log` capture: stricter (kept always, not only on failure)
-   exit code 4 (zero-test) treated identically to exit code 1 unless
    overridden

Override: `--no-ci` forces dev-mode behavior on a CI host; `--ci` forces
CI behavior on a dev host.

## Terminal Capability Detection

Color, animation, and progress UI obey:

-   `NO_COLOR` (any value) — disables color
-   `FORCE_COLOR` — forces color and chooses depth
-   `TERM=dumb` — disables ANSI control sequences
-   not-a-TTY (`stdout.isTTY === false`) — disables progress UI, defaults
    to a non-animated reporter

Terminal width detection uses `process.stdout.columns`; updates on
`SIGWINCH`. Reporters wrap or truncate diff output accordingly.

## Configuration Layering

Configuration sources, in **decreasing** precedence:

1.  CLI flags
2.  Environment variables (`OVERKILL_*`)
3.  Project-local config (`overkill.config.ts` at the cwd or workspace
    root)
4.  Per-package config (in monorepos, each package's `overkill.config.ts`)
5.  User-level defaults (`~/.config/overkill/config.ts`)
6.  Built-in defaults

Config files are TS modules exporting a default config value. The runner
imports them via the same loader pipeline as test files (Node type
stripping). No JSON or YAML schema; types over schema.

A subset of values cascades: a per-package config inherits root config and
overrides per-key. Arrays merge (with `replace:` opt-out per array
property).

## Watch-Mode Targeting

Watch mode (`--watch`) reuses Node `--watch` for file events, with
Overkill-specific logic for selective rerun:

-   on file change, classify: test file / source file / config / fixture
-   compute the closure of affected tests using the persisted module
    dependency graph (see `fast-feedback-loops.md` § module graph)
-   re-run only affected tests
-   debounce: collapse rapid edits within 50 ms

Overrides:

-   `--watch=all` — always run the full suite on change
-   `--watch=changed` — run only tests in changed files (no closure)
-   `--watch=related` (default) — closure-based rerun

## Source Maps In Failure Stacks

Default: `--enable-source-maps` is on for the runner process. Failure
stacks are walked once on first failure to map back to TS source.

Frames inside Overkill packages are filtered from default stack output;
`--show-runner-frames` opts back in for runner debugging.

When a test runs successfully, no stack walking happens. The success path
never imports `source-map-support` or its replacements.

## Encoding And Locale

The runner forces `LC_ALL=C.UTF-8`-equivalent behavior internally for
deterministic sort and number formatting in reports. User code is not
affected. Test output is captured as bytes; rendering decodes as UTF-8.

## Network And Filesystem Defaults

By profile (`microtests-and-capabilities.md` enumerates):

-   microtest: deny FS write, deny net, deny child process, deny worker
-   integration-local: allow FS write within a per-test temp dir, allow
    loopback net, allow child process
-   benchmark: allow as integration-local but with single-worker
    serialization

The temp-dir convention is `os.tmpdir() + /overkill-<run-id>/<test-id>/`,
created lazily per test, removed on test completion (or run completion in
debug mode). This is one of the runner-owned escape hatches named in
`microtests-and-capabilities.md`.

## Connection To Other Docs

This document is the runtime counterpart to several others. Cross-links:

-   `microtests-and-capabilities.md` — capability profiles, hang
    detection, supervision
-   `failure-artifacts.md` — output capture, runner-error vs test-failure
    distinction
-   `metadata-and-selection.md` — selection rules sharding composes with
-   `fast-feedback-loops.md` — watch mode dependency graph and CI cache
    behavior
-   `platform-first-implementation-notes.md` — `AbortSignal`, source maps,
    `AsyncLocalStorage`
-   `package-architecture.md` — execution strategy decisions live in
    `@overkill/run`; this doc names the resulting runtime defaults

## Open Items

-   exact attribution rules for unhandled rejections that escape the test
    window (currently best-effort)
-   how strict-profile leak detection elevates a leak to a failure
    (default policy mentioned; precise rule deferred)
-   monorepo cross-package fixture sharing (likely follows resource scope
    rules; needs a worked example)
-   sharding determinism in the presence of dynamic test generation —
    the partition uses identities at collection time; a generator that
    produces different cases on different shards breaks the model. Likely
    answer: collect once, partition the result; do not collect twice.
