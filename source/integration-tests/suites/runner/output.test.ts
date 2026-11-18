import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as recordingBoundaries } from './recording-boundaries.test.ts';
import { testNode as sourcePersistence } from './source-persistence.test.ts';
import { testNode as attachmentsTestNode } from './attachments.test.ts';
import { testNode as coverageTestNode } from './coverage.test.ts';
import { testNode as measurementsTestNode } from './measurements.test.ts';

export const testNode = createSuite({
    title: 'runner output integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ recordingBoundaries, sourcePersistence, attachmentsTestNode, coverageTestNode, measurementsTestNode ]
});
