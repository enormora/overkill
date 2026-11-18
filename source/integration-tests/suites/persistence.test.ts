import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as baselinesTestNode } from './persistence/baselines.test.ts';
import { testNode as corporaTestNode } from './persistence/corpora.test.ts';
import { testNode as coverageTestNode } from './persistence/coverage.test.ts';
import { testNode as historyTestNode } from './persistence/history.test.ts';
import { testNode as mergesTestNode } from './persistence/merges.test.ts';
import { testNode as recordsTestNode } from './persistence/records.test.ts';
import { testNode as replayTestNode } from './persistence/replay.test.ts';
import { testNode as snapshotsTestNode } from './persistence/snapshots.test.ts';
import { testNode as witnessesTestNode } from './persistence/witnesses.test.ts';

export const testNode = createSuite({
    title: 'persistence integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        baselinesTestNode,
        corporaTestNode,
        coverageTestNode,
        historyTestNode,
        mergesTestNode,
        recordsTestNode,
        replayTestNode,
        snapshotsTestNode,
        witnessesTestNode
    ]
});
