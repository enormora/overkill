import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    defineCompositeAssertion,
    type CompositeAssertionReturn,
    type CompositeCheckBuilder
} from '@overkill-dev/test/assert';
import type { MergeResultsCommand, MergedRunRecord } from '../packages/run/run.entry-point.ts';
import { compactHistorySchema } from '../run/compact-history-schema.ts';
import { mergeRecordSchema, mergedRecordSchema, type MergeRecord } from '../run/merge-results-schema.ts';
import { recordedRunResult } from '../run/run-record-result.ts';
import { facts } from './run-record-session-fixture.ts';
import { runResultFactory } from './run-result-factory.ts';

export function mergeRecordFixture(id: string, index: number, passed: number): MergeRecord {
    const result = runResultFactory.build({});
    return mergeRecordSchema.parse({
        version: 1,
        kind: 'single',
        detail: 'detailed',
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

const firstUnsupportedRecordVersion = 2;
const recordVersionsChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    current: MergedRunRecord
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(current.version, 1),
        ...Array
            .from({ length: 4 }, (_value, index) => {
                return (function (version) {
                    return check.false(mergedRecordSchema.safeParse({ ...current, version }).success);
                })(
                    function (_value, index) {
                        return firstUnsupportedRecordVersion + index;
                    }
                        .call(this, _value, index),
                    index
                );
            })
    ]);
};

export const retainedMergedRecord = defineCompositeAssertion({
    name: 'retained',
    async assert(check, command: MergeResultsCommand, merged: MergedRunRecord) {
        const retained = mergedRecordSchema.parse(JSON.parse(
            await readFile(
                join(command.cwd, command.config.runtimeStateDir, 'runs', `${merged.id}.json`),
                'utf8'
            )
        ));
        const initialChecksBeforeNextAction = check.group([
            check.deepEqual(retained, merged),
            recordVersionsChecks(check.annotated('record versions'), merged),
            check.equal(retained.status, 'completed')
        ]);
        const history = compactHistorySchema.parse(JSON.parse(
            await readFile(
                join(command.cwd, command.config.runtimeStateDir, 'history', 'index.json'),
                'utf8'
            )
        ));
        return check.group([
            initialChecksBeforeNextAction,
            check.equal(
                history.summaries.some(function aggregate(summary) {
                    return summary.id === merged.id && !summary.replayable;
                }),
                true
            )
        ]);
    }
});
