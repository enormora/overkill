import { suite } from '@overkill-dev/test';
import { testNode as observationTestNode } from '../../run/execution-session-observation.test.ts';
import { testNode as historyTestNode } from '../../run/history-suite.test.ts';

import { testNode as baselineTestNode } from '../../run/benchmark-baseline-suite.test.ts';
import { testNode as runTestNode } from '../../run/run-suite.test.ts';
import { testNode as mutationTestNode } from '../../packages/stryker-runner/stryker-runner.test.ts';
import { testNode as sourceContracts } from './source-contracts.ts';
import { testNode as attachmentContracts } from './attachment-contracts.ts';
import { testNode as runnerPolicy } from './runner-policy.ts';
import { testNode as coverageLifecycle } from './coverage-lifecycle.ts';

export const testNode = suite('runner and integrations', [
    coverageLifecycle,
    runnerPolicy,
    attachmentContracts,
    sourceContracts,
    historyTestNode,
    runTestNode,
    mutationTestNode,
    observationTestNode,
    baselineTestNode
]);
