import { table, type TestNode, type TestScope, suite } from '@overkill-dev/test';
import { setTimeout as scheduleTimer, clearTimeout as cancelTimer } from 'node:timers';
import { AsyncResource } from 'node:async_hooks';

import { createTestEngine } from '../../../test-support/create-test-engine.ts';
import { createAsyncLeakMonitor } from '../../../engine/async-leak-diagnostics.ts';
import { createExecutionObservation, type ExecutionObservation } from '../../../engine/execution-observation.ts';
import { observeCaseResourceOwners, type ObservedCase } from '../../../engine/resource-owner-observation.ts';
import type { TestPlanCase } from '../../../engine/test-plan.ts';

function ignoreTimer(): void {
    return undefined;
}
type StaleResourceProbe = {
    readonly current: ExecutionObservation;
    readonly late: AsyncResource;
    readonly testCase: TestPlanCase;
    readonly createTimer: () => void;
};

const unownedResources = new AsyncResource('unowned resource context');
type AttemptLifetime = 'closed' | 'live' | 'unknown';

function resourceCase(): TestPlanCase {
    const engine = createTestEngine();
    return engine
        .createTestPlan(engine.createRoot({
            title: 'resources',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({
                title: 'case',
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                body(scope) {
                    return scope.assert.collect();
                }
            }) ]
        }))
        .cases[0];
}

async function captureStaleResourceProbe(scope: TestScope, lifetime: AttemptLifetime): Promise<StaleResourceProbe> {
    const testCase = resourceCase();
    const previous = createExecutionObservation();
    const late = await previous.runAttempt(testCase, { index: 0 }, async function previousAttempt() {
        return lifetime === 'unknown'
            ? unownedResources.runInAsyncScope(function createUnknownContext() {
                return new AsyncResource('unknown resource attempt');
            })
            : new AsyncResource('previous resource attempt');
    });
    if (lifetime !== 'live') {
        previous.stop();
    }
    const current = createExecutionObservation();
    const monitor = createAsyncLeakMonitor();
    const timers: ReturnType<typeof scheduleTimer>[] = [];
    scope.cleanup(function closeResourceProbe() {
        timers.forEach(cancelTimer);
        late.emitDestroy();
        monitor.stop();
        current.stop();
        previous.stop();
    });
    return {
        current,
        late,
        testCase,
        createTimer() {
            timers.push(scheduleTimer(ignoreTimer, 60_000));
        }
    };
}

async function observeStaleTimers(
    probe: StaleResourceProbe,
    includeCurrentTimer: boolean
): Promise<ObservedCase<void>> {
    return await probe.current.runAttempt(probe.testCase, { index: 0 }, async function nextInvocation() {
        return await observeCaseResourceOwners(process.getActiveResourcesInfo, async function allocateResources() {
            probe.late.runInAsyncScope(probe.createTimer);
            if (includeCurrentTimer) {
                probe.createTimer();
            }
        });
    });
}

export const testNode: TestNode = suite(
    'stale native resource ownership',
    [ table({
        title: 'keeps resource growth ambiguous with current timer',
        cases: ([ 'closed', 'live', 'unknown' ] as const).flatMap(function attemptLifetime(lifetime) {
            return [ false, true ].map(function currentTimer(includeCurrentTimer) {
                return ({
                    caseDescription: `keeps ${lifetime} resource growth ambiguous with current timer ${
                        String(includeCurrentTimer)
                    }`,
                    lifetime,
                    includeCurrentTimer
                });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { lifetime, includeCurrentTimer } = scope.parameters;

            const probe = await captureStaleResourceProbe(scope, lifetime);
            const baselineTimeouts = process
                .getActiveResourcesInfo()
                .filter(function (type) {
                    return type === 'Timeout';
                })
                .length;
            const observed = await observeStaleTimers(probe, includeCurrentTimer);
            scope.assert.deepEqual(
                observed.ambiguousResources,
                Array.from({ length: includeCurrentTimer ? 2 : 1 }, function timerType() {
                    return 'Timeout';
                })
            );
            scope.assert.equal(
                observed
                    .baseline
                    .filter(function timerType(type) {
                        return type === 'Timeout';
                    })
                    .length,
                baselineTimeouts
            );
            return scope.assert.collect();
        }
    }) ]
);
