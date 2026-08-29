import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
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
    name,
    owner,
    params,
    runtime,
    stability,
    suite,
    tag
} from './run-selection-filters.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

type SelectionScenario = {
    readonly filter: RunFilter;
    readonly names: readonly string[];
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

function selectedCaseNames(resolvedRun: ResolvedRun): readonly string[] {
    return resolvedRun.facts.cases.map(function toCaseName(testCase) {
        return testCase.id.name;
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-selection.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() selects local test cases by stable filter dimensions',
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
                    return testCase.id.name === 'query row';
                });
                scope.require.defined(queryCase);

                const scenarios: readonly SelectionScenario[] = [
                    {
                        filter: file('source/integration-tests/run/fixtures/*.test.ts'),
                        names: [ 'charges card', 'refunds card', 'query row' ]
                    },
                    { filter: name('CHARGES'), names: [ 'charges card' ] },
                    { filter: suite('PAYMENTS'), names: [ 'charges card', 'refunds card' ] },
                    { filter: params('alpha'), names: [ 'query row' ] },
                    { filter: tag('fast'), names: [ 'charges card' ] },
                    { filter: runtime('browser'), names: [ 'refunds card' ] },
                    { filter: owner('@search'), names: [ 'query row' ] },
                    { filter: stability('flaky'), names: [ 'refunds card' ] },
                    { filter: caseId(queryCase.id), names: [ 'query row' ] }
                ];

                for (const scenario of scenarios) {
                    const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                        config: localSelectionConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: selectionRequest(scenario.filter)
                    }));

                    scope.assert.deepEqual(selectedCaseNames(resolvedRun), scenario.names);
                    scope.assert.deepEqual(resolvedRun.facts.reproducibility.selection, {
                        filter: scenario.filter,
                        kind: 'filter'
                    });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects local filters that match no cases',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveMissingSelection() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: localSelectionConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: selectionRequest(name('missing'))
                    }));
                }, { message: 'Run selection matched no test cases.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() returns a zero-plan result when local selection matches no cases',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: localSelectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: selectionRequest(name('missing'))
                }));

                scope.assert.deepEqual(result.perTest, []);
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 5,
                    discovered: 3,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 0,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(result.bySuite, {
                    'selection fixture': { discovered: 3, executed: 0, planned: 0 },
                    'selection fixture > payments': { discovered: 2, executed: 0, planned: 0 },
                    'selection fixture > search rows': { discovered: 1, executed: 0, planned: 0 }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() executes selected supervised cases and preserves discovered counts',
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
                    result.perTest.map(function toCaseName(testCase) {
                        return testCase.id.name;
                    }),
                    [ 'charges card' ]
                );
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 5,
                    discovered: 3,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(result.bySuite, {
                    'selection fixture': { discovered: 3, executed: 1, planned: 1 },
                    'selection fixture > payments': { discovered: 2, executed: 1, planned: 1 },
                    'selection fixture > search rows': { discovered: 1, executed: 0, planned: 0 }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() returns a zero-plan result when supervised selection matches no cases',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: supervisedSelectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: selectionRequest(name('missing'))
                }));

                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.deepEqual(result.perTest, []);
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 5,
                    discovered: 3,
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
