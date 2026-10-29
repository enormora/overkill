import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as policy } from './run-record-policy.test.ts';
import { testNode as session } from './run-record-session.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'run record persistence',
    annotations: {},
    controls: {},
    children: [ session, policy ]
});
await runIfMain(import.meta, testNode);
