import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';
export const testNode = createTestCase({
    definitionLocations: [ { kind: 'unknown' } ], annotations: {}, controls: {}, title: 'process policy case',
    async body(scope) {
        process.send?.({ userMessage: 'unexpected' });
await new Promise(() => {});
        return scope.assert.collect();
    }
});
