import { suite as authoredSuite } from '@overkill-dev/test';
import { testNode as commands } from '../run/benchmark-command-routing.test.ts';
import { testNode as calibration } from '../bench/host-calibration.test.ts';

import { testNode as storage } from './performance-storage-policy.test.ts';
import { testNode as boundaries } from './performance-boundaries.test.ts';
import { testNode as normalized } from './normalized-performance.test.ts';
import { testNode as sharedPlanning } from './baseline-planning.test.ts';
import { testNode as presentationTestNode } from './performance-presentation.test.ts';
import { testNode as plan } from './performance-plan.test.ts';
import { testNode as observations } from './performance-observation.test.ts';

export const testNode = authoredSuite('performance baselines', [
    boundaries,
    commands,
    storage,
    normalized,
    sharedPlanning,
    plan,
    observations,
    calibration,
    presentationTestNode
]);
