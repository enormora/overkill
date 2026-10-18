import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as hostObserverTestNode } from '../integration-tests/run/runner-benchmark-host.test.ts';
import { testNode as hostReportTestNode } from './benchmark-host-report.test.ts';
import { testNode as hostAdmissionTestNode } from './benchmark-host-admission.test.ts';
import { testNode as hostTestNode } from './benchmark-host.test.ts';
import { testNode as hostUnavailableTestNode } from './benchmark-host-unavailable.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'benchmark host observations',
    children: [ hostTestNode, hostAdmissionTestNode, hostReportTestNode, hostUnavailableTestNode, hostObserverTestNode ]
});
