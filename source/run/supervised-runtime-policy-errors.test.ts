import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { CaseId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { deduplicatedChildRuntimePolicyErrors } from './supervised-run-state.ts';

const caseId: CaseId = {
    file: 'source/example.test.ts',
    title: 'case',
    params: null,
    suite: []
};

function runtimePolicyError(message: string, attributedTo: CaseId | null, capability: string): RunnerError {
    return {
        attributedTo,
        cause: { capability },
        message,
        subtype: 'runtime-policy'
    };
}

function reporterError(): RunnerError {
    return {
        attributedTo: caseId,
        cause: {},
        message: 'Reporter failed after process.env output.',
        subtype: 'reporter'
    };
}

export const testSuite = createOverkillSuite({
    title: 'source/run/supervised-runtime-policy-errors.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title:
                'deduplicatedChildRuntimePolicyErrors() drops child process.env errors already observed by the supervisor',
            metadata: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            title: 'deduplicatedChildRuntimePolicyErrors() preserves process.env errors for another boundary',
            metadata: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            title: 'deduplicatedChildRuntimePolicyErrors() preserves non-env errors',
            metadata: {},
            body(scope: OverkillScope) {
                const childError = runtimePolicyError('Runtime policy violation: timer.', caseId, 'timer');
                const childReporterError = reporterError();

                scope.assert.deepEqual(
                    deduplicatedChildRuntimePolicyErrors([ childError, childReporterError ], []),
                    [ childError, childReporterError ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
