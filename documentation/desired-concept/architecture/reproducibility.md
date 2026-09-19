# Reproducibility

## Purpose

This document defines what Overkill should mean by a reproducible run.

## Position

Reproducibility is not only about random seeds. It is about whether a run
can be re-created with meaningfully the same inputs, ordering, runtimes,
and artifact expectations.

The strongest form Overkill commits to is **reproducible run intent and
facts**. Bit-for-bit reproducibility across machines is not promised in the
general case; deterministic-simulation tests reach close to it, ordinary
integration tests do not.

## Reproducibility Inputs

A reproducible run captures, at minimum:

- the run seed
- the resolved selection (filter expression and the resulting set of
  `WorkId`s after runtime/workload expansion)
- the resolved runtime identities (each `RuntimeId` actually used)
- the resolved execution strategy (process model, worker count,
  worker lifecycle, work distribution, assignment policy, dispatch policy,
  serialisation rules)
- the resolved work units, shard partition, and initial placement plan
- the resolved capability profile per worker
- duration-history inputs used for placement, when history-aware assignment
  is enabled
- dynamic scheduling trace inputs when runtime dispatch used leasing,
  reprioritization, pending-unit splitting, compatible batching, warm-lane
  affinity, or hedging
- the baseline verb invoked, if any (`update`, `apply`, `bootstrap`,
  `diff`)
- the benchmark workload identity and calibration inputs where
  relevant
- resolved annotations and controls per case
- the loader configuration (TS strip mode, source-map flag, registered
  hooks)
- the Overkill engine and package versions

Together these form a `RunFacts` value preserved as part of the run record.
`RunFacts` is a serializable snapshot with run-level domains and a
`cases` projection. It is not attached to each executable case. The
executable `TestPlan` is in-memory only because it contains callable test
bodies.

For sharded CI runs, the baseline model is that each shard independently
reconstructs the same `RunFacts` and then executes only its own shard
partition. A richer two-phase planner/executor workflow may still exist, but
it is an optimization, not the required cross-CI baseline.

## Run Record Shape

```ts
type SingleRunRecord = {
    readonly id: string; // ULID
    readonly kind: 'single';
    readonly status: 'started' | 'completed' | 'interrupted';
    readonly seed: string;
    readonly facts: RunFacts;
    readonly identities: ReadonlyArray<WorkId>;
    readonly placementTrace: PlacementTrace | null;
    readonly runtime: ResolvedRuntime; // see types-index.md
    readonly versions: { engine: string; node: string; packages: Readonly<Record<string, string>>; };
    readonly startedAt: string; // ISO 8601
    readonly result: RunResult | null;
};

type MergedRunRecord = {
    readonly id: string; // ULID
    readonly kind: 'merged';
    readonly facts: RunFacts;
    readonly identities: ReadonlyArray<WorkId>;
    readonly lineage: NonEmptyReadonlyArray<{ readonly id: string; readonly path: string; }>;
    readonly runtime: NonEmptyReadonlyArray<ResolvedRuntime>;
    readonly versions: { engine: string; packages: Readonly<Record<string, string>>; };
    readonly startedAt: string; // ISO 8601
    readonly result: RunResult;
};

type RunRecord = SingleRunRecord | MergedRunRecord;
```

`RunRecord.id` identifies one persisted record. For `kind: 'single'`, it
identifies one concrete run instance. For `kind: 'merged'`, it identifies a
derived aggregate created from completed shard records. It is not a plan hash
and it is not reused across repeated identical runs. If the concept later
needs an explicit same-plan fingerprint, that should be a separate field
rather than overloading the run-record ID.

The record is a conceptual output of the run, but persistence is not free.
It must not be mandatory on the hottest microtest path.

So the settled direction should be:

- every run has an in-memory `ResolvedRun` plus result model
- persisted `RunRecord`s are written only when an active workflow needs
  them
- examples include explicit replay/recording workflows, debug-mode
  retention, sharded result merging, coverage/artifact-producing runs, and
  other runs where the user or active feature asked for durable runtime state
- ordinary microtest profiles default to `runRecords.persist: 'on-demand'`
- `overkill run --record` persists a detailed record for one invocation
- profiles may set `runRecords.persist: 'always'` when replay and history are
  part of the normal workflow

When persisted, a `kind: 'single'` record is written under
`.overkill/runs/<id>.json`. A persisted run writes a started record before
execution so crash diagnostics and artifact paths have a stable run id. It
then finalizes that record atomically when the run completes. Incomplete
records are listed as `interrupted`; they are ignored by compact case/work
history, but may still be replayed when their `RunFacts` are complete.

Replay accepts only `kind: 'single'` records. A merged record is reportable
lineage, not a single execution that can be replayed. Detailed record
persistence and compact history are part of the same persistence contract. If
a workflow requests or requires persistence, failure to write the detailed
record or update compact history is a runner error and the command fails. The
retained record should include that persistence error in
`RunRecord.result.runnerErrors` when enough of the record could be written.
This is a repairable state, not a transactional promise: `overkill history
compact` can rebuild the compact index from retained records.

For optional `merge-results` workflows, every shard writes a completed
`kind: 'single'` record with populated `result`. The merge command validates
that the records describe the same planned run, combines their results, and
writes a `kind: 'merged'` record under the same runtime-state directory. The
shard records remain the primary execution facts; the merged record preserves
their ids and input paths as lineage.

Merge validation is strict about the run semantics: selected profile, seed,
shard total, selected identities, loader configuration, and Overkill package
versions must agree. Host metadata such as platform or Node runtime details
may differ and is preserved as metadata. Missing shards, duplicate executed
work identities, unreadable records, or incompatible facts produce a merge
runner error. The merge still writes an incomplete failure record when it has
enough valid input to explain what happened.

## Compact History

Compact history is the long-lived derived state under `runtimeStateDir`. It is
not a replay source. It keeps useful data after detailed records are pruned:

- run summaries for persisted runs
- case-level outcome history keyed by `CaseId`
- work-level duration history keyed by `WorkId`

`overkill history list` reads run summaries. A run summary records the run id,
start time, selected profile, test family, aggregate status, duration, and
whether a detailed replayable record is still available. Aggregate status uses
this precedence:

1. `interrupted`
2. `runner-error`
3. `failed`
4. `inconclusive`
5. `passed`

Case and work histories keep the last 20 observations per identity plus
aggregate counters. Entries that no longer receive updates are pruned after
90 days by default. Run summaries are kept for the last 500 persisted runs or
90 days, whichever keeps fewer.

`--last-failed` reads compact case history rather than the previous detailed
record. A run selected with `--last-failed` automatically persists its own
result so the workflow stays fresh. `duration-history-balanced` placement reads
compact work history rather than scanning retained detailed records. If a
command needs compact history and the index is missing or corrupt, it fails
with a repair hint to run `overkill history compact`.

History state is schema-versioned. Older schemas may be rebuilt automatically
from retained records with a 2 second budget. If that budget is exceeded, or
if retained records are insufficient, the command fails with the same repair
hint. `overkill history compact` keeps existing pruned run summaries when the
index is readable; a rebuild from corrupted state may lose summaries whose
detailed records were already pruned.

## Retention And Maintenance

Run-record retention is global project policy under top-level `history`
configuration. Profile policy decides whether a run writes a record; global
history policy decides how long records and summaries remain.

Defaults:

- detailed records: last 20 persisted runs
- successful per-run artifacts: last 5 successful persisted runs
- failing per-run artifacts: 7 days
- run summaries: last 500 persisted runs or 90 days
- stale case/work history entries: 90 days
- compact history observations: last 20 per identity plus counters

Required record and compact-history commits happen before final reporter
output so persistence errors appear in the normal run summary. Automatic
pruning is optional maintenance and happens after final reporter output.

Automatic maintenance:

- runs only after persisted runs
- is lock-protected
- is best-effort
- has a default 100 ms budget
- may leave retention temporarily exceeded
- reports pruning failures as diagnostics without changing the test verdict

Explicit maintenance commands use the same lock. `overkill history prune`
fails when it cannot apply retention. `overkill history compact` fails when it
cannot rebuild the compact index. `overkill history clear` deletes all
history state under `runtimeStateDir`, excluding baselines, witnesses, and
corpus.

History lock acquisition waits up to 5 seconds by default. A lock older than
2 minutes may be treated as stale, broken, and reported as a diagnostic.

## Ordering

If ordering is randomized, the ordering must be replayable.

That implies:

- reproducible seed handling (single run seed; per-test seeds derived
  deterministically from `(runSeed, CaseId)`)
- stable test identities ([Artifact Identity](./artifact-identity.md))
- deterministic expansion of parameterized and runtime-driven cases
- deterministic work-unit construction and initial placement

The default ordering is a seeded shuffle recorded in the run plan and
reported in the run summary. Lexical ordering is an explicit opt-out for
debugging or policy-driven runs that prefer source-stable order.

Worker-pool balancing may place larger work units before smaller units. The
seeded order still matters: it breaks equal-weight ties and determines the
lane-local execution order recorded in the placement plan.

## Per-Test Seeds

Every test gets its own splittable PRNG derived from
`(runSeed, hash(CaseId))`. This means:

- reproducing a single failed test requires only the run seed and the
  test identity, not the full run record
- parallel execution does not perturb per-test randomness (each test
  has its own splittable child)
- rerunning one test under `--retry` produces identical inputs to the
  failing run

The PRNG is SplitMix-based (see [Capability Handles § Splittable Random For Determinism Under Parallelism](../authoring/capability-handles.md#splittable-random-for-determinism-under-parallelism)).

## Artifact Reproducibility

Artifact-related operations should also be reproducible where practical:

- baseline lookup (deterministic given `ArtifactId`)
- stale-baseline detection (deterministic given the collected identity
  set and the on-disk artifact set)
- benchmark budget resolution (deterministic given workload and environment)
- failure artifact association (artifacts attach to a single
  `CaseId + AttemptId`)

## Machine-Dependent Reproducibility

Some metrics inherently vary across machines. Overkill's policy:

- **Content snapshots** require exact reproducibility. A content
  snapshot that differs across machines is a real failure (unless
  explicit normalisation is configured).
- **Visual snapshots** require near-exact reproducibility within
  declared tolerances (anti-aliasing variations, font rendering). The
  baseline subtype's adapter declares the tolerance; differences within
  tolerance pass.
- **Performance baselines** explicitly do _not_ require exact
  reproducibility. Calibration normalises against a reference workload
  on the current machine; baselines are stored as
  machine-class-stratified (e.g. `linux-x64-ci-shared` vs
  `darwin-arm64-dev`). See [Benchmarking § Calibration And Normalization](../authoring/benchmarking.md#calibration-and-normalization).
- **Witnesses from deterministic-simulation tests** require exact
  reproducibility (the whole point of DST).

When machine-class stratification is in effect, the run record includes
the resolved machine class so reports can show "this baseline was set on
machine class X."

## Replay

`overkill replay <run-id>` loads a previously persisted run record and
executes the same plan:

- restores the seed
- restores the selection (no re-collection from disk; the recorded
  identity set is used directly)
- restores runtime identities where local runtimes are
  available; reports inconclusive for runtimes not available
- restores the execution strategy
- restores the loader configuration
- restores the recorded placement trace when replaying a run that used dynamic
  leasing, runtime reprioritization, pending-unit splitting, compatible
  batching, warm-lane affinity, or straggler hedging

Replay of dynamic scheduling is trace-led. It does not try to reproduce the
same wall-clock straggler timing and then hope the scheduler makes the same
choices. The recorded trace restores the dynamic choices themselves: split
parentage, batch envelopes, hedged duplicates, authoritative completions,
discarded duplicates, reassignment, and conflict evidence.

Limitations:

- replay cannot reproduce wall-clock-dependent behavior outside
  deterministic-simulation tests
- replay cannot reproduce external services that have changed state
- replay across different Node major versions warns and may refuse if
  the loader behavior diverges materially

## Replay Witnesses For Properties And Simulations

For property tests and deterministic-simulation tests, a run record is
overkill - a witness is enough. `overkill replay-witness <path>` loads the
witness JSON and replays that single failing case directly.

For the witness schema and versioning rules, see
[Failure Artifacts § Witnesses And Replay Artifacts](../authoring/failure-artifacts.md#witnesses-and-replay-artifacts).

## Scope

Overkill does not promise impossible bit-for-bit reproducibility across
all machines or operating systems.

It promises:

- reproducible run intent (the same inputs produce the same plan)
- reproducible run planning (the same plan executes the same identities)
- reproducible per-test randomness (the same seed produces the same
  inputs)
- reproducible content baselines (cross-machine for non-rendered
  artifacts)
- reproducible deterministic-simulation outcomes (cross-machine, by
  design)
- reproducible performance baselines within machine class

That is enough to make:

- failures debuggable
- randomization replayable
- baseline changes reviewable
- benchmark budgets meaningful
- CI failures reproducible locally

## Cross-References

- [Artifact Identity](./artifact-identity.md) - provides the stable `CaseId` and `ArtifactId`
  used here
- [Capability Handles](../authoring/capability-handles.md) - splittable PRNG; recording handles for
  deterministic effect logs
- [Deterministic Simulation Testing](../authoring/deterministic-simulation.md) - the strongest form of reproducibility
  in Overkill
- [Failure Artifacts](../authoring/failure-artifacts.md) - witnesses are first-class artifacts
- [Test Data And Selection](./test-data-and-selection.md) - resolved test data is part of the
  plan
- [Benchmarking](../authoring/benchmarking.md) - calibration and machine-class stratification
