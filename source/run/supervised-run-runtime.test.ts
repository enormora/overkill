import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';
import type { CaseId } from '../engine/identity.ts';
import { resolveRootTestAnnotations } from '../engine/test-data.ts';
import type { ProcessUsageSnapshot } from '../engine/process-usage.ts';
import {
    childProcess,
    timeoutRuntime,
    runRuntime,
    type ChildRecord,
    type TimeoutRuntimeRecord
} from '../test-support/supervised-run-runtime-fixture.ts';
import type { CollectedRunPlan, ResolvedRun } from './run-types.ts';
import { kill, type SupervisedChildProcess } from './supervised-child-process.ts';
import { createStoredRunValue, createSupervisedRunState } from './supervised-run-state.ts';
import {
    createHardTimeout,
    handleChildMessage,
    handleCollectionSample,
    supervisedCollectedPlan,
    type SupervisedCollectionRuntime,
    type SupervisedHardTimeout
} from './supervised-run-runtime.ts';

const collectedPlan = {
    root: {
        annotations: resolveRootTestAnnotations({}),
        controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
        title: 'root'
    }
} as unknown as CollectedRunPlan;

const caseId: CaseId = {
    file: 'source/example.test.ts',
    title: 'case',
    params: null,
    suite: []
};

const processUsageSample: ProcessUsageSnapshot = {
    activeResourceCount: 0,
    activeResourceTypes: [],
    capturedAtMicroseconds: 1000,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 200
};

function resolvedRunWithPlan(plan: ResolvedRun['plan']): ResolvedRun {
    return { plan } as unknown as ResolvedRun;
}

function collectionRuntime(
    child: SupervisedChildProcess,
    terminalFailure: boolean,
    activeResourceCount: number | null
): SupervisedCollectionRuntime<CollectedRunPlan | null> {
    return {
        child,
        collected: createStoredRunValue(null),
        command: {
            processBudgets: {
                activeResourceCount,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            }
        },
        dependencies: {},
        previousSample: createStoredRunValue(null),
        state: createSupervisedRunState('first-failure-and-final'),
        terminalFailure: createStoredRunValue(terminalFailure)
    } as unknown as SupervisedCollectionRuntime<CollectedRunPlan | null>;
}

function timeoutCallback(callbacks: readonly (() => void)[]): () => void {
    const callback = callbacks.at(-1);
    if (callback === undefined) {
        throw new Error('Expected callback to satisfy defined.');
    }

    return callback;
}

function scheduleOverlappingCases(
    record: TimeoutRuntimeRecord,
    timeout: SupervisedHardTimeout
): void {
    record.runtime.state.addActiveCase(
        'first',
        { capture: null, id: caseId, workId: { familyVariant: null, case: caseId, runtimes: [], workload: null } },
        0,
        { index: 0 }
    );
    timeout.start();
    record.advanceTo(500_000);
    record.runtime.state.addActiveCase(
        'second',
        { capture: null, id: caseId, workId: { familyVariant: null, case: caseId, runtimes: [], workload: null } },
        500_000,
        { index: 0 }
    );
    timeout.start();
    record.runtime.state.removeActiveCase('first');
    timeout.start();
}

const assertTimedOutChild = defineCompositeAssertion({
    name: 'timed out child',
    assert(check, record: TimeoutRuntimeRecord, child: ChildRecord) {
        return check.group([
            check.equal(record.clears(), 3),
            check.equal(record.runtime.terminalFailure.read(), true),
            check.deepEqual(child.signals(), [ 'SIGKILL' ])
        ]);
    }
});

export const testNode = suite('Supervised run runtime', [
    test('supervisedCollectedPlan() accepts only supervised plans', function (scope) {
        const supervisedPlan = { collectedPlan, kind: 'supervised' as const };
        const localPlan = { kind: 'local' as const, testPlan: {} };

        scope.assert.equal(
            Object.is(
                supervisedCollectedPlan(resolvedRunWithPlan(supervisedPlan)),
                collectedPlan
            ),
            true
        );
        scope.assert.throws(function readLocalPlan() {
            supervisedCollectedPlan(resolvedRunWithPlan(localPlan as ResolvedRun['plan']));
        }, { message: 'Supervised execution requires a supervised collected plan.' });

        return scope.assert.collect();
    }),
    test('kill() only signals a live spawned child', function (scope) {
        const live = childProcess({ exitCode: null, pid: 1, signalCode: null });
        const exited = childProcess({ exitCode: 0, pid: 2, signalCode: null });
        const notStarted = childProcess({ exitCode: null, pid: undefined, signalCode: null });
        const signaled = childProcess({ exitCode: null, pid: 3, signalCode: 'SIGTERM' });

        kill(live.child);
        kill(exited.child);
        kill(notStarted.child);
        kill(signaled.child);

        scope.assert.deepEqual([
            ...live.signals(),
            ...exited.signals(),
            ...notStarted.signals(),
            ...signaled.signals()
        ], [ 'SIGKILL' ]);

        return scope.assert.collect();
    }),
    test('createHardTimeout() reschedules for the oldest active case', function (scope) {
        const live = childProcess({ exitCode: null, pid: 1, signalCode: null });
        const record = timeoutRuntime(live.child);
        const timeout = createHardTimeout({ ...record.runtime, analysis: false });

        scheduleOverlappingCases(record, timeout);
        scope.assert.deepEqual(record.delays(), [ 1000, 500, 1000 ]);
        timeoutCallback(record.callbacks())();
        timeout.clear();

        scope.assert(assertTimedOutChild, record, live);

        return scope.assert.collect();
    }),
    test('handleCollectionSample() skips terminal runs and records clean samples', function (scope: TestScope) {
        const terminal = collectionRuntime(
            childProcess({ exitCode: null, pid: 1, signalCode: null }).child,
            true,
            null
        );
        const running = collectionRuntime(
            childProcess({ exitCode: null, pid: 2, signalCode: null }).child,
            false,
            null
        );

        handleCollectionSample(processUsageSample, terminal);
        handleCollectionSample(processUsageSample, running);
        const recordedSample = running.previousSample.read();
        scope.require.notNull(recordedSample);

        scope.assert.equal(terminal.previousSample.read(), null);
        scope.assert.deepEqual(recordedSample, processUsageSample);

        return scope.assert.collect();
    }),
    test('handleCollectionSample() reports collection process budget breaches', function (scope) {
        const live = childProcess({ exitCode: null, pid: 1, signalCode: null });
        const runtime = collectionRuntime(live.child, false, -1);

        handleCollectionSample(processUsageSample, runtime);

        scope.assert.equal(runtime.terminalFailure.read(), true);
        scope.assert.deepEqual(live.signals(), [ 'SIGKILL' ]);
        scope.assert.equal(runtime.state.runnerErrors()[0]?.subtype, 'process-exhaustion');

        return scope.assert.collect();
    }),
    test('handleChildMessage() records supervised process usage samples', function (scope: TestScope) {
        const runtime = runRuntime(
            timeoutRuntime(childProcess({ exitCode: null, pid: 1, signalCode: null }).child).runtime
        );

        handleChildMessage({ kind: 'sample', sample: processUsageSample }, runtime);
        const recordedSample = runtime.previousSample.read();
        scope.require.notNull(recordedSample);

        scope.assert.deepEqual(recordedSample, processUsageSample);

        return scope.assert.collect();
    })
]);
