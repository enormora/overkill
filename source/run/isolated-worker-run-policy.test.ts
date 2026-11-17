import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { isolatedWorkerRun, passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { workerOrchestrationFaults } from '../test-support/worker-pool-orchestration.ts';
import { testNode as finalization } from './isolated-run-finalization-policy.test.ts';
import { testNode as families } from './selected-family-facts-policy.test.ts';
import { createIsolatedResolvedRun, runIsolatedProcessCommand } from './run-isolated-process.ts';

export const testNode = suite('isolated worker run planning and execution', [
    finalization,
    families,
    ...([ false, true ] as const).map(function (timed) {
        return test(
            `resolves a worker execution plan from memory collection with timing ${timed}`,
            async function (scope: TestScope) {
                const fixture = passingIsolatedWorkerRun(timed, false);
                const pending = createIsolatedResolvedRun(
                    fixture.command,
                    fixture.dependencies,
                    fixture.input,
                    fixture.options
                );
                scope.require.defined(pending);
                const resolved = await pending;
                scope.assert.equal(resolved.plan.kind, 'worker-pool');
                scope.assert.equal(resolved.facts.cases.length, 1);
                scope.assert.equal(resolved.facts.execution.processModel, 'worker-pool');
                scope.assert.equal(fixture.events.at(-1), 'destroy');
                return scope.assert.collect();
            }
        );
    }),
    ...([ false, true ] as const).flatMap(function (timed) {
        return [ false, true ].map(function (history) {
            return test(
                `executes isolated worker results with timing ${timed} and duration history ${history}`,
                async function (scope: TestScope) {
                    const fixture = passingIsolatedWorkerRun(timed, history);
                    const pending = runIsolatedProcessCommand(fixture.command, fixture.dependencies, {
                        ...fixture.options,
                        signal: null
                    }, fixture.input);
                    scope.require.defined(pending);
                    const result = await pending;
                    scope.assert.equal(result.status, 'passed');
                    scope.assert.equal(result.perTest.length, 1);
                    scope.assert.equal(
                        result.perTest[0]?.id.file,
                        'source/integration-tests/run/fixtures/passing.test.ts'
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
            );
        });
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
await runIfMain(import.meta, testNode);
