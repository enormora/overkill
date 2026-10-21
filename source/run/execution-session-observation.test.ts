import { suite, test } from '../packages/test/test.entry-point.ts';
import { InvocationDeadlineExceededError } from '../invocation-budget.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createExecutionDataObservation, observedReply } from './execution-session-observation.ts';
import type { ExecutionSessionCall } from './execution-session-runtime-types.ts';

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

export const testNode = suite(
    'interrupted execution evidence',
    ([ 'timeout', 'missing-data' ] as const).map(function interruptedDelivery(interruption) {
        return test(`preserves parent-owned artifacts after ${interruption}`, function (scope) {
            const result = runResultFactory.build({
                artifacts: [ {
                    id: {
                        attempt: null,
                        runtimes: [],
                        scope: { kind: 'run' },
                        sequence: 0,
                        subtype: 'log-capture',
                        workload: null
                    },
                    source: 'boundary-captured',
                    payload: {
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
    })
);
