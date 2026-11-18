import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as benchmarkHtmlReporterTestNode } from '../../../reporters/benchmark-html-reporter.test.ts';
import { testNode as runnerMeasurementsTestNode } from '../../run/runner-measurements.test.ts';
import { testNode as runnerWorkloadsTestNode } from '../../run/runner-workloads.test.ts';
import { testNode as runnerRetriesTestNode } from '../../run/runner-retries.test.ts';

export const testNode = createSuite({
    title: 'runner measurements integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        benchmarkHtmlReporterTestNode,
        runnerMeasurementsTestNode,
        runnerWorkloadsTestNode,
        runnerRetriesTestNode
    ]
});
