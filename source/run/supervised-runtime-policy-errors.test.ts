import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-runtime-policy-errors.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title:
                'deduplicatedChildRuntimePolicyErrors() drops child process.env errors already observed by the supervisor',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'deduplicatedChildRuntimePolicyErrors() preserves process.env errors for another boundary',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'deduplicatedChildRuntimePolicyErrors() preserves non-env errors',
            annotations: {},
            controls: {},
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
