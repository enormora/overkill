import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';
import {
    mixedLifecycleResolvedRun,
    fakeDependencies,
    type WorkerLifecycle
} from '../test-support/worker-pool-lifecycle-routing-fixture.ts';
import type { CreatedWorkerPool, WorkerPoolCreationOptions } from './run-orchestrator-dependencies.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import { createWorkerPoolRuntime, type WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

function lifecycleTask(workerLifecycle: WorkerLifecycle, lane: string): unknown {
    return {
        command: { workerLifecycle },
        kind: 'run',
        lane
    };
}

function invalidWorkerPoolTask(): unknown {
    return {
        command: { workerLifecycle: 'reuse' },
        kind: 'invalid'
    };
}

function runOptions(): Parameters<CreatedWorkerPool['run']>[1] {
    const controller = new AbortController();

    return {
        name: 'runTask',
        signal: controller.signal,
        transferList: []
    };
}

const assertRoutedPoolErrors = defineCompositeAssertion({
    name: 'routed pool errors',
    async assert(check, runtime: WorkerPoolRunRuntime) {
        return check.group([
            await check.rejects(async function runInvalidTask() {
                await runtime.pool.run(invalidWorkerPoolTask(), runOptions());
            }, { message: 'Worker-pool received an invalid task.' }),
            await check.rejects(async function runUnknownLane() {
                await runtime.pool.run({
                    command: { workerLifecycle: 'unknown' },
                    kind: 'run',
                    lane: 'unknown'
                }, runOptions());
            }, { message: 'Worker-pool task has no "unknown" route.' }),
            await check.rejects(async function collectUnknownLifecycle() {
                await runtime.pool.run({
                    command: { workerLifecycle: 'unknown' },
                    kind: 'collect'
                }, runOptions());
            }, { message: 'Worker-pool task has no "unknown" route.' })
        ]);
    }
});

const assertRoutedLifecycleRuns = defineCompositeAssertion({
    name: 'routed lifecycle runs',
    async assert(
        check,
        runtime: WorkerPoolRunRuntime,
        routedLifecycles: readonly WorkerLifecycle[],
        routedHostOutputSinks: readonly WorkerLifecycle[]
    ) {
        const initialChecks = check.group([
            check.equal(runtime.pool.options.maxThreads, 2),
            check.equal(await runtime.pool.run(lifecycleTask('reuse', 'worker-1'), runOptions()), 'reuse'),
            check.equal(
                await runtime.pool.run(lifecycleTask('fresh-worker-per-unit', 'worker-2'), runOptions()),
                'fresh-worker-per-unit'
            ),
            check.equal(
                await runtime.pool.run({ kind: 'collect', command: { workerLifecycle: 'reuse' } }, runOptions()),
                'reuse'
            ),
            check.equal(
                await runtime.pool.run(
                    { kind: 'collect', command: { workerLifecycle: 'fresh-worker-per-unit' } },
                    runOptions()
                ),
                'fresh-worker-per-unit'
            )
        ]);
        runtime.pool.setHostOutputSink?.(null);
        return check.group([
            initialChecks,
            check.deepEqual(routedLifecycles, [ 'reuse', 'fresh-worker-per-unit', 'reuse', 'fresh-worker-per-unit' ]),
            check.deepEqual(routedHostOutputSinks, [
                'reuse',
                'fresh-worker-per-unit',
                'reuse',
                'fresh-worker-per-unit'
            ])
        ]);
    }
});

export const testNode = suite('Worker pool lifecycle routing', [
    test('worker-pool runtime splits and routes mixed lifecycle pools', async function (scope) {
        const createdWorkerPools: WorkerPoolCreationOptions[] = [];
        const routedLifecycles: WorkerLifecycle[] = [];
        const routedHostOutputSinks: WorkerLifecycle[] = [];
        const runtime = await createWorkerPoolRuntime({
            attachments: null,
            collectionRunnerErrors: [],
            createdPool: null,
            dependencies: fakeDependencies(createdWorkerPools, routedLifecycles, routedHostOutputSinks),
            async finalizeResult(completion) {
                return completion.result;
            },
            resolvedRun: mixedLifecycleResolvedRun(),
            runState: createSupervisedRunState('first-failure-and-final')
        });

        await scope.assert(assertRoutedLifecycleRuns, runtime, routedLifecycles, routedHostOutputSinks);
        scope.assert.deepEqual(createdWorkerPools, [
            {
                cwd: process.cwd(),
                hostProcess: { kind: 'direct' },
                testFamily: 'integration',
                workerCount: 1,
                workerLifecycle: 'reuse'
            },
            {
                cwd: process.cwd(),
                hostProcess: { kind: 'direct' },
                testFamily: 'integration',
                workerCount: 1,
                workerLifecycle: 'fresh-worker-per-unit'
            }
        ]);
        await scope.assert(assertRoutedPoolErrors, runtime);

        await runtime.pool.destroy();

        return scope.assert.collect();
    })
]);
