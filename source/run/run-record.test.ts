import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as policy } from './run-record-policy.test.ts';
import { testNode as session } from './run-record-session.test.ts';
import { testNode as reasons } from './run-record-reasons.test.ts';
import { testNode as invocation } from './run-record-invocation.test.ts';
import { testNode as attachments } from './run-record-attachments.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'run record persistence',
    annotations: {},
    controls: {},
    children: [ session, policy, reasons, invocation, attachments ]
});
await runIfMain(import.meta, testNode);
