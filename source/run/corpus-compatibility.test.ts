import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { capturePropertyInput } from '../property/property-graph.ts';
import { inspectCorpus, promoteWitness, migrateCorpus } from '../packages/run/run.entry-point.ts';
import type { CorpusRequest } from './corpus-types.ts';

async function directory(scope: TestScope): Promise<string> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'overkill-corpus-compatibility-'));
    scope.cleanup(async function remove() {
        await rm(cwd, { recursive: true, force: true });
    });
    return cwd;
}
async function customInput(scope: TestScope): Promise<CorpusRequest> {
    const cwd = await directory(scope);
    const input: unknown = JSON.parse(
        await readFile(new URL('../property/fixtures/property-custom-v1.json', import.meta.url), 'utf8')
    );
    await writeFile(path.join(cwd, 'witness.json'), JSON.stringify({ ...propertyCorpusEntry, counterexample: input }));
    await writeFile(
        path.join(cwd, 'codec.mjs'),
        `export default {
        name: 'date', version: 3,
        encode(value) { return value.getTime(); },
        decode(value) { if (typeof value !== 'number') throw new Error('number required'); return new Date(value); },
        previousDecoders: [{ version: 1, decode(value) { return new Date(Number(value)); } }]
    };`
    );
    return {
        cwd,
        source: { kind: 'path' as const, path: 'witness.json' },
        codec: { kind: 'module' as const, path: 'codec.mjs', exportName: 'default' }
    };
}
export const testNode = suite('corpus compatibility', [
    test('promotion retains historical versions while migration writes the current codec', async function (scope) {
        const request = await customInput(scope);
        const promotion = await promoteWitness({
            ...request,
            destination: 'promoted.json',
            async beforeWrite() {
                return undefined;
            }
        });
        const migration = await migrateCorpus({
            ...request,
            destination: 'migrated.json',
            async beforeWrite() {
                return undefined;
            }
        });
        scope.assert.equal(promotion.entry.witness.counterexample.codec.version, 1);
        scope.assert.equal(migration.entry.witness.counterexample.codec.version, 3);
        scope.assert.deepEqual(promotion.entry.preview, migration.entry.preview);
        scope.assert.deepEqual(promotion.entry.witness.case, migration.entry.witness.case);
        return scope.assert.collect();
    }),
    test('cache inspection diagnoses bad entries and promotion requires explicit selection', async function (scope) {
        const cwd = await directory(scope);
        const witness = {
            ...propertyCorpusEntry,
            counterexample: capturePropertyInput(42, null, function () {
                return undefined;
            })
        };
        await writeFile(
            path.join(cwd, 'cache.json'),
            JSON.stringify({ version: 1, entries: [ null, { id: 'chosen', savedAt: '', entry: witness } ] })
        );
        const request = {
            cwd,
            source: { kind: 'path' as const, path: 'cache.json' },
            codec: { kind: 'built-in' as const }
        };
        const inspection = await inspectCorpus(request);
        scope.assert.deepEqual([ inspection.entries.length, inspection.diagnostics.length ], [ 1, 1 ]);
        await scope.assert.rejects(async function unselected() {
            await promoteWitness({
                ...request,
                destination: 'bad.json',
                async beforeWrite() {
                    return undefined;
                }
            });
        }, { message: /explicit cache entry/v });
        const result = await promoteWitness({
            ...request,
            source: { kind: 'cache-entry', path: 'cache.json', entryId: 'chosen' },
            destination: 'selected.json',
            async beforeWrite() {
                return undefined;
            }
        });
        scope.assert.deepEqual(result.entry.witness, witness);
        return scope.assert.collect();
    })
]);
