import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { workerReplayRecord } from '../test-support/replay-record-fixture.ts';
import { createCollectedPlan, fakeWorkerRuntime, placementPlan } from '../test-support/worker-pool-execution-state.ts';
import { withReplay } from './replay-context.ts';
import { withReplayCancellation, type ReplayCancellation } from './replay-cancellation.ts';
import { createStaticDispatcher } from './worker-pool-static-dispatcher.ts';
import type { PlacementLane } from './run-types.ts';

type CancellationFixture = ReplayCancellation & { readonly lane: PlacementLane; };
function cancellationFixture(): CancellationFixture {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const plan = placementPlan();
    const lane = plan.lanes[0];
    if (lane === undefined) {
        throw new Error('Expected a replay lane.');
    }
    const dispatcher = createStaticDispatcher(plan, runtime.placementTrace);
    return { runtime, dispatcher, lane };
}
export const testNode = authoredSuite('replay cancellation lifecycle', [
    ...[ false, true ].map(function alreadyAborted(early) {
        return authoredTest(
            `stops pending placement with prior cancellation ${early}`,
            async function (scope: TestScope) {
                const fixture = cancellationFixture();
                const controller = new AbortController();
                if (early) {
                    controller.abort();
                }
                await withReplay(
                    { kind: 'record', record: workerReplayRecord(fixture.runtime, null) },
                    controller.signal,
                    async function () {
                        await withReplayCancellation(fixture, async function () {
                            if (!early) {
                                controller.abort();
                            }
                        });
                    }
                );
                scope.assert.true(fixture.runtime.terminalFailure.read());
                scope.assert.deepEqual(
                    fixture.runtime.runState.runnerErrors().map(function message(error) {
                        return error.message;
                    }),
                    [ 'Replay was cancelled.' ]
                );
                scope.assert.equal(fixture.dispatcher.pull(fixture.lane), null);
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('removes cancellation listeners when execution throws', async function (scope: TestScope) {
        const fixture = cancellationFixture();
        const controller = new AbortController();
        const failure = new Error('Execution failed.');
        await scope.assert.rejects(async function () {
            await withReplay(
                { kind: 'record', record: workerReplayRecord(fixture.runtime, null) },
                controller.signal,
                async function () {
                    await withReplayCancellation(fixture, async function () {
                        throw failure;
                    });
                }
            );
        }, { exact: failure });
        controller.abort();
        scope.assert.false(fixture.runtime.terminalFailure.read());
        scope.assert.deepEqual(fixture.runtime.runState.runnerErrors(), []);
        return scope.assert.collect();
    })
]);
