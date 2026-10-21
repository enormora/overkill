import { setTimeout as scheduleTimer, clearTimeout as cancelTimer } from 'node:timers';
import { AsyncResource } from 'node:async_hooks';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { activeResourceLeakError, createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { settleAsyncWork } from './async-control.ts';
import {
    createExecutionObservation,
    withRunnerInfrastructure,
    type ExecutionObservation
} from './execution-observation.ts';
import { observeCaseResourceOwners, type ObservedCase } from './resource-owner-observation.ts';
import type { TestPlanCase } from './test-plan.ts';

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

export const testNode = suite('native infrastructure resources', [
    ...([ 'closed', 'live', 'unknown' ] as const).flatMap(function attemptLifetime(lifetime) {
        return [ false, true ].map(function currentTimer(includeCurrentTimer) {
            return test(
                `keeps ${lifetime} resource growth ambiguous with current timer ${String(includeCurrentTimer)}`,
                async function (scope) {
                    const probe = await captureStaleResourceProbe(scope, lifetime);
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
                        0
                    );
                    return scope.assert.collect();
                }
            );
        });
    }),
    ...([ 'live', 'unref', 'closed' ] as const).map(function infrastructureTimer(lifetime) {
        return test(`${lifetime} infrastructure timers cannot mask test timer leaks`, async function (scope) {
            const monitor = createAsyncLeakMonitor();
            scope.cleanup(monitor.stop);
            const background = withRunnerInfrastructure(function createBackgroundContext() {
                return new AsyncResource('infrastructure resource probe');
            });
            scope.cleanup(function destroyBackgroundContext() {
                background.emitDestroy();
            });
            const observed = await observeCaseResourceOwners(
                process.getActiveResourcesInfo,
                async function allocateTimers() {
                    const infrastructure = background.runInAsyncScope(function createInfrastructureTimer() {
                        return scheduleTimer(ignoreTimer, 60_000);
                    });
                    const owned = scheduleTimer(ignoreTimer, 60_000);
                    scope.cleanup(function clearTimers() {
                        cancelTimer(infrastructure);
                        cancelTimer(owned);
                    });
                    if (lifetime === 'unref') {
                        infrastructure.unref();
                    } else if (lifetime === 'closed') {
                        cancelTimer(infrastructure);
                    }
                }
            );
            await settleAsyncWork();
            const error = activeResourceLeakError({
                after: process.getActiveResourcesInfo(),
                before: observed.baseline,
                attributedTo: null,
                attributedToWork: null,
                phase: 'run'
            });
            scope.assert.partialDeepEqual(error?.cause, { resourceTypes: [ 'Timeout' ] });
            scope.assert.deepEqual(observed.ambiguousResources, []);
            return scope.assert.collect();
        });
    }),
    test('retains unknown infrastructure handle growth as ambiguous', async function (scope) {
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const resources: string[] = [];
        const observed = await observeCaseResourceOwners(function readResources() {
            return resources;
        }, async function allocateOpaqueResource() {
            const resource = withRunnerInfrastructure(function nativeInfrastructureResource() {
                return new AsyncResource('OpaqueWrap');
            });
            scope.cleanup(function closeOpaqueResource() {
                resource.emitDestroy();
            });
            resources.push('OpaqueWrap');
        });
        scope.assert.deepEqual(observed.baseline, []);
        scope.assert.deepEqual(observed.ambiguousResources, [ 'OpaqueWrap' ]);
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
