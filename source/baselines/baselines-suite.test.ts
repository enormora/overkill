import { testNode as calibration } from '../bench/host-calibration.test.ts';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as calibrationStoreTestNode } from './calibration-store.test.ts';
import { testNode as presentationTestNode } from './performance-presentation.test.ts';
import { testNode as boundaries } from './performance-boundaries.test.ts';
import { testNode as store } from './performance-store.test.ts';
import { testNode as plan } from './performance-plan.test.ts';
import { testNode as normalized } from './normalized-performance.test.ts';
import { testNode as observations } from './performance-observation.test.ts';

export const testNode = suite('performance baselines', [
    calibrationStoreTestNode,
    store,
    plan,
    normalized,
    observations,
    calibration,
    boundaries,
    presentationTestNode
]);
