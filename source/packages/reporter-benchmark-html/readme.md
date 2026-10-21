# Benchmark HTML reporter

Create an offline, interactive HTML report from a benchmark profile:

```ts
import { createBenchmarkHtmlReporter } from '@overkill-dev/test/reporters';

const reporters = [
    createBenchmarkHtmlReporter({ outputFile: 'reports/benchmarks.html' })
];
```

The same factory is available from `@overkill-dev/reporter-benchmark-html`.
Set this list on the benchmark profile's `reporters` property.
Run the selected profile with `overkill bench run --profile <name>`.
Relative output paths resolve when the factory is created. Reports replace the
configured file atomically; file sinks are exclusive.

Reports include workload/runtime metric tables, retained-sample distributions,
empirical box plots, budget estimates and uncertainty intervals, baseline
comparisons, policy outcomes, and recorded machine/process metadata. Use the
metric and workload selectors, chart sliders, and tooltips to explore results.
All scripts and styles are embedded. Tables remain readable without JavaScript.

Budget tables and tooltips include signed deltas from each configured bound in
the displayed raw or normalized scale. Percentage deltas divide by the absolute
bound and remain unavailable for zero or missing bounds. Deltas never determine
pass/fail; recorded budget intervals and decisions remain authoritative.

Opt-in benchmark timelines provide workload, phase, sample, and clock-domain
selectors plus static event tables. Separate process clocks retain their own
origins. Missing attachments, historical absence, and omitted events are explicit.

Charts embed aggregated data, not individual samples. Original sample artifacts
remain under runner retention policy. Missing or omitted samples have an
explicit reason; summary statistics and budget outcomes remain available.
Observed sample quartiles are descriptive, not confidence intervals. Budget
intervals and decisions come directly from benchmark execution.

Performance adapters may implement `describeMetrics({ actual, expected })` to
supply typed chart values, units, point/range references, and raw or normalized
scale labels. Adapters own normalization and comparison policy. Existing JSON
adapters continue working with structured comparison diagnostics. Chart metadata
errors fail infrastructure reporting after valid baseline operations, preserving
completed writes. Saved legacy reports have no chart metadata.

The reporter uses the existing 100 ms callback limit. Write failures and timeouts
are reported through the normal reporter error pipeline. Direct engine execution
must provide benchmark run facts; missing host metadata is labeled as unrecorded.
