# `@overkill-dev/reporter-line`

Human-readable line reporter family for Overkill test runs.

Top-level API:

- `createLineReporter()`
- `createLineTreeReporter()`
- `createLineProgressReporter()`

Usage:

```ts
import { execute } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

await execute(testPlan, {
    execution: { mode: 'serial-in-process' },
    reporters: [ createLineReporter() ],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

The reporter writes directly to `stdout` and declares `stdout-raw`.

`createLineReporter()` emits completed tests in completion order.
`createLineReporter({ showPassing: false, verbose: false })` reports progress
every 100 completed tests and still prints non-passing results.
`createLineTreeReporter()` prints the logical result tree after the run.
`createLineProgressReporter()` shows compact live progress, then prints the
same logical result tree.

Rendering:

- table rows use their titles. Failure details put row parameters in an indented block
- line wrapping defaults to on for terminals and off for redirected output
- interactive lines align durations when the result fits. Longer lines and
  redirected logs keep timings inline
- failed test details put the test name first and the source location directly
  below it. The assertion and parameters follow
- all failure details come from structured `outcome.failures`
- all failed checks are rendered
- failed checks include source locations when available, including forwarding
  details when a check carries more than one location
- the line reporter puts the run status, nonzero verdict counts, and elapsed
  time first, followed by execution counts and timing. Planned and discovered
  counts appear when the counts differ
- durations use microseconds, milliseconds, or seconds based on their size
- precise timing summaries list up to five runner overhead spans above 500 ms
