import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { safeParse } from '@schema-hub/zod-error-formatter';

import { timingProfilePolicySchema } from './schema.ts';

function assertValidationSuccess(scope: TestScope, data: unknown): void {
    const result = safeParse(timingProfilePolicySchema, data);

    if (!result.success) {
        scope.assert.fail({ message: `Validation failed with: ${result.error.message}` });

        return;
    }

    scope.assert.deepEqual(result.data, data);
}

function assertValidationFailure(
    scope: TestScope,
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

export const testNode: TestNode = suite('Timing profile schema', [
    test('accepts collection modes', function (scope) {
        assertValidationSuccess(scope, { collection: 'summary' });
        assertValidationSuccess(scope, { collection: 'precise' });

        return scope.assert.collect();
    }),
    test('rejects missing collection and extra fields', function (scope) {
        assertValidationFailure(
            scope,
            { extra: true },
            [ 'at collection: missing property', 'unexpected additional property: "extra"' ]
        );

        return scope.assert.collect();
    })
]);
