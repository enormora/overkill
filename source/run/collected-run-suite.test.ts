import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as budgets } from '../invocation-budget.test.ts';
import { testNode as executionFailure } from './execution-failure.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'public collected runner lifecycle',
    annotations: {},
    controls: {},
    children: [ executionFailure, budgets ]
});

await runIfMain(import.meta, testNode);
