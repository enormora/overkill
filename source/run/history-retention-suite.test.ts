import { suite } from '@overkill-dev/test';

import { testNode as publication } from './history-retention-policy.test.ts';
import { testNode as evidence } from './compact-run-record.test.ts';
import { testNode as runnerResults } from './runner-result.test.ts';
import { testNode as compact } from './compact-history.test.ts';
import { testNode as duration } from './duration-history-retention.test.ts';
import { testNode as records } from './history-retention-records.test.ts';

export const testNode = suite('history retention', [
    publication,
    evidence,
    runnerResults,
    compact,
    duration,
    records
]);
