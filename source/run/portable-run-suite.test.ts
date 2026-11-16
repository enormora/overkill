import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as executionTests } from './implementation-execution.test.ts';
import { testNode as recordTests } from './implementation-record.test.ts';

import { testNode as lifetimeTests } from './worker-implementation-plan.test.ts';

export const testNode = suite('portable implementation runs', [ executionTests, recordTests, lifetimeTests ]);
await runIfMain(import.meta, testNode);
