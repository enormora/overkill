# Test Debug Mode

## Purpose

Debug mode explicitly retains structured diagnostics for selected runtime tests,
including passing tests. Diagnostics describe observations; they do not classify
code quality or contribute to a test verdict. Observation overhead still consumes
ordinary execution time.

Retained state means diagnostic snapshots. Processes, resources, and handles
continue through their normal cleanup and disposal.

## Activation

- `--debug` records every test in the resolved executable work set.
- `--debug-scope <selector>` records matching tests without narrowing execution.
  It works independently of `--debug`, uses the `--filter` grammar, and may be
  repeated. Repeated scopes are combined with OR.
- Supplying both forms is a usage error.

Programmatic callers use `RunRequest.debug`:

```ts
type RunDebugRequest =
    | { readonly mode: 'off' | 'all'; readonly selectors: readonly []; }
    | { readonly mode: 'selected'; readonly selectors: NonEmptyReadonlyArray<string>; };
```

Activation does not change profile, capabilities, process model, scheduling,
ordering, sharding, or ordinary test selection. There is no per-test authoring
annotation or configuration default that implicitly enables debug mode.
Analysis-only type-test profiles reject runtime debug recording.

`RunFacts.execution.debug` retains the request. `execution.debuggedCases` records
the selected `WorkId` values, including runtime, workload, and family-variant identity. An explicit
request persists a run record even when its debug scope matches no cases.

## Artifact Shape

`TestDebugArtifact` is a native `RunArtifact` variant with subtype and payload kind
`debug`. Its shared artifact ID supplies case, runtime, workload, family variant, and attempt
identity. The payload has `schemaVersion: 1` and contains:

- authoritative verdict, nullable outcome, and attempt duration in microseconds
- a timeline of body start, assertion calls, requirements, `plan`, body completion,
  and rejection; entries include assertion labels and source locations when available
- named snapshots of application-owned recording providers
- observed module resolution and load operations with durations
- CPU, heap, sampled heap maximum, and active-resource deltas
- assertion, requirement, recording-event, and observed-load counts; plan counts,
  heap growth, active-resource growth, and effective soft-timeout headroom
- completeness and dropped-entry metadata

Timeline timestamps are decimal strings containing monotonic nanoseconds relative
to body start. Arbitrary rejection reasons and recording events use the existing
bounded `SerializedValue` representation, including bigint and cyclic values.
Artifacts are JSON-safe before reporter delivery or process transport.

A skipped case has an empty body timeline and unavailable body measurements.
A policy failure can have a null outcome while retaining its authoritative verdict.

## Measurement Semantics

Native measurements are execution-window observations, not exclusive per-test
accounting. Each available measurement identifies its scope, method, and observed
overlapping work. CPU and heap values can include concurrent activity in the same
thread. Active-resource deltas cover the current event loop and are observations
rather than proof of a leak.

Heap peak means the maximum of the recorded start and end samples, not the exact
allocation peak. Unavailable readings carry a reason rather than a fabricated zero.

Module hooks record observable resolution and load operations during the attempt.
Their timings exclude module evaluation. Loader caches can bypass observations;
absence of a load event does not establish a cache hit. Exact uncached-load counts
and time unaccounted for by arbitrary awaited operations are unavailable.

No arbitrary `await` instrumentation, runtime monkey-patching, CPU profiling, or
benchmark-quality measurement is implied. Runner phase timings remain separate.

## Recording Providers

Application-owned handles register recordings explicitly on either test-scope form:

```ts
scope.debug.includeRecording({
    name: 'http',
    recorded: () => http.recorded()
});
```

A provider returns an array of application-owned events. Registration is inert
when debug is off. Debug mode snapshots registered providers once after attempt
cleanup, preserving registration order, event order, and original timestamp data.
It does not assume application timestamps share the engine clock. Repeated names
remain separate registrations.

At most 100 providers can register per attempt, matching the existing scope
attachment limit. Further registrations count as dropped entries.

A provider exception produces an attributed artifact runner error and incomplete
recording metadata. Other available diagnostics and the test verdict are preserved;
the runner error fails the run.

## Lifecycle And Limits

Recording runs inside the retry loop and existing timeout and process boundaries.
Body completion is distinct from completion of cleanup and resource disposal.
The collector closes before test completion delivery, and late asynchronous work
cannot append to a completed artifact.

Diagnostic collection is bounded to 10 MiB per attempt. Limits apply before
retaining event payloads or sending them over process boundaries. Truncation is
explicit and retains counts and terminal metadata. Existing structured-value
serialization limits also apply.

Debug-off execution installs no debug module hooks, sampling timers, or recording
providers, and does not create debug files or require run persistence.

## Storage

Runner-owned artifacts live alongside the run record:

```text
.overkill/runs/<run-id>/debug/<work-id-derived>__attempt=0.debug.json
```

The path follows configured `runtimeStateDir`. Names derive from full canonical
work identity rather than display titles. Every debugged retry attempt is retained,
independently of ordinary retry-artifact retention policy.
Concurrent placement attempts use an additional placement sequence suffix so
conflicting speculative executions retain separate diagnostics.

Writes use the existing atomic runtime-state store. Required artifact or record
write failures fail the run through runner errors while preserving test outcomes.
Run history pruning and clearing remove debug artifacts with their owning run.
See [Reproducibility](../architecture/reproducibility.md#retention-and-maintenance).

Direct engine execution returns artifacts in memory. Runner orchestration owns
disk persistence and history policy.

## Reporter Interaction

Completed artifacts travel through `test-end.artifacts` and the final run result.
The default line reporter adds a compact wall-time, timeline-count, and heap
summary, including the measurement scope. Dedicated reporters may render the full
artifact; no additional reporter package is required.

Opt-in `debug-checkpoint` events carry incomplete snapshots for owned-boundary
crash recovery. At most one checkpoint delivery is pending per attempt. Checkpoints
are requested at body start, each 64 retained timeline entries, and every 50 ms
through an unreferenced timer. They do not represent completed tests.

After abrupt termination, a parent retains received evidence as incomplete and
adds rejection-style terminal evidence. Missing observations remain unavailable.
The native worker-crash or process-exhaustion artifact remains authoritative.

## Debug Mode And Retries / Replay

Each retry produces its own artifact. Debug recording does not change retry
eligibility, case counts, seeds, or executor placement.

Replay clears inherited debug activation. Existing artifacts remain in the source
run; replay does not copy or regenerate them automatically. Explicit `--debug` or
`--debug-scope` on replay collects fresh artifacts in the new run. Programmatic
replay requests supply an explicit `debug` value.

## Cross-References

- [Capability Handles](./capability-handles.md): application-owned recording patterns.
- [Failure Artifacts](./failure-artifacts.md): attribution, errors, and retention.
- [Composition Order](../architecture/composition-order.md): attempt lifecycle.
- [Run Timings](../architecture/run-timings.md): orchestration measurements.
- [Types Index](../reference/types-index.md): public diagnostic contracts.
