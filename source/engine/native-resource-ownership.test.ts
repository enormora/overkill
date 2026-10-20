import { setTimeout as scheduleTimer, clearTimeout as cancelTimer } from 'node:timers';
import { AsyncResource } from 'node:async_hooks';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { activeResourceLeakError, createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { settleAsyncWork } from './async-control.ts';
import { withRunnerInfrastructure } from './execution-observation.ts';
import { observeCaseResourceOwners } from './resource-owner-observation.ts';

function ignoreTimer(): void {
    return undefined;
}

export const testNode = suite('native infrastructure resources', [
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
