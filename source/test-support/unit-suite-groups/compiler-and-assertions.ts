import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as typeTests } from '../../packages/type-test/type-test-suite.test.ts';
import { testNode as assertions } from './assert-and-run.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'assertions and compiler adapters',
    annotations: {},
    controls: {},
    children: [ typeTests, assertions ]
});
