import { suite, test } from '@overkill-dev/test';

import type { CaseId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { deduplicatedChildRuntimePolicyErrors, deduplicatedRuntimePolicyErrors } from './supervised-run-state.ts';

const caseId: CaseId = {
    file: 'source/example.test.ts',
    title: 'case',
    params: null,
    suite: []
};

function runtimePolicyError(message: string, attributedTo: CaseId | null, capability: string): RunnerError {
    return {
        attributedToAttempt: null,
        attributedTo,
        cause: { capability },
        diagnostics: [ { label: 'capability', value: capability } ],
        message,
        subtype: 'runtime-policy'
    };
}

function reporterError(): RunnerError {
    return {
        attributedToAttempt: null,
        attributedTo: caseId,
        cause: {},
        diagnostics: [],
        message: 'Reporter failed after process.env output.',
        subtype: 'reporter'
    };
}

export const testNode = suite('Supervised runtime policy diagnostics', [
    test(
        'drops child process.env errors already observed by the supervisor',
        function (scope) {
            const childError = runtimePolicyError(
                'Runtime policy violation: process.env changed.',
                caseId,
                'process-env'
            );
            const supervisorError = runtimePolicyError(
                'Runtime policy violation: process.env value was set: EXAMPLE.',
                caseId,
                'process-env'
            );

            scope.assert.deepEqual(
                deduplicatedChildRuntimePolicyErrors([ childError ], [ supervisorError ]),
                []
            );

            return scope.assert.collect();
        }
    ),
    test(
        'preserves process.env errors for another boundary',
        function (scope) {
            const childError = runtimePolicyError(
                'Runtime policy violation: process.env changed.',
                caseId,
                'process-env'
            );
            const supervisorError = runtimePolicyError(
                'Runtime policy violation: process.env value was set: EXAMPLE.',
                null,
                'process-env'
            );

            scope.assert.deepEqual(
                deduplicatedChildRuntimePolicyErrors([ childError ], [ supervisorError ]),
                [ childError ]
            );

            return scope.assert.collect();
        }
    ),
    test('preserves non-env errors', function (scope) {
        const childError = runtimePolicyError('Runtime policy violation: timer.', caseId, 'timer');
        const childReporterError = reporterError();

        scope.assert.deepEqual(
            deduplicatedChildRuntimePolicyErrors([ childError, childReporterError ], []),
            [ childError, childReporterError ]
        );

        return scope.assert.collect();
    }),
    test('deduplicatedRuntimePolicyErrors() keeps one process.env error per boundary', function (scope) {
        const traceError = runtimePolicyError(
            'Runtime policy violation: process.env value was set: EXAMPLE.',
            caseId,
            'process-env'
        );
        const childError = runtimePolicyError(
            'Runtime policy violation: process.env changed.',
            caseId,
            'process-env'
        );
        const reporter = reporterError();

        scope.assert.deepEqual(
            deduplicatedRuntimePolicyErrors([ traceError, childError, reporter ]),
            [ traceError, reporter ]
        );

        return scope.assert.collect();
    })
]);
