import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { ResolvedRun, RunCommand, RunConfig, RunFilter, RunRequest } from './run-types.ts';
import {
    caseId,
    file,
    owner,
    params,
    runtime,
    stability,
    suite,
    tag,
    title
} from './run-selection-filters.ts';

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
        paths: [ selectionFixturePath ],
        selection: { filter, kind: 'filter' }
    });
}

function selectedCaseTitles(resolvedRun: ResolvedRun): readonly string[] {
    return resolvedRun.facts.cases.map(function toCaseTitle(testCase) {
        return testCase.id.title;
    });
}

export const testSuite = createOverkillSuite({
    title: 'source/run/run-selection.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'orchestrator.resolve() selects local test cases by stable filter dimensions',
            metadata: {},
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
                    { filter: runtime('browser'), titles: [ 'refunds card' ] },
                    { filter: owner('@search'), titles: [ 'query row' ] },
                    { filter: stability('flaky'), titles: [ 'refunds card' ] },
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
            title: 'orchestrator.resolve() rejects local filters that match no cases',
            metadata: {},
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
            title: 'orchestrator.run() returns a zero-plan result when local selection matches no cases',
            metadata: {},
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
            title: 'orchestrator.run() executes selected supervised cases and preserves discovered counts',
            metadata: {},
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
            title: 'orchestrator.run() returns a zero-plan result when supervised selection matches no cases',
            metadata: {},
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
