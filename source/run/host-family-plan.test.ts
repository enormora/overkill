import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import {
    createRunResult,
    type ExecuteOptions,
    defineTestFamily,
    type Engine,
    type TestFamily,
    type TestPlan
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { bindFamilySettings, type BoundFamilySettings } from '../engine/test-family.ts';
import { family as runtimeFamily } from '../integration-tests/run/fixtures/imported-runtime-family.ts';
import { family as analysisFamily } from '../integration-tests/run/fixtures/imported-analysis-family.ts';
import { testNode as recordPlanTestNode } from './prepared-family-plan.test.ts';
import { familyCatalog, type CollectedFamilyMetadata, type FrozenFamilyDefinition } from './family-catalog.ts';
import {
    executeHostFamily,
    registerHostFamilyPlan,
    registerImportedHostFamilyPlan,
    transferHostFamilyPlan
} from './host-family-plan.ts';

type HostFamilyScenario = {
    readonly engine: Engine;
    readonly source: TestPlan;
    readonly binding: BoundFamilySettings;
    readonly definition: FrozenFamilyDefinition;
};
type PreparedHostFamily = HostFamilyScenario & { readonly catalog: TestPlan; };
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

function rejectBodyExecution(): never {
    throw new Error('Host collection must not execute a body.');
}

function hostScenario(family: TestFamily<null>): HostFamilyScenario {
    const engine = createTestEngine();
    const source = engine.createTestPlanFromTestFiles({
        files: [ {
            file: 'case.ts',
            testNode: engine.createTestCase({ ...metadata, title: 'case', body: rejectBodyExecution })
        } ],
        root: { annotations: {}, controls: {}, title: 'host' }
    });
    return {
        engine,
        source,
        binding: bindFamilySettings(family, null),
        definition: {
            id: family.id,
            version: family.version,
            settings: null,
            source: { kind: 'config-file', configPath: '/project/config.ts', profile: 'cases' },
            projectRoot: '/project',
            processModel: 'worker-pool',
            checkpoint: null,
            selection: null,
            definitionLocationCapture: 'disabled'
        }
    };
}

async function prepareHost(family: TestFamily<null>): Promise<PreparedHostFamily> {
    const scenario = hostScenario(family);
    const catalog = await registerImportedHostFamilyPlan(
        scenario.source,
        scenario.engine,
        scenario.binding,
        scenario.definition
    );
    return { ...scenario, catalog };
}

function catalogFacts(plan: TestPlan): CollectedFamilyMetadata {
    const family = familyCatalog(plan);
    if (family === null) {
        throw new Error('Missing host family metadata.');
    }
    return family;
}

function observedRuntimeCollection(record: (event: string) => void): TestFamily<null> {
    return defineTestFamily({
        ...runtimeFamily,
        async load() {
            const backend = await runtimeFamily.load();
            return {
                async prepare(input) {
                    const prepared = await backend.prepare(input);
                    return {
                        ...prepared,
                        async collect(selection) {
                            record('collect');
                            return await prepared.collect(selection);
                        }
                    };
                }
            };
        }
    });
}

const epoch = new Date(0);
const executionOptions: ExecuteOptions = {
    debug: { mode: 'off' },
    retryPolicy: null,
    execution: { mode: 'serial-in-process' },
    reporters: [],
    runFacts: {},
    startedAt: epoch.toISOString(),
    runtimePolicy: null,
    timeoutPolicy: null,
    processBudgets: null,
    processUsageTracker: null,
    propertyRun: { seed: 0n, projectRoot: null }
};

export const testNode = authoredSuite('host family catalogs', [
    ...[ runtimeFamily, analysisFamily ].map(function executionAdmission(family) {
        return authoredTest(
            `admits selected ${family.features.execution} work to the host driver`,
            async function (scope: TestScope) {
                const context = await prepareHost(family);
                const first = context.catalog.cases[0];
                scope.require.defined(first);
                const selected = { ...context.catalog, cases: [ first ] as const };
                const expected = createRunResult(selected, [], [], {
                    planStatus: 'planned',
                    processUsage: null,
                    startedAtMicroseconds: 0,
                    completedAtMicroseconds: 0,
                    testExecutionWallTimeMicroseconds: 0
                });
                const admitted: unknown[] = [];
                const result = await executeHostFamily(context.catalog, selected, async function (input, options) {
                    admitted.push(input);
                    const fields = [
                        'runtimePolicy',
                        'timeoutPolicy',
                        'processBudgets',
                        'processUsageTracker',
                        'propertyRun'
                    ];
                    scope.assert.deepEqual(
                        fields.map(function present(field) {
                            return Object.hasOwn(options ?? {}, field);
                        }),
                        fields.map(function () {
                            return family.features.execution === 'runtime';
                        })
                    );
                    return expected;
                }, executionOptions);
                scope.assert.equal(result, expected);
                scope.assert.equal(admitted.length, 1);
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('rejects imported identities registered as built-in host families', function (scope) {
        const context = hostScenario(runtimeFamily);
        scope.assert.throws(function () {
            registerHostFamilyPlan(context.source, context.engine, runtimeFamily.id, '/project');
        }, { message: 'Imported families require explicit host resolution.' });
        return scope.assert.collect();
    }),
    recordPlanTestNode,
    ...[ runtimeFamily, analysisFamily ].map(function familyCollection(family) {
        return authoredTest(
            `collects exact selected facts for ${family.id} without invoking bodies`,
            async function (scope) {
                const context = await prepareHost(family);
                const initial = catalogFacts(context.catalog);
                const selected = await registerImportedHostFamilyPlan(context.source, context.engine, context.binding, {
                    ...initial.definition,
                    selection: [ context.catalog.cases[0].workId ]
                });
                scope.assert.equal(initial.facts.collection, null);
                scope.assert.equal(catalogFacts(selected).facts.id, family.id);
                scope.assert.deepEqual(structuredClone<unknown>(catalogFacts(selected).facts.collection), {
                    selected: 1
                });
                scope.assert.equal(selected.cases.length, context.catalog.cases.length);
                scope.assert.equal(catalogFacts(selected).definition.selection, null);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'preparation', 'catalog' ] as const).map(function changedCheckpoint(field) {
        return authoredTest(`rejects changed frozen ${field} before collecting selected work`, async function (scope) {
            const events: string[] = [];
            const context = await prepareHost(observedRuntimeCollection(function recordCollection(event) {
                events.push(event);
            }));
            const { definition } = catalogFacts(context.catalog);
            const { checkpoint } = definition;
            if (checkpoint === null) {
                throw new Error('Missing frozen checkpoint.');
            }
            const changed = field === 'preparation'
                ? { ...checkpoint, preparation: { ...checkpoint.preparation, preparation: 'changed' } }
                : { ...checkpoint, catalog: 'changed' };
            await scope.assert.rejects(async function collectChangedFamily() {
                await registerImportedHostFamilyPlan(context.source, context.engine, context.binding, {
                    ...definition,
                    checkpoint: changed,
                    selection: [ context.catalog.cases[0].workId ]
                });
            }, { message: `Frozen family ${field} changed; collect a new run.` });
            scope.assert.deepEqual(events, []);
            return scope.assert.collect();
        });
    }),
    authoredTest('retains catalog provenance when a replay plan replaces the prepared plan', async function (scope) {
        const { catalog } = await prepareHost(runtimeFamily);
        const replay = { ...catalog };
        scope.assert.equal(familyCatalog(replay), null);
        scope.assert.equal(transferHostFamilyPlan(catalog, replay), replay);
        scope.assert.equal(familyCatalog(replay), familyCatalog(catalog));
        return scope.assert.collect();
    }),
    authoredTest('leaves ordinary source plans without imported family metadata', function (scope) {
        const { source } = hostScenario(runtimeFamily);
        const selected = { ...source };
        scope.assert.equal(transferHostFamilyPlan(source, selected), selected);
        scope.assert.equal(familyCatalog(selected), null);
        return scope.assert.collect();
    })
]);
