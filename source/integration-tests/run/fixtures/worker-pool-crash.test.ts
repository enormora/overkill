import { isMainThread } from 'node:worker_threads';
import { createTestFacade } from '../../../packages/test/test.entry-point.ts';

const integration = createTestFacade({
    testFamily: 'integration'
});

export const testNode = integration.suite('worker pool crash fixture', [
    integration.test('runs in a worker thread', function runsInWorkerThread(scope) {
        scope.assert.equal(isMainThread, false);

        return scope.assert.collect();
    }),
    integration.test('exits worker', function exitsWorker(scope) {
        process.exit(9);

        return scope.assert.collect();
    }),
    integration.test('runs after crash', function runsAfterCrash(scope) {
        scope.assert.true(true);

        return scope.assert.collect();
    })
]);
