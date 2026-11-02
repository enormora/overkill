import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as maintenance } from './history-maintenance.test.ts';
import { testNode as runnerResults } from './runner-result.test.ts';
import { testNode as compact } from './compact-history.test.ts';
import { testNode as duration } from './duration-history-retention.test.ts';
import { testNode as records } from './history-retention-records.test.ts';
import { testNode as pruning } from './history-pruning.test.ts';

export const testNode = createSuite({
    title: 'history retention',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ maintenance, runnerResults, compact, duration, records, pruning ]
});
await runIfMain(import.meta, testNode);
