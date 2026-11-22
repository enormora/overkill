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
- family identity and implementation version, validated settings, and preparation
  facts; type tests include exact compiler variants, original source and
  configuration fingerprints, resolution inputs, and assertion ownership

Together these form a `RunFacts` value preserved as part of the run record.

Browser facts additionally preserve body placement, module/export and harness
graph/build identity, browser/controller/protocol versions, guard policy and
required coverage, scenario/startup configuration, and measurement/collector/
reset/instrumentation semantics. Keep temporary addresses, session credentials,
and target/process IDs out of stable comparison keys; rebind permitted endpoints
explicitly during reproduction. Persist logical configuration without secrets.

Reproduction validates the current implementation/build and frozen selected
catalog before admission. A changed module graph, incompatible browser/collector,
or unavailable guard capability requires fresh preparation or a clear failure,
not silent metric substitution. Records keep incomplete/truncated evidence and
attempt/session/document provenance. Inspecting records does not load
browser/controller packages. Reproducing
intent does not claim identical browser scheduling or timings across machines.
`RunFacts` is a serializable snapshot with run-level domains and a
`cases` projection. It is not attached to each executable case. The
executable `TestPlan` is in-memory only because it contains callable test
bodies.

For sharded CI runs, the baseline model is that each shard independently
reconstructs the same `RunFacts` and then executes only its own shard
partition. A richer two-phase planner/executor workflow may still exist, but
it is an optimization, not the required cross-CI baseline.

## Run Record Shape

### Shared Storage And Portable Evidence

Persisted evidence defaults to repository-shared storage in Git projects.
Resolve the canonical common Git directory with
`git rev-parse --path-format=absolute --git-common-dir`
([Git reference](https://git-scm.com/docs/git-rev-parse)), using the resolved
project root rather than the invocation's incidental subdirectory. The default
store lives under `<git-common-dir>/overkill/<project-key>`. The project key
derives from the resolved project's repository-relative location; validate its
stored namespace identity rather than trusting a hash alone. Independent
projects within one repository have separate namespaces. Separate clones have
separate stores; remote URLs and package names are not repository identities.

Non-Git projects default to `<project-root>/.overkill`. Explicit
`runtimeStateDir` chooses project-local or custom storage; resolve relative
values against the resolved project root. A shared custom location must identify
the intended project namespace explicitly and reject accidental mixing.
Resolve storage only when persistence or history access requires it, once per
invocation, never per test. Ordinary unrecorded microtest execution needs no Git
probe, storage scan, shared lock, or new telemetry.

Records carry a store-issued originating-checkout identity and project identity.
The originating cwd and worktree location are provenance, not lookup roots.
Branch/revision metadata, when available, is descriptive; it does not establish
source freshness, clean inputs, or equivalent execution. Runs from different
checkouts remain separate observations even when their work identities match.
Retain origin in summaries and inspection output without changing `CaseId` or
`WorkId`.

Runner-owned record and artifact references are store-relative; test source
locations are repository-relative. Copy retained artifacts into the store before
publishing references, or mark external dependencies explicitly as non-portable.
Do not follow an old absolute cwd to inspect a record. Removing the originating
worktree does not remove its retained evidence. Explicit run-id inspection can
read any run in the project namespace without loading its test code or requiring
that checkout. Source navigation resolves against the caller's explicit current
project root and does not claim that current source matches historical source.

Replay uses the explicitly selected current checkout and compatible resources.
It never checks out a historical revision, re-creates a deleted worktree, or
claims that stored evidence preserves the old application. Store portability
does not imply deterministic replay or automatic cross-machine execution.

The store coordinates concurrent writers, ownership, retention, and byte budgets
across all worktrees. A store's retention and storage policy is authoritative:
ordinary runs with conflicting resolved policy fail persistence rather than
silently replace another checkout's policy. Explicit maintenance may adopt a
changed policy only without live writers. Baselines and checked-in corpus entries
remain checkout-owned and are not relocated into shared mutable storage.

### Record Envelope

Ordinary executions save one compact run record. Explicit recording, replay,
coverage, and attachment workflows retain detailed evidence in that same lifecycle.
`detail` distinguishes compact outcomes and measured summaries from replayable
details. Compact records retain captured family facts and per-work verdicts.
Internal worker and mutation tasks do not enter ordinary history.

Aggregated history holds bounded observations and counters for scheduling and
selection. Baselines, regression witnesses, and calibration references are reusable
inputs with independent lifecycles. Benchmark performance means the measured
consumer workload; duration history learns execution cost for future scheduling.

Version 1 retains executable-family facts, implementation provenance, replay
settings, and resource-check evidence. It replaces the earlier development
formats; existing records must be regenerated. Existing files are never deleted
as a migration step. Inspecting records does not load
family modules. Fields with safe defaults do not require a version bump. Increase
the envelope version only for incompatible meaning or representation.

```ts
type SingleRunRecord = {
    readonly origin: RunOrigin;
    readonly id: string; // ULID
    readonly kind: 'single';
    readonly version: 1;
    readonly replayPlan: CollectedRunPlan | null;
    readonly replayProfile: unknown;
    readonly replayWitness: WitnessFile | null;
    readonly cwd: string;
    readonly request: RunRecordRequest;
    readonly engine: RunExecutionFacts['engine'];
    readonly environment: RunFacts['environment'];
    readonly execution: TestProfileConfig['execution'];
    readonly loader: RunFacts['loader'];
    readonly coverage: RunRecordCoverage | null;
    readonly status: 'started' | 'completed' | 'interrupted';
    readonly seed: string;
    readonly facts: RunFacts | null;
    readonly identities: ReadonlyArray<WorkId>;
    readonly placementTrace: PlacementTrace | null;
    readonly runtime: ResolvedRuntime | null; // see types-index.md
    readonly versions: { engine: string | null; node: string; packages: Readonly<Record<string, string>>; };
    readonly startedAt: string; // ISO 8601
    readonly result: RunRecordResult | null;
};

type MergedRunRecord = {
    readonly origins: NonEmptyReadonlyArray<RunOrigin>;
    readonly id: string; // ULID
    readonly kind: 'merged';
    readonly version: 1;
    readonly status: 'started' | 'completed' | 'interrupted';
    readonly facts: RunFacts;
    readonly identities: ReadonlyArray<WorkId>;
    readonly lineage: NonEmptyReadonlyArray<{ readonly id: string; readonly path: string; }>;
    readonly runtime: NonEmptyReadonlyArray<ResolvedRuntime | null>;
    readonly versions: { engine: string | null; packages: Readonly<Record<string, string>>; };
    readonly startedAt: string; // ISO 8601
    readonly result: RunRecordResult;
};

type RunRecord = CompactRunRecord | SingleRunRecord | MergedRunRecord;
```

Version 1 records require explicit resource-check evidence in their result,
including an empty collection when no checks were recorded.

Completed single records require a result. Started and interrupted attempts may
have no result. `RunRecordRequest` preserves the request with a decimal string
seed. `RunRecordResult` preserves result fields while projecting opaque thrown
values and error causes through bounded diagnostic serialization.
`RunRecordCoverage` stores the resolved policy and store-relative report and
raw directories. Microtests without declared runtimes use `runtime: null`;
unavailable engine versions use `null`.

Explicitly requested, profile-required, and coverage-required attempts start
before runner-owned coverage setup or module imports. Artifact-only attempts
start when collection identifies attachment scopes, before resource acquisition
or case execution. Reusable initialization and collection remain read-only;
each execution invocation starts a fresh record after collection. Direct-file
recording begins inside `runIfMain`, after the entry module has loaded. Until full resolution,
`facts` is `null`, and that attempt cannot be replayed. Known empty selections
have complete empty facts. The result is checkpointed before final reporting,
then completed after reporters and coverage cleanup finish. An escaping exception
marks the attempt interrupted; a supervised crash with a returned parent result
is a completed failed run.

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

For optional `merge-results` workflows, `--record-for-merge` or
`RunRequest.recordForMerge` requests a completed `kind: 'single'` record with
populated `result` for each shard. The persisted request identifies these records
as merge inputs. Run summaries, case outcomes, and work durations from these
inputs enter compact history through the aggregate. History repair skips the
individual inputs. Detailed records remain subject to project retention.

The merge command validates that the records describe the same planned run,
combines their results, and writes a `kind: 'merged'` record under the same
runtime-state directory. The shard records remain the primary execution facts.
The merged record preserves their ids and input paths as lineage.

Merge validation is strict about the run semantics: selected profile, seed,
shard total, selected identities, loader configuration, and Overkill package
versions must agree. `RunFacts.reproducibility.selectedIdentities` records the
complete selected `WorkId` set after expansion and before sharding, including
on empty shards. Identity comparison ignores array order and retains runtime,
workload, and family variants. Missing selection evidence decodes as `null`
for replay; merging requires records with explicit evidence.
Version comparison covers the engine version and recorded `@overkill-dev/*`
package keys and values; other dependency versions may differ. Host metadata such as platform or Node runtime details
may differ and is preserved as metadata. Missing shards, duplicate executed
work identities, unreadable records, or incompatible facts produce a merge
runner error. The merge still writes an incomplete failure record when it has
enough valid input to explain what happened. The first eligible record in shard-index
and canonical-path order supplies the reference; incompatible records contribute
diagnostics rather than counts. Duplicate executions retain all observed outcomes,
so incomplete totals may include repeated work. Repeated shard indices also fail
the merge, including empty shards. With no eligible reference, merging fails
without fabricating aggregate facts. Merge errors select CLI exit status 2 even
when an input reports process exhaustion.

## Compact History

Compact history is the long-lived derived state under `runtimeStateDir`. It is
not a replay source. It keeps useful data after detailed records are pruned:

- run summaries for persisted runs eligible for compact history
- case-level outcome history keyed by `CaseId`
- work history keyed by `WorkId`, with duration samples and family-variant verdicts

`overkill history list` reads run summaries. A run summary records the run id,
start time, selected profile, test family, aggregate status, duration, and
whether a detailed replayable record is still available. Aggregate status uses
this precedence:

1. `interrupted`
2. `runner-error`
3. `failed`
4. `inconclusive`
5. `passed`

Case and work histories keep the last 20 observations per originating checkout
and identity plus aggregate counters. Case observations aggregate all executed
variants in one run: failure wins, then inconclusive, pass, and skip. Retries contribute their
final verdict once. Work observations remain keyed by `WorkId`.

Entries that no longer receive updates are pruned after
90 days by default. Run summaries are kept for the last 500 persisted runs or
90 days, whichever keeps fewer.

`--last-failed` selects work whose newest completed compact observation is failed.
For work without a family variant, it uses the logical case observation.
Family variants use exact `WorkId` observations even when no duration sample
was recorded. A later pass, skip, or inconclusive result clears selection
for that identity only. Existing indexes acquire variant verdicts as new runs
complete.
`--last-failed` and history-based duration scheduling use the originating
checkout's observations by default; another checkout cannot clear failures or
silently supply execution history. Shared storage does not merge these scopes.
Current discovery and filters bound eligible cases. A readable history with no
matches produces a successful recorded empty selection. Reusable collected plans
retain their history snapshot until initialized again.

`--last-failed` reads compact history rather than the previous detailed
record. A run selected with `--last-failed` automatically persists its own
result so the workflow stays fresh. `duration-history-balanced` placement reads
compact work history rather than scanning retained detailed records. If a
command needs compact history and the index is missing or corrupt, it fails
with a repair hint to run `overkill history compact`. Missing duration history
is a normal cold start and uses case-count balancing.

History state is schema-versioned. Older schemas may be rebuilt automatically
from retained records with a 2 second budget. If that budget is exceeded, or
if retained records are insufficient, the command fails with the same repair
hint. `overkill history compact` keeps existing pruned run summaries when the
index is readable; a rebuild from corrupted state may lose summaries whose
detailed records were already pruned. Explicit repair reports this potential
loss; automatic repair does not replace state when its inputs are insufficient.

Run/case history and duration observations live in one versioned document at
`history/index.json`, guarded by one project history lock. Completion atomically
publishes observations and ingestion receipts. Repeated completion or repair
does not increase counters twice. Scheduling reads observations and receipts
from the same snapshot. The old separate duration document is no longer read.

## Retained Evidence Inspection

`@overkill-dev/run` exposes typed `inspectRun`, `inspectCaseHistory`, and
`compareRuns` operations. They read retained runtime state without collecting
tests, importing application modules, acquiring resources, or executing bodies.
They require neither Git nor coverage. Callers supply the runtime-state location
explicitly; CLI configuration resolution follows the ordinary CLI contract.

`inspectRun` accepts an explicit run id and returns its recorded status, facts,
failures, structured assertion diffs, captured output, and artifact references.
Single and merged records are inspectable. Inspection preserves attempt and full
work identity, run-scoped errors, truncation, and completeness metadata. Artifact
references include availability; inspecting a record does not eagerly load every
external artifact. A retained summary without its detailed record is still useful
but cannot supply the pruned diagnostics.

`inspectCaseHistory` accepts a structured `CaseId` and returns retained compact
observations in time order, aggregate counters, and detailed-record availability.
Its explicit scope selects the current checkout or all checkouts in the project.
History list and case inspection default to the current checkout; project-scoped
inspection includes origin for every observation. Explicit run-id inspection and
comparison can address any run in the project namespace.
Compact case observations aggregate variants as defined above; variant and attempt
details are available only from retained detailed records. History does not imply
an observation for every execution: unrecorded runs are absent, and retention
bounds the observations still available.

Readers distinguish available evidence, evidence not recorded, and evidence no
longer retained. Missing files with otherwise unknown provenance are unavailable,
not assumed pruned. Corrupt or unsupported records produce explicit read errors.
An unknown id or identity is unavailable, not a passing result or an empty failure
report. Inspection never repairs, prunes, or writes history implicitly. Historical
readers reuse versioned record decoders and bounded diagnostic data without loading
the producing test family, browser provider, or compiler.

### Selective Evidence Queries

Extend `inspectRun` with typed selection of work items, attempts, and failures,
and a projection of requested sections: summary/facts, diagnostics, diffs,
captured output, or artifact references. Keep full work/attempt attribution and
run-scoped errors accessible; filtering must not silently attribute those errors
to a selected case. CLI history inspection lowers to these same requests and
renders concise text, without requiring JSON or a new query language.

Apply selection and projection before formatting or loading optional artifact
payloads. Bound response entries and bytes; return continuation information and
the number of omitted matches when known. Continuations bind to the immutable
run snapshot and query, not a mutable latest-run pointer. Reject mismatched
continuations, including when an unfinished record has changed since the page;
pruned evidence is unavailable. If one entry exceeds the response budget, return
a marked bounded preview or explicit unavailability rather than a non-advancing
page. Distinguish query exclusion, response truncation, capture/serialization
omission, storage-budget omission, never-recorded data, and pruned data. Default
inspection pages contain at most 100 entries and 32 KiB of rendered text,
including continuation metadata; typed callers receive corresponding bounded
structured sections. Explicit positive entry/byte limits change a query's
response budget without altering stored evidence.

Inspection can enumerate grouped brief diagnostic members from individual stored
failures; it never reconstructs missing operands or executes tests to recover
detail. Reuse existing decoders, result types, and brief formatting. The compact
completion receipt follows [Run Counts](./run-counts.md#completion-receipt).

### Recorded Run Comparison

`compareRuns` accepts explicit before and after run ids and compares their retained
detailed results by full `WorkId`. The result separates:

- failures newly observed after a previous successful execution
- successful executions after a previous failure
- other verdict transitions, including skipped and inconclusive outcomes
- identities observed in only one result
- planned work without a completed result, when the retained plan establishes it

Only-in-one-result identities are not described as added or removed tests. Different
selections, shards, interrupted runs, or unavailable evidence can explain their
absence. A skipped or inconclusive result is not a recovery. Retries compare final
authoritative verdicts while preserving attempt evidence for inspection.

Comparison reports recorded differences in profile, family/version, selection,
runtime, workload, seed, and execution conditions alongside transitions. It does
not merge distinct variants, infer renamed cases, certify freshness, or attribute
failures to source changes. Unknown conditions remain unknown. Missing detailed
results make comparison unavailable; compact summaries are not substituted for
work-level evidence. Comparison creates no merged record or new execution result.

CLI commands and read-operation exit behavior are defined in
[CLI Reference](../reference/cli.md#history). Human output reuses the brief
reporter's diagnostic formatting; typed callers receive structured evidence rather
than parsed terminal text.

## Retention And Maintenance

### Storage Budgets

Default project policy includes a 64 MiB combined per-run storage limit
(`history.maxRunBytes: 67_108_864`) and a 1 GiB shared project-store limit
(`history.maxStoreBytes: 1_073_741_824`). Positive safe integers set finite byte
limits; `null` explicitly disables the corresponding byte ceiling. Count and age
retention still apply. Byte ceilings take precedence over retention windows;
seven-day failure retention is not a promise to retain unlimited bytes.

The store ceiling accounts for records, compact history, artifacts, debug and
coverage data, local witnesses and corpus, provisional captures, temporary
files, and reserved writes across concurrent runs. Account for peak replacement
space during atomic writes as well as final size. Count logical file bytes and
outstanding reservations; filesystem metadata, allocation overhead, and external
consumer-owned output are outside this byte-accounting guarantee. External
references do not imply that their targets are covered by the store budget.

Writers reserve bounded chunks under shared coordination before retaining or
writing data, including provisional evidence later discarded. Keep accounting
incremental; do not scan the whole store on every invocation. A crash must not
silently release reservations for bytes still present. Ownership recovery and
explicit maintenance reconcile abandoned reservations and temporary files.
Unknown or inconsistent accounting blocks new persistence until reconciled;
never assume unaccounted files use zero bytes. No writer may borrow another
active run's reservation or rely on eventual pruning to admit an over-budget
write.

Reclaim eligible completed-run evidence first, oldest first with run id as the
tie-breaker. Active runs and repair-required records are protected. Local
witnesses and corpus entries follow the same byte accounting and explicit
ownership; stale unreferenced entries are reclaimable, while retained records'
required references are preserved or marked unavailable together. Never delete
checked-in corpus entries or baselines to reclaim runtime-state space.

If admission cannot reclaim enough space within its bounded maintenance work,
stop retaining additional optional diagnostics and record a storage-budget
omission. Reserve space for bounded completion metadata before optional capture.
Preserve observed verdicts and counts; omitted diagnostics do not erase failures
or become passing results. If required record metadata, history updates, or
lossless workflow evidence cannot fit, report a persistence runner error while
preserving the in-memory test outcomes. Do not truncate identities, replay
payloads, or required result structure into apparently valid records.

`--unbounded-diagnostics` removes diagnostic volume caps and the per-run
storage cap for one run,
but cannot override a finite shared-store ceiling. The request is recorded in
run facts. Cycle detection, serialization work bounds, timeouts, and human
rendering limits remain in force. See
[Failure Artifacts](../authoring/failure-artifacts.md#serialization-storage-and-rendering-boundaries).

### Retention Windows And Maintenance

Count and age windows are shared across the project store, while automatic
history consumers remain checkout-scoped. Store-owned writers and artifact
producers must honor byte admission; an integration that cannot bound its
retained output must reject that capture mode before starting it. The store
ceiling is not an operating-system quota on arbitrary application filesystem
writes. Explicit external output remains outside its accounting.

The detailed-record limit downgrades older details to compact records. Compact
records follow summary count and age limits. Aggregate observations and counters
survive record pruning; repairs report possible loss when source records expired.

Run-record retention is global project policy under top-level `history`
configuration. Profile policy decides whether a run writes a record; global
history policy decides how long records and summaries remain.

Defaults:

- detailed records: last 20 persisted runs
- per-run stored data: 64 MiB; shared project store: 1 GiB
- successful per-run artifacts: last 5 successful persisted runs
- failing per-run artifacts: 7 days
- run summaries: last 500 persisted runs or 90 days
- stale case/work history entries: 90 days
- compact history observations: last 20 per identity plus counters

Required record and provisional compact-history writes happen before final
reporter output so persistence errors appear in the normal run summary.
Case and work observations become visible only after the record completes,
including reporter delivery and coverage cleanup. Abandoned provisional
contributions become interrupted summaries during repair. Automatic
pruning is optional maintenance and happens after final reporter output.

Automatic maintenance:

- runs only after persisted runs eligible for compact history
- is lock-protected
- is best-effort
- has a default 100 ms cooperative budget, including lock waiting and scanning;
  zero disables automatic maintenance
- stops starting operations at the deadline and awaits in-flight operations
  before releasing the lock
- may leave retention temporarily exceeded
- reports pruning failures as diagnostics without changing the test verdict

These best-effort pruning rules never weaken write-time byte admission.
Automatic maintenance follows completed attempts, including failed tests.
Escaping exceptions preserve their original failure; later maintenance handles
the interrupted records. Budget exhaustion, contention, and live owners defer
maintenance quietly. Other failures and ownership recovery are returned through
runner-owned `maintenanceDiagnostics`, also printed by the CLI. These diagnostics
are not engine errors or persisted record fields. Large scans can consume the
entire budget without deleting anything; explicit prune completes such backlogs.

Explicit maintenance commands use the same lock. `overkill history prune`
fails when it cannot apply retention. `overkill history compact` fails when it
cannot rebuild the compact index. `overkill history clear` deletes all
history state under `runtimeStateDir`, excluding baselines, witnesses, and
corpus.

History lock acquisition waits up to 5 seconds by default. A lock older than
2 minutes may be treated as stale, broken, and reported as a diagnostic.

Per-run artifact retention is independent of detailed-record and summary
retention. Before pruning a record whose artifacts survive, maintenance writes
versioned retention metadata beside its artifacts. Unknown artifact ownership
or invalid metadata fails pruning before deletion.

Successful runs retain their place in the artifact retention window even when
they produced no artifacts and their detailed records and summaries expire.

Pruning preserves detailed records needed to repair incomplete history commits.
Run `overkill history compact` before retrying when pruning reports a repair
requirement. Repair preserves known case outcomes even when a run summary
cannot be recovered.

Persisted runs register ownership before their first record write and release
it after completion or interruption. Explicit prune, compact, and clear reject
live owners while holding the shared project lock. Abandoned local owners can
be recovered after their process exits. Maintenance must not overlap older
runner versions that lack ownership registration.

## Ordering

If ordering is randomized, the ordering must be replayable.

That implies:

- reproducible seed handling (single run seed; per-test seeds derived
  deterministically from `(runSeed, WorkId)`)
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
`(runSeed, WorkId)`. `scope.seed` exposes the derived seed and `scope.random`
exposes its splittable random handle on both builder and throwing scopes.
The complete executable identity includes parameter, runtime, and workload
identity; attempt, worker, scheduling, and selection do not change the stream.
Every attempt starts a fresh stream. This means:

- reproducing a single failed test requires only the run seed and the
  test identity, not the full run record
- parallel execution does not perturb per-test randomness (each test
  has its own splittable child)
- rerunning one test under an integration retry policy produces identical inputs to the
  failing run

Case-seed version `case-seed-v1` hashes the JSON tuple of that version, the
decimal run seed, and the canonical work identity key with SHA-256, taking the
first 64 bits in big-endian order. Direct engine execution accepts an explicit
`seed` and uses `0n` when no run context supplies one.

Use `pure-rand`'s xoroshiro128+ generator. Stream version `case-random-v1`
hashes the JSON tuple of that version and the decimal case seed with SHA-256.
The first 128 bits become four signed 32-bit state words in big-endian order;
an all-zero state uses `1` for its first word.

Splitting hashes the JSON tuple of `case-random-split-v1`, the parent state,
and the child label (`first` or `second`) with the same state derivation.
Advance the parent once per split. Child streams share no mutable state;
recursive and repeated splits derive distinct child identities.
See [Capability Handles § Splittable Random For Determinism Under Parallelism](../authoring/capability-handles.md#splittable-random-for-determinism-under-parallelism).

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
  reproducibility. Calibration records a reference workload on the current machine. Adapters
  receive automatically normalized benchmark samples. Normalized expectations
  match by calibration workload identity across machine classes; raw and legacy
  expectations remain machine scoped. Custom domains select representative
  calibration workloads. See [Benchmarking § Calibration And Normalization](../authoring/benchmarking.md#calibration-and-normalization).
- **Witnesses from deterministic-simulation tests** require exact
  reproducibility (the whole point of DST).

When machine-class stratification is in effect, the run record includes
the resolved machine class so reports can show "this baseline was set on
machine class X." Performance expectations retain their calibration metadata
and reference samples. Invalid or non-comparable calibration fails the run.
Captured reference files are optional; automatic normalization uses stable
reference-workload units for budgets.

## Replay

`overkill replay <run-id>` loads a previously persisted run record and
executes the same plan:

- restores the seed
- imports only recorded source modules to bind current bodies to saved work
  identities; current discovery patterns, filters, shards, and placement
  planning do not select new work
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
discarded duplicates, reassignment, and conflict evidence. Current outcomes are
compared using recorded authority, even when completion timing changes.

An interrupted trace is a prefix. Remaining unassigned work follows the saved
unit and lane order, without new adaptive scheduling decisions, and replay emits
a diagnostic. Empty selections require no source imports.

Replay writes a fresh record and leaves the source record intact.
Version 1 snapshots contain bodyless collection metadata and normalized profile
policy without reporter callbacks. Witness replay records retain the concrete
witness input for subsequent recorded-run replay. Records without replay
snapshots remain inspectable; missing replay metadata is a compatibility error.
Reporter callbacks use current config.

Limitations:

- replay cannot reproduce wall-clock-dependent behavior outside
  deterministic-simulation tests
- replay cannot reproduce external services that have changed state
- replay across different Node major versions warns and may refuse if
  the loader behavior diverges materially

## Replay Witnesses For Properties And Simulations

For first-class property tests and deterministic-simulation tests, a witness
can reproduce family-owned inputs without a complete run record.
`overkill replay-witness <path> --profile <name>` loads the
witness JSON and replays a first-class property body with the stored input,
without generation, corpus phases, shrinking, or confirmation. Advanced nested `scope.forall` witnesses
execute the enclosing case normally and substitute the target input only;
missing, ambiguous, or unreached targets are replay errors. The command reports
the current outcome when source code has changed.

Nested property witnesses reproduce only the target input; they do not
promise to freeze surrounding executions, corpus contents, or captured state.
Use complete run recording when reproducing that enclosing run is necessary.

Simulation witnesses select one owning resource and restore through
`withWitnessReplay(resource, restore)` before projecting its fresh handle. The
callback receives the witness, a signed `bigint | null` seed, and cancellation
signal together with the fresh owner handle in one context. The resource may
declare one restore callback; absent/ambiguous owning resources or incompatible
producer/payload state fail before projecting the handle. Disposal follows
normal ownership rules, including restore failures.
The built-in HTTP adapter restores scenarios and reruns the current handler;
transcripts are diagnostics. The adapter checks the producer package name and
validates the existing HTTP payload format and inputs. The recorded package
release is provenance, so a compatible witness can replay after an upgrade.

For the witness schema and versioning rules, see
[Failure Artifacts § Witnesses And Replay Artifacts](../authoring/failure-artifacts.md#witnesses-and-replay-artifacts).

Property witnesses and promoted corpus entries use lossless, versioned graph
JSON with supported historical built-in decoders. Their compatibility,
promotion, and execution rules live in
[Property-Based Testing Resolution](../authoring/higher-test-layers.md#property-based-testing-resolution).

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
- [Benchmarking](../authoring/benchmarking.md) - calibration and portable normalized budgets

Declared calibration resources retain workload identity, version, units, sampling
policy, samples, machine metadata, and executing Node arguments. Built-in timing
and CPU metrics normalize by default; custom domains declare their own workloads.
Saved expectations retain their original budget basis. Optional captures from
`overkill bench calibrate` provide display references. Incompatible workload
identities, execution arguments, or conflicting adapter references fail measurement.
Budget intervals account for reference
uncertainty under the independent, stationary observation assumption.
