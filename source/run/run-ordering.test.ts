import { type TestNode, suite, test } from '@overkill-dev/test';

import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';

import { orderedRunItems } from './run-ordering.ts';
import type { ResolvedRun, RunCommand, RunRequest } from './run-types.ts';

const selectionFixturePath = 'source/integration-tests/integration/fixtures/selection.test.ts';

const localConfig: NormalizedConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process', scheduling: 'serial' },
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const supervisedConfig: NormalizedConfig = defaultRunConfig({
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

function runCommand(config: NormalizedConfig, request: RunRequest): RunCommand {
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

export const testNode: TestNode = suite('Run ordering', [
    test(
        'orchestrator.resolve() keeps source-stable order for lexical requests',
        async function (scope) {
            const runOrchestrator = createUnitRunOrchestrator();
            const resolvedRun = await runOrchestrator.resolve(runCommand(
                localConfig,
                runRequest('lexical', 1n)
            ));

            scope.assert.deepEqual(caseTitles(resolvedRun), sourceOrder);
            scope.assert.equal(resolvedRun.facts.execution.order, 'lexical');
            scope.assert.equal(resolvedRun.facts.reproducibility.seed, '1');

            return scope.assert.collect();
        }
    ),
    test('orchestrator.resolve() applies repeatable seeded ordering', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();
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
    }),
    test(
        'orchestrator.run() executes supervised assignments in ordered fact order',
        async function (scope) {
            const runOrchestrator = createUnitRunOrchestrator();
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
    ),
    test('orderedRunItems() rejects seeded order without a resolved seed', function (scope) {
        scope.assert.throws(
            function orderWithUnresolvedSeed() {
                orderedRunItems([ singleCase ], 'seeded', { value: null });
            },
            { message: 'Seeded ordering requires a resolved run seed.' }
        );

        return scope.assert.collect();
    }),
    test('orderedRunItems() rejects sparse seeded case arrays', function (scope) {
        const sparseCases = [ singleCase, singleCase ];
        sparseCases.length = 3;

        scope.assert.throws(
            function orderSparseCases() {
                orderedRunItems(sparseCases, 'seeded', { value: 1n });
            },
            { message: 'Seeded ordering selected an invalid case index.' }
        );

        return scope.assert.collect();
    })
]);
