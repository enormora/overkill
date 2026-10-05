import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';
import { coveredValue } from './coverage-source.ts';

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'covers a source with a broken map',
    body(scope) {
        scope.assert.equal(coveredValue(), 42);
        return scope.assert.collect();
    }
});
//# sourceMappingURL=coverage-missing.map
