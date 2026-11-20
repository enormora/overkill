import { suite } from '@overkill-dev/test';

import { testNode as storagePolicy } from './history-storage-policy.test.ts';
import { testNode as operations } from './history-command-suite.test.ts';
import { testNode as reader } from './history-reader.test.ts';
import { testNode as repair } from './history-repair.test.ts';
import { testNode as storage } from './history-storage.test.ts';
import { testNode as outcomes } from './history-outcomes.test.ts';
import { testNode as retention } from './history-retention-suite.test.ts';
import { testNode as access } from './history-access-policy.test.ts';

export const testNode = suite('compact history', [
    storagePolicy,
    access,
    operations,
    reader,
    repair,
    storage,
    outcomes,
    retention
]);
