import { AsyncResource } from 'node:async_hooks';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createNativeWriteProbe, type NativeWriteProbe } from '../test-support/native-write-probe.ts';
import { activeResourceLeakError, createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { settleAsyncWork } from './async-control.ts';
import { withRunnerInfrastructure } from './execution-observation.ts';
import { observeCaseResourceOwners, type ObservedCase } from './resource-owner-observation.ts';

function ignoreWriteCompletion(): void {
    return undefined;
}

async function assertInfrastructureWriteLifetime(
    scope: TestScope,
    probe: NativeWriteProbe
): Promise<ObservedCase<{ readonly writing: Promise<void>; }>> {
    const observed = await observeCaseResourceOwners(process.getActiveResourcesInfo, async function enqueueWrite() {
        return { writing: withRunnerInfrastructure(probe.write) };
    });
    scope.assert.equal(observed.baseline.includes('SimpleWriteWrap'), true);
    probe.drain();
    await observed.result.writing;
    await settleAsyncWork();
    scope.assert.equal(observed.baseline.includes('SimpleWriteWrap'), false);
    return observed;
}

async function assertOwnedWrite(scope: TestScope, probe: NativeWriteProbe, baseline: readonly string[]): Promise<void> {
    probe.pause();
    const writing = probe.write();
    const error = activeResourceLeakError({
        after: process.getActiveResourcesInfo(),
        before: baseline,
        attributedTo: null,
        attributedToWork: null,
        phase: 'run'
    });
    scope.assert.partialDeepEqual(error?.cause, { resourceTypes: [ 'SimpleWriteWrap' ] });
    probe.drain();
    await writing;
}

const pendingWrites = [ true, false ].flatMap(function infrastructureOwners(infrastructure) {
    return [ true, false ].map(function requestLayouts(initialized) {
        return { infrastructure, initialized };
    });
});

export const testNode = suite('native write ownership', [
    ...pendingWrites.map(function infrastructureWrite(scenario) {
        const { infrastructure, initialized } = scenario;
        return test(
            `${initialized ? 'initialized' : 'legacy'} ${infrastructure ? 'infrastructure' : 'test-owned'} writes`,
            async function (scope) {
                const monitor = createAsyncLeakMonitor();
                scope.cleanup(monitor.stop);
                const resources: string[] = [];
                const observed = await observeCaseResourceOwners(function readResources() {
                    return resources;
                }, async function allocateWriteRequest() {
                    const createRequest = function createWriteRequest(): AsyncResource {
                        const request = Object.assign(new AsyncResource('WRITEWRAP'), {
                            oncomplete: ignoreWriteCompletion
                        });
                        if (initialized) {
                            Object.assign(request, { async: false, handle: null });
                        }
                        return request;
                    };
                    const request = infrastructure ? withRunnerInfrastructure(createRequest) : createRequest();
                    scope.cleanup(function closeWriteRequest() {
                        request.emitDestroy();
                    });
                    resources.push('SimpleWriteWrap');
                });
                scope.assert.deepEqual(observed.baseline, infrastructure ? [ 'SimpleWriteWrap' ] : []);
                scope.assert.deepEqual(observed.ambiguousResources, []);
                const error = activeResourceLeakError({
                    after: resources,
                    before: observed.baseline,
                    attributedTo: null,
                    attributedToWork: null,
                    phase: 'run'
                });
                scope.assert.equal(error === null, infrastructure);
                return scope.assert.collect();
            }
        );
    }),
    ...([ true, false ] as const).map(function completedWrite(callbackRan) {
        return test(
            `completed infrastructure writes cannot mask owned writes after callback ${String(callbackRan)}`,
            async function (scope) {
                const monitor = createAsyncLeakMonitor();
                scope.cleanup(monitor.stop);
                const resources: string[] = [];
                const observed = await observeCaseResourceOwners(function readResources() {
                    return resources;
                }, async function completeWriteRequest() {
                    const request = withRunnerInfrastructure(function completedInfrastructureWrite() {
                        return Object.assign(new AsyncResource('WRITEWRAP'), {
                            async: callbackRan,
                            oncomplete: ignoreWriteCompletion
                        });
                    });
                    scope.cleanup(function closeWriteRequest() {
                        request.emitDestroy();
                    });
                    if (callbackRan) {
                        request.runInAsyncScope(ignoreWriteCompletion);
                    }
                    resources.push('SimpleWriteWrap');
                });
                scope.assert.deepEqual(observed.baseline, []);
                const error = activeResourceLeakError({
                    after: resources,
                    before: observed.baseline,
                    attributedTo: null,
                    attributedToWork: null,
                    phase: 'run'
                });
                scope.assert.partialDeepEqual(error?.cause, { resourceTypes: [ 'SimpleWriteWrap' ] });
                return scope.assert.collect();
            }
        );
    }),
    test('tracks native writes through completion without masking a later owned write', async function (scope) {
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const probe = await createNativeWriteProbe(scope);
        const observed = await assertInfrastructureWriteLifetime(scope, probe);
        await assertOwnedWrite(scope, probe, observed.baseline);
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
