import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { assertionSources } from './assertion-node-shape.ts';

export const testSuite = createOverkillSuite({
    title: 'source/assertion-protocol/assertion-node-shape.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'assertionSources declares the built-in assertion origins',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(assertionSources, [ 'assert', 'require' ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
