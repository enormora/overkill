import { suite } from '@overkill-dev/test';

import { testNode as baselineStoreTestNode } from '../../../run/baseline-store.test.ts';
import { testNode as baselineSessionTestNode } from '../../../run/baseline-session.test.ts';
import { testNode as baselineCommandsTestNode } from '../../../run/baseline-commands.test.ts';
import { testNode as baselineStorageTestNode } from '../../../run/baseline-storage.test.ts';
import { testNode as baselineFailureBoundariesTestNode } from '../../../run/baseline-failure-boundaries.test.ts';
import { testNode as runnerOrdinaryBaselinesTestNode } from '../../run/runner-ordinary-baselines.test.ts';

export const testNode = suite('persistence baselines integration', [
    baselineStoreTestNode,
    baselineSessionTestNode,
    baselineCommandsTestNode,
    baselineStorageTestNode,
    baselineFailureBoundariesTestNode,
    runnerOrdinaryBaselinesTestNode
]);
