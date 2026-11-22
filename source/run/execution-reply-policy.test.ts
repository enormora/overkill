import { table, suite, test } from '@overkill-dev/test';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { RunnerError } from '../engine/run-result.ts';
import {
    createExecutionDataObservation,
    observeExecutionMessage,
    observedReply
} from './execution-session-observation.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';
import { supervisedChildCorrelationId } from './supervised-protocol.ts';
import type { ExecutionSessionCall } from './execution-session-runtime-types.ts';

function call(signal: AbortSignal): ExecutionSessionCall {
    return {
        signal,
        timeoutMilliseconds: 100,
        transport: { lifecycle: { moduleUrl: import.meta.url, exportName: 'unused' }, data: null },
        async checkpoint() {
            return undefined;
        }
    };
}
function crash(termination: 'cancelled' | 'hard-timeout' | null): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null,
        cause: { termination },
        diagnostics: [],
        message: 'worker stopped',
        subtype: 'crash'
    };
}
export const testNode = suite('execution reply policy', [
    test('keeps the last checkpoint until final lifecycle data arrives', function (scope) {
        const observation = createExecutionDataObservation();
        observeExecutionMessage(
            observation,
            childProcessEnvelope(supervisedChildCorrelationId, { kind: 'execution-checkpoint', data: { step: 1 } })
        );
        scope.assert.false(observation.delivered.read());
        observeExecutionMessage(
            observation,
            childProcessEnvelope(supervisedChildCorrelationId, { kind: 'execution-data', data: { step: 2 } })
        );
        const reply = observedReply(runResultFactory.build(), call(scope.signal), observation);
        scope.assert.partialDeepEqual<unknown, unknown>(reply, {
            kind: 'result',
            data: { step: 2 },
            deadlineExceeded: false
        });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects replies arriving after final lifecycle data',
        cases: [ 'execution-data', 'execution-checkpoint' ] as const,
        caseTitle(kind) {
            return kind;
        },
        test(scope) {
            const kind = scope.parameters;

            const observation = createExecutionDataObservation();
            observeExecutionMessage(
                observation,
                childProcessEnvelope(supervisedChildCorrelationId, { kind: 'execution-data', data: 'final' })
            );
            observeExecutionMessage(
                observation,
                childProcessEnvelope(supervisedChildCorrelationId, { kind, data: 'duplicate' })
            );
            const reply = observedReply(runResultFactory.build(), call(scope.signal), observation);
            scope.assert.partialDeepEqual<unknown, unknown>(reply, {
                kind: 'failure',
                data: 'final',
                failure: { message: 'Duplicate execution lifecycle data.' }
            });
            scope.assert.true(observation.invalid.signal.aborted);
            return scope.assert.collect();
        }
    }),
    test('uses child plan counts while retaining parent result evidence', function (scope) {
        const observation = createExecutionDataObservation();
        const parent = runResultFactory.build({ summary: { planned: 2 } });
        const child = runResultFactory.build({ summary: { planned: 7 }, planStatus: 'empty-selection' });
        observeExecutionMessage(
            observation,
            childProcessEnvelope(supervisedChildCorrelationId, { kind: 'result', result: child })
        );
        observeExecutionMessage(
            observation,
            childProcessEnvelope(supervisedChildCorrelationId, { kind: 'execution-data', data: null })
        );
        const reply = observedReply(parent, call(scope.signal), observation);
        scope.assert.partialDeepEqual<unknown, unknown>(reply, {
            kind: 'result',
            result: { planStatus: 'empty-selection', summary: { planned: 7 } }
        });
        return scope.assert.collect();
    }),
    table({
        title: 'classifies missing lifecycle data after termination',
        cases: [ 'cancelled', 'hard-timeout', null ] as const,
        caseTitle: String,
        test(scope) {
            const termination = scope.parameters;

            const observation = createExecutionDataObservation();
            const reply = observedReply(
                runResultFactory.build({ runnerErrors: [ crash(termination) ] }),
                call(scope.signal),
                observation
            );
            scope.assert.equal(reply.kind, termination === 'hard-timeout' ? 'timeout' : 'failure');
            return scope.assert.collect();
        }
    }),
    test('preserves explicit cancellation when child only reports crashes', function (scope) {
        const controller = new AbortController();
        controller.abort(new Error('caller cancelled'));
        const reply = observedReply(
            runResultFactory.build({ runnerErrors: [ crash('cancelled') ] }),
            call(controller.signal),
            createExecutionDataObservation()
        );
        scope.assert.partialDeepEqual<unknown, unknown>(reply, {
            kind: 'failure',
            failure: { message: 'caller cancelled' }
        });
        return scope.assert.collect();
    }),
    test('ignores ordinary reporter events while waiting for lifecycle data', function (scope) {
        const observation = createExecutionDataObservation();
        observeExecutionMessage(
            observation,
            childProcessEnvelope(supervisedChildCorrelationId, {
                kind: 'event',
                event: { kind: 'runner-error', error: crash(null) }
            })
        );
        scope.assert.equal(observation.failure.read(), null);
        scope.assert.false(observation.delivered.read());
        return scope.assert.collect();
    })
]);
