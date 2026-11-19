import { suite } from '@overkill-dev/test';

import { testNode as benchmarkHtmlReporterTestNode } from '../../../reporters/benchmark-html-reporter.test.ts';
import { testNode as runnerMeasurementsTestNode } from '../../run/runner-measurements.test.ts';
import { testNode as runnerWorkloadsTestNode } from '../../run/runner-workloads.test.ts';
import { testNode as runnerRetriesTestNode } from '../../run/runner-retries.test.ts';

export const testNode = suite('runner measurements integration', [
    benchmarkHtmlReporterTestNode,
    runnerMeasurementsTestNode,
    runnerWorkloadsTestNode,
    runnerRetriesTestNode
]);
