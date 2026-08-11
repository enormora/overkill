import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { assertionSources } from './assertion-node-shape.ts';

export const testSuite = createOverkillSuite({
    name: 'source/assertion-protocol/assertion-node-shape.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'assertionSources declares the built-in assertion origins',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(assertionSources, [ 'assert', 'require' ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
