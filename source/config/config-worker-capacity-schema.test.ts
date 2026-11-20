import { type TestNode, suite, test } from '@overkill-dev/test';

import { safeParse } from '@schema-hub/zod-error-formatter';

import { integrationExecutionSchema } from './schema.ts';

export const testNode: TestNode = suite('Configuration worker capacity schema', [
    test('integration execution schema rejects invalid worker maximums', function (scope) {
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
