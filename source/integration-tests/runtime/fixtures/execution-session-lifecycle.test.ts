import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'session lifecycle cases',
    children: [ 'first', 'second' ].map(function lifecycleCase(title) {
        return createTestCase({
            ...metadata,
            title,
            body(scope) {
                scope.assert.equal(scope.signal.aborted, false);
                return scope.assert.collect();
            }
        });
    })
});
