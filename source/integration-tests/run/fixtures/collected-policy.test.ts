import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

console.log('collection console policy violation');

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
export const testNode = createSuite({ ...metadata, title: 'collection policy', children: [ createTestCase({
    ...metadata,
    title: 'passes',
    body(scope) {
        scope.assert.true(true);
        return scope.assert.collect();
    }
}) ] });
