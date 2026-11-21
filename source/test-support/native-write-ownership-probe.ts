import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { AsyncResource } from 'node:async_hooks';
import { suite, table, test } from '@overkill-dev/test';
import { activeResourceLeakError, createAsyncLeakMonitor } from '../engine/async-leak-diagnostics.ts';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { observeCaseResourceOwners } from '../engine/resource-owner-observation.ts';
import { createNativeWriteProbe, type NativeWriteProbe } from './native-write-probe.ts';

function ignoreWriteCompletion(): void {
    return undefined;
}

const assertOwnedWrite = defineCompositeAssertion({
    name: 'owned write',
    async assert(check, probe: NativeWriteProbe, baseline: readonly string[]) {
        probe.pause();
        const writing = probe.write();
        const error = activeResourceLeakError({
            after: process.getActiveResourcesInfo(),
            before: baseline,
            attributedTo: null,
            attributedToWork: null,
            phase: 'run'
        });
        const initialChecks = check.partialDeepEqual(error?.cause, { resourceTypes: [ 'SimpleWriteWrap' ] });
        probe.drain();
        await writing;
        return initialChecks;
    }
});

const pendingWrites = [ true, false ].flatMap(function infrastructureOwners(infrastructure) {
    return [ true, false ].map(function requestLayouts(initialized) {
        return { infrastructure, initialized };
    });
});

export const nativeWriteOwnershipTestNode = suite('native write ownership', [
    table({
        title: 'attributes pending writes',
        cases: pendingWrites,
        caseTitle({ infrastructure, initialized }) {
            return `${initialized ? 'initialized' : 'legacy'} ${
                infrastructure ? 'infrastructure' : 'test-owned'
            } writes`;
        },
        async test(scope) {
            const { infrastructure, initialized } = scope.parameters;
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
    }),
    table({
        title: 'completed infrastructure writes cannot mask owned writes',
        cases: [ 'callback', 'synchronous', 'cleared' ] as const,
        caseTitle(completion) {
            return completion;
        },
        async test(scope) {
            const completion = scope.parameters;
            const monitor = createAsyncLeakMonitor();
            scope.cleanup(monitor.stop);
            const resources: string[] = [];
            const observed = await observeCaseResourceOwners(function readResources() {
                return resources;
            }, async function completeWriteRequest() {
                const request = withRunnerInfrastructure(function completedInfrastructureWrite() {
                    return Object.assign(new AsyncResource('WRITEWRAP'), {
                        async: completion !== 'synchronous',
                        oncomplete: ignoreWriteCompletion
                    });
                });
                scope.cleanup(function closeWriteRequest() {
                    request.emitDestroy();
                });
                if (completion === 'callback') {
                    request.runInAsyncScope(ignoreWriteCompletion);
                } else if (completion === 'cleared') {
                    Reflect.set(request, 'oncomplete', null);
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
    }),
    test('tracks native writes through completion without masking a later owned write', async function (scope) {
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const probe = await createNativeWriteProbe(scope.cleanup);
        const observed = await observeCaseResourceOwners(process.getActiveResourcesInfo, async function enqueueWrite() {
            return { writing: withRunnerInfrastructure(probe.write) };
        });
        scope.assert.true(observed.baseline.includes('SimpleWriteWrap'));
        probe.drain();
        await observed.result.writing;
        await scope.yieldToNextTurn();
        scope.assert.false(observed.baseline.includes('SimpleWriteWrap'));
        await scope.assert(assertOwnedWrite, probe, observed.baseline);
        return scope.assert.collect();
    })
]);

export const nativeWriteOwnershipProbeUrl = import.meta.url;
