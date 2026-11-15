import { runInNewContext } from 'node:vm';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { InvocationDeadlineExceededError } from '../invocation-budget.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { permissionDeniedRunnerErrorFromDiagnostic } from '../engine/run-result.ts';
import {
    createExecutionDataObservation,
    observedReply,
    observeExecutionMessage,
    type ExecutionDataObservation
} from './execution-session-observation.ts';
import type { ExecutionSessionCall } from './execution-session-runtime-types.ts';
import type { RunExecutionReply } from './execution-session-types.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';
import { supervisedChildCorrelationId } from './supervised-protocol.ts';

type FailedDelivery = {
    readonly observation: ExecutionDataObservation;
    readonly cause: Error;
    readonly checkpoint: { readonly beforeFailure: boolean; };
};

type FailureReply = Extract<RunExecutionReply, { readonly kind: 'failure'; }>;

function failingDelivery(cause: Error): FailedDelivery {
    const checkpoint = { beforeFailure: true };
    const observation = createExecutionDataObservation();
    observation.data.write(checkpoint);
    return {
        cause,
        checkpoint,
        observation: {
            ...observation,
            data: {
                ...observation.data,
                write() {
                    throw cause;
                }
            }
        }
    };
}

function interruptedExecutionCall(interruption: 'missing-data' | 'timeout'): ExecutionSessionCall {
    const controller = new AbortController();
    if (interruption === 'timeout') {
        controller.abort(new InvocationDeadlineExceededError());
    }
    return {
        signal: controller.signal,
        timeoutMilliseconds: 1,
        transport: { lifecycle: { moduleUrl: import.meta.url, exportName: 'unused' }, data: null },
        async checkpoint() {
            await Promise.resolve();
        }
    };
}

function failedDeliveryReply(delivery: FailedDelivery): FailureReply {
    observeExecutionMessage(
        delivery.observation,
        childProcessEnvelope(supervisedChildCorrelationId, { kind: 'execution-data', data: 'replacement' })
    );
    const reply = observedReply(
        runResultFactory.build(),
        interruptedExecutionCall('missing-data'),
        delivery.observation
    );
    if (reply.kind !== 'failure') {
        throw new Error('Failed lifecycle delivery must produce a failure reply.');
    }
    return reply;
}

export const testNode = suite(
    'interrupted execution evidence',
    [
        ...([ 'timeout', 'missing-data' ] as const).map(function interruptedDelivery(interruption) {
            return test(`preserves parent-owned artifacts after ${interruption}`, function (scope) {
                const result = runResultFactory.build({
                    artifacts: [ {
                        id: {
                            familyVariant: null,
                            attempt: null,
                            runtimes: [],
                            scope: { kind: 'run' },
                            sequence: 0,
                            subtype: 'log-capture',
                            workload: null
                        },
                        source: 'boundary-captured',
                        payload: {
                            capture: 'automatic',
                            completeness: 'best-effort',
                            kind: 'captured-output',
                            byteLength: 6,
                            text: 'prefix',
                            stream: 'stdout',
                            truncated: true,
                            capturedAtMicroseconds: 0
                        }
                    } ]
                });
                const reply = observedReply(
                    result,
                    interruptedExecutionCall(interruption),
                    createExecutionDataObservation()
                );
                if (reply.kind === 'result') {
                    throw new Error('Missing lifecycle delivery must not produce a completed reply.');
                }
                scope.assert.equal(reply.kind, interruption === 'timeout' ? 'timeout' : 'failure');
                scope.assert.deepEqual(reply.artifacts, result.artifacts);
                return scope.assert.collect();
            });
        }),
        test('ignores lifecycle data from another execution correlation', function (scope) {
            const observation = createExecutionDataObservation();
            observeExecutionMessage(
                observation,
                childProcessEnvelope('unrelated-execution', {
                    kind: 'execution-data',
                    data: 'unrelated'
                })
            );
            scope.assert.equal(observation.failure.read(), null);
            scope.assert.equal(observation.data.read(), null);
            scope.assert.equal(observation.result.read(), null);
            scope.assert.false(observation.delivered.read());
            scope.assert.false(observation.invalid.signal.aborted);
            return scope.assert.collect();
        }),
        test('normalizes cross-realm delivery failures and retains checkpoint data', function (scope) {
            const delivery = failingDelivery(runInNewContext('new Error("Delivery failed.")') as Error);
            const reply = failedDeliveryReply(delivery);
            const retainedData: unknown = reply.data;
            scope.assert.equal(reply.failure.message, 'Invalid execution lifecycle data.');
            scope.assert.equal(reply.failure.cause, delivery.cause);
            scope.assert.deepEqual(retainedData, delivery.checkpoint);
            scope.assert.true(delivery.observation.invalid.signal.aborted);
            return scope.assert.collect();
        }),
        test('retains native delivery errors and checkpoint data', function (scope) {
            const delivery = failingDelivery(new Error('Delivery failed.'));
            const reply = failedDeliveryReply(delivery);
            const retainedData: unknown = reply.data;
            scope.assert.equal(reply.failure.message, 'Delivery failed.');
            scope.assert.equal(reply.failure.cause, undefined);
            scope.assert.deepEqual(retainedData, delivery.checkpoint);
            scope.assert.true(delivery.observation.invalid.signal.aborted);
            return scope.assert.collect();
        }),
        test('retains permission failures when a deadline expires before lifecycle delivery', function (scope) {
            const error = permissionDeniedRunnerErrorFromDiagnostic({
                channel: 'node:permission-model:fs',
                fallbackCapability: 'fs-write',
                message: { permission: 'FileSystemWrite', resource: '/denied' }
            }, {
                attributedTo: null,
                attributedToWork: null,
                boundary: null,
                diagnosticChannel: 'node:permission-model:fs',
                hook: null,
                phase: 'body'
            });
            const result = runResultFactory.build({ runnerErrors: [ error ] });
            const reply = observedReply(
                result,
                interruptedExecutionCall('timeout'),
                createExecutionDataObservation()
            );
            if (reply.kind !== 'result') {
                throw new Error('Permission failures must not become timeout-only replies.');
            }
            scope.assert.true(reply.deadlineExceeded);
            scope.assert.equal(reply.result, result);
            return scope.assert.collect();
        })
    ]
);
