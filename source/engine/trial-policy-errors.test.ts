import { type TestNode, suite, test } from '@overkill-dev/test';

import { observationError } from '../test-support/observation-lifetime.ts';
import { propertyTrialWithPolicyErrors, propertyBoundary } from './property-trial-outcome.ts';
import type { ExecutedBody } from './body-result.ts';

const body: ExecutedBody = {
    bodyError: null,
    cleanupErrors: [],
    contractFailures: [],
    inconclusiveReason: null,
    requireFailed: false,
    runnerErrors: [],
    returnedAssertions: []
};
export const testNode: TestNode = suite('trial runtime policy completion', [
    test('converts a passing trial into a terminated trial with its policy error', function (scope) {
        const error = observationError();
        scope.assert.deepEqual(propertyTrialWithPolicyErrors({ kind: 'passed' }, [ error ]), {
            kind: 'terminated',
            result: { ...body, runnerErrors: [ error ] }
        });
        return scope.assert.collect();
    }),
    test('preserves prior trial errors when adding policy errors', function (scope) {
        const first = observationError();
        const second = { ...first, message: 'second' };
        const result = { ...body, runnerErrors: [ first ] };
        scope.assert.deepEqual(propertyTrialWithPolicyErrors({ kind: 'terminated', result }, [ second ]), {
            kind: 'terminated',
            result: { ...result, runnerErrors: [ first, second ] }
        });
        return scope.assert.collect();
    }),
    test('rejects a failed composite without a failing child', function (scope) {
        const child = {
            check: 'true' as const,
            actual: true,
            source: 'assert' as const,
            message: null,
            sourceLocations: [ { kind: 'unknown' as const } ] as const
        };
        scope.assert.throws(function () {
            propertyBoundary({
                check: 'composite',
                actual: true,
                expected: true,
                source: 'assert',
                message: null,
                sourceLocations: [ { kind: 'unknown' } ],
                name: 'boundary',
                summary: 'boundary',
                children: [ child ]
            });
        }, { message: 'Failed property composite requires a failed child.' });
        return scope.assert.collect();
    })
]);
