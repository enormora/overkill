import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                setTimeout(function ignoredTimer() {
                    return undefined;
                }, 1);

                return scope.assert.collect();
            },
            metadata: {},
            name: 'creates a timer'
        })
    ],
    metadata: {},
    name: 'fixture'
});
