import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            body() {
                return process.exit(0);
            },
            annotations: {},
            controls: {},
            title: 'exits process'
        })
    ],
    annotations: {},
    controls: {},
    title: 'fixture'
});
