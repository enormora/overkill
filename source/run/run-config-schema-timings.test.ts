import { safeParse } from '@schema-hub/zod-error-formatter';
import {
    createSuite as createOverkillSuite,
    createTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { timingProfilePolicySchema } from './run-config-schema.ts';

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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-schema-timings.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'timing profile schema accepts collection modes',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                assertValidationSuccess(scope, { collection: 'summary' });
                assertValidationSuccess(scope, { collection: 'precise' });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'timing profile schema rejects missing collection and extra fields',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                assertValidationFailure(
                    scope,
                    { extra: true },
                    [ 'at collection: missing property', 'unexpected additional property: "extra"' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});
