import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as regressions } from './property-regressions.test.ts';
import { testNode as exhaustive } from './property-exhaustive.test.ts';
import { testNode as targeting } from './property-targets.test.ts';

export const testNode = authoredSuite('property exploration', [
    regressions,
    exhaustive,
    targeting
]);
