import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as platformPressure } from './platform-pressure-policy.test.ts';
import { testNode as hostReportTestNode } from './benchmark-host-report.test.ts';
import { testNode as garbageCollectionPolicyTestNode } from './benchmark-garbage-collection.test.ts';
import { testNode as hostTestNode } from './benchmark-host.test.ts';
import { testNode as hostUnavailableTestNode } from './benchmark-host-unavailable.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'benchmark host observations',
    children: [
        platformPressure,
        garbageCollectionPolicyTestNode,
        hostTestNode,
        hostReportTestNode,
        hostUnavailableTestNode
    ]
});
