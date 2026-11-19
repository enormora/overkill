import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { safeParse } from '@schema-hub/zod-error-formatter';

import { integrationExecutionSchema } from './schema.ts';

export const testNode = suite('source/config/config-worker-capacity-schema.test.ts', [
    test('integration execution schema rejects invalid worker maximums', function (scope: OverkillScope) {
        for (const maxWorkers of [ 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1 ]) {
            const result = safeParse(integrationExecutionSchema, {
                maxWorkers,
                processModel: 'worker-pool',
                scheduling: 'serial'
            });

            scope.assert.equal(result.success, false);
        }

        return scope.assert.collect();
    })
]);
