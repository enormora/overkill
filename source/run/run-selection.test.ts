import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { subjectTestNode } from '../test-support/create-test-engine.ts';

import type {
    NormalizedConfig,
    ResolvedRun,
    RunCommand,
    RunRequest,
    RunFilter
} from '../packages/run/run.entry-point.ts';
import {
    attachTestBodyResourceAttachments,
    stampTestNodeFamily,
    type TestCase,
    type TestBodyResourceAttachments,
    type TestPlan,
    createRoot,
    createTestPlan
} from '../packages/engine/engine.entry-point.ts';

import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';

import { expandRuntimeMatrices } from '../engine/runtime-matrix-expansion.ts';

import {
    caseId,
    file,
    owner,
    params,
    runtimeScenario,
    suite as subjectSuite,
    tag,
    title
} from './run-selection-filters.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import {
    selectedCollectedRunPlan,
    selectedTestPlan,
    assertCollectedRunPlanMatchesTestFamily,
    assertTestPlanMatchesTestFamily
} from './run-selection.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};
type SelectionScenario = {
    readonly filter: RunFilter;
    readonly titles: readonly string[];
};

const selectionFixturePath = 'source/integration-tests/integration/fixtures/selection.test.ts';

const localSelectionConfig: NormalizedConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process', scheduling: 'serial' },
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const supervisedSelectionConfig: NormalizedConfig = defaultRunConfig({
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
                workload: 'independent' as const,
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
    return subjectTestNode(test(
        'uses metadata',
        attachTestBodyResourceAttachments(function attachedBody(scope: TestScope) {
            scope.assert.true(true);

            return scope.assert.collect();
        }, attachments)
    ));
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

export const testNode: TestNode = suite('Run selection', [
    test(
        'assertTestPlanMatchesTestFamily() rejects microtest cases with resource descriptors',
        function (scope) {
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
    ),
    test(
        'assertTestPlanMatchesTestFamily() accepts pure runtime descriptors for microtests',
        function (scope) {
            const testPlan = testPlanWithAttachments(pureRuntimeAttachments());

            assertTestPlanMatchesTestFamily(testPlan, 'microtest');
            scope.assert.equal(testPlan.discoveredCases.length, 1);

            return scope.assert.collect();
        }
    ),
    test(
        'assertCollectedRunPlanMatchesTestFamily() rejects collected microtest resource descriptors',
        function (scope) {
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
    ),
    test(
        'assertCollectedRunPlanMatchesTestFamily() accepts collected pure runtime descriptors',
        function (scope) {
            const collectedPlan = collectedRunPlanFromTestPlan(testPlanWithAttachments(pureRuntimeAttachments()));

            assertCollectedRunPlanMatchesTestFamily(collectedPlan, 'microtest');
            scope.assert.equal(collectedPlan.discoveredFiles.length, 1);

            return scope.assert.collect();
        }
    ),
    test(
        'assertTestPlanMatchesTestFamily() reports family mismatch before resource descriptors',
        function (scope) {
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
    ),
    test(
        'orchestrator.resolve() selects local test cases by stable filter dimensions',
        async function (scope: TestScope) {
            const runOrchestrator = createUnitRunOrchestrator();
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
                    filter: file('source/integration-tests/integration/fixtures/*.test.ts'),
                    titles: [ 'charges card', 'refunds card', 'query row', 'other query row' ]
                },
                { filter: title('CHARGES'), titles: [ 'charges card' ] },
                { filter: subjectSuite('PAYMENTS'), titles: [ 'charges card', 'refunds card' ] },
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
    ),
    test('runtime scenario filters select expanded local and collected cases', function (scope: TestScope) {
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
    }),
    test('orchestrator.resolve() rejects local filters that match no cases', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();

        await scope.assert.rejects(async function resolveMissingSelection() {
            await runOrchestrator.resolve(createRunCommand({
                config: localSelectionConfig,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: selectionRequest(title('missing'))
            }));
        }, { message: 'Run selection matched no test cases.' });

        return scope.assert.collect();
    }),
    test(
        'orchestrator.run() returns a zero-plan result when local selection matches no cases',
        async function (scope) {
            const runOrchestrator = createUnitRunOrchestrator();
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
                processExhausted: 0,
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
    ),
    test(
        'orchestrator.run() executes selected supervised cases and preserves discovered counts',
        async function (scope) {
            const runOrchestrator = createUnitRunOrchestrator();
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
                processExhausted: 0,
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
    ),
    test(
        'orchestrator.run() returns a zero-plan result when supervised selection matches no cases',
        async function (scope) {
            const runOrchestrator = createUnitRunOrchestrator();
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
                processExhausted: 0,
                runtimePolicy: 0,
                skipped: 0
            });

            return scope.assert.collect();
        }
    )
]);
