import { skippedTest, suite } from '../../../packages/test/test.entry-point.ts';

export const testNode = suite('fixture', [
    skippedTest('skips', 'unsupported platform')
]);
