import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as budgets } from '../invocation-budget.test.ts';
import { testNode as collection } from './initialized-run.test.ts';
import { testNode as execution } from './collected-run.test.ts';
import { testNode as policy } from './collected-run-policy.test.ts';
import { testNode as coverage } from './collected-run-coverage.test.ts';
import { testNode as executionSession } from './execution-session.test.ts';
import { testNode as executionFailure } from './execution-failure.test.ts';
import { testNode as boundaries } from './collected-run-boundaries.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'public collected runner lifecycle',
    annotations: {},
    controls: {},
    children: [ collection, execution, policy, coverage, boundaries, executionSession, executionFailure, budgets ]
});

await runIfMain(import.meta, testNode);
