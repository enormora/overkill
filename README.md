# Overkill

Overkill is a test authoring and runner toolkit for explicit, composable test
trees.

Install the standard distribution:

```sh
npm install -D @overkill-dev/test
```

The `@overkill-dev/test` package ships the public `overkill` binary and the
default authoring facade. See
[`source/packages/test/readme.md`](source/packages/test/readme.md) for the
quickstart and package surface.

Contributor setup and checks are described in the [repository guide](documentation/repository-layout.md).

## ESLint testing

Install `@overkill-dev/eslint-test` to share rule definitions and named
configuration matrices between example suites and automated source/option
properties. Configuration tests add inventories, resolved policy checks, project
fixtures, and generated safety properties. See the [package documentation](source/packages/eslint-test/readme.md).

## Differential testing

Install `@overkill-dev/differential` alongside `@overkill-dev/test`.
Use `differential({ implementations, check })` as a property body to compare
named implementations on independently reconstructed inputs, with ordinary
property shrinking, witnesses, and corpora.

See the [package documentation](source/packages/differential/readme.md) for
installation, authoring, and outcome semantics.

## Linearizability checking

Install `@overkill-dev/linearizability` to check recorded concurrent histories
against a pure sequential model. `checkLinearizability(...)` supports pending
operations, an explicit work budget, and cancellation. Budget exhaustion returns
inconclusive rather than a consistency verdict.

See the [package documentation](source/packages/linearizability/readme.md) for
event logs, model transitions, and result semantics.

## Type testing

Install `@overkill-dev/type-test` and an explicit TypeScript compiler to assert
type relationships in your original project. See the
[package guide](source/packages/type-test/readme.md) for runner profiles, direct
engine execution, and recorded replay.

## Performance regression checks

Run `npx just benchmark` for the full matrix, including the root import and
CLI startup checks. It executes the current checkout's Overkill source and
writes measurements and an HTML report under `target/performance`. Use a fresh
output directory for each run. Each workload takes 20 samples. Linux
and macOS use the same commands. The full matrix needs a C compiler.
Type-test fixtures load and check source from the checkout.

CLI workloads measure file discovery, title filtering, and plan listings with
source locations. Matching fixtures measure line, dot, and brief output against
a quiet run, plus failure diffs and GitHub Actions annotations. Separate runs
measure precise timings and coverage report generation against a matched run
with both options off.

The dot and line-progress reporters also run in a pseudoterminal. These cases
check wrapping and ANSI redraws, budget the time to first test progress, total
runtime, and child CPU and peak RSS, and retain output and checkpoint timelines
in the HTML report. The checkpoints track terminal output, before any emulator
paints it.

Use `npx just benchmark capture target/performance/capture target/performance/reference.json`
to collect three samples per workload and round each ceiling up to two
significant digits. The default command compares 20 samples per workload
against the shared reference and fails when a required median confidence
interval falls outside or overlaps a threshold.

CI and local runs use the same `source/benchmarks/baselines/shared.json`
thresholds. The reference records the original capture host. Timing
thresholds use Overkill’s CPU reference workload units. Memory thresholds use
bytes across supported platforms and Node versions.

Execution matrix measurements include CPU from reaped descendants and report the
largest single-process peak RSS in bytes. A dedicated workload samples the
sum of live-process RSS. That sum can count shared pages more than once and
miss short-lived peaks. The warm engine batch also measures
CPU and elapsed time after initial execution and heap growth after explicit
GC. Build and fixture preparation happen outside the measurement windows.
