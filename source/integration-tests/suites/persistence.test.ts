import { suite } from '@overkill-dev/test';

import { testNode as baselinesTestNode } from './persistence/baselines.test.ts';
import { testNode as corporaTestNode } from './persistence/corpora.test.ts';
import { testNode as coverageTestNode } from './persistence/coverage.test.ts';
import { testNode as historyTestNode } from './persistence/history.test.ts';
import { testNode as mergesTestNode } from './persistence/merges.test.ts';
import { testNode as recordsTestNode } from './persistence/records.test.ts';
import { testNode as replayTestNode } from './persistence/replay.test.ts';
import { testNode as snapshotsTestNode } from './persistence/snapshots.test.ts';
import { testNode as witnessesTestNode } from './persistence/witnesses.test.ts';

export const testNode = suite('persistence integration', [
    baselinesTestNode,
    corporaTestNode,
    coverageTestNode,
    historyTestNode,
    mergesTestNode,
    recordsTestNode,
    replayTestNode,
    snapshotsTestNode,
    witnessesTestNode
]);
