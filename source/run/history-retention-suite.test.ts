import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as publication } from './history-retention-policy.test.ts';
import { testNode as evidence } from './compact-run-record.test.ts';
import { testNode as runnerResults } from './runner-result.test.ts';
import { testNode as compact } from './compact-history.test.ts';
import { testNode as duration } from './duration-history-retention.test.ts';
import { testNode as records } from './history-retention-records.test.ts';

export const testNode = createSuite({
    title: 'history retention',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ publication, evidence, runnerResults, compact, duration, records ]
});
await runIfMain(import.meta, testNode);
