import { suite } from '@overkill-dev/test';
import { testNode as recordPolicy } from '../../run/run-record-policy.test.ts';
import { testNode as recordReasons } from '../../run/run-record-reasons.test.ts';

import { testNode as runLocalCoverage } from '../../run/run-local-coverage.test.ts';
import { testNode as recordedCoverageSession } from '../../run/recorded-coverage-session.test.ts';
import { testNode as runResultFinalization } from '../../run/run-result-finalization.test.ts';

export const testNode = suite('coverage recording lifecycle', [
    recordPolicy,
    recordReasons,
    runLocalCoverage,
    recordedCoverageSession,
    runResultFinalization
]);
