import { channel } from 'node:diagnostics_channel';
import { suite, test } from '@overkill-dev/test';

import { defineReporter } from '../../../packages/engine/engine.entry-point.ts';
import { collectedRunCommand, collectLifecycleRun } from '../../../test-support/collected-run-fixtures.ts';
import { equals } from '../../../run/run-selection-filters.ts';

const firstCase = { selection: { kind: 'filter', filter: equals('title', 'first') } } as const;

export const testNode = suite('collected runner policy and delivery', [
    test(
        'explicit capability policy remains fixed while assertion requirements stay active',
        async function (scope) {
            const command = collectedRunCommand();
            const { collected, state } = await collectLifecycleRun({
                ...command,
                request: {
                    ...command.request,
                    capabilityRestrictions: { mode: 'disabled' }
                }
            });
            state.mode = 'console';
            const allowed = await collected.run(firstCase);
            state.mode = 'no-assertions';
            const missingAssertions = await collected.run(firstCase);
            state.mode = 'pass';
            const passed = await collected.run(firstCase);
            scope.assert.deepEqual({
                allowedErrors: allowed.runnerErrors,
                statuses: [ allowed.status, missingAssertions.status, passed.status ]
            }, { allowedErrors: [], statuses: [ 'passed', 'failed', 'passed' ] });
            return scope.assert.collect();
        }
    ),
    test(
        'console checks remain active on reruns and subscriptions stop before returning',
        async function (scope) {
            const { collected, state } = await collectLifecycleRun(collectedRunCommand());
            const before = {
                subscribers: channel('console.log').hasSubscribers,
                listeners: process.listenerCount('newListener')
            };
            state.mode = 'console';
            const denied = await collected.run(firstCase);
            state.mode = 'pass';
            const passed = await collected.run(firstCase);
            scope.assert.deepEqual({
                subscribersStopped: channel('console.log').hasSubscribers === before.subscribers,
                listenersStopped: process.listenerCount('newListener') === before.listeners,
                denied: denied.runnerErrors.map(function deniedCase(error) {
                    return [ error.subtype, error.attributedTo?.title ];
                }),
                passed: [ passed.status, passed.runnerErrors.length ],
                statuses: [ denied.status, passed.status ]
            }, {
                subscribersStopped: true,
                listenersStopped: true,
                denied: [ [ 'runtime-policy', 'first' ] ],
                passed: [ 'passed', 0 ],
                statuses: [ 'failed', 'passed' ]
            });
            return scope.assert.collect();
        }
    ),
    test('body and scope cleanup failures leave the collected plan runnable', async function (scope) {
        const { collected, state } = await collectLifecycleRun(collectedRunCommand());
        state.mode = 'throw';
        const bodyFailure = await collected.run(firstCase);
        state.mode = 'cleanup-error';
        const cleanupFailure = await collected.run(firstCase);
        state.mode = 'pass';
        const passed = await collected.run(firstCase);
        scope.assert.deepEqual({
            cleanupCount: state.cleanupCount,
            results: [ bodyFailure.perTest.length, cleanupFailure.perTest.length, passed.perTest.length ],
            statuses: [ bodyFailure.status, cleanupFailure.status, passed.status ]
        }, { cleanupCount: 3, results: [ 1, 1, 1 ], statuses: [ 'failed', 'failed', 'passed' ] });
        return scope.assert.collect();
    }),
    test('reporter delivery tracks only errors from its own invocation', async function (scope) {
        const command = collectedRunCommand();
        const reporter = defineReporter(function createTerminalReporter() {
            return {
                dispose: null,
                kind: 'real-time',
                name: 'terminal',
                onEvent() {
                    return undefined;
                },
                onFinish() {
                    return undefined;
                },
                sinks: [ { kind: 'stderr-raw' } ]
            };
        });
        const { collected, state } = await collectLifecycleRun({
            ...command,
            config: { ...command.config, reporters: [ reporter ] }
        });
        state.mode = 'console';
        const denied = await collected.runWithReporterDelivery(firstCase);
        state.mode = 'pass';
        const passed = await collected.runWithReporterDelivery(firstCase);
        scope.assert.deepEqual({
            denied: denied.deliveredRunnerErrors.map(function errorSubtype(error) {
                return error.subtype;
            }),
            undelivered: denied.undeliveredRunnerErrors,
            passed: [
                passed.result.status,
                passed.deliveredRunnerErrors.length,
                passed.undeliveredRunnerErrors.length
            ]
        }, { denied: [ 'runtime-policy' ], undelivered: [], passed: [ 'passed', 0, 0 ] });
        return scope.assert.collect();
    }),
    test(
        'reporter construction failures release invocation ownership and policy observations',
        async function (scope) {
            const command = collectedRunCommand();
            let attempts = 0;
            const reporter = defineReporter(function createRetryableReporter() {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('reporter setup failed');
                }
                return {
                    dispose: null,
                    kind: 'real-time',
                    name: 'memory',
                    onEvent() {
                        return undefined;
                    },
                    onFinish() {
                        return undefined;
                    },
                    sinks: [ { kind: 'memory' } ]
                };
            });
            const { collected } = await collectLifecycleRun({
                ...command,
                config: { ...command.config, reporters: [ reporter ] }
            });
            const listeners = process.listenerCount('newListener');
            await scope.assert.rejects(async function runWithFailedReporter() {
                await collected.run(firstCase);
            }, { message: 'reporter setup failed' });
            const passed = await collected.run(firstCase);
            scope.assert.deepEqual({
                attempts,
                listenersStopped: process.listenerCount('newListener') === listeners,
                status: passed.status
            }, {
                attempts: 2,
                listenersStopped: true,
                status: 'passed'
            });
            return scope.assert.collect();
        }
    ),
    test('invalid invocation selections reject and release the invocation guard', async function (scope) {
        const { collected } = await collectLifecycleRun(collectedRunCommand());
        await scope.assert.rejects(async function runInvalidFilter() {
            await collected.run({
                selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: '' } }
            });
        }, { message: /non-empty string/u });
        const selection = { kind: 'all' as const, assertion: 1 };
        await scope.assert.rejects(async function runNestedSelection() {
            await collected.run({ selection });
        }, { message: /Unrecognized key/u });
        const result = await collected.run(firstCase);
        scope.assert.deepEqual([ result.status, result.summary.planned ], [ 'passed', 1 ]);
        return scope.assert.collect();
    })
]);
