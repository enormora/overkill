import { mergeRecordSchema, type MergeRecord } from '../run/merge-results-schema.ts';
import { recordedRunResult } from '../run/run-record-result.ts';
import { facts } from './run-record-session-fixture.ts';
import { runResultFactory } from './run-result-factory.ts';

export function mergeRecordFixture(id: string, index: number, passed: number): MergeRecord {
    const result = runResultFactory.build({});
    return mergeRecordSchema.parse({
        version: 2,
        kind: 'single',
        status: 'completed',
        id,
        facts: { ...facts, reproducibility: { ...facts.reproducibility, shard: { index, total: 2 } } },
        identities: [],
        runtime: null,
        versions: { engine: null, node: '26', packages: {} },
        result: recordedRunResult({
            ...result,
            status: 'passed',
            summary: { ...result.summary, defined: 10, discovered: 8, planned: passed, passed },
            bySuite: { suite: { discovered: 8, executed: passed, planned: passed } },
            timings: {
                precise: null,
                summary: {
                    totalWallTimeMicroseconds: 10,
                    testExecutionWallTimeMicroseconds: 6,
                    runnerOverheadWallTimeMicroseconds: 4
                }
            }
        })
    });
}
