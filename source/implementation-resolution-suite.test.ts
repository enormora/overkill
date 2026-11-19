import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as sourceTests } from './implementation-source.test.ts';

import { testNode as deliveryTests } from './module-delivery.test.ts';

export const testNode = authoredSuite('portable module resolution', [ sourceTests, deliveryTests ]);
