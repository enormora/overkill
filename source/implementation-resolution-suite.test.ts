import { runIfMain } from '#test-runner';
import { suite } from './packages/test/test.entry-point.ts';
import { testNode as sourceTests } from './implementation-source.test.ts';

import { testNode as deliveryTests } from './module-delivery.test.ts';

export const testNode = suite('portable module resolution', [ sourceTests, deliveryTests ]);
await runIfMain(import.meta, testNode);
