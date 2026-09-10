import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { orderedRunCases } from './run-selection.ts';
import type { ResolvedRun, RunCommand, RunConfig, RunRequest } from './run-types.ts';

const selectionFixturePath = 'source/integration-tests/run/fixtures/selection.test.ts';

const localConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process', scheduling: 'serial' },
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const supervisedConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'supervised-process', scheduling: 'serial' },
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const sourceOrder = [ 'charges card', 'refunds card', 'query row', 'other query row' ];
const singleCase = {
    id: {
        file: 'a.test.ts',
        params: null,
        suite: [],
        title: 'a'
    }
} as const;

function runRequest(order: RunRequest['order'], seed: bigint): RunRequest {
    return defaultRunRequest({
        order,
        paths: [ selectionFixturePath ],
        seed: { value: seed }
    });
}

function runCommand(config: RunConfig, request: RunRequest): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request
    };
}

function caseTitles(resolvedRun: ResolvedRun): readonly string[] {
    return resolvedRun.facts.cases.map(function toTitle(testCase) {
        return testCase.id.title;
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-ordering.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() keeps source-stable order for lexical requests',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(runCommand(
                    localConfig,
                    runRequest('lexical', 1n)
                ));

                scope.assert.deepEqual(caseTitles(resolvedRun), sourceOrder);
                scope.assert.equal(resolvedRun.facts.execution.order, 'lexical');
                scope.assert.equal(resolvedRun.facts.reproducibility.seed, '1');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() applies repeatable seeded ordering',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const firstRun = await runOrchestrator.resolve(
                    runCommand(localConfig, runRequest('seeded', 1n))
                );
                const repeatedRun = await runOrchestrator.resolve(
                    runCommand(localConfig, runRequest('seeded', 1n))
                );
                const otherRun = await runOrchestrator.resolve(
                    runCommand(localConfig, runRequest('seeded', 2n))
                );

                scope.assert.deepEqual(caseTitles(firstRun), [
                    'other query row',
                    'refunds card',
                    'charges card',
                    'query row'
                ]);
                scope.assert.deepEqual(caseTitles(firstRun), caseTitles(repeatedRun));
                scope.assert.notDeepEqual(caseTitles(firstRun), caseTitles(otherRun));
                scope.assert.notDeepEqual(caseTitles(firstRun), sourceOrder);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() executes supervised assignments in ordered fact order',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const request = runRequest('seeded', 1n);
                const expectedRun = await runOrchestrator.resolve(runCommand(supervisedConfig, request));
                const result = await runOrchestrator.run(runCommand(supervisedConfig, request));

                scope.assert.deepEqual(
                    result.perTest.map(function toTitle(testCase) {
                        return testCase.id.title;
                    }),
                    caseTitles(expectedRun)
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orderedRunCases() rejects seeded order without a resolved seed',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.throws(
                    function orderWithUnresolvedSeed() {
                        orderedRunCases([ singleCase ], 'seeded', { value: null });
                    },
                    { message: 'Seeded ordering requires a resolved run seed.' }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orderedRunCases() rejects sparse seeded case arrays',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const sparseCases = [ singleCase, singleCase ];
                sparseCases.length = 3;

                scope.assert.throws(
                    function orderSparseCases() {
                        orderedRunCases(sparseCases, 'seeded', { value: 1n });
                    },
                    { message: 'Seeded ordering selected an invalid case index.' }
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
