import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { propertyWitnessSchema } from '../engine/property-corpus.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { commandLineRunner } from '../packages/run/command-line.entry-point.ts';
import { dispatchOverkillCommand } from '../packages/test/command-line-commands.ts';
import { capturePropertyInput } from '../property/property-graph.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';

async function directory(scope: TestScope): Promise<string> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'overkill-corpus-cli-'));
    scope.cleanup(async function remove() {
        await rm(cwd, { recursive: true, force: true });
    });
    await writeFile(
        path.join(cwd, 'witness.json'),
        JSON.stringify({
            ...propertyCorpusEntry,
            counterexample: capturePropertyInput(42, null, function () {
                return undefined;
            })
        })
    );
    return cwd;
}
export const testNode = suite('corpus CLI', [
    test('promotion delivers its preview before publishing the named destination', async function (scope) {
        const cwd = await directory(scope);
        const result = await dispatchOverkillCommand(
            [ 'corpus', 'promote', 'witness.json', '--to', 'output.json' ],
            async function () {
                return commandLineRunner;
            },
            cwd,
            async function preview(lines) {
                scope.assert.true(lines.join('').includes('overkill-property-graph'));
                await scope.assert.rejects(async function unpublished() {
                    await access(path.join(cwd, 'output.json'));
                }, { message: /ENOENT/v });
            }
        );
        if (result.kind !== 'command-result') {
            throw new Error('Expected a corpus command result.');
        }
        scope.assert.equal(result.result.exitCode, 0);
        scope.assert.deepEqual(
            propertyWitnessSchema.parse(JSON.parse(await readFile(path.join(cwd, 'output.json'), 'utf8'))),
            propertyWitnessSchema.parse(JSON.parse(await readFile(path.join(cwd, 'witness.json'), 'utf8')))
        );
        return scope.assert.collect();
    }),
    test('missing destinations and codec modules produce argument errors', async function (scope) {
        const cwd = await directory(scope);
        const results = await Promise.all([
            dispatchOverkillCommand(
                [ 'corpus', 'promote', 'witness.json' ],
                async function () {
                    return commandLineRunner;
                },
                cwd,
                async function () {
                    return undefined;
                }
            ),
            dispatchOverkillCommand(
                [ 'corpus', 'inspect', 'witness.json', '--codec-export', 'named' ],
                async function () {
                    return commandLineRunner;
                },
                cwd,
                async function () {
                    return undefined;
                }
            )
        ]);
        for (const result of results) {
            if (result.kind !== 'command-result') {
                throw new Error('Expected an argument error result.');
            }
            scope.assert.equal(result.result.exitCode, 3);
        }
        return scope.assert.collect();
    })
]);
