import { isDeepStrictEqual } from 'node:util';
import { implementationPlan, setImplementationPlan } from '../engine/body-reference-plan.ts';
import { preparePlacedFamily, executePreparedFamilyWithDriver, type Engine } from '../engine/engine.ts';
import { builtinTestFamily, isBuiltinFamilyId } from '../engine/builtin-test-families.ts';
import type { ExecuteOptions, ExecutionDriver } from '../engine/execution.ts';
import { bindFamilySettings, type BoundFamilySettings, type FamilyValue } from '../engine/test-family.ts';
import {
    analysisOwnership,
    analysisSignal,
    expectedAnalysisCollection,
    withAnalysisDeadline
} from './analysis-deadline.ts';
import { familyCatalogSnapshot } from './family-work-catalog.ts';
import { familyCatalog, setFamilyCatalog, type FrozenFamilyDefinition } from './family-catalog.ts';
import { assertFrozenFamilyPreparation } from './family-resolution.ts';

type TestPlan = ReturnType<Engine['createTestPlan']>;
type RunResult = Awaited<ReturnType<Engine['execute']>>;
type PreparedFamily = Awaited<ReturnType<typeof preparePlacedFamily>>;
type CollectedFamily = Awaited<ReturnType<PreparedFamily['collect']>>;
type WorkId = TestPlan['cases'][number]['workId'];
type FamilyPreparationFacts = PreparedFamily['facts'];

type RegisteredFamily = {
    readonly placement: 'in-process' | 'supervised-process' | 'worker-pool';
    readonly source: TestPlan;
    readonly engine: Engine;
    readonly binding: BoundFamilySettings;
    readonly expected: FamilyPreparationFacts | null;
    readonly catalog: TestPlan;
    readonly projectRoot: string;
    readonly retainedAnalysis: PreparedFamily | null;
};

const families = new WeakMap<TestPlan, RegisteredFamily>();
const analysisCollections = new WeakMap<PreparedFamily, CollectedFamily>();

function analysisHostOptions(options: ExecuteOptions): ExecuteOptions {
    const selected = { ...options };
    for (const field of [ 'runtimePolicy', 'timeoutPolicy', 'processBudgets', 'processUsageTracker', 'propertyRun' ]) {
        Reflect.deleteProperty(selected, field);
    }
    return selected;
}

function assertHostFamilyCatalog(expected: TestPlan, actual: TestPlan): void {
    if (!isDeepStrictEqual(familyCatalogSnapshot(expected), familyCatalogSnapshot(actual))) {
        throw new TypeError('Frozen family work changed; collect a new run.');
    }
}

type PreparedCatalog = { readonly facts: FamilyPreparationFacts; readonly testPlan: TestPlan; };

function validatePreparedCatalog(
    expected: FamilyPreparationFacts | null,
    catalog: TestPlan,
    prepared: PreparedCatalog
): void {
    if (expected !== null) {
        assertFrozenFamilyPreparation(expected, prepared.facts);
        assertHostFamilyCatalog(catalog, prepared.testPlan);
    }
}

function validateDefinitionCheckpoint(
    definition: FrozenFamilyDefinition,
    facts: FamilyPreparationFacts,
    catalog: FamilyValue
): void {
    if (definition.checkpoint === null) {
        return;
    }
    assertFrozenFamilyPreparation(definition.checkpoint.preparation, facts);
    if (!isDeepStrictEqual(definition.checkpoint.catalog, catalog)) {
        throw new TypeError('Frozen family catalog changed; collect a new run.');
    }
}

export function registerHostFamilyPlan(
    plan: TestPlan,
    engine: Engine,
    id: string,
    projectRoot: string
): TestPlan {
    if (!isBuiltinFamilyId(id)) {
        throw new TypeError('Imported families require explicit host resolution.');
    }
    families.set(plan, {
        source: plan,
        engine,
        binding: bindFamilySettings(builtinTestFamily(id), null),
        projectRoot,
        expected: null,
        catalog: plan,
        placement: 'in-process',
        retainedAnalysis: null
    });
    return plan;
}

export async function collectRetainedHostAnalysis(plan: TestPlan, workIds: readonly WorkId[]): Promise<FamilyValue> {
    const prepared = families.get(plan)?.retainedAnalysis ?? null;
    if (prepared === null) {
        throw new TypeError('Expected an analysis session.');
    }
    const collected = await prepared.collect({ workIds, signal: analysisSignal() });
    analysisCollections.set(prepared, collected);
    return collected.facts.collection;
}

function assertAnalysisAssignment(selected: TestPlan, collected: CollectedFamily): void {
    const work = selected.cases.map(function identity(testCase) {
        return testCase.workId;
    });
    const collectedWork = collected.testPlan.cases.map(function identity(testCase) {
        return testCase.workId;
    });
    if (
        !isDeepStrictEqual(work, collectedWork) ||
        !isDeepStrictEqual(expectedAnalysisCollection(), collected.facts.collection) ||
        (implementationPlan(selected)?.catalog ?? null) !== null
    ) {
        throw new TypeError('Frozen analysis assignment changed; collect a new run.');
    }
}

type HostFamilyExecution = {
    readonly family: RegisteredFamily;
    readonly selected: TestPlan;
    readonly driver: ExecutionDriver;
    readonly options: ExecuteOptions;
    readonly analysis: boolean;
};

async function executeRecreatedFamily(input: HostFamilyExecution, signal: AbortSignal): Promise<RunResult> {
    const { family, selected, driver, options, analysis } = input;
    const implementations = implementationPlan(selected);
    await using prepared = await preparePlacedFamily(family.engine, {
        testPlan: implementations === null ? family.source : setImplementationPlan(family.source, implementations),
        testFamily: family.binding.testFamily,
        binding: family.binding,
        projectRoot: family.projectRoot,
        signal
    }, family.placement);
    validatePreparedCatalog(family.expected, family.catalog, prepared);
    const collected = await prepared.collect({
        workIds: selected.cases.map(function identity(testCase) {
            return testCase.workId;
        }),
        signal
    });
    const expected = expectedAnalysisCollection();
    if (analysis && expected !== undefined && !isDeepStrictEqual(expected, collected.facts.collection)) {
        throw new TypeError('Frozen analysis collection changed; collect a new run.');
    }
    return await executePreparedFamilyWithDriver(family.engine, collected, { ...options, signal }, driver);
}

export async function executeHostFamily(
    source: TestPlan,
    selected: TestPlan,
    driver: ExecutionDriver,
    options: ExecuteOptions
): Promise<RunResult> {
    const registered = families.get(source);
    if (registered === undefined) {
        return await driver(selected, options);
    }
    const family = registered;
    const analysis = family.binding.testFamily.features.execution === 'analysis';
    const timeout = analysis ? options.timeoutPolicy?.timeoutMilliseconds ?? null : null;
    async function execute(signal: AbortSignal): Promise<RunResult> {
        const admittedOptions = analysis ? analysisHostOptions(options) : options;
        const prepared = family.retainedAnalysis;
        const retained = prepared === null ? undefined : analysisCollections.get(prepared);
        if (retained === undefined) {
            return await executeRecreatedFamily({ family, selected, driver, analysis, options: admittedOptions }, signal);
        }
        assertAnalysisAssignment(selected, retained);
        return await executePreparedFamilyWithDriver(family.engine, retained, { ...admittedOptions, signal }, driver);
    }
    return timeout === null
        ? await execute(analysisSignal())
        : await withAnalysisDeadline(timeout, 'Analysis checking exceeded soft timeout.', execute);
}

async function recordFamilyCatalog(
    prepared: PreparedFamily,
    definition: FrozenFamilyDefinition,
    signal: AbortSignal
): Promise<void> {
    const catalog = familyCatalogSnapshot(prepared.testPlan);
    validateDefinitionCheckpoint(definition, prepared.facts, catalog);
    const collected = definition.selection === null || definition.selection.length === 0
        ? null
        : await prepared.collect({ workIds: definition.selection, signal });
    setFamilyCatalog(prepared.testPlan, {
        definition: { ...definition, selection: null, checkpoint: { preparation: prepared.facts, catalog } },
        facts: collected?.facts ?? { ...prepared.facts, collection: null }
    });
}

export async function registerImportedHostFamilyPlan(
    source: TestPlan,
    engine: Engine,
    binding: BoundFamilySettings,
    definition: FrozenFamilyDefinition
): Promise<TestPlan> {
    const { projectRoot, processModel: placement } = definition;
    const signal = analysisSignal();
    await using ownership = new AsyncDisposableStack();
    const prepared = ownership.use(await preparePlacedFamily(engine, {
        testPlan: source,
        testFamily: binding.testFamily,
        binding,
        projectRoot,
        signal
    }, placement));
    await recordFamilyCatalog(prepared, definition, signal);
    const lifetime = binding.testFamily.features.execution === 'analysis' ? analysisOwnership() : undefined;
    lifetime?.use(ownership.move());
    families.set(prepared.testPlan, {
        source,
        engine,
        binding,
        projectRoot,
        placement,
        expected: prepared.facts,
        catalog: prepared.testPlan,
        retainedAnalysis: lifetime === undefined ? null : prepared
    });
    return prepared.testPlan;
}

export function transferHostFamilyPlan(source: TestPlan, target: TestPlan): TestPlan {
    const family = families.get(source);
    if (family !== undefined) {
        families.set(target, family);
    }
    const metadata = familyCatalog(source);
    if (metadata !== null) {
        setFamilyCatalog(target, metadata);
    }
    return target;
}
