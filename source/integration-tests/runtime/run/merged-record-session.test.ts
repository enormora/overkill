import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { readFile, mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from '@overkill-dev/test';

import { defineReporter } from '../../../packages/engine/engine.entry-point.ts';

import { mergeResults, type MergeResultsCommand, type MergedRunRecord } from '../../../packages/run/run.entry-point.ts';
import { mergeRecordFixture } from '../../../test-support/merge-record-fixture.ts';
import { defaultRunConfig } from '../../../test-support/run-command-factory.ts';
import { mergedRecordSchema } from '../../../run/merge-results-schema.ts';
import { compactHistorySchema } from '../../../run/compact-history-schema.ts';

async function prepare(directory: string): Promise<MergeResultsCommand> {
    await writeFile(join(directory, 'first.json'), JSON.stringify(mergeRecordFixture('first', 1, 2)));
    await writeFile(join(directory, 'second.json'), JSON.stringify(mergeRecordFixture('second', 2, 3)));
    return { config: defaultRunConfig({}), cwd: directory, inputs: [ { kind: 'directory', path: '.' } ] };
}
const recordVersionsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    current: MergedRunRecord
): CompositeAssertionReturn<'assert'> => {
    return check.group([
        check.equal(current.version, 1),
        ...[ 2, 3, 4, 5 ].map((version) => {
            return check.false(mergedRecordSchema.safeParse({ ...current, version }).success);
        })
    ]);
};

const assertRetained = defineCompositeAssertion({
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
const assertDiscovery = defineCompositeAssertion({
    name: 'discovery',
    async assert(check, command: MergeResultsCommand, merged: MergedRunRecord) {
        await writeFile(join(command.cwd, 'merged.json'), JSON.stringify(merged));
        const repeated = await mergeResults(command);
        const initialChecks = check.group([
            check.equal(repeated.result.status, 'passed'),
            check.deepEqual(repeated.lineage, merged.lineage)
        ]);
        const explicit = await mergeResults({
            ...command,
            inputs: [
                { kind: 'directory', path: '.' },
                { kind: 'file', path: 'merged.json' }
            ]
        });
        return check.group([ initialChecks, check.equal(explicit.result.status, 'failed') ]);
    }
});
export const testNode = suite('merged record sessions', [
    test('persists aggregate history and skips derived directory records', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merged-session-'));
        const command = await prepare(directory.path);
        const merged = await mergeResults(command);
        await scope.assert(assertRetained, command, merged);
        await scope.assert(assertDiscovery, command, merged);
        return scope.assert.collect();
    }),
    test('retains final reporter failures after exactly one delivery and disposal', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merged-reporters-'));
        const command = await prepare(directory.path);
        const counts = { delivered: 0, disposed: 0 };
        const reporter = defineReporter(function () {
            return {
                kind: 'final-result',
                name: 'failing',
                sinks: [],
                onResult() {
                    counts.delivered += 1;
                    throw new Error('report failed');
                },
                dispose() {
                    counts.disposed += 1;
                }
            };
        });
        const merged = await mergeResults({
            ...command,
            config: { ...command.config, reporters: [ reporter ] }
        });
        scope.assert.deepEqual(counts, { delivered: 1, disposed: 1 });
        scope.assert.equal(merged.result.status, 'failed');
        await scope.assert(assertRetained, command, merged);
        return scope.assert.collect();
    })
]);
