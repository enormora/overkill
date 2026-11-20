import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { isolatedWorkerRun, passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { workerOrchestrationFaults } from '../test-support/worker-pool-orchestration.ts';

import { createIsolatedResolvedRun, runIsolatedProcessCommand } from './run-isolated-process.ts';

export const testNode: TestNode = suite('isolated worker run planning and execution', [
    table({
        title: 'resolves worker plans from in-memory collection',
        cases: [ false, true ] as const,
        caseTitle(timed) {
            return `${timed}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const timed = scope.parameters;

            const fixture = passingIsolatedWorkerRun(timed, false);
            const pending = createIsolatedResolvedRun(
                fixture.command,
                fixture.dependencies,
                fixture.input,
                fixture.options
            );
            require.defined(pending);
            const resolved = await pending;
            scope.assert.equal(resolved.plan.kind, 'worker-pool');
            scope.assert.equal(resolved.facts.cases.length, 1);
            scope.assert.equal(resolved.facts.execution.processModel, 'worker-pool');
            scope.assert.equal(fixture.events.at(-1), 'destroy');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'executes isolated workers across timing and history policies',
        cases: ([ false, true ] as const).flatMap(function (timed) {
            return [ false, true ].map(function (history) {
                return ({
                    caseDescription: `${timed}, ${history}`,
                    timed,
                    history
                });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { timed, history } = scope.parameters;

            const require: typeof scope.require = scope.require;

            const fixture = passingIsolatedWorkerRun(timed, history);
            const pending = runIsolatedProcessCommand(fixture.command, fixture.dependencies, {
                ...fixture.options,
                signal: null
            }, fixture.input);
            require.defined(pending);
            const result = await pending;
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(result.perTest.length, 1);
            scope.assert.equal(
                result.perTest[0]?.id.file,
                'source/integration-tests/integration/fixtures/passing.test.ts'
            );
            scope.assert.equal(
                fixture
                    .events
                    .filter(function (value) {
                        return value === 'run';
                    })
                    .length,
                1
            );
            scope.assert.equal(fixture.events.at(-1), 'destroy');
            return scope.assert.collect();
        }
    }),
    test('reports collection failures without executing worker units', async function (scope: TestScope) {
        const fixture = isolatedWorkerRun(
            { ...workerOrchestrationFaults, collection: new Error('collection failed') },
            false,
            false
        );
        const pending = runIsolatedProcessCommand(fixture.command, fixture.dependencies, {
            ...fixture.options,
            signal: null
        }, fixture.input);
        scope.require.defined(pending);
        const result = await pending;
        scope.assert.equal(result.status, 'failed');
        scope.assert.partialDeepEqual(result.runnerErrors, [ {
            subtype: 'loader',
            message: 'Worker-pool collection failed.'
        } ]);
        scope.assert.false(fixture.events.includes('run'));
        scope.assert.equal(fixture.events.at(-1), 'destroy');
        return scope.assert.collect();
    })
]);
