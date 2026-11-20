import { suite } from '@overkill-dev/test';

import { testNode as maintenance } from './calibration-maintenance.test.ts';
import { testNode as publication } from './benchmark-baseline-publication.test.ts';
import { testNode as capture } from './calibration-capture-session.test.ts';

import { testNode as hostTestNode } from './benchmark-host-suite.test.ts';
import { testNode as placementTestNode } from './benchmark-placement-suite.test.ts';

export const testNode = suite('benchmark baseline execution', [
    capture,
    publication,
    maintenance,
    hostTestNode,
    placementTestNode
]);
