import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as maintenance } from './calibration-maintenance.test.ts';
import { testNode as publication } from './benchmark-baseline-publication.test.ts';
import { testNode as capture } from './calibration-capture-session.test.ts';

import { testNode as hostTestNode } from './benchmark-host-suite.test.ts';
import { testNode as placementTestNode } from './benchmark-placement-suite.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ capture, publication, maintenance, hostTestNode, placementTestNode ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'benchmark baseline execution'
});
