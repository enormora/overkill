import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as coverageSources } from './coverage-sources.test.ts';
import { testNode as failureEvidence } from './failure-evidence.test.ts';

export const testNode = createSuite({
    title: 'source and artifact persistence',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ coverageSources, failureEvidence ]
});
