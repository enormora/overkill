import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                process.exit(0);

                return scope.assert.collect();
            },
            metadata: {},
            name: 'exits process'
        })
    ],
    metadata: {},
    name: 'fixture'
});
