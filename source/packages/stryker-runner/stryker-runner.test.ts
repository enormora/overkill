import { suite } from '../test/test.entry-point.ts';
import { testNode as sandbox } from './mutation-sandbox-policy.test.ts';
import { testNode as profileTestNode } from './microtest-profile.test.ts';
import { testNode as instrumentationTestNode } from './instrumentation-context.test.ts';
import { testNode as coverageTestNode } from './mutation-coverage.test.ts';
import { testNode as catalogTestNode } from './mutation-catalog.test.ts';
import { testNode as dryRunTestNode } from './dry-run-results.test.ts';

import { testNode as invocations } from './mutation-invocation-suite.test.ts';

import { testNode as campaignClient } from './campaign-client.test.ts';

import { testNode as campaignWorker } from './campaign-worker.test.ts';

export const testNode = suite('Stryker runner', [
    sandbox,
    profileTestNode,
    instrumentationTestNode,
    coverageTestNode,
    catalogTestNode,
    dryRunTestNode,
    invocations,
    campaignClient,
    campaignWorker
]);
