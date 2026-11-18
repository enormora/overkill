import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as recordedCoverageRunTestNode } from '../../../run/recorded-coverage-run.test.ts';
import { testNode as runnerCoverageRecordsTestNode } from '../../run/runner-coverage-records.test.ts';

export const testNode = createSuite({
    title: 'persistence coverage integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ recordedCoverageRunTestNode, runnerCoverageRecordsTestNode ]
});
