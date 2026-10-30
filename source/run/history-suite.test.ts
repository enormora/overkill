import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as operations } from './history-command-suite.test.ts';
import { testNode as reader } from './history-reader.test.ts';
import { testNode as repairFailures } from './history-repair-failures.test.ts';
import { testNode as repair } from './history-repair.test.ts';
import { testNode as locking } from './node-history-storage.test.ts';
import { testNode as storage } from './history-storage.test.ts';
import { testNode as outcomes } from './history-outcomes.test.ts';
import { testNode as retention } from './history-retention-suite.test.ts';

export const testNode = createSuite({
    title: 'compact history',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ operations, reader, repairFailures, repair, locking, storage, outcomes, retention ]
});
await runIfMain(import.meta, testNode);
