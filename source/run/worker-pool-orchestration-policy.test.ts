import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { workerPoolOrchestration, workerOrchestrationFaults } from '../test-support/worker-pool-orchestration.ts';
import { testNode as idle } from './idle-worker-runtime-policy.test.ts';
import { testNode as isolated } from './isolated-worker-run-policy.test.ts';
import { testNode as placement } from './worker-placement-execution-policy.test.ts';
import { executeWorkerPoolRun, collectWorkerPoolRun, runWorkerPoolCommand } from './worker-pool-run.ts';

export const testNode = suite('memory worker-pool orchestration', [
    idle,
    placement,
    isolated,
    ...([ false, true ] as const).map(function (timed) {
        return test(`executes and releases a newly owned pool with timing ${timed}`, async function (scope: TestScope) {
            const fixture = workerPoolOrchestration(workerOrchestrationFaults, timed);
            const result = await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            scope.assert.equal(fixture.created.length, 1);
            scope.assert.deepEqual(fixture.events, [ 'output:observe', 'run', 'output:clear', 'destroy' ]);
            scope.assert.equal(fixture.completions.length, 1);
            return scope.assert.collect();
        });
    }),
    ...([ false, true ] as const).map(function (timed) {
        return test(
            `collects and releases a separate collection pool with timing ${timed}`,
            async function (scope: TestScope) {
                const fixture = workerPoolOrchestration(workerOrchestrationFaults, timed);
                const result = await collectWorkerPoolRun(
                    fixture.command,
                    fixture.dependencies,
                    fixture.options.timing
                );
                scope.assert.equal(result.collectedPlan.defined, 1);
                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.equal(fixture.created.length, 1);
                scope.assert.deepEqual(fixture.events, [ 'output:observe', 'collect', 'output:clear', 'destroy' ]);
                return scope.assert.collect();
            }
        );
    }),
    ...([ false, true ] as const).flatMap(function (timed) {
        return ([ 'direct', 'child' ] as const).map(function (host) {
            return test(
                `owns ${host} collection and execution pools with timing ${timed}`,
                async function (scope: TestScope) {
                    const fixture = workerPoolOrchestration(workerOrchestrationFaults, timed);
                    const result = await runWorkerPoolCommand(
                        {
                            ...fixture.command,
                            hostProcess: host === 'direct' ? { kind: 'direct' } : { kind: 'child', nodeArguments: [] }
                        },
                        fixture.dependencies,
                        async function (collection) {
                            scope.assert.equal(collection.collectedPlan.defined, 1);
                            return fixture.resolved;
                        },
                        fixture.options
                    );
                    scope.assert.equal(result.status, 'passed');
                    scope.assert.equal(fixture.created.length, host === 'child' ? 1 : 2);
                    scope.assert.equal(
                        fixture
                            .events
                            .filter(function (value) {
                                return value === 'destroy';
                            })
                            .length,
                        host === 'child' ? 1 : 2
                    );
                    scope.assert.equal(fixture.completions.length, 1);
                    return scope.assert.collect();
                }
            );
        });
    }),
    test('releases a collection pool when collection fails', async function (scope: TestScope) {
        const fixture = workerPoolOrchestration({
            ...workerOrchestrationFaults,
            collection: new Error('import failed')
        }, false);
        await scope.assert.rejects(async function () {
            await collectWorkerPoolRun(fixture.command, fixture.dependencies, null);
        }, { message: 'Worker-pool collection failed.' });
        scope.assert.deepEqual(fixture.events, [ 'output:observe', 'collect', 'output:clear', 'destroy' ]);
        return scope.assert.collect();
    }),
    test('stops after repeated worker crashes and still releases its owned pool', async function (scope: TestScope) {
        const fixture = workerPoolOrchestration(
            { ...workerOrchestrationFaults, execution: new Error('worker failed') },
            false
        );
        const result = await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function (error) {
            return error.message === 'Worker-pool stopped after 3 worker crashes.';
        }));
        scope.assert.equal(
            fixture
                .events
                .filter(function (value) {
                    return value === 'run';
                })
                .length,
            3
        );
        scope.assert.equal(fixture.events.at(-1), 'destroy');
        return scope.assert.collect();
    }),
    test('releases its pool after finalization fails', async function (scope: TestScope) {
        const error = new Error('finalization failed');
        const fixture = workerPoolOrchestration({ ...workerOrchestrationFaults, finalization: error }, false);
        await scope.assert.rejects(async function () {
            await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
        }, { exact: error });
        scope.assert.equal(fixture.events.at(-1), 'destroy');
        return scope.assert.collect();
    }),
    test('preserves owned pool destruction failures', async function (scope: TestScope) {
        const error = new Error('destruction failed');
        const fixture = workerPoolOrchestration({ ...workerOrchestrationFaults, destruction: error }, false);
        await scope.assert.rejects(async function () {
            await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
        }, { exact: error });
        scope.assert.equal(fixture.completions.length, 1);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
