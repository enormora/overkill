import { table, suite, test } from '@overkill-dev/test';

import { workerPoolOrchestration, workerOrchestrationFaults } from '../test-support/worker-pool-orchestration.ts';

import { executeWorkerPoolRun, collectWorkerPoolRun, runWorkerPoolCommand } from './worker-pool-run.ts';

export const testNode = suite('memory worker-pool orchestration', [
    table({
        title: 'executes and releases newly owned pools',
        cases: [ false, true ] as const,
        caseTitle: String,
        async test(scope) {
            const timed = scope.parameters;

            const fixture = workerPoolOrchestration(workerOrchestrationFaults, timed);
            const result = await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            scope.assert.equal(fixture.created.length, 1);
            scope.assert.deepEqual(fixture.events, [ 'output:observe', 'run', 'output:clear', 'destroy' ]);
            scope.assert.equal(fixture.completions.length, 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'collects and releases separate collection pools',
        cases: [ false, true ] as const,
        caseTitle: String,
        async test(scope) {
            const timed = scope.parameters;

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
    }),
    table({
        title: 'owns collection and execution pools across host modes',
        cases: ([ false, true ] as const).flatMap(function (timed) {
            return ([ 'direct', 'child' ] as const).map(function (host) {
                return { timed, host };
            });
        }),
        caseTitle({ timed, host }) {
            return [ host, timed ].map(String).join(', ');
        },
        async test(scope) {
            const { timed, host } = scope.parameters;

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
    }),
    test('releases a collection pool when collection fails', async function (scope) {
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
    test(
        'stops after repeated worker crashes and still releases its owned pool',
        async function (scope) {
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
        }
    ),
    test('releases its pool after finalization fails', async function (scope) {
        const error = new Error('finalization failed');
        const fixture = workerPoolOrchestration({ ...workerOrchestrationFaults, finalization: error }, false);
        await scope.assert.rejects(async function () {
            await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
        }, { exact: error });
        scope.assert.equal(fixture.events.at(-1), 'destroy');
        return scope.assert.collect();
    }),
    test('preserves owned pool destruction failures', async function (scope) {
        const error = new Error('destruction failed');
        const fixture = workerPoolOrchestration({ ...workerOrchestrationFaults, destruction: error }, false);
        await scope.assert.rejects(async function () {
            await executeWorkerPoolRun(fixture.resolved, fixture.dependencies, fixture.options);
        }, { exact: error });
        scope.assert.equal(fixture.completions.length, 1);
        return scope.assert.collect();
    })
]);
