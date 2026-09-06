import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                process.on('message', function ignoredMessageListener() {
                    return undefined;
                });

                return scope.assert.collect();
            },
            metadata: {},
            title: 'registers ipc listener'
        })
    ],
    metadata: {},
    title: 'fixture'
});
