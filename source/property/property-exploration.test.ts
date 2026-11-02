import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as regressions } from './property-regressions.test.ts';
import { testNode as exhaustive } from './property-exhaustive.test.ts';
import { testNode as targeting } from './property-targets.test.ts';

export const testNode = suite('property exploration', [
    regressions,
    exhaustive,
    targeting
]);
