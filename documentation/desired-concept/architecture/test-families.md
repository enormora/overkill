# Executable Test Families

## Public Contract

This document defines the desired public API. It is not a description of the
current exports. Implement the contract in the engine, then adapt runner
profiles and optional packages to it. Compiler implementation choices remain
inside the type-test package.

A family supplies settings validation, preparation, and an execution mode.
The engine owns plans, identities, result normalization, and reporter delivery.
The runner owns discovery, selection policy, placement, supervision, and records.
A family cannot replace those orchestration services.

## Selecting A Family

```ts
import { defineConfig } from '@overkill-dev/test/config';
import { family as typeTests } from '@overkill-dev/type-test';

export const config = defineConfig({
    profiles: {
        types: {
            testFamily: typeTests,
            files: { include: [ 'source/**/*.types.ts' ] },
            settings: {
                projectConfigPath: './tsconfig.json',
                compiler: { kind: 'local' }
            }
        }
    }
});
```

The `testFamily` property supplies the executable definition. Its type determines
`settings`; settings do not participate in inferring or widening the family type.
`defineConfig` preserves this relationship per profile, including heterogeneous
families and built-in aliases in one config. Untyped configurations undergo the
same runtime validation. Family-specific keys stay inside `settings`; common
runner policy stays at profile level.

The standard distribution resolves `'microtest'`, `'integration'`, `'property'`,
and `'benchmark'` as aliases for definitions it supplies. Optional families
require an imported definition. In particular, a bare `'type-test'` is rejected.
Imports do not register global state or augment configuration types.

## Authoring A Family

The following types and `defineTestFamily` are public engine exports. Existing
engine types named below keep their established meanings. `FamilyValue` is
lossless readonly JSON; validation rejects non-finite numbers, cycles, functions,
class instances, and compiler objects rather than coercing them.

```ts
type TestFamilyId = string;
type FamilyValue = null | boolean | number | string | readonly FamilyValue[] | { readonly [key: string]: FamilyValue; };

type FamilyModuleReference = {
    readonly moduleUrl: string;
    readonly exportName: string;
};

type FamilyFeatures = {
    readonly execution: 'runtime' | 'analysis';
    readonly processModels: NonEmptyReadonlyArray<'in-process' | 'supervised-process' | 'worker-pool'>;
    readonly profileOptions: readonly ('coverage' | 'capture' | 'resources' | 'retries')[];
};

type TestFamilyDefinition<Settings extends FamilyValue> = {
    readonly id: TestFamilyId;
    readonly version: string;
    readonly module: FamilyModuleReference | null;
    readonly features: FamilyFeatures;
    readonly parseSettings: (input: unknown) => Settings;
    readonly load: () => Promise<FamilyBackend<Settings>>;
};

type DefinedTestFamily = {
    readonly id: TestFamilyId;
    readonly version: string;
    readonly module: FamilyModuleReference | null;
    readonly features: FamilyFeatures;
};

type TestFamily<Settings extends FamilyValue> = DefinedTestFamily & TestFamilyDefinition<Settings>;

declare function defineTestFamily<Settings extends FamilyValue>(
    definition: TestFamilyDefinition<Settings>
): TestFamily<Settings>;
```

`defineTestFamily` validates and brands the definition; shape-compatible objects
are not accepted as definitions. The visible shape above omits that engine-owned
brand. Identifiers are nonempty. Additional families use package-qualified IDs,
such as `@overkill-dev/type-test`; built-in IDs retain their existing spelling.
`version` identifies the implementation, not a compiler variant. Conflicting
implementations with the same ID in one resolved config fail validation. No
execution or module loading is inferred from the ID.

The module reference is explicit transport metadata, not an instruction to
import during definition. `null` permits local programmatic definitions. A
reference names an absolute module URL and a named export containing the same
family. Relative configuration and settings paths resolve against the explicit
project root, not the definition package's directory.

`parseSettings` runs before `load`, rejects invalid input, and returns normalized
serializable settings. It must not load compiler projects or run test code.
`defineTestFamily` wraps the parser to validate, copy, and deeply freeze its
normalized output before returning it. `load` lazily obtains the backend;
importing assertion markers or inspecting definition metadata does not load it.

Features declare compatibility, not permissions. Supplied profile policy and
authored controls are validated before backend preparation. Execute-time options
and overrides are validated before `run-start` and executor admission. Runtime
families retain the existing engine body modes and their constraints. Analysis families do not execute bodies
and cannot enable coverage, capture, resources, or body retries. Process support
is checked independently: a synchronous in-process checker cannot promise an
enforceable hard deadline merely by declaring supervised support.

## Configuration Type Contract

`FamilySettingsOf<Family>` and `ProjectFamilyProfileConfig<Family>` are runner
exports. `DefinedTestFamily` is the branded non-generic metadata view of a family;
it contains no callable backend accepting erased settings.

```ts
type FamilySettingsOf<Family> = Family extends TestFamily<infer Settings> ? Settings : never;

type FamilyProfileBinding<Family extends DefinedTestFamily> = {
    readonly testFamily: Family;
    readonly settings: NoInfer<FamilySettingsOf<Family>>;
};

type ProjectFamilyProfileConfig<Family extends DefinedTestFamily> =
    & FamilyProfileBinding<Family>
    & CommonFamilyProfileConfig;
```

`CommonFamilyProfileConfig` owns the established profile fields `files`,
`reporters`, `execution`, `processUsage`, `timeouts`, `timings`, and `runRecords`,
with their existing defaults. Families declare which policies they support;
unknown top-level keys are rejected. Policy extensions such as coverage are
validated only for families declaring that existing policy domain. Family
settings cannot weaken common policy.

The `defineConfig` overload infers each definition from its profile's
`testFamily` field before validating the corresponding settings. It must not
infer a union of unrelated settings from the entire config or erase settings to
`unknown`. Built-in profiles retain their existing discriminated input types.

Acceptance examples are a config mixing type tests, a differently typed custom
family, and a built-in profile; rejection examples are swapped settings, missing
required fields, invalid compiler selections, and a string-only optional family.
`prepareFamily` applies the same `NoInfer` constraint for direct callers.

### Plan Construction With Collection Policy

The existing `engine.createTestPlan(root)` and
`engine.createTestPlanFromTestFiles(options)` signatures remain available. Each
also accepts a second `TestPlanCollectionPolicy` argument containing
`runtimeMatrices`, `benchmarkCalibration`, and `property`. `property` is either `null` or an object with
`policy` and `timeoutMilliseconds`.

The engine applies these existing collection policies before issuing the plan.
The runner supplies runtime expansion, calibration capture, and resolved
property defaults here;
family preparation receives an engine-owned plan after those transformations.
Callers do not adopt or relabel transformed plans as engine-owned.

Imported analysis profiles retain the existing local, serial defaults with
concurrency one and 60-second collection, soft, and hard timeouts. Imported
runtime profiles use the ordinary common defaults. A family that does not support
the default placement requires explicit compatible execution policy.

## Backend Preparation

```ts
type FamilyVariant = {
    readonly key: string;
    readonly facts: FamilyValue;
};

type FamilyPreparationInput<Settings extends FamilyValue> = {
    readonly testPlan: TestPlan;
    readonly settings: Settings;
    readonly projectRoot: string;
    readonly signal: AbortSignal;
    readonly expandVariants: (variants: NonEmptyReadonlyArray<FamilyVariant>) => TestPlan;
};

type FamilyBackend<Settings extends FamilyValue> = {
    readonly prepare: (input: FamilyPreparationInput<Settings>) => Promise<FamilyPreparation>;
};

type FamilyPreparation = {
    readonly testPlan: TestPlan;
    readonly facts: FamilyValue;
    readonly collect: (input: FamilyCollectionInput) => Promise<FamilyCollection>;
    readonly dispose: () => Promise<void>;
};

type FamilyCollectionInput = {
    readonly workIds: readonly WorkId[];
    readonly signal: AbortSignal;
};

type FamilyCollection = {
    readonly kind: 'runtime';
    readonly facts: FamilyValue;
} | {
    readonly kind: 'analysis';
    readonly facts: FamilyValue;
    readonly execute: (context: FamilyAnalysisContext) => Promise<void>;
};
```

Preparation receives the whole collected plan after ordinary runtime/workload
expansion, before filtering and sharding. A backend returns the original plan or
one produced by `expandVariants`. It cannot construct new logical cases, remove
cases, replace bodies, or take ownership of another engine's nodes.

`expandVariants` produces the Cartesian product with a nonempty ordered list of
unique variant keys. The engine owns the resulting plan and IDs. Each `WorkId`
adds `familyVariant: { family: TestFamilyId; key: string; } | null`; ordinary
unexpanded work uses `null`. Runtime and workload identity remain independent.
TypeScript variants use keys such as `typescript@6.0.3`, with compiler identity
and input fingerprints in facts. There is no TypeScript-only identity union.
Work-unit identity, placement, and case artifacts also retain `familyVariant`,
so work from different compiler variants cannot collide or share a unit
accidentally. Null variants are omitted from canonical identity keys to preserve
existing unexpanded keys and shard assignments; non-null variants contribute
the family and key. See [Artifact Identity](./artifact-identity.md). Two
different compiler implementations claiming the same version must not be
silently deduplicated; reject conflicting identities.

The engine validates plan ownership, identity, and expansion before exposing the
preparation. Facts are immutable JSON. A backend may retain a compiler program,
but it cannot place live handles in facts.

Collection receives an ordered exact subset of prepared work IDs. Empty selections,
duplicates, and unknown IDs are rejected before calling the backend. The
runner handles empty shards before engine collection. Collection freezes selected assertion ownership and returns either runtime
work for the engine or analysis work for the supplied analysis executor. Its
kind must match the definition's execution feature. Collection must not create
new variants or evaluate case outcomes. The engine retains the selected plan;
the backend does not return or reorder it.

## Analysis Evidence And Reporting

```ts
type FamilyEvent =
    | { readonly kind: 'case-start'; readonly workId: WorkId; }
    | { readonly kind: 'case-progress'; readonly workId: WorkId; readonly note: string; }
    | {
        readonly kind: 'case-end';
        readonly result: PerTestResult;
        readonly artifacts: readonly RunArtifact[];
    }
    | { readonly kind: 'run-error'; readonly error: RunnerError; }
    | { readonly kind: 'artifact'; readonly artifact: RunArtifact; };

type FamilyAnalysisContext = {
    readonly signal: AbortSignal;
    readonly report: (event: FamilyEvent) => Promise<void>;
};
```

The analysis executor reports through this engine-owned sink, never directly to
reporters. A non-skipped selected work item has exactly one `case-start` followed
by one `case-end`; progress is valid only between them. `case-end` uses the common
`PerTestResult`, `TestOutcome`, and `FailedCheck` contracts. Static checking has
one attempt, with no retry summary or runtime-only result domains. The engine
validates case IDs, work IDs, attempt identity, and result completeness.

The engine completes authored skipped work without body inspection. It omits
skipped IDs from backend collection and execution while retaining them in the
selected plan. Entirely skipped selections bypass backend collection and
analysis execution and have `null` collection facts.
It must not invent successful completion for work interrupted by cancellation.
Missing case-end evidence, duplicate events, unknown IDs, and contradictory
outcomes become run errors. The engine synthesizes inconclusive results for
selected unfinished work and gives the run a failing exit status. It does not
turn infrastructure failure into a failed type assertion or an intentional skip.

The sink translates accepted events into ordinary reporter events and retains
results in selected-plan order. Analysis artifacts use the common adapter
artifact shape. Event arrival order may reflect analysis order;
reporters receive actual starts, progress, and completions. A failing reporter
is an engine-owned delivery error, not checker evidence. Backends await `report`
to preserve ordering and backpressure. Background reports after execution settles
are invalid.

Runtime collections expose no custom execution callback. The engine executes
their existing bodies through normal scheduling, retries, scopes, and supervision.
This prevents the initial extension contract from becoming a second runtime
scheduler. A custom external runtime driver would need its own separately
specified contract; it is not implied by custom family support.

Shared compiler startup/checking time belongs in run timings. Per-case duration
measures attributable evidence evaluation and must not charge the entire shared
compiler run to every case. Shared assertion evidence may complete several
selected cases, each retaining its own work identity.

## Direct Engine API

```ts
type PrepareFamilyRequest<Settings extends FamilyValue> = {
    readonly testPlan: TestPlan;
    readonly testFamily: TestFamily<Settings>;
    readonly settings: NoInfer<Settings>;
    readonly projectRoot: string;
    readonly signal: AbortSignal;
};

type FamilyRunFacts = {
    readonly id: TestFamilyId;
    readonly version: string;
    readonly settings: FamilyValue;
    readonly preparation: FamilyValue;
    readonly collection: FamilyValue;
};

type PreparedFamilyRun = AsyncDisposable & {
    readonly testPlan: TestPlan;
    readonly collect: (input: FamilyCollectionInput) => Promise<CollectedFamilyRun>;
};

type CollectedFamilyRun = {
    readonly testPlan: TestPlan;
    readonly facts: FamilyRunFacts;
};

type FamilyExecuteOptions = ExecuteOptions & { readonly signal: AbortSignal; };
```

`PreparedFamilyRun` and `CollectedFamilyRun` are engine-branded values. Their
visible shapes above do not permit callers to construct them. Each engine adds
these call signatures; the package-level functions delegate to the default engine:

```ts
declare function prepareFamily<Settings extends FamilyValue>(
    request: PrepareFamilyRequest<Settings>
): Promise<PreparedFamilyRun>;

declare function execute(
    run: CollectedFamilyRun,
    options: FamilyExecuteOptions
): Promise<RunResult>;
```

The existing `execute(testPlan, options)` overload remains the ordinary default
runtime path. It rejects incompatible explicit body-family requirements before
execution. It does not inspect family-neutral bodies with a compiler. If such a
body reaches a static reference during runtime execution, that reference throws;
earlier body effects may already have happened. The guarantee that type-test
bodies are never invoked requires explicitly selecting the analysis family.
There is no implicit optional-family lookup or fallback from analysis to runtime.

A direct consumer uses its own engine and existing engine execution options:

```ts
await using prepared = await engine.prepareFamily({
    testPlan: engine.createTestPlan(root),
    testFamily: typeTests,
    settings: {
        projectConfigPath: './tsconfig.json',
        compiler: { kind: 'local' }
    },
    projectRoot: process.cwd(),
    signal
});

const collected = await prepared.collect({
    workIds: prepared.testPlan.cases.map(function workIdentity(testCase) {
        return testCase.workId;
    }),
    signal
});

const result = await engine.execute(collected, { ...executionOptions, signal });
```

`projectRoot` must be an absolute path. Relative paths in settings resolve
against it, and the engine never discovers runner configuration on a direct call.

The runner performs its existing filters, sharding, and ordering between
`prepareFamily` and `collect`, then supplies the resulting ordered work IDs.
Direct callers can select IDs without importing runner configuration or its
filter grammar. Both paths execute the same branded collection.

## Lifetime And Failure Contract

A preparation is single-use: prepare, collect once, execute once, dispose.
Execution consumes the collection. Repeated or concurrent collection/execution,
a collection from another engine, or use after disposal throws `TypeError`.
New invocations and watch reruns obtain new preparations. Internal cache reuse
must preserve these public lifetime and source-validation guarantees.

Before ownership transfers to the engine, a backend that fails preparation must
dispose its partial resources before rejecting. Once returned, the engine owns
its `dispose` call. Collection failure, including invalid selection, disposes preparation automatically.
Execution always disposes it before `run-end` and final result delivery, including
cancellation and reporting failure. `reporter.dispose` and terminal output
cleanup remain engine-owned and run after final delivery under their existing
contract. `Symbol.asyncDispose` handles abandoned
preparations and is idempotent after engine cleanup. Disposal runs exactly once
and is not skipped because the cancellation signal is aborted. Explicit disposal
while collection or execution is active invalidates the preparation, requests
cooperative cancellation, and awaits active backend work before cleanup.
After engine cleanup, explicit disposal does not throw cleanup failures again;
execution retains those failures in its returned result.

Invalid configuration and pre-execution setup failures reject `prepareFamily`
or `collect` with an error and preserved cause. The runner maps them through its
existing setup-diagnostic path. Direct callers can catch them normally. During
execution, checker failures, cancellation, drift, and cleanup failures become
common run errors in `RunResult`; affected incomplete checks are inconclusive.
A genuinely wrong assertion produces a failed assertion outcome. Caller misuse
of consumed or foreign branded values remains an API error.

Cancellation is checked before admission and propagated to preparation and
execution. It requests cooperative stopping; it does not promise preemption of
synchronous compiler work. Hard termination requires runner-owned process or
worker supervision, including disposal/termination of compiler subprocesses.
Cleanup failures are retained alongside the primary failure.

## Process Boundaries And Records

Resolve families inside the boundary that already loads configuration or an
explicit programmatic bootstrap. A coordinator must not import user code merely
to inspect family metadata. A definition's explicit module reference can be used
when configuration replay is unavailable. Resolving a module must select its
named export without invoking a factory inferred from its name. A local definition with neither an
importable configuration nor a module/bootstrap is restricted to local execution.
Reject incompatible placement before checking; do not serialize functions or
infer an import from a family ID.

Frozen messages contain the family ID, implementation version, module reference
when used, normalized settings, selected IDs, and serializable facts. The worker
resolves the definition and verifies identity, exact version, settings, and frozen
work before execution. A run may not switch implementations after selection.
Execution and reproduction require the recorded implementation version; a changed
version requires fresh collection rather than an assumed semver-compatible
substitution.

Records retain `FamilyRunFacts` and common results, never executable definitions,
compiler sessions, or callback closures. Generic historical inspection needs no
family code. Reproduction requires the explicitly resolved compatible family and
recorded inputs. Existing records retain a versioned reader; migrate old compiler
identity into the generic family-variant representation without changing its
recorded meaning or claiming that old generated-input checks used this contract.

## Delivery Boundaries

Implement the dependent milestones in this order:

1. Public family definitions, generic work/work-unit identity, and the single-use
   preparation/collection contract, with the engine-owned evidence sink.
2. Typed profile binding and direct-engine execution, including error delivery,
   disposal, and settings rejection.
3. Built-in aliases and policy migration, then worker/bootstrap resolution and
   versioned record compatibility.
4. Dependency/compiler compatibility assessment against the specified relation
   semantics, followed by the original-source type-test backend and package API.
5. Exact selection, diagnostics, cancellation/drift behavior, reproduction, and
   end-to-end acceptance across direct and runner entry points.

Each milestone includes its acceptance checks before the next starts. The ordered
implementation checklist is [issue #194](https://github.com/enormora/overkill/issues/194).
Implementation choices inside a backend may vary without reopening these public
contracts. If a required semantic rule cannot be supported through public APIs,
report that blocker explicitly rather than silently weakening the rule.

Implement and validate the family API before migrating the type-test backend.
Preserve built-in policy and command behavior through their definitions; an
optional family does not gain benchmark commands or microtest permissions by
choosing a familiar identifier. The initial custom-family surface supports
ordinary engine runtime execution and project-wide analysis, not arbitrary
replacement worker protocols.

The normative type-test settings, assertion catalog, and diagnostic contract are
in [Native Type-Test Integration](../authoring/testing-models.md#native-type-test-integration).
