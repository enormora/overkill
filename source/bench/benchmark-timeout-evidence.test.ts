import { createDeterministicClock } from '@enormora/clock';
import { createRoot, createTestPlan } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createExecutionSupervision, executeCaseBody } from '../engine/execution-supervision.ts';
import { createDisabledExecutionGlobalErrorObserver } from '../engine/execution-global-error-observer.ts';
import { benchmark } from './benchmark-authoring.ts';
import { wallClockMeasurement } from './measurement-strategy.ts';
import { workload } from './workload.ts';

const globalErrorObserver = createDisabledExecutionGlobalErrorObserver();

type TimedBenchmark = {
    readonly suspended: Promise<undefined>;
    readonly resume: () => void;
    readonly wallClock: ReturnType<typeof createDeterministicClock>;
    readonly execution: ReturnType<typeof executeCaseBody>;
};

function createTimedBenchmark(): TimedBenchmark {
    const gates = { suspended: Promise.withResolvers<undefined>(), resumed: Promise.withResolvers<undefined>() };
    let index = 0;
    const node = benchmark('partial', {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        async measure({ sample }) {
            sample.measure(function () {
                index += 1;
                return index;
            });
            if (index === 129) {
                gates.suspended.resolve(undefined);
                await gates.resumed.promise;
            }
            return { value: index % 2 };
        },
        diagnosticMetrics: [],
        budgets: { one: { value: { maximum: 0.5 } } }
    });
    const plan = createTestPlan(createRoot({ title: 'root', children: [ node ], annotations: {}, controls: {} }));
    const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const execution = executeCaseBody({
        async onBenchmarkUpdate() {
            return undefined;
        },
        testCase: plan.cases[0],
        attempt: { index: 0 },
        supervision: createExecutionSupervision(),
        dependencies: { wallClock, globalErrorObserver },
        timeoutPolicy: { hardTimeoutMilliseconds: 100, timeoutMilliseconds: 10 }
    });
    return {
        suspended: gates.suspended.promise,
        resume() {
            gates.resumed.resolve(undefined);
        },
        wallClock,
        execution
    };
}

export const testNode = suite('benchmark timeout evidence', [
    test('hard timeout preserves the last confirmed checkpoint in results and attempts', async function (scope) {
        const timed = createTimedBenchmark();
        scope.cleanup(timed.resume);
        await timed.suspended;
        timed.wallClock.advanceByMilliseconds(100);
        const completed = await timed.execution;
        scope.assert.equal(completed.result.verdict, 'crashed');
        scope.assert.equal(completed.result.benchmark?.samples, 128);
        scope.assert.equal(completed.result.benchmark?.status, 'incomplete');
        scope.assert.equal(completed.result.attempts[0].benchmark?.samples, 128);
        return scope.assert.collect();
    })
]);
