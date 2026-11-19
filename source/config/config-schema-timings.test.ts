import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { safeParse } from '@schema-hub/zod-error-formatter';

import { timingProfilePolicySchema } from './schema.ts';

function assertValidationSuccess(scope: OverkillScope, data: unknown): void {
    const result = safeParse(timingProfilePolicySchema, data);

    if (!result.success) {
        scope.assert.fail({ message: `Validation failed with: ${result.error.message}` });

        return;
    }

    scope.assert.deepEqual(result.data, data);
}

function assertValidationFailure(
    scope: OverkillScope,
    data: unknown,
    expectedIssues: readonly string[]
): void {
    const result = safeParse(timingProfilePolicySchema, data);

    if (result.success) {
        scope.assert.fail({ message: 'Validation succeeded but a failure was expected' });

        return;
    }

    scope.assert.deepEqual(result.error.issues, expectedIssues);
}

export const testNode = suite('source/config/config-schema-timings.test.ts', [
    test('timing profile schema accepts collection modes', function (scope: OverkillScope) {
        assertValidationSuccess(scope, { collection: 'summary' });
        assertValidationSuccess(scope, { collection: 'precise' });

        return scope.assert.collect();
    }),
    test('timing profile schema rejects missing collection and extra fields', function (scope: OverkillScope) {
        assertValidationFailure(
            scope,
            { extra: true },
            [ 'at collection: missing property', 'unexpected additional property: "extra"' ]
        );

        return scope.assert.collect();
    })
]);
