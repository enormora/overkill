import { suite } from '@overkill-dev/test';

import { testNode as recordingBoundaries } from './recording-boundaries.test.ts';
import { testNode as sourcePersistence } from './source-persistence.test.ts';
import { testNode as attachmentsTestNode } from './attachments.test.ts';
import { testNode as coverageTestNode } from './coverage.test.ts';
import { testNode as measurementsTestNode } from './measurements.test.ts';

export const testNode = suite('runner output integration', [
    recordingBoundaries,
    sourcePersistence,
    attachmentsTestNode,
    coverageTestNode,
    measurementsTestNode
]);
