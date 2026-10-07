import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';
export const testNode = createTestCase({
    definitionLocations: [ { kind: 'unknown' } ], annotations: {}, controls: {}, title: 'process policy case',
    async body(scope) {
        process.send?.({ kind: 'overkill-child-message', correlationId: 'supervised-run', message: { kind: 'result', result: { status: 'passed' } } });
await new Promise(() => {});
        return scope.assert.collect();
    }
});
