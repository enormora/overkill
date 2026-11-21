import { defineMacro, suite, table, test } from '@overkill-dev/test';

import { safeParse } from '@schema-hub/zod-error-formatter';

import { timingProfilePolicySchema } from './schema.ts';

const assertValidationFailure = defineMacro((title: string, data: unknown, expectedIssues: readonly string[]) =>
    test(title, (scope) => {
        const result = safeParse(timingProfilePolicySchema, data);

        if (result.success) {
            scope.assert.fail({ message: 'Validation succeeded but a failure was expected' });

            return scope.assert.collect();
        }

        scope.assert.deepEqual(result.error.issues, expectedIssues);

        return scope.assert.collect();
    })
);

export const testNode = suite('Timing profile schema', [
    table({
        title: 'accepts collection modes',
        cases: [ 'summary', 'precise' ] as const,
        caseTitle(mode) {
            return mode;
        },
        test(scope) {
            const result = safeParse(timingProfilePolicySchema, { collection: scope.parameters });
            scope.assert.true(result.success);
            if (result.success) {
                scope.assert.deepEqual(result.data, { collection: scope.parameters });
            }
            return scope.assert.collect();
        }
    }),
    assertValidationFailure('rejects missing collection and extra fields', { extra: true }, [
        'at collection: missing property',
        'unexpected additional property: "extra"'
    ])
]);
