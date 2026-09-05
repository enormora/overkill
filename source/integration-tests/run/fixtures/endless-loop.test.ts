import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createTestCase({
    body(scope) {
        while (Date.now() >= 0) {
            if (process.pid < 0) {
                break;
            }
        }

        return scope.assert.collect();
    },
    metadata: {},
    title: 'loops'
});
