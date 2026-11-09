import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as boundaries } from './snapshot.test.ts';
import { testNode as comparisons } from './snapshot-comparison.test.ts';
import { testNode as evidence } from './snapshot-evidence.test.ts';
import { testNode as runtime } from './snapshot-runtime.test.ts';
import { testNode as preparation } from './snapshot-preparation.test.ts';
import { testNode as sharing } from './snapshot-sharing.test.ts';

export const testNode = suite('content snapshots', [
    boundaries,
    comparisons,
    evidence,
    runtime,
    preparation,
    sharing
]);
