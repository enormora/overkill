import { testNode as lifecycleTestNode } from '../../integration-tests/run/runner-stryker-lifecycle.test.ts';
import { suite } from '../test/test.entry-point.ts';
import { testNode as profileTestNode } from './microtest-profile.test.ts';
import { testNode as settingsTestNode } from './runner-options.test.ts';
import { testNode as policyTestNode } from './mutation-execution-policy.test.ts';
import { testNode as sandboxTestNode } from './mutation-sandbox.test.ts';
import { testNode as resultsTestNode } from './mutation-results.test.ts';
import { testNode as instrumentationTestNode } from './instrumentation-context.test.ts';

export const testNode = suite('Stryker runner', [
    profileTestNode,
    settingsTestNode,
    policyTestNode,
    sandboxTestNode,
    resultsTestNode,
    instrumentationTestNode,
    lifecycleTestNode
]);
