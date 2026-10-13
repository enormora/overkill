import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'cancellation cases',
    children: [
        createTestCase({
            ...metadata,
            title: 'earlier failure',
            body(scope) {
                scope.assert.equal(1, 2);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'wedged case',
            body() {
                while (true) {}
            }
        }),
        createTestCase({
            ...metadata,
            title: 'pending case',
            body(scope) {
                scope.assert.equal(3, 3);
                return scope.assert.collect();
            }
        })
    ]
});
