import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { workerTaskOutput } from '../test-support/worker-task-output.ts';

import { createCollectedPlan, createTaskRun, fakeWorkerRuntime } from '../test-support/worker-pool-execution-state.ts';
import { recordBatchStarted, recordBatchCompleted } from './worker-pool-task-events.ts';

export const testNode = authoredSuite('worker task output and batch boundaries', [
    ...([ 'stdout', 'stderr' ] as const).flatMap(function (stream) {
        return ([ 'buffered', 'live' ] as const).map(function (capture) {
            return authoredTest(`delivers ${capture} ${stream} output`, function (scope: TestScope) {
                const fixture = workerTaskOutput(capture);
                fixture.deliver(stream);
                scope.assert.deepEqual(fixture.live, capture === 'live' ? [ `${stream}:worker output` ] : []);
                scope.assert.equal(fixture.artifacts().length, capture === 'live' ? 0 : 1);
                scope.assert.partialDeepEqual<unknown, unknown>(
                    fixture.artifacts(),
                    capture === 'live'
                        ? []
                        : [ { payload: { kind: 'captured-output', stream, text: 'worker output' } } ]
                );
                return scope.assert.collect();
            });
        });
    }),
    authoredTest('records matching batch boundaries for every assigned attempt', function (scope: TestScope) {
        const runtime = fakeWorkerRuntime(createCollectedPlan());
        const task = createTaskRun(runtime.runState);
        task.envelopeId.write('envelope-1');
        recordBatchStarted(task, runtime);
        recordBatchCompleted(task, runtime);
        scope.assert.partialDeepEqual(runtime.placementTrace.entries(), [ {
            kind: 'batch-started',
            attempts: [ 'attempt-1' ],
            envelopeId: 'envelope-1',
            lane: 'worker-1'
        }, { kind: 'batch-completed', attempts: [ 'attempt-1' ], envelopeId: 'envelope-1', lane: 'worker-1' } ]);
        return scope.assert.collect();
    }),
    authoredTest('omits batch boundaries for individual task dispatch', function (scope: TestScope) {
        const runtime = fakeWorkerRuntime(createCollectedPlan());
        const task = createTaskRun(runtime.runState);
        recordBatchStarted(task, runtime);
        recordBatchCompleted(task, runtime);
        scope.assert.deepEqual(runtime.placementTrace.entries(), []);
        return scope.assert.collect();
    })
]);
