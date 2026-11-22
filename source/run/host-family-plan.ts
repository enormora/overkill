import { isDeepStrictEqual } from 'node:util';
import { implementationPlan, setImplementationPlan } from '../engine/body-reference-plan.ts';
import { preparePlacedFamily, executePreparedFamilyWithDriver, type Engine } from '../engine/engine.ts';
import { builtinTestFamily, isBuiltinFamilyId } from '../engine/builtin-test-families.ts';
import type { ExecuteOptions, ExecutionDriver } from '../engine/execution.ts';
import { bindFamilySettings, type BoundFamilySettings, type FamilyValue } from '../engine/test-family.ts';
import { analysisSignal, expectedAnalysisCollection, withAnalysisDeadline } from './analysis-deadline.ts';
import { familyWorkCatalog } from './family-work-catalog.ts';
import { familyCatalog, setFamilyCatalog, type FrozenFamilyDefinition } from './family-catalog.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { assertFrozenFamilyPreparation } from './family-resolution.ts';

type TestPlan = ReturnType<Engine['createTestPlan']>;
type RunResult = Awaited<ReturnType<Engine['execute']>>;
type FamilyPreparationFacts = Awaited<ReturnType<typeof preparePlacedFamily>>['facts'];

const families = new WeakMap<TestPlan, {
    readonly placement: 'in-process' | 'supervised-process' | 'worker-pool';
    readonly source: TestPlan;
    readonly engine: Engine;
    readonly binding: BoundFamilySettings;
    readonly expected: FamilyPreparationFacts | null;
    readonly catalog: TestPlan;
    readonly projectRoot: string;
}>();

function familyCatalogSnapshot(plan: TestPlan): FamilyValue {
    return familyWorkCatalog(collectedRunPlanFromTestPlan(plan));
}

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
        placement: 'in-process'
    });
    return plan;
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
        await using prepared = await preparePlacedFamily(family.engine, {
            testPlan: implementationPlan(selected) === null
                ? family.source
                : setImplementationPlan(
                    family.source,
                    implementationPlan(selected) ?? { catalog: null, admission: 'all' }
                ),
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
        const admittedOptions = analysis
            ? analysisHostOptions(options)
            : options;
        return await executePreparedFamilyWithDriver(family.engine, collected, { ...admittedOptions, signal }, driver);
    }
    return timeout === null
        ? await execute(analysisSignal())
        : await withAnalysisDeadline(timeout, 'Analysis checking exceeded soft timeout.', execute);
}

export async function registerImportedHostFamilyPlan(
    source: TestPlan,
    engine: Engine,
    binding: BoundFamilySettings,
    definition: FrozenFamilyDefinition
): Promise<TestPlan> {
    const { projectRoot, processModel: placement } = definition;
    const signal = analysisSignal();
    await using prepared = await preparePlacedFamily(engine, {
        testPlan: source,
        testFamily: binding.testFamily,
        binding,
        projectRoot,
        signal
    }, placement);
    const catalog = familyCatalogSnapshot(prepared.testPlan);
    validateDefinitionCheckpoint(definition, prepared.facts, catalog);
    const collected = definition.selection === null || definition.selection.length === 0
        ? null
        : await prepared.collect({ workIds: definition.selection, signal });
    const facts = collected?.facts ?? { ...prepared.facts, collection: null };
    setFamilyCatalog(prepared.testPlan, {
        definition: { ...definition, selection: null, checkpoint: { preparation: prepared.facts, catalog } },
        facts
    });
    families.set(prepared.testPlan, {
        source,
        engine,
        binding,
        projectRoot,
        placement,
        expected: prepared.facts,
        catalog: prepared.testPlan
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
