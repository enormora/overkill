import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';
import { coveredValue } from './coverage-source.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                scope.assert.equal(coveredValue(), 42);

                return scope.assert.collect();
            },
            annotations: {},
            controls: {},
            title: 'covers source behavior'
        })
    ],
    annotations: {},
    controls: {},
    title: 'coverage fixture'
});
