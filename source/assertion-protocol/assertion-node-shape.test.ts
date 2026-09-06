import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);
