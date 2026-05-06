# Reproducibility

## Purpose

This document defines what Overkill should mean by a reproducible run.

## Position

Reproducibility is not only about random seeds. It is about whether a run
can be re-created with meaningfully the same inputs, ordering, runtimes,
and artifact expectations.

The strongest form Overkill commits to is **reproducible run intent and
plan**. Bit-for-bit reproducibility across machines is not promised in the
general case; deterministic-simulation tests reach close to it, ordinary
integration tests do not.

## Reproducibility Inputs

A reproducible run captures, at minimum:

-   the run seed
-   the resolved selection (filter expression and the resulting set of
    `CaseId`s after expansion)
-   the resolved runtime matrix (each `RuntimeId` actually used)
-   the resolved execution strategy (process model, worker count,
    serialisation rules)
-   the resolved capability profile per worker
-   the resolved baseline update mode
-   the benchmark workload identity and calibration inputs where
    relevant
-   the metadata propagation result (resolved metadata per case)
-   the loader configuration (TS strip mode, source-map flag, registered
    hooks)
-   the Overkill engine and package versions

Together these form a `RunPlan` value preserved as part of the run record.

## Run Record Shape

```ts
type RunRecord = {
    readonly id: string; // ULID or content hash of the plan
    readonly seed: bigint;
    readonly plan: RunPlan;
    readonly identities: ReadonlyArray<CaseId>;
    readonly runtime: ResolvedRuntime;
    readonly versions: { engine: string; node: string; packages: ReadonlyMap<string, string> };
    readonly startedAt: string; // ISO 8601
    readonly result?: RunResult; // populated when the run completes
};
```

The record is written to `.overkill/runs/<id>.json` by default. Replay
uses it as input.

## Ordering

If ordering is randomized, the ordering must be replayable.

That implies:

-   reproducible seed handling (single run seed; per-test seeds derived
    deterministically from `(runSeed, CaseId)`)
-   stable test identities (`artifact-identity.md`)
-   deterministic expansion of parameterized and runtime-driven cases

The default ordering is alphabetic by `CaseId` for stability. Randomized
ordering is opt-in (`--shuffle`) and reports the seed prominently in the
run summary.

## Per-Test Seeds

Every test gets its own splittable PRNG derived from
`(runSeed, hash(CaseId))`. This means:

-   reproducing a single failed test requires only the run seed and the
    test identity, not the full run record
-   parallel execution does not perturb per-test randomness (each test
    has its own splittable child)
-   rerunning one test under `--retry` produces identical inputs to the
    failing run

The PRNG is SplitMix-based (see `capability-handles.md` § Splittable
Random).

## Artifact Reproducibility

Artifact-related operations should also be reproducible where practical:

-   baseline lookup (deterministic given `ArtifactId`)
-   stale-baseline detection (deterministic given the collected identity
    set and the on-disk artifact set)
-   benchmark budget resolution (deterministic given workload and env)
-   failure artifact association (artifacts attach to a single
    `CaseId + AttemptId`)

## Machine-Dependent Reproducibility

Some metrics inherently vary across machines. Overkill's policy:

-   **Content snapshots** require exact reproducibility. A content
    snapshot that differs across machines is a real failure (unless
    explicit normalisation is configured).
-   **Visual snapshots** require near-exact reproducibility within
    declared tolerances (anti-aliasing variations, font rendering). The
    baseline subtype's adapter declares the tolerance; differences within
    tolerance pass.
-   **Performance baselines** explicitly do _not_ require exact
    reproducibility. Calibration normalises against a reference workload
    on the current machine; baselines are stored as
    machine-class-stratified (e.g. `linux-x64-ci-shared` vs
    `darwin-arm64-dev`). See `benchmarking.md` § calibration.
-   **Witnesses from deterministic-simulation tests** require exact
    reproducibility (the whole point of DST).

When machine-class stratification is in effect, the run record includes
the resolved machine class so reports can show "this baseline was set on
machine class X."

## Replay

`overkill replay <run-id>` loads a run record and executes the same plan:

-   restores the seed
-   restores the selection (no re-collection from disk; the recorded
    identity set is used directly)
-   restores the runtime matrix where local runtimes are
    available; reports inconclusive for runtimes not available
-   restores the execution strategy
-   restores the loader configuration

Limitations:

-   replay cannot reproduce wall-clock-dependent behavior outside
    deterministic-simulation tests
-   replay cannot reproduce external services that have changed state
-   replay across different Node major versions warns and may refuse if
    the loader behavior diverges materially

## Replay Witnesses For Properties And Simulations

For property tests and deterministic-simulation tests, a run record is
overkill — a witness is enough:

-   `overkill replay-witness <path>` loads the witness JSON, restores the
    seed, the captured world snapshot, and the fault configuration, and
    runs that single test to reproduction
-   the witness is portable (cross-machine for DST, intra-machine-class
    for property tests with timing-dependent shrinks)

Witnesses are versioned by the library version that produced them; an
incompatible reader fails fast rather than running with subtly-different
shrinking semantics.

## Scope

Overkill does not promise impossible bit-for-bit reproducibility across
all machines or operating systems.

It promises:

-   reproducible run intent (the same inputs produce the same plan)
-   reproducible run planning (the same plan executes the same identities)
-   reproducible per-test randomness (the same seed produces the same
    inputs)
-   reproducible content baselines (cross-machine for non-rendered
    artifacts)
-   reproducible deterministic-simulation outcomes (cross-machine, by
    design)
-   reproducible performance baselines within machine class

That is enough to make:

-   failures debuggable
-   randomization replayable
-   baseline changes reviewable
-   benchmark policies meaningful
-   CI failures reproducible locally

## Connection To Other Docs

-   `artifact-identity.md` — provides the stable `CaseId` and `ArtifactId`
    used here
-   `capability-handles.md` — splittable PRNG; recording handles for
    deterministic effect logs
-   `deterministic-simulation.md` — the strongest form of reproducibility
    in Overkill
-   `failure-artifacts.md` — witnesses are first-class artifacts
-   `metadata-and-selection.md` — the resolved metadata is part of the
    plan
-   `benchmarking.md` — calibration and machine-class stratification
