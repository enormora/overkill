# Failure Artifacts

## Purpose

This document defines the concept for artifacts emitted during failures,
updates, or diagnostic runs.

## Position

Overkill treats failure artifacts as first-class outputs of a run, not as
reporter-specific accidents.

Examples:

-   captured stdout / stderr (see `runtime-behavior.md` § console capture)
-   temp files
-   trace or event timelines
-   current-vs-baseline diffs
-   benchmark sample data
-   property-test witnesses
-   deterministic-simulation witnesses
-   future browser screenshots or traces

## Core Rule

The core preserves the structured information needed to build good failure
output, but reporters decide how to present it.

That means:

-   a failing assertion is not the same thing as an internal runner error
-   the engine preserves enough data for either a human-oriented reporter
    or a machine-oriented reporter
-   reporters may choose very different presentations of the same
    underlying failure

Examples:

-   a stdout reporter wants concise diff output
-   a JSON reporter wants structured payloads
-   an HTML reporter may want attached artifacts and richer navigation

## Test Failures Versus Runner Errors

A clear conceptual distinction:

-   **test failure** — the test ran and reported unmet expectations. The
    test produced a `Check` with `kind: 'fail'` (or threw a recognised
    assertion error through the throwing adapter).
-   **runner or infrastructure error** — the system could not execute or
    observe the test correctly. Examples: fixture setup threw, a worker
    crashed, an unhandled rejection escaped the test window, a Node
    permission was denied unexpectedly, a loader hook errored.

The two categories are reported separately so reporters present them
differently. CI pipelines may treat them with different gating policies
(some teams want runner errors to fail fast and abort the rest of the
run; others want them to count alongside test failures).

## Attribution Rules

Async errors and out-of-band events need a clear owner. The default
attribution policy:

-   an unhandled rejection or uncaught exception emitted **during** a
    test's `run` (including its async tail until the next test starts) is
    attributed to that test as a runner error
-   an error emitted between tests but during run-level setup/teardown is
    attributed to the run
-   an error from the runner's own machinery is a runner crash, surfaced
    as a top-level diagnostic

Attribution is best-effort and uses `AsyncLocalStorage` to correlate async
work with the originating test. If the runner detects attribution drift
(an async chain escaped its test window), it warns rather than silently
mis-blaming a sibling test.

Tests that intend to test rejection paths use the assertion library's
explicit support (`assert.rejects(promise, expected)`) rather than relying
on the global hooks. The global hooks are the safety net, not the
mechanism.

## Artifact Policy

Artifacts are:

-   explicitly associated with stable test identities (see
    `artifact-identity.md`)
-   clearly typed (subtype tag in `ArtifactId`)
-   reviewable where appropriate (snapshots, baselines)
-   discoverable by reporters and integrations (declared in the run
    record)
-   optional when the run mode does not need them
-   size-bounded with explicit truncation markers

## Storage Policy

Artifacts produced during a run live in a per-run directory by default:

```
.overkill/runs/<run-id>/artifacts/<case-id-derived-path>
```

Artifacts that survive runs (baselines, witnesses) live in their own
directories:

-   `test-baselines/` — all baseline subtypes
-   `.overkill/witnesses/` — replay witnesses (gitignored by default; can
    be promoted into the repo when valuable)
-   `.overkill/corpus/` — fuzzing/property regression corpus
-   `.overkill/runs/` — run records (kept for the last N runs, default
    20)

Per-run artifacts are garbage-collected: the runner keeps the most recent
N successful runs (default 5) and all failing runs from the last
configurable retention window (default 7 days).

Size caps:

-   captured stdout/stderr per test: 1 MiB by default, truncated with
    marker
-   trace/event timeline per test: 10 MiB by default
-   structured diff payload: unbounded in JSON output, capped at 100
    lines / 8 KiB in human reporter output

All caps are configurable per profile.

## Witnesses And Replay Artifacts

Failing property tests and deterministic-simulation tests produce witnesses:
serialised, replayable artifacts containing the seed, shrink path, world
snapshot, fault configuration, and library version. See
`reproducibility.md` § replay witnesses.

A witness is also a failure artifact — it attaches to the failing case via
`ArtifactId` and is rendered by reporters as a "replay command" line:

```
overkill replay-witness .overkill/witnesses/users__round-trip__c0ffee.witness.json
```

Witnesses are first-class enough that the runner records them even when
the failure is reproducible by other means. Their cost is small (a few
KB) and their value when triaging flakes is high.

## Captured Output

Default policy (covered in `runtime-behavior.md`):

-   captured per test, attributed via `AsyncLocalStorage` correlation
-   suppressed in default reporter for passing tests
-   printed for failing tests inline with the failure summary
-   preserved in JSON event stream regardless of terminal rendering

## Diff Artifacts

A failed assertion's diff is structured (see `assertions-and-results.md`):

```ts
type DiffArtifact = {
    readonly kind: 'value' | 'string' | 'object' | 'array';
    readonly expected: SerializedValue;
    readonly actual: SerializedValue;
    readonly ops?: ReadonlyArray<DiffOp>;
    readonly hunks?: ReadonlyArray<Hunk>;
};
```

Reporters render this. The runner does not pre-render. Truncation is
reporter-policy, not runner-policy (the data stays full in JSON output).

## Retry Interaction

Retries are not a microtest concept.

For integration-style tests, retries may exist. Failure artifacts preserve:

-   which attempt failed (`AttemptId`)
-   which attempt finally passed or failed
-   whether artifacts come from the first failure, last failure, or all
    attempts (configurable; default keeps first-failure artifacts plus
    final-attempt artifacts)
-   a `retried: { attempts: number, finalVerdict: TestVerdict }`
    summary on the test result

This prevents retries from hiding useful debugging evidence. The default
configuration is conservative: keep the first failure (often the most
diagnostic) plus the final outcome.

## Process Crash Artifacts

When a worker process dies mid-test (segfault, OOM, native-addon crash):

-   the test is recorded as a runner error with subtype `crash`
-   captured output up to the crash is preserved
-   the worker's exit signal and any core-dump pointer are included
-   a `WorkerCrash` artifact is attached, including:
    -   timestamp
    -   exit signal (SIGSEGV, SIGABRT, etc.)
    -   identifier of the worker (PID, pool index)
    -   the test active at the time of the crash
    -   any environment metadata helpful for triage (Node version,
        loaded native addons)

See `runtime-behavior.md` § process crash handling for the run-level
policy (replacement workers, crash-budget abort).

## Sources

-   [Pytest — terminal output and reports](https://docs.pytest.org/en/stable/how-to/output.html)
-   [Playwright — Trace Viewer](https://playwright.dev/docs/trace-viewer)
-   [Vitest — Reporters](https://vitest.dev/guide/reporters)
