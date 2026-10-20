import { AsyncResource } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createRuntimeCapabilityPolicy, type RuntimeCapabilityPolicy } from '../run/capability-policy.ts';
import { observeProcessIpcListeners } from '../run/node-process-policy-observation.ts';
import type { TestPlanCase } from './test-plan.ts';
import { createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import {
    withExecutionObservation,
    withRunnerInfrastructure
} from './execution-observation.ts';

const external = new AsyncResource('external guard ownership probe');
const consoleChannel = channel('console.log');
const permissionChannel = channel('node:permission-model:fs');

function policy(): RuntimeCapabilityPolicy {
    const environment = {};
    return createRuntimeCapabilityPolicy({
        dependencies: {
            observeIpcListeners(record) {
                return observeProcessIpcListeners(process, record, new WeakSet());
            },
            observeProcessExit() {
                return function stopExitObservation() {
                    return undefined;
                };
            },
            readEnvironment() {
                return environment;
            },
            readStorage() {
                return null;
            }
        },
        observedStderr: false,
        observedStdout: false
    });
}

function guardCase(): TestPlanCase {
    const engine = createTestEngine();
    return engine
        .createTestPlan(engine.createRoot({
            title: 'guard ownership',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({
                title: 'case',
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                }
            }) ]
        }))
        .cases[0];
}

function publishDiagnostics(): void {
    consoleChannel.publish({});
    permissionChannel.publish({ permission: 'FileSystemWrite', resource: 'guard-probe' });
}

export const testNode = suite('native guard ownership', [
    test('retains late diagnostics from a closed invocation as run errors', async function (scope) {
        const previous = policy();
        const testCase = guardCase();
        const late = await previous.runAttempt(testCase, { index: 0 }, async function capturePreviousRun() {
            return new AsyncResource('previous invocation');
        });
        previous.takeRunErrors();
        const current = policy();
        scope.cleanup(function closeInvocationProbe() {
            late.emitDestroy();
            current.takeRunErrors();
        });
        await current.runAttempt(testCase, { index: 0 }, async function nextInvocation() {
            late.runInAsyncScope(publishDiagnostics);
        });
        scope.assert.deepEqual(current.takeAttemptErrors(testCase, { index: 0 }), []);
        scope.assert.deepEqual(
            current.takeRunErrors().map(function subtype(error) {
                return error.subtype;
            }),
            [
                'attribution-drift',
                'attribution-drift'
            ]
        );
        return scope.assert.collect();
    }),
    test('retains unknown diagnostics at run level', async function (scope) {
        const observed = policy();
        external.runInAsyncScope(publishDiagnostics);
        const errors = observed.takeRunErrors();
        scope.assert.deepEqual(
            errors.map(function subtype(error) {
                return error.subtype;
            }),
            [
                'runtime-policy',
                'permission'
            ]
        );
        scope.assert.true(errors.every(function unowned(error) {
            return error.attributedTo === null;
        }));
        return scope.assert.collect();
    }),
    test('isolates diagnostics from another live run', async function (scope) {
        const first = policy();
        const second = policy();
        try {
            await first.runAttempt(guardCase(), { index: 0 }, async function publishOwnedEffects() {
                publishDiagnostics();
            });
            scope.assert.deepEqual(second.takeRunErrors(), []);
            scope.assert.deepEqual(first.takeRunErrors(), []);
            scope.assert.equal(first.takeAttemptErrors(guardCase(), { index: 0 }).length, 2);
        } finally {
            first.takeRunErrors();
            second.takeRunErrors();
        }
        return scope.assert.collect();
    }),
    test('excludes infrastructure without disabling test diagnostics', async function (scope) {
        const observed = policy();
        const testCase = guardCase();
        const listener = function receiveInfrastructureMessage(): void {
            return undefined;
        };
        try {
            await observed.runAttempt(testCase, { index: 0 }, async function exerciseOwnership() {
                withRunnerInfrastructure(function infrastructureEffects() {
                    publishDiagnostics();
                    process.on('message', listener);
                });
                publishDiagnostics();
            });
            scope.assert.deepEqual(
                observed.takeAttemptErrors(testCase, { index: 0 }).map(function subtype(error) {
                    return error.subtype;
                }),
                [ 'runtime-policy', 'permission' ]
            );
            scope.assert.deepEqual(observed.takeRunErrors(), []);
        } finally {
            process.removeListener('message', listener);
            observed.takeRunErrors();
        }
        return scope.assert.collect();
    }),
    test('retains late console and permission origins without blaming the next attempt', async function (scope) {
        const observed = policy();
        const testCase = guardCase();
        const late = await observed.runAttempt(testCase, { index: 0 }, async function captureOrigin() {
            return new AsyncResource('finished guard attempt');
        });
        scope.cleanup(function closeLateObservation() {
            late.emitDestroy();
            observed.takeRunErrors();
        });
        await observed.runAttempt(testCase, { index: 1 }, async function nextAttempt() {
            late.runInAsyncScope(publishDiagnostics);
        });
        const errors = observed.takeRunErrors();
        scope.assert.partialDeepEqual(errors, [
            { subtype: 'attribution-drift', attributedTo: null },
            { subtype: 'attribution-drift', attributedTo: null }
        ]);
        scope.assert.partialDeepEqual(errors[0]?.cause, {
            origin: { case: testCase.id, work: testCase.workId, attempt: { index: 0 } }
        });
        scope.assert.deepEqual(observed.takeAttemptErrors(testCase, { index: 1 }), []);
        return scope.assert.collect();
    }),
    test('stops native subscriptions after failure and ignores later direct reports', async function (scope) {
        const listenersBefore = process.listenerCount('newListener');
        const created = await withExecutionObservation(async function failedBoundary() {
            const observed = policy();
            await scope.assert.rejects(async function failCollection() {
                return await observed.runLoad(async function failedImport() {
                    throw new Error('guard collection sentinel');
                });
            }, { message: 'guard collection sentinel' });
            return observed;
        });
        scope.assert.equal(process.listenerCount('newListener'), listenersBefore);
        external.runInAsyncScope(publishDiagnostics);
        created.takeRunErrors();
        created.recordViolation('console', 'after stop', 'observed');
        scope.assert.deepEqual(created.takeRunErrors(), []);
        return scope.assert.collect();
    }),
    test('tracks test promises while excluding infrastructure promises', async function (scope) {
        const monitor = createAsyncLeakMonitor();
        const testCase = guardCase();
        const pending = await monitor.runCase(testCase, async function allocatePromises() {
            const infrastructure = withRunnerInfrastructure(function pendingInfrastructure() {
                return Promise.withResolvers<undefined>();
            });
            return { infrastructure, test: Promise.withResolvers<undefined>() };
        });
        scope.cleanup(function settleTrackedPromises() {
            pending.infrastructure.resolve(undefined);
            pending.test.resolve(undefined);
            monitor.stop();
        });
        scope.assert.partialDeepEqual(monitor.casePromiseLeakError(testCase)?.cause, { pendingPromiseCount: 1 });
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
