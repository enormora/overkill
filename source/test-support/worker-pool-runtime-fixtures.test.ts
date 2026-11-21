import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, table, test } from '@overkill-dev/test';

import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import { runResultFactory } from './run-result-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

type FixtureDependencies = RunOrchestratorDependencies;

function recordPolicyMessage(): void {
    return undefined;
}

const poolContract = defineCompositeAssertion({
    name: 'worker pool fake',
    async assert(check, dependencies: FixtureDependencies) {
        const pool = dependencies.createWorkerPool({
            cwd: '/project',
            hostProcess: { kind: 'direct' },
            testFamily: 'integration',
            workerCount: 2,
            workerLifecycle: 'fresh-worker-per-unit'
        });
        const controller = new AbortController();

        return check.group([
            check.equal(pool.options.isolateWorkers, true),
            check.equal(pool.options.maxThreads, 2),
            await check.rejects(async function runFakePoolTask() {
                await pool.run(null, { name: 'runTask', signal: controller.signal, transferList: [] });
            }, { message: 'Fake worker pool did not receive a task implementation.' })
        ]);
    }
});

const assertReporterFakes = defineCompositeAssertion({
    name: 'reporter fakes',
    async assert(check, dependencies: FixtureDependencies) {
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
        return check.group([
            check.equal(disposedErrors.length, 0),
            check.equal(eventErrors.length, 0),
            check.equal(resultErrors.length, 0),
            check.equal(tracked.deliveredRunnerErrors.length, 0),
            check.equal(tracked.result, 'result')
        ]);
    }
});

const assertStorageAndOutputFakes = defineCompositeAssertion({
    name: 'storage and output fakes',
    async assert(check, dependencies: FixtureDependencies) {
        dependencies.liveOutput.stderr.write(Buffer.from('stderr'));
        dependencies.liveOutput.stdout.write(Buffer.from('stdout'));
        await dependencies.runtimeStateStore.write('/history', '{}');
        return check.group([ check.equal(await dependencies.runtimeStateStore.read('/history') === null, true) ]);
    }
});

const policyContract = defineCompositeAssertion({
    name: 'runtime policy fake',
    assert(check, dependencies: FixtureDependencies) {
        const restoreIpcRestriction = dependencies.runtimeCapabilityPolicy.observeIpcListeners(recordPolicyMessage);
        const restoreProcessRestriction = dependencies.runtimeCapabilityPolicy.observeProcessExit(
            function unexpectedPrematureExit(): never {
                throw new Error('Unexpected premature exit.');
            }
        );

        return check.group([
            check.empty(Object.keys(dependencies.runtimeCapabilityPolicy.readEnvironment())),
            check.null(dependencies.runtimeCapabilityPolicy.readStorage('localStorage')),
            check.function(restoreIpcRestriction),
            check.function(restoreProcessRestriction)
        ]);
    }
});

const assertUnsupportedFakes = defineCompositeAssertion({
    name: 'unsupported fakes',
    async assert(check, dependencies: FixtureDependencies) {
        return check.group([
            check.throws(function createProcessUsageTracker() {
                dependencies.createProcessUsageTracker({ samplingIntervalMilliseconds: 1 });
            }, { message: 'Test fixture dependency is not configured.' }),
            await check.rejects(async function startSupervisedChild() {
                await dependencies.startSupervisedChild({
                    capabilityRestrictions: { mode: 'disabled' },
                    coverage: null,
                    cwd: '/project',
                    environmentVariables: {},
                    testFamily: 'integration'
                });
            }, { message: 'Test fixture dependency is not configured.' })
        ]);
    }
});

export const testNode = suite('Worker pool runtime fixtures', [
    table({
        title: 'provides observable dependencies',
        cases: [
            { title: 'worker pool', assertion: poolContract },
            { title: 'reporter delivery', assertion: assertReporterFakes },
            { title: 'storage and output', assertion: assertStorageAndOutputFakes },
            { title: 'unsupported integrations', assertion: assertUnsupportedFakes }
        ],
        caseTitle(entry) {
            return entry.title;
        },
        async test(scope) {
            const dependencies = fakeWorkerPoolRuntimeDependencies();
            scope.assert.equal(dependencies.createSeed(), 42n);
            await scope.assert(scope.parameters.assertion, dependencies);
            return scope.assert.collect();
        }
    }),
    test('provides an inert capability policy', function (scope) {
        const dependencies = fakeWorkerPoolRuntimeDependencies();
        scope.assert(policyContract, dependencies);
        return scope.assert.collect();
    })
]);
