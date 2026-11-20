import { suite } from '@overkill-dev/test';

import { testNode as recordedCoverageRunTestNode } from '../../../run/recorded-coverage-run.test.ts';
import { testNode as runnerCoverageRecordsTestNode } from '../../run/runner-coverage-records.test.ts';

export const testNode = suite('persistence coverage integration', [
    recordedCoverageRunTestNode,
    runnerCoverageRecordsTestNode
]);
