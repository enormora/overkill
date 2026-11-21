import { suite, skippedTest } from '@overkill-dev/test';

export const testNode = suite('fixture', [
    skippedTest('skips', 'unsupported platform')
]);
