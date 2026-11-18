import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as boundaries } from './boundary-failure-artifacts.test.ts';
import { testNode as terminalReports } from './run-result-reporting.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'integration failure artifacts',
    children: [ boundaries, terminalReports ]
});
await runIfMain(import.meta, testNode);
