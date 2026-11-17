import { testNode as comparisonIdentityTests } from '../baselines/measurement-identity.test.ts';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as resultAdmissionTests } from './collector-result.test.ts';
import { testNode as evidenceTests } from './measurement-evidence.test.ts';
import { testNode as sampleDataTests } from './benchmark-sample-data.test.ts';
import { testNode as shutdownTests } from './measurement-shutdown.test.ts';
import { testNode as regionTests } from './measurement-region.test.ts';
import { testNode as collectorTests } from './collector-lifecycle.test.ts';
import { testNode as targetTests } from './measurement-target.test.ts';

export const testNode = suite('measurement lifecycle', [
    resultAdmissionTests,
    evidenceTests,
    comparisonIdentityTests,
    regionTests,
    collectorTests,
    targetTests,
    shutdownTests,
    sampleDataTests
]);
