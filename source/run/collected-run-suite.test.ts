import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as budgets } from '../invocation-budget.test.ts';
import { testNode as executionFailure } from './execution-failure.test.ts';
import { testNode as selectionPolicy } from './collected-invocation-policy.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'public collected runner lifecycle',
    annotations: {},
    controls: {},
    children: [
        selectionPolicy,
        executionFailure,
        budgets
    ]
});

await runIfMain(import.meta, testNode);
