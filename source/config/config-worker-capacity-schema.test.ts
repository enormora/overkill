import { safeParse } from '@schema-hub/zod-error-formatter';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { integrationExecutionSchema } from './schema.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/config/config-worker-capacity-schema.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'integration execution schema rejects invalid worker maximums',
            body(scope: OverkillScope) {
                for (const maxWorkers of [ 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1 ]) {
                    const result = safeParse(integrationExecutionSchema, {
                        maxWorkers,
                        processModel: 'worker-pool',
                        scheduling: 'serial'
                    });

                    scope.assert.equal(result.success, false);
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
