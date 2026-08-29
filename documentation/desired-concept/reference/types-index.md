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
    readonly file: string | null; // canonical source file path, repository-relative; null when unknown to engine
    readonly suite: ReadonlyArray<string>; // ordered visible suite names, top-level suite to leaf
    readonly name: string; // test name within its parent
};

type CaseId = TestId & {
    readonly params: string | null; // canonical case key for parameterized tests
};

type RuntimeId = {
    readonly name: string; // 'chromium', 'node', 'deterministic-api', ...
    readonly dimensions?: Record<string, string>;
};

type WorkloadId = {
    readonly name: string;
    readonly params?: Record<string, string>;
};

type AttemptId = { readonly index: number; }; // 0-indexed

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
declare const testNodeBrand: unique symbol;

type TestNode = (TestCase | Suite | Table) & {
    readonly [testNodeBrand]: true;
};

type TestRoot = {
    readonly kind: 'root';
    readonly name: string;
    readonly metadata?: Metadata;
    readonly children: ReadonlyArray<TestNode>;
};

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
    readonly cases: ReadonlyArray<{ params: Record<string, unknown>; body: TestBody; }>;
};

type Metadata = {
    readonly tags?: readonly string[];
    readonly kind?: TestFamily;
    readonly runtimes?: readonly string[] | {
        readonly mode: 'append' | 'replace';
        readonly values: readonly string[];
    };
    readonly capabilities?: ReadonlyArray<Capability>;
    readonly baselines?: ReadonlyArray<BaselineSubtype>;
    readonly ownership?: ReadonlyArray<string>;
    readonly stability?: 'stable' | 'flaky' | 'experimental';
    readonly priority?: 'critical' | 'standard' | 'optional';
    readonly debug?: boolean;
    readonly capture?: 'buffered' | 'live';
    readonly timeoutMilliseconds?: number;
    readonly extra?: Readonly<Record<string, unknown>>;
};

type ResolvedMetadata = {
    readonly tags: readonly string[];
    readonly kind: TestFamily | null;
    readonly runtimes: readonly string[];
    readonly capabilities: readonly Capability[];
    readonly baselines: readonly BaselineSubtype[];
    readonly ownership: readonly string[];
    readonly stability: 'stable' | 'flaky' | 'experimental';
    readonly priority: 'critical' | 'standard' | 'optional';
    readonly debug: boolean;
    readonly capture: 'buffered' | 'live' | null;
    readonly timeoutMilliseconds: number | null;
    readonly extra: Readonly<Record<string, unknown>>;
};

type TestFamily = 'microtest' | 'integration' | 'property' | 'benchmark' | 'type-test';

type ProfileName = string;

type BaselineSubtype = 'content-snapshot' | 'visual-snapshot' | 'terminal-snapshot' | 'performance-baseline';

// Closed enumeration; see microtests-and-capabilities.md §
// Capability Defaults for the canonical definition. New capabilities
// require an explicit addition.
type Capability = 'fs-read' | 'fs-write' | 'net' | 'child-process' | 'worker' | 'addon' | 'wasi' | 'process-exit';
```

Canonical: [Tests As Values](../authoring/tests-as-values.md) for `TestNode`/`TestCase`/`Suite`/`Table`,
[Metadata And Selection](../architecture/metadata-and-selection.md) for `Metadata`, [Glossary](./glossary.md) for the
enumerations.

`TestNode` is engine-branded. Shape-compatible plain objects are not valid
run inputs unless they were created by engine-owned constructors.

## Outcomes And Verdicts

```ts
type NonEmptyReadonlyArray<Item> = readonly [Item, ...(readonly Item[])];

type TestOutcome = Pass | Fail | Skip | Inconclusive;

type TestVerdict = TestOutcome['kind'] | 'crashed' | 'resource-exhausted';

type Pass = { kind: 'pass'; };

type Fail = {
    kind: 'fail';
    failures: NonEmptyReadonlyArray<TestFailure>;
};

type Skip = { kind: 'skip'; reason: string; };

type Inconclusive = { kind: 'inconclusive'; reason: string; };

type TestFailure =
    | {
        readonly kind: 'assertion';
        readonly checks: NonEmptyReadonlyArray<FailedCheck>;
    }
    | {
        readonly kind: 'body-error';
        readonly error: {
            readonly message: string;
            readonly name: string;
            readonly stack: string | null;
            readonly thrown: unknown;
        };
    }
    | {
        readonly actual: unknown;
        readonly code:
            | 'invalid-assertion-reference'
            | 'invalid-composite-result'
            | 'invalid-plan'
            | 'invalid-require-reference'
            | 'no-assertions'
            | 'pending-async-assertion'
            | 'plan-mismatch';
        readonly expected: string;
        readonly kind: 'test-contract';
        readonly summary: string;
    };

type FailedCheckBase = {
    readonly actual: SerializedValue;
    readonly diff: Diff | null;
    readonly expected: SerializedValue;
    readonly id: string;
    readonly location: SourceLocation;
    readonly path: ReadonlyArray<DiffPathSegment>;
    readonly source: 'assert' | 'require';
    readonly summary: string;
};

type FailedCheck =
    | (FailedCheckBase & {
        readonly kind: 'leaf';
    })
    | (FailedCheckBase & {
        readonly children: NonEmptyReadonlyArray<FailedCheck>;
        readonly kind: 'composite';
    })
    | (FailedCheckBase & {
        readonly error: {
            readonly message: string;
            readonly name: string;
            readonly stack: string | null;
            readonly thrown: unknown;
        };
        readonly kind: 'foreign';
        readonly label: string;
    });

type Diff =
    | { kind: 'value'; expected: SerializedValue; actual: SerializedValue; }
    | { kind: 'string'; expected: string; actual: string; hunks: ReadonlyArray<Hunk>; }
    | { kind: 'object'; operations: ReadonlyArray<ObjectDiffOperation>; }
    | { kind: 'array'; operations: ReadonlyArray<ArrayDiffOperation>; }
    | { kind: 'map'; operations: ReadonlyArray<MapDiffOperation>; }
    | { kind: 'set'; operations: ReadonlyArray<SetDiffOperation>; }
    | {
        kind: 'binary';
        expectedSize: number;
        actualSize: number;
        expectedHash: string;
        actualHash: string;
        ranges: ReadonlyArray<ByteDiffRange>;
    };

type DiffPathSegment =
    | { kind: 'property'; key: SerializedPropertyKey; }
    | { kind: 'index'; index: number; }
    | { kind: 'map-key'; key: SerializedValue; }
    | { kind: 'map-value'; key: SerializedValue; }
    | { kind: 'set-value'; value: SerializedValue; }
    | { kind: 'byte'; offset: number; };

type SerializedPropertyKey =
    | { kind: 'string'; value: string; }
    | { kind: 'symbol'; value: string; };

type DiffOperation =
    | { operation: 'add'; path: ReadonlyArray<DiffPathSegment>; value: SerializedValue; }
    | { operation: 'remove'; path: ReadonlyArray<DiffPathSegment>; value: SerializedValue; }
    | { operation: 'replace'; path: ReadonlyArray<DiffPathSegment>; from: SerializedValue; to: SerializedValue; };

type ObjectDiffOperation =
    | DiffOperation
    | { operation: 'missing-property'; path: ReadonlyArray<DiffPathSegment>; value: SerializedValue; };

type ArrayDiffOperation =
    | DiffOperation
    | { operation: 'missing-index'; index: number; value: SerializedValue; }
    | { operation: 'missing-member'; value: SerializedValue; };

type MapDiffOperation =
    | DiffOperation
    | { operation: 'missing-entry'; key: SerializedValue; value: SerializedValue; };

type SetDiffOperation =
    | Exclude<DiffOperation, { operation: 'replace'; }>
    | { operation: 'missing-member'; value: SerializedValue; };

type Hunk = {
    readonly expectedStart: number;
    readonly actualStart: number;
    readonly removed: ReadonlyArray<string>;
    readonly added: ReadonlyArray<string>;
};

type ByteDiffRange = {
    readonly offset: number;
    readonly expected: ReadonlyArray<number>;
    readonly actual: ReadonlyArray<number>;
};

type SerializedValue = unknown; // bounded JSON-compatible value with explicit truncation metadata when capped

type SourceLocation = {
    readonly file: string;
    readonly line: number | null;
    readonly column: number | null;
};

type SourceLocationProvider = () => SourceLocation;
type ResolvableSourceLocation = SourceLocation | SourceLocationProvider;
```

Canonical: [Assertions And Results § The Protocol Shape](../authoring/assertions-and-results.md#the-protocol-shape) for `TestOutcome`,
[Assertions And Results](../authoring/assertions-and-results.md) for `TestFailure`/`FailedCheck`/`Diff`/`DiffOperation`/`Hunk`. The
`TestVerdict` reporter category is derived from outcome + metadata; see
[Glossary § Test Verdict](./glossary.md#test-verdict).

## Assertion Extensions And Error Matching

```ts
type OptionalFields<Shape, RequiredKey extends keyof Shape> = {
    readonly [ShapeKey in keyof Shape as ShapeKey extends RequiredKey ? never : ShapeKey]?: Shape[ShapeKey];
};

type RequiredField<Shape, RequiredKey extends keyof Shape> = {
    readonly [ShapeKey in RequiredKey]-?: Shape[ShapeKey];
};

type RequireAtLeastOne<Shape, Key extends keyof Shape = keyof Shape> = {
    readonly [RequiredKey in Key]: OptionalFields<Shape, RequiredKey> & RequiredField<Shape, RequiredKey>;
}[Key];

type ExactThrownMatcher = {
    readonly cause?: never;
    readonly code?: never;
    readonly exact: unknown;
    readonly message?: never;
    readonly name?: never;
    readonly type?: never;
};

type ErrorMatcher =
    RequireAtLeastOne<{
        readonly type: abstract new (...args: never[]) => Error;
        readonly message: string | RegExp;
        readonly code: string;
        readonly name: string;
        readonly cause: ThrownMatcher;
    }> & {
        readonly exact?: never;
    };

type ThrownMatcher = ExactThrownMatcher | ErrorMatcher;

type Assert = {
    throws<Body extends () => unknown>(
        body: ReturnType<Body> extends PromiseLike<unknown> ? never : Body,
        matcher: ThrownMatcher,
        options?: AssertionOptions
    ): void;

    rejects(
        thunk: () => PromiseLike<unknown>,
        matcher: ThrownMatcher,
        options?: AssertionOptions
    ): Promise<void>;
};

type AssertionExtension = {
    readonly name: string;
};

type ForeignAssertionBridge = {
    fromThrowable(label: string, body: () => void): unknown;
    fromRejectable(label: string, body: () => Promise<void>): Promise<unknown>;
};

type AssertionOptions = {
    readonly message: string;
};

type AssertionSource = 'assert' | 'require';

type EqualAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'equal';
    readonly expected: unknown;
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: Source;
};

type TrueAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'true';
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: Source;
};

type AssertAssertionNode = EqualAssertionNode<'assert'> | TrueAssertionNode<'assert'>;
type RequireAssertionNode = {
    readonly actual: unknown;
    readonly check: 'defined' | 'string';
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: 'require';
};
type AssertionNode = AssertAssertionNode | RequireAssertionNode;
type AssertionResult = AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>;

type PrimitiveValueByType = {
    readonly bigint: bigint;
    readonly boolean: boolean;
    readonly null: null;
    readonly number: number;
    readonly string: string;
    readonly symbol: symbol;
    readonly undefined: undefined;
};
type PrimitiveValue = PrimitiveValueByType[keyof PrimitiveValueByType];
type IsAny<Value> = 0 extends Value & 1 ? true : false;
type DeepComparableKnownValue<Value> = [Extract<Value, PrimitiveValue>] extends [never] ? Value : never;
type DeepComparableUnknownValue<Value> = unknown extends Value ? unknown : DeepComparableKnownValue<Value>;
type DeepComparable<Value = unknown> = IsAny<Value> extends true ? never : DeepComparableUnknownValue<Value>;

type CompositeAssertionReference<Arguments extends readonly unknown[]> = unknown;
type NarrowingCompositeAssertionReference<Actual, Narrowed extends Actual, Arguments extends readonly unknown[]> = unknown;

type AssertAssertionFacade = {
    <Reference extends CompositeAssertionReference<readonly unknown[]>>(
        reference: Reference,
        ...arguments_: readonly unknown[]
    ): void | Promise<void>;
    readonly annotated: (message: string) => AssertAssertionFacade;
    readonly arrayContainsPartial: <Actual, Expected>(
        actual: readonly DeepComparable<Actual>[],
        expectedSubset: DeepComparable<Expected>
    ) => void;
    readonly deepEqual: <Actual, Expected>(
        actual: DeepComparable<Actual>,
        expected: DeepComparable<Expected>
    ) => void;
    readonly equal: (actual: unknown, expected: unknown) => void;
    readonly membersPartialDeepEqual: <Actual, Expected>(
        actual: readonly DeepComparable<Actual>[],
        expectedMembers: readonly DeepComparable<Expected>[]
    ) => void;
    readonly notDeepEqual: <Actual, Expected>(
        actual: DeepComparable<Actual>,
        expected: DeepComparable<Expected>
    ) => void;
    readonly partialDeepEqual: <Actual, Expected>(
        actual: DeepComparable<Actual>,
        expectedSubset: DeepComparable<Expected>
    ) => void;
    readonly true: (actual: unknown) => void;
};

type RequireAssertionFacade = {
    <Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...arguments_: Arguments
    ): asserts actual is Narrowed;
    readonly defined: <Value>(actual: Value) => asserts actual is NonNullable<Value>;
    readonly string: (actual: unknown) => asserts actual is string;
};

type TestScopeAssertContext = AssertAssertionFacade & {
    readonly collect: () => NonEmptyReadonlyArray<AssertAssertionNode>;
};

type BuilderTestBody = (case: unknown) => AssertionResult | Promise<AssertionResult>;
type ThrowingTestBody = (case: unknown) => void | Promise<void>;
type TestBody = BuilderTestBody | ThrowingTestBody;

type RunIfMainOptions = {
    readonly outputRenderer?: OutputRenderer;
    readonly reporters?: ReadonlyArray<Reporter>;
    readonly runFacts?: RunFacts;
};

type TestFacade = {
    readonly root: (name: string, children: ReadonlyArray<TestNode>) => TestRoot;
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
    readonly runIfMain: (meta: ImportMeta, testNode: TestNode, options?: RunIfMainOptions) => Promise<void>;
};
```

Canonical: [Assertions And Results](../authoring/assertions-and-results.md).

## Reporters

```ts
type Reporter = RealTimeReporter | FinalResultReporter;

type RealTimeReporter = {
    readonly dispose: (() => void | Promise<void>) | null;
    readonly kind: 'real-time';
    readonly name: string;
    readonly sinks: ReadonlyArray<SinkDeclaration>;
    onEvent(event: ReporterEvent): void | Promise<void>;
    onFinish: ((result: RunResult) => void | Promise<void>) | null;
};

type FinalResultReporter = {
    readonly dispose: (() => void | Promise<void>) | null;
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: ReadonlyArray<SinkDeclaration>;
    onResult(result: RunResult): void | Promise<void>;
};

type SinkDeclaration =
    | { readonly kind: 'stdout-raw'; }
    | { readonly kind: 'stderr-raw'; }
    | { readonly kind: 'stdout-managed-primary'; }
    | { readonly kind: 'stderr-managed-primary'; }
    | { readonly kind: 'stdout-managed-supplemental'; }
    | { readonly kind: 'stderr-managed-supplemental'; }
    | { readonly kind: 'file'; readonly path: string; }
    | { readonly kind: 'directory'; readonly path: string; }
    | { readonly kind: 'memory'; }
    | { readonly kind: 'stream'; readonly provided: WritableStream; };

type ReporterOutput = ReadonlyArray<OutputLineIntent>;

type OutputLineIntent = {
    readonly annotation: OutputIntentAnnotation | null;
    readonly kind: 'stdout-line' | 'stderr-line';
    readonly role: 'primary' | 'supplemental';
    readonly text: string;
};

type OutputIntentAnnotation = {
    readonly location: SourceLocation | null;
    readonly severity: 'error' | 'notice' | 'warning';
    readonly title: string | null;
};

type OutputRenderer = {
    render(intent: OutputLineIntent): string;
};
```

Reporter method return types are conditional in the public TypeScript
contract. A reporter whose literal `sinks` tuple contains a managed stdout or
stderr sink may return `ReporterOutput` or `void`. Reporters without managed
stream sinks are side-effect-only and return only `void` or `Promise<void>`.

Canonical: [Reporters](../architecture/reporters.md).

## Run Request, Resolution, And Record

Direct engine consumers can create `TestCase` values with `createTestCase`,
attach them to a `TestRoot` with `createRoot`, build the executable
`TestPlan` with `createTestPlan(root)`, then pass it to
`execute(testPlan): Promise<RunResult>`. `TestRoot` carries run-level name
and metadata. It is not a `TestNode` and does not contribute to
`CaseId.suite`, `suitePath`, or `RunResult.bySuite`.

```ts
type RunConfig = {
    readonly outputRenderer: OutputRenderer;
    readonly reporters: ReadonlyArray<Reporter>;
    readonly loader: { readonly stripMode: 'strip-only'; readonly sourceMaps: boolean; };
    readonly profiles: Readonly<Record<ProfileName, RunProfileConfig>>;
    readonly benchmark?: {
        readonly profiles: Readonly<Record<ProfileName, BenchmarkProfileConfig>>;
    };
    readonly runtimeStateDir: string;
};

type RunProfileConfig =
    | MicrotestProfileConfig
    | IntegrationProfileConfig
    | PropertyProfileConfig
    | TypeTestProfileConfig;

type MicrotestProfileConfig = {
    readonly testFamily: 'microtest';
    readonly files: ProfileFiles | null;
    readonly reporters?: ReadonlyArray<Reporter>;
    readonly execution?: MicrotestExecutionConfig;
    readonly resourceUsage?: ResourceUsagePolicy;
    readonly timeouts?: TimeoutPolicy;
    readonly coverage?: MicrotestCoveragePolicy;
};

type IntegrationProfileConfig = {
    readonly testFamily: 'integration';
    readonly files: ProfileFiles;
    readonly reporters?: ReadonlyArray<Reporter>;
    readonly execution?: IntegrationExecutionConfig;
    readonly resourceUsage?: ResourceUsagePolicy;
    readonly timeouts?: TimeoutPolicy;
};

type PropertyProfileConfig = {
    readonly testFamily: 'property';
    readonly files: ProfileFiles;
    readonly reporters?: ReadonlyArray<Reporter>;
    readonly execution?: MicrotestExecutionConfig;
    readonly resourceUsage?: ResourceUsagePolicy;
    readonly timeouts?: TimeoutPolicy;
    readonly coverage?: never;
};

type TypeTestProfileConfig = {
    readonly testFamily: 'type-test';
    readonly files: ProfileFiles;
    readonly reporters?: ReadonlyArray<Reporter>;
};

type BenchmarkProfileConfig = {
    readonly files: ProfileFiles;
};

type ProfileFiles = {
    readonly include: NonEmptyReadonlyArray<string>;
    readonly exclude: ReadonlyArray<string>;
};

type MicrotestExecutionConfig = {
    readonly processModel: 'in-process' | 'supervised-process';
    readonly scheduling: 'serial' | 'concurrent';
};

type IntegrationExecutionConfig = {
    readonly processModel: 'process-per-file' | 'worker-pool' | 'supervised-process';
    readonly scheduling: 'serial' | 'concurrent';
};

type ResourceUsagePolicy = {
    readonly measure: boolean;
    readonly budgets: ResourceBudgets;
    readonly samplingIntervalMilliseconds: number;
};

type TimeoutPolicy = {
    readonly softMilliseconds: number;
    readonly hardMilliseconds: number;
};

type MicrotestCoveragePolicy = {
    readonly formats: ReadonlyArray<'text' | 'lcov' | 'json' | 'html' | 'v8'>;
    readonly include: ReadonlyArray<string>;
    readonly exclude: ReadonlyArray<string>;
    readonly thresholds?: CoverageThresholds;
    readonly outputDir?: string;
};

type CoverageThresholds = {
    readonly branches?: number;
    readonly functions?: number;
    readonly lines?: number;
};

type LoadRunConfigRequest = {
    readonly cwd: string;
    readonly configPath: string | null;
};

declare function defineConfig(config: RunConfig): RunConfig;
declare function loadRunConfig(request: LoadRunConfigRequest): Promise<RunConfig>;

type RunRequest = {
    readonly paths: ReadonlyArray<string>;
    readonly selection:
        | { readonly kind: 'all'; }
        | { readonly expression: string; readonly kind: 'filter'; }
        | { readonly id: CaseId; readonly kind: 'case-id'; }
        | { readonly kind: 'file'; readonly path: string; }
        | { readonly kind: 'last-failed'; }
        | { readonly kind: 'name'; readonly pattern: string; };
    readonly shard: { readonly index: number; readonly total: number; };
    readonly profile: ProfileName;
    readonly execution: { readonly mode: 'profile-default'; };
    readonly baselineUpdateMode: 'none' | 'update' | 'apply' | 'bootstrap' | 'diff';
    readonly capture: 'buffered' | 'live';
    readonly measureResourceUsage: boolean | null;
    readonly resourceBudgetOverrides: ResourceBudgetOverrides | null;
    readonly resourceUsageSamplingIntervalMilliseconds: number | null;
    readonly seed: { readonly value: bigint | null; };
    readonly order: 'plan' | 'seeded' | 'lexical';
    readonly verbose: boolean;
    readonly debug: {
        readonly mode: 'off' | 'all' | 'selected';
        readonly selectors: ReadonlyArray<string>;
    };
};

type RunEngineSelection =
    | { readonly kind: 'default'; }
    | { readonly kind: 'instance'; readonly engine: Engine; }
    | {
        readonly kind: 'module';
        readonly moduleUrl: string;
        readonly exportName: string;
        readonly exportKind: 'value' | 'getter';
    };

type RunCommand = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly request: RunRequest;
};

declare function resolveRun(command: RunCommand): Promise<ResolvedRun>;
declare function run(command: RunCommand): Promise<RunResult>;

type TestPlanCase = {
    readonly id: CaseId;
    readonly suitePath: ReadonlyArray<string>;
    readonly metadata: ResolvedMetadata;
    readonly body: TestBody;
};

type TestPlan = {
    readonly defined: number;
    readonly discoveredCases: NonEmptyReadonlyArray<TestPlanCase>;
    readonly cases: NonEmptyReadonlyArray<TestPlanCase>;
    readonly orphans: ReadonlyArray<{ file: string | null; name: string; kind: 'test' | 'suite' | 'table'; }>;
    readonly root: { readonly name: string; readonly metadata: ResolvedMetadata; };
};

type RunFacts = {
    readonly cases: ReadonlyArray<RunCaseFacts>;
    readonly environment: {
        readonly node: { readonly arch: string; readonly platform: string; readonly version: string; };
        readonly runtimeStateDir: string;
    };
    readonly execution: {
        readonly baselineUpdateMode: 'none' | 'update' | 'apply' | 'bootstrap' | 'diff';
        readonly capture: 'buffered' | 'live';
        readonly debug: { readonly mode: 'off' | 'all' | 'selected'; readonly selectors: ReadonlyArray<string>; };
        readonly order: 'plan' | 'seeded' | 'lexical';
        readonly processModel: string;
        readonly profile: ProfileName;
        readonly resourceUsagePolicy: ResourceUsagePolicy;
        readonly scheduling: 'serial' | 'concurrent';
        readonly testFamily: TestFamily;
        readonly timeoutPolicy: TimeoutPolicy;
        readonly verbose: boolean;
    };
    readonly loader: { readonly stripMode: 'strip-only'; readonly sourceMaps: boolean; };
    readonly reproducibility: {
        readonly seed: string;
        readonly shard: { readonly index: number; readonly total: number; };
    };
};

type RunCaseFacts = {
    readonly id: CaseId;
    readonly metadata: SerializedValue;
};

type CollectedRunCase = {
    readonly metadata: SerializedValue;
    readonly name: string;
    readonly params: string | null;
    readonly suite: ReadonlyArray<string>;
};

type CollectedRunFile = {
    readonly file: string;
    readonly cases: ReadonlyArray<CollectedRunCase>;
};

type CollectedRunPlan = {
    readonly root: { readonly name: string; readonly metadata: ResolvedMetadata; };
    readonly defined: number;
    readonly files: ReadonlyArray<CollectedRunFile>;
    readonly orphans: ReadonlyArray<OrphanedNode>;
};

type ResolvedRunPlan =
    | { readonly kind: 'local'; readonly testPlan: TestPlan; }
    | { readonly kind: 'supervised'; readonly collectedPlan: CollectedRunPlan; };

type ResolvedRun = {
    readonly request: RunRequest;
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly facts: RunFacts;
    readonly plan: ResolvedRunPlan;
    readonly collectionRunnerErrors: ReadonlyArray<RunnerError>;
    readonly reporters: ReadonlyArray<Reporter>;
};

type ResolvedRuntime = {
    readonly id: RuntimeId;
    readonly nodeVersion?: string;
    readonly os?: string;
    readonly machineClass?: string;
    readonly adapters: ReadonlyArray<{ name: string; version: string; }>;
};

type RunRecord = {
    readonly id: string; // ULID
    readonly seed: bigint;
    readonly facts: RunFacts;
    readonly identities: ReadonlyArray<CaseId>;
    readonly runtime: ResolvedRuntime;
    readonly versions: { engine: string; node: string; packages: ReadonlyMap<string, string>; };
    readonly startedAt: string; // ISO 8601
    readonly result?: RunResult;
};

type RunResult = {
    readonly summary: {
        discovered: number;
        planned: number;
        defined: number; // TestNodes constructed during collection; orphaned = orphans.length
        passed: number;
        failed: number;
        skipped: number;
        inconclusive: number;
        resourceExhausted: number;
    };
    readonly perTest: ReadonlyArray<{ id: CaseId; outcome: TestOutcome | null; verdict: TestVerdict; }>;
    readonly bySuite: Record<string, { discovered: number; planned: number; executed: number; }>;
    readonly orphans: ReadonlyArray<{ file: string | null; name: string; kind: 'test' | 'suite' | 'table'; }>;
    readonly runnerErrors: ReadonlyArray<RunnerError>;
    readonly artifacts: ReadonlyArray<ArtifactId>;
    readonly resourceUsage: RunResourceUsage | null;
    readonly wallTimeMs: number;
};

type RunnerError = {
    readonly subtype:
        | 'fixture'
        | 'crash'
        | 'unhandled-rejection'
        | 'permission'
        | 'runtime-policy'
        | 'loader'
        | 'reporter'
        | 'attribution-drift'
        | 'resource-exhaustion';
    readonly attributedTo: CaseId | null; // null when run-level
    readonly message: string;
    readonly cause?: unknown;
};

type RuntimePolicyViolation = {
    readonly attribution:
        | { readonly kind: 'direct'; readonly case: CaseId; }
        | { readonly kind: 'active-case'; readonly case: CaseId; }
        | { readonly kind: 'unknown'; };
    readonly operation: string;
    readonly policy:
        | 'console-output-denied'
        | 'fs-write-denied'
        | 'net-denied'
        | 'process-exit-denied'
        | 'worker-denied'
        | 'child-process-denied';
    readonly source: SourceLocation | null;
};
```

```ts
type ResourceBudgets = {
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
    readonly activeResourceCount: number | null;
};

type ResourceBudgetOverrides = ResourceBudgets;

type ResourceUsageSnapshot = {
    readonly capturedAtMilliseconds: number;
    readonly javaScriptEngineHeapBytes: number;
    readonly residentSetBytes: number;
    readonly activeResourceCount: number;
    readonly activeResourceTypes: ReadonlyArray<string>;
};

type RunResourceUsage = {
    readonly start: ResourceUsageSnapshot;
    readonly end: ResourceUsageSnapshot;
    readonly peakJavaScriptEngineHeapBytes: number;
    readonly peakResidentSetBytes: number;
    readonly peakResidentSetGrowthBytesPerSecond: number;
    readonly peakActiveResourceCount: number;
    readonly activeResourceTypes: ReadonlyArray<string>;
    readonly sampleCount: number;
};
```

Canonical: [Reproducibility](../architecture/reproducibility.md) for `RunFacts` and `RunRecord`,
[Package Architecture](../architecture/package-architecture.md) for `RunRequest`, `ResolvedRun`, and `TestPlan`,
[Failure Artifacts](../authoring/failure-artifacts.md) for `RunnerError`.

`RunConfig.reporters` is the global fallback list. A selected profile's
`reporters` list replaces it for that run when present. `ResolvedRun.reporters`
contains the effective list after that resolution.

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
    | { kind: 'clock.now'; at: bigint; }
    | { kind: 'random.uuid'; produced: string; }
    | { kind: 'fs.write'; path: string; bytes: number; contentHash: string; }
    | { kind: 'log.info'; msg: string; fields?: Fields; }
    | { kind: 'http.request'; method: string; url: string; bodyHash?: string; };

type RuntimeSnapshot = unknown; // adapter-specific replay payload
```

Source: [Capability Handles](../authoring/capability-handles.md). These are
illustrative architecture patterns, not canonical contracts owned by
`@overkill-dev/engine`.

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

type ResourceExhaustion = {
    readonly timestamp: string; // ISO 8601
    readonly metric:
        | 'javaScriptEngineHeapBytes'
        | 'residentSetBytes'
        | 'residentSetGrowthBytesPerSecond'
        | 'activeResourceCount'
        | 'libuvHandleCount';
    readonly budget: number;
    readonly observed: number;
    readonly enforcement: 'v8-heap-limit' | 'sampled' | 'post-test-diagnostic';
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly workerId: string;
    readonly activeCase: CaseId;
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
    readonly heap: { beforeBytes: number; afterBytes: number; peakBytes: number; };
    readonly activeHandlesDelta: number;
    readonly plan?: { declared: number; recorded: number; };
    readonly stats: DebugStats;
};

// Discriminated union; mirrors RecordedEvent's pattern.
type TimelineEntry =
    | { readonly kind: 'body-start'; readonly at: bigint; }
    | { readonly kind: 'assert'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation; }
    | { readonly kind: 'require'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation; }
    | { readonly kind: 'plan'; readonly at: bigint; readonly declared: number; }
    | { readonly kind: 'body-end'; readonly at: bigint; }
    | { readonly kind: 'rejection'; readonly at: bigint; readonly reason: unknown; };

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
    readonly producedBy: { library: string; libraryVersion: string; };
    readonly case: CaseId;
    readonly kind: 'property' | 'simulation';
    readonly seed: bigint;
    readonly shrinkPath?: ReadonlyArray<unknown>;
    readonly counterexample?: unknown;
    readonly adapter?: { name: string; payload: unknown; };
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
    start(options: { seed?: bigint; scenario?: string; signal: AbortSignal; }): Promise<SimulationSession>;
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
    | { kind: 'serial'; }
    | { kind: 'single-worker'; }
    | { kind: 'exclusive-resource'; name: string; }
    | { kind: 'startup-budget-ms'; min: number; };
```

Canonical: [Deterministic Simulation Testing](../authoring/deterministic-simulation.md).

## Illustrative Placeholders Without Domain Definitions

These names appear in code samples to keep the example readable. They are
not part of the Overkill API surface; treat them as `unknown` unless the
sample explicitly defines them.

- `User`, `UserInput`, `Saved`: appear in [Capability Handles](../authoring/capability-handles.md)'s
  illustrative `saveUser` example
- `arbitrary.user`, `arbitrary.bytes`, `gen.user`: placeholder generator
  references in property-test snippets
- `relation`, `differential`, `linearizability`, `browserBenchmark`,
  `slo()`: settled helper names for higher-layer families; owning
  documentation defines the package home and concept-level semantics, but
  this index does not own their full signatures
