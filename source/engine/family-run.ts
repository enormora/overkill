import { isAbsolute } from 'node:path';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { ExecuteOptions } from './execution-options.ts';
import { workIdentityKey } from './identity.ts';
import { hasAttachedResourceDescriptors } from './test-body-resource-attachment.ts';
import {
    isDefinedTestFamily,
    snapshotFamilyValue,
    type DefinedTestFamily,
    type FamilyCollection,
    type FamilyCollectionInput,
    type FamilyPreparation,
    type FamilyValue,
    type FamilyVariant,
    type TestFamily
} from './test-family.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

const disposalSymbols: typeof Symbol & { readonly asyncDispose: typeof Symbol.asyncDispose; } = Symbol;
const asyncDispose: typeof Symbol.asyncDispose = disposalSymbols.asyncDispose;

const preparedBrand: unique symbol = Symbol('PreparedFamilyRun');
const collectedBrand: unique symbol = Symbol('CollectedFamilyRun');

export type PrepareFamilyRequest<Settings extends FamilyValue> = {
    readonly testPlan: TestPlan;
    readonly testFamily: TestFamily<Settings>;
    readonly settings: NoInfer<Settings>;
    readonly projectRoot: string;
    readonly signal: AbortSignal;
};

export type FamilyRunFacts = {
    readonly id: DefinedTestFamily['id'];
    readonly version: string;
    readonly settings: FamilyValue;
    readonly preparation: FamilyValue;
    readonly collection: FamilyValue;
};

export type PreparedFamilyRun = AsyncDisposable & {
    readonly [preparedBrand]: true;
    readonly testPlan: TestPlan;
    readonly collect: (input: FamilyCollectionInput) => Promise<CollectedFamilyRun>;
};

export type CollectedFamilyRun = {
    readonly [collectedBrand]: true;
    readonly testPlan: TestPlan;
    readonly facts: FamilyRunFacts;
};

export type FamilyExecuteOptions = ExecuteOptions & { readonly signal: AbortSignal; };

type FamilyExecution = {
    readonly family: DefinedTestFamily;
    readonly collection: FamilyCollection | null;
    readonly run: CollectedFamilyRun;
};

export type FamilyExecutionRequest = FamilyExecution & { readonly signal: AbortSignal; };

function validateCasePolicy(testCase: TestPlanCase, family: DefinedTestFamily): void {
    if (testCase.controls.capture !== null && !family.features.profileOptions.includes('capture')) {
        throw new TypeError('The selected family does not support capture.');
    }
    if (
        hasAttachedResourceDescriptors(testCase.resourceAttachments) &&
        !family.features.profileOptions.includes('resources')
    ) {
        throw new TypeError('The selected family does not support resources.');
    }
}

function validateCase(testCase: TestPlanCase, family: DefinedTestFamily): void {
    if (testCase.execution.kind === 'skip') {
        return;
    }
    if (testCase.testFamily !== null && testCase.testFamily !== family.id) {
        throw new TypeError(`Case requires test family "${testCase.testFamily}", not "${family.id}".`);
    }
    validateCasePolicy(testCase, family);
}

function nonEmptyCases(cases: readonly TestPlanCase[]): NonEmptyReadonlyArray<TestPlanCase> {
    const [ first, ...rest ] = cases;
    if (first === undefined) {
        throw new TypeError('Family selection must contain at least one work item.');
    }
    return Object.freeze([ first, ...rest ]);
}

function indexCases(testPlan: TestPlan): ReadonlyMap<string, TestPlanCase> {
    const cases = new Map<string, TestPlanCase>();
    for (const testCase of testPlan.cases) {
        const key = workIdentityKey(testCase.workId);
        if (cases.has(key)) {
            throw new TypeError('Duplicate family work identity.');
        }
        cases.set(key, testCase);
    }
    return cases;
}

function selectCases(testPlan: TestPlan, input: FamilyCollectionInput): TestPlan {
    const indexed = indexCases(testPlan);
    const selected = new Set<string>();
    const cases = input.workIds.map(function select(workId) {
        const key = workIdentityKey(workId);
        const testCase = indexed.get(key);
        if (testCase === undefined || selected.has(key)) {
            throw new TypeError('Family selection contains an unknown or duplicate work ID.');
        }
        selected.add(key);
        return testCase;
    });
    return Object.freeze({ ...testPlan, cases: nonEmptyCases(cases) });
}

function snapshotCase(testCase: TestPlanCase): TestPlanCase {
    const workId = snapshotFamilyValue(testCase.workId);
    return Object.freeze({
        ...testCase,
        id: workId.case,
        workId,
        execution: Object.freeze({ ...testCase.execution }),
        controls: Object.freeze({ ...testCase.controls })
    });
}

function snapshotPlan(testPlan: TestPlan): TestPlan {
    const cases = nonEmptyCases(testPlan.cases.map(snapshotCase));
    const byIdentity = new Map(cases.map(function byWork(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ] as const;
    }));
    const discoveredCases = nonEmptyCases(testPlan.discoveredCases.map(function snapshotDiscovered(testCase) {
        return byIdentity.get(workIdentityKey(testCase.workId)) ?? snapshotCase(testCase);
    }));
    return Object.freeze({ ...testPlan, cases, discoveredCases, root: Object.freeze({ ...testPlan.root }) });
}

function expandPlan(
    testPlan: TestPlan,
    family: DefinedTestFamily,
    input: NonEmptyReadonlyArray<FamilyVariant>
): TestPlan {
    const variants = snapshotFamilyValue(input);
    const keys = new Set<string>();
    for (const { key } of variants) {
        if (typeof key !== 'string' || key.trim().length === 0 || keys.has(key)) {
            throw new TypeError('Family variants require unique nonempty keys.');
        }
        keys.add(key);
    }
    function expand(cases: TestPlan['cases']): TestPlan['cases'] {
        return nonEmptyCases(cases.flatMap(function expandCase(testCase) {
            return variants.map(function variant({ key }) {
                return snapshotCase({
                    ...testCase,
                    workId: { ...testCase.workId, familyVariant: { family: family.id, key } }
                });
            });
        }));
    }
    return Object.freeze({
        ...testPlan,
        cases: expand(testPlan.cases),
        discoveredCases: expand(testPlan.discoveredCases)
    });
}

async function collectFamily(
    preparation: FamilyPreparation,
    input: FamilyCollectionInput,
    execution: DefinedTestFamily['features']['execution']
): Promise<FamilyCollection> {
    const collection = await preparation.collect(input);
    if (collection.kind !== execution) {
        throw new TypeError('Family collection kind does not match its definition.');
    }
    if (collection.kind === 'runtime') {
        return { kind: 'runtime', facts: snapshotFamilyValue(collection.facts) };
    }
    if (typeof collection.execute !== 'function') {
        throw new TypeError('Analysis collection requires an execute callback.');
    }
    return {
        kind: 'analysis',
        facts: snapshotFamilyValue(collection.facts),
        execute: collection.execute.bind(collection)
    };
}

function collectPreparedFamily(
    preparation: FamilyPreparation,
    family: DefinedTestFamily,
    settings: FamilyValue,
    executions: WeakMap<CollectedFamilyRun, FamilyExecution>
): PreparedFamilyRun {
    const preparationFacts = snapshotFamilyValue(preparation.facts);
    const preparedPlan = preparation.testPlan;
    return Object.freeze<PreparedFamilyRun>({
        [preparedBrand]: true,
        testPlan: preparedPlan,
        async [asyncDispose]() {
            await preparation.dispose();
        },
        async collect(input) {
            const testPlan = selectCases(preparedPlan, input);
            const workIds = Object.freeze(
                testPlan
                    .cases
                    .filter(function executable(testCase) {
                        return testCase.execution.kind !== 'skip';
                    })
                    .map(function identity(testCase) {
                        return testCase.workId;
                    })
            );
            const collection = workIds.length === 0 ? null : await collectFamily(
                preparation,
                { workIds, signal: input.signal },
                family.features.execution
            );
            const run = Object.freeze<CollectedFamilyRun>({
                [collectedBrand]: true,
                testPlan,
                facts: Object.freeze({
                    id: family.id,
                    version: family.version,
                    settings,
                    preparation: preparationFacts,
                    collection: collection?.facts ?? null
                })
            });
            executions.set(run, { family, collection, run });
            return run;
        }
    });
}

type FamilyRuns = {
    readonly prepareFamily: <Settings extends FamilyValue>(
        request: PrepareFamilyRequest<Settings>
    ) => Promise<PreparedFamilyRun>;
    readonly execution: (run: CollectedFamilyRun, signal: AbortSignal) => FamilyExecutionRequest;
};

function validatePreparationPlan(plan: TestPlan, family: DefinedTestFamily): void {
    for (const testCase of plan.cases) {
        validateCase(testCase, family);
        if (testCase.workId.familyVariant !== null) {
            throw new TypeError('Family preparation requires unexpanded family work.');
        }
    }
    indexCases(plan);
}

function requireIssuedPlan(
    testPlan: TestPlan,
    issued: WeakSet<TestPlan>,
    complete: () => PreparedFamilyRun
): PreparedFamilyRun {
    if (!issued.has(testPlan)) {
        throw new TypeError('Backend preparation returned a plan the engine did not issue.');
    }
    return complete();
}

async function acceptPreparation(
    preparation: FamilyPreparation,
    issued: WeakSet<TestPlan>,
    complete: () => PreparedFamilyRun
): Promise<PreparedFamilyRun> {
    try {
        return requireIssuedPlan(preparation.testPlan, issued, complete);
    } catch (error: unknown) {
        await preparation.dispose();
        throw error;
    }
}

async function prepareFamilyRun<Settings extends FamilyValue>(
    request: PrepareFamilyRequest<Settings>,
    executions: WeakMap<CollectedFamilyRun, FamilyExecution>
): Promise<PreparedFamilyRun> {
    const { testFamily } = request;
    const testPlan = snapshotPlan(request.testPlan);
    validatePreparationPlan(testPlan, testFamily);
    const settings = testFamily.parseSettings(request.settings);
    const backend = await testFamily.load();
    const issued = new WeakSet([ testPlan ]);
    const preparation = await backend.prepare({
        testPlan,
        settings,
        projectRoot: request.projectRoot,
        signal: request.signal,
        expandVariants(variants) {
            const expanded = expandPlan(testPlan, testFamily, variants);
            issued.add(expanded);
            return expanded;
        }
    });
    return await acceptPreparation(preparation, issued, function accept() {
        return collectPreparedFamily(preparation, testFamily, settings, executions);
    });
}

export function createFamilyRuns(ownsPlan: (plan: TestPlan) => boolean): FamilyRuns {
    const executions = new WeakMap<CollectedFamilyRun, FamilyExecution>();
    return {
        async prepareFamily(request) {
            const { testFamily, projectRoot } = request;
            if (!isDefinedTestFamily(testFamily) || !isAbsolute(projectRoot) || !ownsPlan(request.testPlan)) {
                throw new TypeError(
                    'Preparation requires a defined family, absolute project root, and engine-created plan.'
                );
            }
            if (!testFamily.features.processModels.includes('in-process')) {
                throw new TypeError('The selected family does not support direct in-process execution.');
            }
            return await prepareFamilyRun(request, executions);
        },
        execution(run, signal) {
            const execution = executions.get(run);
            if (execution === undefined) {
                throw new TypeError('Expected a collected family run from this engine.');
            }
            return { ...execution, signal };
        }
    };
}
