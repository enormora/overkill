import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as budgetDeltas } from './benchmark-deltas.test.ts';
import { testNode as baselines } from './benchmark-html-baselines.test.ts';
import { testNode as distributions } from './benchmark-html-distribution.test.ts';
import { testNode as evidence } from './benchmark-html-evidence.test.ts';
import { testNode as timelines } from './benchmark-html-timeline.test.ts';

export const testNode = authoredSuite('benchmark HTML', [
    baselines,
    distributions,
    evidence,
    timelines,
    budgetDeltas
]);
