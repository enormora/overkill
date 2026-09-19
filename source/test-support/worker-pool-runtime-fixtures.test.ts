import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import { runResultFactory } from './run-result-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

type FixtureDependencies = RunOrchestratorDependencies;

function recordPolicyMessage(): void {
    return undefined;
}

async function assertPoolFake(scope: OverkillScope, dependencies: FixtureDependencies): Promise<void> {
    const pool = dependencies.createWorkerPool({
        cwd: '/project',
        hostProcess: { kind: 'direct' },
        testFamily: 'integration',
        workerCount: 2,
        workerLifecycle: 'fresh-worker-per-unit'
    });
    const controller = new AbortController();

    scope.assert.equal(pool.options.isolateWorkers, true);
    scope.assert.equal(pool.options.maxThreads, 2);
    await scope.assert.rejects(async function runFakePoolTask() {
        await pool.run(null, {
            name: 'runTask',
            signal: controller.signal,
            transferList: []
        });
    }, { message: 'Fake worker pool did not receive a task implementation.' });
    await pool.destroy();
}

async function assertReporterFakes(scope: OverkillScope, dependencies: FixtureDependencies): Promise<void> {
    const delivery = await dependencies.reporterDispatcher.createDelivery([], createPlainOutputRenderer());
    const tracked = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(async function work() {
        return 'result';
    });
    const eventErrors = await delivery.reportEvent({
        facts: {},
        kind: 'run-start',
        root: { annotations: { ownership: [], tags: [] }, title: 'root' },
        startedAt: '2026-09-19T00:00:00.000Z'
    });
    const disposedErrors = await delivery.disposeReporters();
    const resultErrors = await delivery.reportResult(runResultFactory.build());

    scope.assert.equal(disposedErrors.length, 0);
    scope.assert.equal(eventErrors.length, 0);
    scope.assert.equal(resultErrors.length, 0);
    scope.assert.equal(tracked.deliveredRunnerErrors.length, 0);
    scope.assert.equal(tracked.result, 'result');
}

async function assertStorageAndOutputFakes(scope: OverkillScope, dependencies: FixtureDependencies): Promise<void> {
    dependencies.liveOutput.stderr.write(Buffer.from('stderr'));
    dependencies.liveOutput.stdout.write(Buffer.from('stdout'));
    await dependencies.durationHistoryStore.write('/history', '{}');

    scope.assert.equal(await dependencies.durationHistoryStore.read('/history') === null, true);
}

function assertRuntimePolicyFakes(scope: OverkillScope, dependencies: FixtureDependencies): void {
    const restoreIpcRestriction = dependencies.runtimeCapabilityPolicy.installIpcRestriction(recordPolicyMessage);
    const restoreProcessRestriction = dependencies.runtimeCapabilityPolicy.installProcessExecutionRestriction(
        recordPolicyMessage
    );

    scope.assert.equal(Object.keys(dependencies.runtimeCapabilityPolicy.readEnvironment()).length, 0);
    scope.assert.equal(dependencies.runtimeCapabilityPolicy.readStorage('localStorage') === null, true);
    restoreIpcRestriction();
    restoreProcessRestriction();
}

async function assertUnsupportedFakes(scope: OverkillScope, dependencies: FixtureDependencies): Promise<void> {
    scope.assert.throws(function createResourceUsageTracker() {
        dependencies.createResourceUsageTracker({ samplingIntervalMilliseconds: 1 });
    }, { message: 'Test fixture dependency is not configured.' });
    await scope.assert.rejects(async function startSupervisedChild() {
        await dependencies.startSupervisedChild({
            capabilityRestrictions: { mode: 'disabled' },
            cwd: '/project',
            environmentVariables: {},
            testFamily: 'integration'
        });
    }, { message: 'Test fixture dependency is not configured.' });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/test-support/worker-pool-runtime-fixtures.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'fakeWorkerPoolRuntimeDependencies() creates observable worker-pool fakes',
            async body(scope: OverkillScope) {
                const dependencies = fakeWorkerPoolRuntimeDependencies();

                scope.assert.equal(dependencies.createSeed(), 42n);
                await assertPoolFake(scope, dependencies);
                await assertReporterFakes(scope, dependencies);
                await assertStorageAndOutputFakes(scope, dependencies);
                assertRuntimePolicyFakes(scope, dependencies);
                await assertUnsupportedFakes(scope, dependencies);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('./run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
