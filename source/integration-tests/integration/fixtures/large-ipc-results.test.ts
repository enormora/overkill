import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';
import { coveredValue } from './coverage-source.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'large IPC results',
    children: Array.from({ length: 32 }, function largeCase(_, index) {
        return createTestCase({
            ...metadata,
            title: `${index}:${'x'.repeat(32_768)}`,
            body(scope) {
                scope.assert.equal(coveredValue(), 42);
                return scope.assert.collect();
            }
        });
    })
});
