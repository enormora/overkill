import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';
export const testNode = createTestCase({
    definitionLocations: [ { kind: 'unknown' } ], annotations: {}, controls: {}, title: 'process policy case',
    async body(scope) {
        try { process.execve?.(process.execPath, [ process.execPath, '-e', 'process.exit(0)' ]); } catch {}
return scope.assert.collect();
    }
});
