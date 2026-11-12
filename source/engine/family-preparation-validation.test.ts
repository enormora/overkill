import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    attachTestBodyResourceAttachments,
    defineTestFamily,
    stampTestNodeFamily,
    type Engine,
    type FamilyBackend,
    type FamilyExecuteOptions,
    type FamilyPreparation,
    type FamilyPreparationInput,
    type TestCase,
    type TestFamily,
    type TestPlan,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';

const controller = new AbortController();
const { signal } = controller;
const projectRoot = process.cwd();
const options: FamilyExecuteOptions = {
    debug: { mode: 'off' },
    signal,
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: '2026-01-01T00:00:00.000Z'
};
const nodeOptions = { definitionLocations: [ { kind: 'unknown' } ] as const, annotations: {}, controls: {} };

type AuthoredPolicy = 'capture' | 'foreign' | 'ordinary' | 'resources';

function analysisBody(): never {
    throw new Error('Analysis should not execute this body.');
}

function resourceBody(): Parameters<Engine['createTestCase']>[0]['body'] {
    return attachTestBodyResourceAttachments(analysisBody.bind(null), {
        directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
        resourceGraph: [ {
            workload: 'independent',
            dependencies: [],
            handleTransport: 'local',
            name: 'scratch',
            requirements: [],
            scenarios: [],
            scope: 'per-case'
        } ],
        runtimeGraphs: []
    });
}

function plan(engine: Engine, policy: AuthoredPolicy): TestPlan {
    const testCase = engine.createTestCase({
        ...nodeOptions,
        title: 'check',
        controls: policy === 'capture' ? { capture: 'live' } : {},
        body: policy === 'resources' ? resourceBody() : analysisBody
    });
    if (policy === 'foreign') {
        stampTestNodeFamily(testCase, '@example/foreign');
    }
    return engine.createTestPlan(engine.createRoot({ ...nodeOptions, title: 'root', children: [ testCase ] }));
}

async function prepareRuntime(input: FamilyPreparationInput<null>): Promise<FamilyPreparation> {
    const { testPlan } = input;
    return {
        testPlan,
        facts: null,
        async collect() {
            return { kind: 'runtime', facts: null };
        },
        async dispose() {
            return undefined;
        }
    };
}

function defineAnalysis(prepare: FamilyBackend<null>['prepare']): TestFamily<null> {
    return defineTestFamily({
        id: '@example/validation',
        version: '1',
        module: null,
        features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings() {
            return null;
        },
        async load() {
            return { prepare };
        }
    });
}

function rejectPolicy(policy: AuthoredPolicy, message: RegExp): TestCase {
    return test(`rejects ${policy} policy before loading analysis`, async function (scope) {
        const engine = createTestEngine();
        const testFamily = defineAnalysis(prepareRuntime);
        const testPlan = plan(engine, policy);
        await scope.assert.rejects(async function () {
            await engine.prepareFamily({ testPlan, testFamily, settings: null, projectRoot, signal });
        }, { message });
        return scope.assert.collect();
    });
}

async function collectExecutable(
    engine: Engine,
    testFamily: TestFamily<null>,
    testPlan: TestPlan,
    scope: TestScope
): Promise<void> {
    await using prepared = await engine.prepareFamily({ testPlan, testFamily, settings: null, projectRoot, signal });
    await scope.assert.rejects(async function () {
        await prepared.collect({ workIds: [ testPlan.cases[0].workId ], signal });
    }, { message: /collection kind/u });
}

function runtimeFamily(): TestFamily<null> {
    return defineTestFamily({
        ...defineAnalysis(prepareRuntime),
        features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] }
    });
}

export const testNode = suite('family preparation validation', [
    rejectPolicy('capture', /does not support capture/u),
    rejectPolicy('foreign', /requires test family/u),
    rejectPolicy('resources', /does not support resources/u),
    test('rejects forged settings bindings before backend preparation', async function (scope) {
        const engine = createTestEngine();
        const testFamily = defineAnalysis(prepareRuntime);
        const request = {
            testPlan: plan(engine, 'ordinary'),
            testFamily,
            settings: null,
            projectRoot,
            signal,
            binding: { testFamily, settings: null, prepare: prepareRuntime }
        };
        await scope.assert.rejects(async function forgedBinding() {
            await Reflect.apply(engine.prepareFamily, engine, [ request ]);
        }, { message: /engine-issued family settings/u });
        return scope.assert.collect();
    }),
    test('rejects a plan from a different engine', async function (scope) {
        const engine = createTestEngine();
        const testPlan = plan(createTestEngine(), 'ordinary');
        await scope.assert.rejects(async function () {
            await engine.prepareFamily({
                testPlan,
                testFamily: defineAnalysis(prepareRuntime),
                settings: null,
                projectRoot,
                signal
            });
        }, { message: /engine-created plan/u });
        return scope.assert.collect();
    }),
    test('rejects families requiring process supervision', async function (scope) {
        const engine = createTestEngine();
        const testFamily = defineTestFamily({
            ...defineAnalysis(prepareRuntime),
            features: { execution: 'analysis', processModels: [ 'supervised-process' ], profileOptions: [] }
        });
        await scope.assert.rejects(async function () {
            await engine.prepareFamily({
                testPlan: plan(engine, 'ordinary'),
                testFamily,
                settings: null,
                projectRoot,
                signal
            });
        }, { message: /direct in-process/u });
        return scope.assert.collect();
    }),
    test('rejects duplicate variant keys during expansion', async function (scope) {
        const engine = createTestEngine();
        const testFamily = defineAnalysis(async function (input) {
            return await prepareRuntime({
                ...input,
                testPlan: input.expandVariants([ { key: 'same', facts: 1 }, { key: 'same', facts: 2 } ])
            });
        });
        await scope.assert.rejects(async function () {
            await engine.prepareFamily({
                testPlan: plan(engine, 'ordinary'),
                testFamily,
                settings: null,
                projectRoot,
                signal
            });
        }, { message: /unique nonempty keys/u });
        return scope.assert.collect();
    }),
    test('rejects backend replacement plans and disposes the rejected preparation', async function (scope) {
        const engine = createTestEngine();
        const disposed: string[] = [];
        const testFamily = defineAnalysis(async function (input) {
            return {
                ...await prepareRuntime(input),
                testPlan: { ...input.testPlan },
                async dispose() {
                    disposed.push('disposed');
                }
            };
        });
        await scope.assert.rejects(async function () {
            await engine.prepareFamily({
                testPlan: plan(engine, 'ordinary'),
                testFamily,
                settings: null,
                projectRoot,
                signal
            });
        }, { message: /engine did not issue/u });
        scope.assert.deepEqual(disposed, [ 'disposed' ]);
        return scope.assert.collect();
    }),
    test('rejects a collection with a different execution kind', async function (scope) {
        const engine = createTestEngine();
        await collectExecutable(engine, defineAnalysis(prepareRuntime), plan(engine, 'ordinary'), scope);
        return scope.assert.collect();
    }),
    test('rejects foreign collections and unsupported retry policy', async function (scope) {
        const engine = createTestEngine();
        const testPlan = plan(engine, 'ordinary');
        await using prepared = await engine.prepareFamily({
            testPlan,
            testFamily: runtimeFamily(),
            settings: null,
            projectRoot,
            signal
        });
        const collected = await prepared.collect({ workIds: [ testPlan.cases[0].workId ], signal });
        await scope.assert.rejects(async function () {
            await createTestEngine().execute(collected, options);
        }, { message: /from this engine/u });
        await scope.assert.rejects(async function () {
            await engine.execute(collected, { ...options, retryPolicy: { maxAttempts: 2 } });
        }, { message: /does not support retries/u });
        return scope.assert.collect();
    }),
    test('rejects a JavaScript call that omits collected execution options', async function (scope) {
        const engine = createTestEngine();
        const testPlan = plan(engine, 'ordinary');
        await using prepared = await engine.prepareFamily({
            testPlan,
            testFamily: runtimeFamily(),
            settings: null,
            projectRoot,
            signal
        });
        const collected = await prepared.collect({ workIds: [ testPlan.cases[0].workId ], signal });
        await scope.assert.rejects(async function () {
            await Reflect.apply(engine.execute, engine, [ collected ]);
        }, { message: /requires an AbortSignal/u });
        return scope.assert.collect();
    }),
    test('rejects a runtime plan with an explicit optional family requirement', async function (scope) {
        const engine = createTestEngine();
        await scope.assert.rejects(async function () {
            await engine.execute(plan(engine, 'foreign'));
        }, { message: /explicit preparation/u });
        return scope.assert.collect();
    })
]);
