import { testNode as calibration } from '../bench/host-calibration.test.ts';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as boundaries } from './performance-boundaries.test.ts';
import { testNode as store } from './performance-store.test.ts';
import { testNode as plan } from './performance-plan.test.ts';

export const testNode = suite('performance baselines', [ store, plan, calibration, boundaries ]);
