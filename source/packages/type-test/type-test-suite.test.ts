import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as orchestration } from '../../run/adapter-execution.test.ts';
import { testNode as generated } from './generated-input-suite.test.ts';
import { testNode as adapter } from './adapter.test.ts';
import { testNode as origins } from './body-origin.test.ts';
import { testNode as assertions } from './assertion-reference.test.ts';

export const testNode = createSuite({
    title: 'type-test integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ generated, adapter, origins, assertions, orchestration ]
});
