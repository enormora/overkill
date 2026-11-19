import { suite } from '@overkill-dev/test';

import { testNode as runIfMainOptionsTestNode } from './run-if-main-options.test.ts';
import { testNode as runIfMainProfileFileSetsTestNode } from './run-if-main-profile-file-sets.test.ts';
import { testNode as runIfMainSelectionTestNode } from './run-if-main-selection.test.ts';
import { testNode as runIfMainTestNode } from './run-if-main.test.ts';
import { testNode as directEntrypointSerializationTestNode } from './direct-entrypoint-serialization.test.ts';
import { testNode as runLocalTestPlanObservationTestNode } from './run-local-test-plan-observation.test.ts';

export const testNode = suite('source/run/run-if-main-suite.test.ts', [
    directEntrypointSerializationTestNode,
    runLocalTestPlanObservationTestNode,
    runIfMainOptionsTestNode,
    runIfMainProfileFileSetsTestNode,
    runIfMainSelectionTestNode,
    runIfMainTestNode
]);
