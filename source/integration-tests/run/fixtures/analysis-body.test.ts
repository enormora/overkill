import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    title: 'analysis body', annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ],
    children: [ createTestCase({
        title: 'does not execute', annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ],
        body() {
            throw new Error('Analysis executed a runtime body.');
        }
    }) ]
});
