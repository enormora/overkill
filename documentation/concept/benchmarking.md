# Benchmarking

## Position

Benchmarking is a first-class Overkill package family, not a side mode of the ordinary test runner.

The core reason is that benchmark suites need a richer model:

-   controlled workloads
-   lifecycle management
-   domain metrics
-   calibration
-   policies and budgets

## Benchmark Definition Model

The conceptual unit should be a **workload-oriented benchmark**, not just “function X.”

A benchmark definition should be able to describe:

-   named workload dimensions such as small, medium, large
-   deterministic fixture generation
-   validation of generated fixtures
-   suite-level setup and teardown
-   case-level setup and teardown

This is closer to BenchmarkTools benchmark groups and to real workflow benchmarking than to a simple timing loop.

Source:

-   <https://juliaci.github.io/BenchmarkTools.jl/stable/manual/>

## Measurement Layer

The measurement engine should support:

-   runtime and throughput
-   percentiles
-   event timelines
-   custom secondary metrics per sample

Tinybench is a useful reference for statistics APIs and event hooks, but it only solves part of the problem.

Source:

-   <https://github.com/tinylibs/tinybench>

## Policy Layer

Overkill should separate measurement from policy.

Policy examples:

-   median must remain below a checked-in budget
-   p99 latency may regress only within tolerance
-   responsiveness metrics must remain within a calibrated range
-   results may be normalized relative to a calibration workload

This policy layer is where CI gating semantics belong. Reporters explain the outcome; policy decides what counts as failure.

## Execution Strategy

Benchmarks should be allowed to influence execution strategy strongly, because measurement reliability is often more important than raw throughput.

Typical benchmark preferences may include:

-   forcing worker count to `1`
-   preventing unrelated workloads from running concurrently
-   isolating process state between workloads
-   reusing expensive setup only where it does not contaminate measurements

These should be modeled as execution constraints contributed to orchestration, not as ad hoc benchmark-only hacks.

## Calibration And Normalization

Some benchmark suites need hardware normalization. The concept should therefore include:

-   calibration workloads
-   scaling rules
-   explicit reporting of raw and normalized numbers
-   reviewable checked-in budget metadata

## External Process Benchmarking

Benchmarking external processes should be first-class:

-   process spawning
-   cwd isolation
-   environment control
-   stdout and stderr capture
-   PTY-aware execution for CLI workflows

This is critical for real tool benchmarking and should not require ad hoc custom harnesses.

## Baselines

Performance baselines are snapshot-like in workflow but stricter in meaning.

Useful stored data may include:

-   machine metadata
-   workload identity
-   median and percentile thresholds
-   calibration context
-   exact metadata expectations
-   range-based budget semantics

## Reporting

Benchmark reports should be:

-   readable in CI
-   machine-readable for automation
-   specific about the failing benchmark, workload, metric, and threshold

## Influence

JMH provides the strongest reminder that a benchmark harness must actively help users avoid misleading results.

Source:

-   <https://github.com/openjdk/jmh>
