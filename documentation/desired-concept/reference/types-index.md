# Types Index

## Purpose

A canonical sketch of every TypeScript type referenced from more than one
concept doc.

This file exists so reviewers do not have to chase types across the doc
set, and so authoring documentation can cite a single source instead of
re-stating fields.

The shapes here are concept-level sketches, not contracts. The actual
package types may add fields. If a type's canonical definition lives in a
domain doc, that doc is named under the sketch.

## Status

Reference-first: the main sections below are lookup sketches for settled
cross-doc concepts. Any remaining placeholders are isolated at the end so
the doc does not blur canonical shared types with illustrative sample names.

## Identity

```ts
type TestId = {
    readonly file: string; // canonical source file path, repository-relative
    readonly suite?: ReadonlyArray<string>; // ordered suite names, root → leaf
    readonly name: string; // test name within its parent
};

type CaseId = TestId & {
    readonly params?: string; // canonical case key for parameterized tests
};

type RuntimeId = {
    readonly name: string; // 'chromium', 'node', 'deterministic-api', ...
    readonly dimensions?: Record<string, string>;
};

type WorkloadId = {
    readonly name: string;
    readonly params?: Record<string, string>;
};

type AttemptId = { readonly index: number }; // 0-indexed

type ArtifactSubtype =
    | 'content-snapshot'
    | 'visual-snapshot'
    | 'terminal-snapshot'
    | 'performance-baseline'
    | 'witness'
    | 'log-capture'
    | 'trace';

type ArtifactId = {
    readonly case: CaseId;
    readonly runtime?: RuntimeId;
    readonly workload?: WorkloadId;
    readonly attempt?: AttemptId;
    readonly subtype: ArtifactSubtype;
};
```

Canonical: [Artifact Identity](../architecture/artifact-identity.md).

## Test Tree And Metadata

```ts
type TestNode = TestCase | Suite | Table;

type TestCase = {
    readonly kind: 'test';
    readonly name: string;
    readonly metadata?: Metadata;
    readonly body: TestBody; // signature varies by DSL
};

type Suite = {
    readonly kind: 'suite';
    readonly name: string;
    readonly metadata?: Metadata;
    readonly children: ReadonlyArray<TestNode>;
};

type Table = {
    readonly kind: 'table';
    readonly name: string;
    readonly metadata?: Metadata;
    readonly cases: ReadonlyArray<{ params: Record<string, unknown>; body: TestBody }>;
};

type Metadata = {
    readonly tags?: ReadonlySet<string>;
    readonly kind?: TestKind;
    readonly runtimes?: ReadonlyArray<string>;
    readonly capabilities?: ReadonlyArray<Capability>;
    readonly baselines?: ReadonlyArray<BaselineSubtype>;
    readonly ownership?: ReadonlyArray<string>;
    readonly stability?: 'stable' | 'flaky' | 'experimental';
    readonly priority?: 'critical' | 'standard' | 'optional';
    readonly debug?: boolean;
    readonly extra?: ReadonlyMap<string, unknown>;
};

type TestKind = 'microtest' | 'integration' | 'browser' | 'benchmark' | 'type-test' | 'property' | 'simulation';

type RunnerProfileName =
    | 'microtest'
    | 'microtest-supervised'
    | 'microtest-with-coverage'
    | 'integration'
    | 'benchmark'
    | 'simulation';

type BaselineSubtype = 'content-snapshot' | 'visual-snapshot' | 'terminal-snapshot' | 'performance-baseline';

// Closed enumeration; see microtests-and-capabilities.md §
// Capability Defaults for the canonical definition. New capabilities
// require an explicit addition.
type Capability = 'fs-read' | 'fs-write' | 'net' | 'child-process' | 'worker' | 'addon' | 'wasi' | 'process-exit';
```

Canonical: [Tests As Values](../authoring/tests-as-values.md) for `TestNode`/`TestCase`/`Suite`/`Table`,
[Metadata And Selection](../architecture/metadata-and-selection.md) for `Metadata`, [Glossary](./glossary.md) for the
enumerations.

## Outcomes And Verdicts

```ts
type TestOutcome = Pass | Fail | Skip | Inconclusive;

type Pass = { kind: 'pass' };

type Fail = {
    kind: 'fail';
    checks: ReadonlyArray<FailedCheck>;
};

type Skip = { kind: 'skip'; reason: string };

type Inconclusive = { kind: 'inconclusive'; reason: string };

type FailedCheck = {
    readonly id: string;
    readonly summary: string;
    readonly expected: unknown;
    readonly actual: unknown;
    readonly path: ReadonlyArray<string | number>;
    readonly location: SourceLocation;
    readonly diff?: Diff;
};

type Diff =
    | { kind: 'value'; expected: SerializedValue; actual: SerializedValue }
    | { kind: 'string'; expected: string; actual: string; hunks: ReadonlyArray<Hunk> }
    | { kind: 'object'; ops: ReadonlyArray<DiffOperation> }
    | { kind: 'array'; ops: ReadonlyArray<DiffOperation> }
    | { kind: 'binary'; expectedSize: number; actualSize: number; expectedHash: string; actualHash: string };

type DiffOperation =
    | { operation: 'add'; path: ReadonlyArray<string | number>; value: SerializedValue }
    | { operation: 'remove'; path: ReadonlyArray<string | number>; value: SerializedValue }
    | { operation: 'replace'; path: ReadonlyArray<string | number>; from: SerializedValue; to: SerializedValue };

type Hunk = {
    readonly line: number;
    readonly removed: ReadonlyArray<string>;
    readonly added: ReadonlyArray<string>;
};

type SerializedValue = unknown; // post-serializer JSON-compatible value

type SourceLocation = {
    readonly file: string;
    readonly line: number;
    readonly column?: number;
};
```

Canonical: [Assertions And Results § The Protocol Shape](../authoring/assertions-and-results.md#the-protocol-shape) for `TestOutcome`,
[Assertions And Results](../authoring/assertions-and-results.md) for `FailedCheck`/`Diff`/`DiffOperation`/`Hunk`. The
`TestVerdict` reporter category is derived from outcome + metadata; see
[Glossary § Test Verdict](./glossary.md#test-verdict).

## Assertion Extensions And Error Matching

```ts
type ErrorMatcher = {
    readonly type?: abstract new (...args: ReadonlyArray<unknown>) => Error;
    readonly message?: string | RegExp;
    readonly code?: string;
    readonly name?: string;
    readonly cause?: ErrorMatcher;
};

type AssertionExtension = {
    readonly name: string;
};

type ForeignAssertionBridge = {
    fromThrowable(label: string, body: () => void | Promise<void>): unknown;
};

type CreateTestFacadeOptions = {
    readonly assertions?: ReadonlyArray<AssertionExtension>;
};

type TestBody = (case: unknown) => unknown;

type TestFacade = {
    readonly test: (name: string, body: TestBody) => TestCase;
    readonly suite: (name: string, children: ReadonlyArray<TestNode>) => Suite;
    readonly table: (options: {
        title: string;
        cases: ReadonlyArray<unknown>;
        caseTitle?: (parameters: unknown, index: number) => string;
        test: TestBody;
    }) => Table;
    readonly defineMacro: <Args extends ReadonlyArray<unknown>>(
        factory: (...args: Args) => TestNode,
    ) => (...args: Args) => TestNode;
    readonly runIfMain: (meta: ImportMeta, spec: TestNode) => Promise<void>;
};
```

Canonical: [Assertions And Results](../authoring/assertions-and-results.md).

## Run Request, Plan, And Record

```ts
type RunRequest = {
    readonly paths?: ReadonlyArray<string>;
    readonly selection?: {
        readonly filter?: string;
        readonly name?: string;
        readonly file?: string;
        readonly id?: CaseId;
        readonly lastFailed?: boolean;
    };
    readonly shard?: { readonly index: number; readonly total: number };
    readonly profile?: RunnerProfileName;
    readonly execution?: {
        readonly mode?: string; // see runtime-behavior.md
        readonly workers?: number;
    };
    readonly coverage?: boolean;
    readonly capture?: 'buffered' | 'live';
    readonly seed?: bigint;
    readonly order?: 'seeded' | 'lexical';
    readonly debug?: {
        readonly mode: 'off' | 'all' | 'selected';
        readonly selectors?: ReadonlyArray<string>;
    };
    readonly configPath?: string;
};

type RunPlan = {
    readonly seed: bigint;
    readonly identities: ReadonlyArray<CaseId>;
    readonly runtimes: ReadonlyArray<ResolvedRuntime>;
    readonly executionStrategy: string; // see runtime-behavior.md
    readonly capabilityProfile: string;
    readonly baselineUpdateMode: 'none' | 'update' | 'apply' | 'bootstrap' | 'diff';
    readonly metadataResolved: ReadonlyMap<string, Metadata>;
    readonly loaderConfig: { stripMode: 'strip-only' | 'transform'; sourceMaps: boolean };
    readonly versions: { engine: string; node: string; packages: ReadonlyMap<string, string> };
    // debug mode plumbing — see runtime-behavior.md § Test Debug Mode
    readonly debugMode: 'off' | 'all' | 'selected';
    readonly debuggedCases?: ReadonlyArray<CaseId>; // present when debugMode === 'selected'
};

type ResolvedRuntime = {
    readonly id: RuntimeId;
    readonly nodeVersion?: string;
    readonly os?: string;
    readonly machineClass?: string;
    readonly adapters: ReadonlyArray<{ name: string; version: string }>;
};

type RunRecord = {
    readonly id: string; // ULID
    readonly seed: bigint;
    readonly plan: RunPlan;
    readonly identities: ReadonlyArray<CaseId>;
    readonly runtime: ResolvedRuntime;
    readonly versions: { engine: string; node: string; packages: ReadonlyMap<string, string> };
    readonly startedAt: string; // ISO 8601
    readonly result?: RunResult;
};

type RunResult = {
    readonly summary: { discovered: number; passed: number; failed: number; skipped: number; inconclusive: number };
    readonly perTest: ReadonlyArray<{ id: CaseId; outcome: TestOutcome; verdict: string }>;
    readonly bySuite: Record<string, { discovered: number; executed: number }>;
    readonly runnerErrors: ReadonlyArray<RunnerError>;
    readonly artifacts: ReadonlyArray<ArtifactId>;
    readonly wallTimeMs: number;
};

type RunnerError = {
    readonly subtype:
        | 'fixture'
        | 'crash'
        | 'unhandled-rejection'
        | 'permission'
        | 'loader'
        | 'reporter'
        | 'attribution-drift';
    readonly attributedTo?: CaseId; // missing when run-level
    readonly message: string;
    readonly cause?: unknown;
};
```

Canonical: [Reproducibility](../architecture/reproducibility.md) for `RunPlan` and `RunRecord`,
[Failure Artifacts](../authoring/failure-artifacts.md) for `RunnerError`.

## Illustrative Capability-Handle Types

```ts
type AppRuntime = {
    readonly clock: Clock;
    readonly random: Random;
    readonly fs: FileSystem;
    readonly http: HttpClient;
    readonly log: Logger;
};

type Clock = {
    now(): Date;
    monotonic(): bigint;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

type Random = {
    uuid(): string;
    integer(min: number, max: number): number;
    bytes(length: number): Uint8Array;
    pick<T>(xs: ReadonlyArray<T>): T;
    split(): readonly [Random, Random];
};

type Logger = {
    debug(msg: string, fields?: Fields): void;
    info(msg: string, fields?: Fields): void;
    warn(msg: string, fields?: Fields): void;
    error(msg: string, fields?: Fields): void;
};

type Fields = Record<string, unknown>;

type FileSystem = unknown; // placeholder; out of concept scope
type HttpClient = unknown; // placeholder; out of concept scope

type RecordedEvent =
    | { kind: 'clock.now'; at: bigint }
    | { kind: 'random.uuid'; produced: string }
    | { kind: 'fs.write'; path: string; bytes: number; contentHash: string }
    | { kind: 'log.info'; msg: string; fields?: Fields }
    | { kind: 'http.request'; method: string; url: string; bodyHash?: string };

type RuntimeSnapshot = unknown; // adapter-specific replay payload
```

Source: [Capability Handles](../authoring/capability-handles.md). These are
illustrative architecture patterns, not canonical contracts owned by
`@overkill/engine`.

## Failure Artifacts

```ts
type DiffArtifact = {
    readonly kind: 'value' | 'string' | 'object' | 'array';
    readonly expected: SerializedValue;
    readonly actual: SerializedValue;
    readonly ops?: ReadonlyArray<DiffOperation>;
    readonly hunks?: ReadonlyArray<Hunk>;
};

type WorkerCrash = {
    readonly timestamp: string; // ISO 8601
    readonly signal: string; // 'SIGSEGV', 'SIGABRT', ...
    readonly workerId: string; // PID or pool index
    readonly activeCase?: CaseId;
    readonly nodeVersion?: string;
    readonly nativeAddons?: ReadonlyArray<string>;
};

// see runtime-behavior.md § Test Debug Mode
type TestDebugArtifact = {
    readonly case: CaseId;
    readonly outcome: TestOutcome['kind'];
    readonly wallTimeMs: number;
    readonly cpuTimeMs: number;
    readonly timeline: ReadonlyArray<TimelineEntry>;
    readonly handleEvents?: ReadonlyArray<RecordedEvent>;
    readonly moduleLoads: ReadonlyArray<{
        readonly specifier: string;
        readonly cachedHit: boolean;
        readonly resolveMs: number;
    }>;
    readonly heap: { beforeBytes: number; afterBytes: number; peakBytes: number };
    readonly activeHandlesDelta: number;
    readonly plan?: { declared: number; recorded: number };
    readonly stats: DebugStats;
};

// Discriminated union; mirrors RecordedEvent's pattern.
type TimelineEntry =
    | { readonly kind: 'body-start'; readonly at: bigint }
    | { readonly kind: 'assert'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation }
    | { readonly kind: 'require'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation }
    | { readonly kind: 'plan'; readonly at: bigint; readonly declared: number }
    | { readonly kind: 'body-end'; readonly at: bigint }
    | { readonly kind: 'rejection'; readonly at: bigint; readonly reason: unknown };

type DebugStats = {
    readonly assertCount: number;
    readonly requireCount: number;
    readonly handleCallCount: number;
    readonly moduleLoadCount: number;
    readonly uncachedModuleLoadCount: number;
    readonly unaccountedGapMs: number;
    readonly heapGrowthBytes: number;
    readonly handleLeakCount: number;
    readonly softTimeoutHeadroomMs: number;
};

// see failure-artifacts.md § Witnesses And Replay Artifacts
type WitnessFile = {
    readonly version: 1;
    readonly producedBy: { library: string; libraryVersion: string };
    readonly case: CaseId;
    readonly kind: 'property' | 'simulation';
    readonly seed: bigint;
    readonly shrinkPath?: ReadonlyArray<unknown>;
    readonly counterexample?: unknown;
    readonly adapter?: { name: string; payload: unknown };
    readonly scenario?: string;
    readonly runtimeSnapshot?: RuntimeSnapshot;
    readonly faultConfiguration?: unknown;
};
```

Canonical: [Failure Artifacts](../authoring/failure-artifacts.md).

## Simulation Adapters

```ts
type SimulationAdapter = {
    readonly name: string;
    readonly executionRequirements?: ReadonlyArray<ExecutionRequirement>;
    start(options: { seed?: bigint; scenario?: string; signal: AbortSignal }): Promise<SimulationSession>;
};

type SimulationSession = {
    readonly runtimeMetadata: {
        seed?: bigint;
        scenario?: string;
        endpoint?: URL;
    };
    witness?(): Promise<unknown>;
    stop(): Promise<void>;
};

type SimulationOptions = {
    readonly seed?: bigint;
    readonly scenario?: string;
};

type WithSimulation = (adapter: SimulationAdapter, options: SimulationOptions, body: TestBody) => TestBody;

type ExecutionRequirement =
    | { kind: 'serial' }
    | { kind: 'single-worker' }
    | { kind: 'exclusive-resource'; name: string }
    | { kind: 'startup-budget-ms'; min: number };
```

Canonical: [Deterministic Simulation Testing](../authoring/deterministic-simulation.md).

## Illustrative Placeholders Without Domain Definitions

These names appear in code samples to keep the example readable. They are
not part of the Overkill API surface; treat them as `unknown` unless the
sample explicitly defines them.

-   `User`, `UserInput`, `Saved` — appear in [Capability Handles](../authoring/capability-handles.md)'s
    illustrative `saveUser` example
-   `arbitrary.user`, `arbitrary.bytes`, `gen.user` — placeholder generator
    references in property-test snippets
-   `relation`, `differential`, `linearizability`, `browserBenchmark`,
    `slo()` — settled helper names for higher-layer families; owning
    documentation defines the package home and concept-level semantics, but
    this index does not own their full signatures
