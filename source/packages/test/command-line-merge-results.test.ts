import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../engine/engine.entry-point.ts';
import { commandLineRunner } from '../run/command-line.entry-point.ts';
import { mergeRecordFixture } from '../../test-support/merge-record-fixture.ts';
import { dispatchOverkillCommand } from './command-line-commands.ts';

async function rejectMergePreview(): Promise<void> {
    throw new Error('Merge must not produce previews.');
}

async function writeMergeInputs(directory: string): Promise<void> {
    await writeFile(
        join(directory, 'overkill.config.ts'),
        "export const config = { profiles: { microtest: { testFamily: 'microtest' } } };\n"
    );
    await writeFile(join(directory, 'first.json'), JSON.stringify(mergeRecordFixture('first', 1, 2)));
    await writeFile(join(directory, 'second.json'), JSON.stringify(mergeRecordFixture('second', 2, 3)));
}
export const testNode = createSuite({
    title: 'merge results command dispatch',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'merges files through the parser, lazy runner, and project configuration',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using temporary = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-cli-'));
                const directory = temporary.path;
                await writeMergeInputs(directory);
                const dispatched = await dispatchOverkillCommand(
                    [ 'merge-results', '--config', 'overkill.config.ts', 'first.json', 'second.json' ],
                    async function runner() {
                        return commandLineRunner;
                    },
                    directory,
                    rejectMergePreview
                );
                if (dispatched.kind !== 'command-result') {
                    throw new Error('Expected a dispatched merge result.');
                }
                scope.assert.equal(dispatched.result.exitCode, 0);
                scope.assert.equal(dispatched.result.runResult?.summary.passed, 5);
                scope.assert.deepEqual(dispatched.result.stdoutLines, []);
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
