import {
    attachTestBodyResourceAttachments,
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    stampTestNodeFamily,
    type TestCase,
    type TestBodyResourceAttachments,
    type TestPlan,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { RunFilter } from './run-request-types.ts';
import type { ResolvedRun, RunCommand, RunConfig, RunRequest } from './run-types.ts';
import {
    caseId,
    file,
    owner,
    params,
    runtimeScenario,
    suite,
    tag,
    title
} from './run-selection-filters.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import {
    assertCollectedRunPlanMatchesTestFamily,
    assertTestPlanMatchesTestFamily,
    selectedCollectedRunPlan,
    selectedTestPlan
} from './run-selection.ts';
import { expandRuntimeMatrices } from './runtime-matrix-expansion.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};
type SelectionScenario = {
    readonly filter: RunFilter;
    readonly titles: readonly string[];
};

const selectionFixturePath = 'source/integration-tests/run/fixtures/selection.test.ts';

const localSelectionConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process', scheduling: 'serial' },
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const supervisedSelectionConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const microtestResourceDescriptorError = 'Run profile "microtest" cannot run test cases with resource descriptors.';

function directResourceAttachments(): TestBodyResourceAttachments {
    return {
        directResources: [ { key: 'database', resourceName: 'database' } ],
        resourceGraph: [],
        runtimeGraphs: []
    };
}

function graphOnlyResourceAttachments(): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: [
            {
                dependencies: [],
                handleTransport: 'local',
                name: 'database',
                requirements: [],
                scenarios: [],
                scope: 'per-case'
            }
        ],
        runtimeGraphs: []
    };
}

function runtimeResourceAttachments(): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: [
            {
                dimensions: {},
                name: 'api',
                requirements: [],
                scenarioBindings: [],
                resources: [ { key: 'database', resourceName: 'database' } ]
            }
        ]
    };
}

function pureRuntimeAttachments(): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: [
            {
                dimensions: { node: '26' },
                name: 'node',
                requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ],
                scenarioBindings: [],
                resources: []
            }
        ]
    };
}

function scenarioRuntimeAttachments(value: string): TestBodyResourceAttachments {
    return {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: [ {
            dimensions: {},
            name: 'api',
            requirements: [],
            resources: [],
            scenarioBindings: [ {
                default: 'default',
                name: 'api',
                owner: { path: [ 'api' ], resourceName: 'api' },
                timing: 'request-routed',
                value,
                values: [ 'default', 'payments-500' ]
            } ]
        } ]
    };
}

function testCaseWithAttachments(attachments: TestBodyResourceAttachments): TestCase {
    return createOverkillTestCase({
        annotations: {},
        body: attachTestBodyResourceAttachments(function attachedBody(scope: OverkillScope) {
            scope.assert.true(true);

            return scope.assert.collect();
        }, attachments),
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'uses metadata'
    });
}

function testPlanForCase(testCase: TestCase): TestPlan {
    return createTestPlan(createRoot({
        annotations: {},
        children: [ testCase ],
        controls: {},
        title: 'root'
    }));
}

function testPlanWithAttachments(attachments: TestBodyResourceAttachments): TestPlan {
    return testPlanForCase(testCaseWithAttachments(attachments));
}

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function selectionRequest(filter: RunFilter): RunRequest {
    return defaultRunRequest({
        order: 'lexical',
        paths: [ selectionFixturePath ],
        selection: { filter, kind: 'filter' }
    });
}

function selectedCaseTitles(resolvedRun: ResolvedRun): readonly string[] {
    return resolvedRun.facts.cases.map(function toCaseTitle(testCase) {
        return testCase.id.title;
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-selection.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertTestPlanMatchesTestFamily() rejects microtest cases with resource descriptors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                for (
                    const attachments of [
                        directResourceAttachments(),
                        graphOnlyResourceAttachments(),
                        runtimeResourceAttachments()
                    ]
                ) {
                    scope.assert.throws(function assertResourceDescriptors() {
                        assertTestPlanMatchesTestFamily(testPlanWithAttachments(attachments), 'microtest');
                    }, {
                        message: microtestResourceDescriptorError,
                        name: 'RunCollectionError'
                    });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertTestPlanMatchesTestFamily() accepts pure runtime descriptors for microtests',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const testPlan = testPlanWithAttachments(pureRuntimeAttachments());

                assertTestPlanMatchesTestFamily(testPlan, 'microtest');
                scope.assert.equal(testPlan.discoveredCases.length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertCollectedRunPlanMatchesTestFamily() rejects collected microtest resource descriptors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                for (
                    const attachments of [
                        directResourceAttachments(),
                        graphOnlyResourceAttachments(),
                        runtimeResourceAttachments()
                    ]
                ) {
                    scope.assert.throws(function assertCollectedResourceDescriptors() {
                        assertCollectedRunPlanMatchesTestFamily(
                            collectedRunPlanFromTestPlan(testPlanWithAttachments(attachments)),
                            'microtest'
                        );
                    }, {
                        message: microtestResourceDescriptorError,
                        name: 'RunCollectionError'
                    });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertCollectedRunPlanMatchesTestFamily() accepts collected pure runtime descriptors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const collectedPlan = collectedRunPlanFromTestPlan(testPlanWithAttachments(pureRuntimeAttachments()));

                assertCollectedRunPlanMatchesTestFamily(collectedPlan, 'microtest');
                scope.assert.equal(collectedPlan.discoveredFiles.length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertTestPlanMatchesTestFamily() reports family mismatch before resource descriptors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const testCase = testCaseWithAttachments(runtimeResourceAttachments());
                stampTestNodeFamily(testCase, 'integration');

                scope.assert.throws(function assertFamilyMismatch() {
                    assertTestPlanMatchesTestFamily(testPlanForCase(testCase), 'microtest');
                }, {
                    message: 'Run profile "microtest" cannot run test case authored for "integration".',
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() selects local test cases by stable filter dimensions',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const allCases = await runOrchestrator.resolve(createRunCommand({
                    config: localSelectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({ paths: [ selectionFixturePath ] })
                }));
                const queryCase = allCases.facts.cases.find(function findQueryCase(testCase) {
                    return testCase.id.title === 'query row';
                });
                scope.require.defined(queryCase);

                const scenarios: readonly SelectionScenario[] = [
                    {
                        filter: file('source/integration-tests/run/fixtures/*.test.ts'),
                        titles: [ 'charges card', 'refunds card', 'query row', 'other query row' ]
                    },
                    { filter: title('CHARGES'), titles: [ 'charges card' ] },
                    { filter: suite('PAYMENTS'), titles: [ 'charges card', 'refunds card' ] },
                    { filter: params('alpha'), titles: [ 'query row' ] },
                    { filter: tag('fast'), titles: [ 'charges card' ] },
                    { filter: owner('@search'), titles: [ 'query row' ] },
                    { filter: caseId(queryCase.id), titles: [ 'query row' ] }
                ];

                for (const scenario of scenarios) {
                    const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                        config: localSelectionConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: selectionRequest(scenario.filter)
                    }));

                    scope.assert.deepEqual(selectedCaseTitles(resolvedRun), scenario.titles);
                    scope.assert.deepEqual(resolvedRun.facts.reproducibility.selection, {
                        filter: scenario.filter,
                        kind: 'filter'
                    });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runtime scenario filters select expanded local and collected cases',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const expanded = expandRuntimeMatrices(testPlanWithAttachments(
                    scenarioRuntimeAttachments('payments-500')
                ));
                const selection = {
                    filter: runtimeScenario('api', 'api', 'payments-500'),
                    kind: 'filter' as const
                };
                const local = selectedTestPlan(expanded, selection);
                const collected = selectedCollectedRunPlan(collectedRunPlanFromTestPlan(expanded), selection);

                scope.assert.equal(local.cases.length, 1);
                scope.assert.equal(collected.files[0]?.cases.length, 1);
                const selectedRuntime = local.cases[0].workId.runtimes[0];

                scope.require.defined(selectedRuntime);
                scope.assert.deepEqual(selectedRuntime.scenarios, {
                    api: 'payments-500'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects local filters that match no cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveMissingSelection() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: localSelectionConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: selectionRequest(title('missing'))
                    }));
                }, { message: 'Run selection matched no test cases.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() returns a zero-plan result when local selection matches no cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: localSelectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: selectionRequest(title('missing'))
                }));

                scope.assert.deepEqual(result.perTest, []);
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 5,
                    discovered: 4,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 0,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(result.bySuite, {
                    'selection fixture': { discovered: 4, executed: 0, planned: 0 },
                    'selection fixture > payments': { discovered: 2, executed: 0, planned: 0 },
                    'selection fixture > search rows': { discovered: 2, executed: 0, planned: 0 }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() executes selected supervised cases and preserves discovered counts',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: supervisedSelectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: selectionRequest(tag('fast'))
                }));

                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.deepEqual(
                    result.perTest.map(function toCaseTitle(testCase) {
                        return testCase.id.title;
                    }),
                    [ 'charges card' ]
                );
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 5,
                    discovered: 4,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(result.bySuite, {
                    'selection fixture': { discovered: 4, executed: 1, planned: 1 },
                    'selection fixture > payments': { discovered: 2, executed: 1, planned: 1 },
                    'selection fixture > search rows': { discovered: 2, executed: 0, planned: 0 }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() returns a zero-plan result when supervised selection matches no cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: supervisedSelectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: selectionRequest(title('missing'))
                }));

                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.deepEqual(result.perTest, []);
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 5,
                    discovered: 4,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 0,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
