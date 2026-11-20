import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as recordTests } from './implementation-record.test.ts';

export const testNode = authoredSuite('portable implementation runs', [ recordTests ]);
