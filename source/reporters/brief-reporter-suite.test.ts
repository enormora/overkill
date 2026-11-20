import { suite } from '@overkill-dev/test';

import { testNode as evidencePolicy } from './brief-evidence-policy.test.ts';
import { testNode as liveTests } from './brief-reporter.test.ts';
import { testNode as finalTests } from './brief-final-result-reporter.test.ts';

export const testNode = suite('brief reporters', [
    evidencePolicy,
    liveTests,
    finalTests
]);
