import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/witness-file.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { capturePropertyInput } from '../property/property-graph.ts';
import { inspectCorpus, promoteWitness, type CorpusRequest } from '../packages/run/run.entry-point.ts';

async function corpusDirectory(scope: TestScope): Promise<string> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'overkill-corpus-errors-'));
    scope.cleanup(async function remove() {
        await rm(cwd, { recursive: true, force: true });
    });
    return cwd;
}
function inspectionRequest(cwd: string, file: string): CorpusRequest {
    return { cwd, source: { kind: 'path', path: file }, codec: { kind: 'built-in' } };
}
function replayableWitness(): PropertyWitnessFile {
    return propertyWitnessSchema.parse({
        ...propertyCorpusEntry,
        counterexample: capturePropertyInput(42, null, function () {
            return undefined;
        })
    });
}
export const testNode = suite('corpus error handling', [
    test('missing, malformed, and unsupported sources fail inspection', async function (scope) {
        const cwd = await corpusDirectory(scope);
        await writeFile(path.join(cwd, 'malformed.json'), '{');
        await writeFile(path.join(cwd, 'unsupported.json'), JSON.stringify({ version: 1, kind: 'simulation' }));
        for (const file of [ 'missing.json', 'malformed.json', 'unsupported.json' ]) {
            await scope.assert.rejects(async function invalid() {
                await inspectCorpus(inspectionRequest(cwd, file));
            }, { name: 'CorpusOperationError' });
        }
        return scope.assert.collect();
    }),
    test('unknown and duplicate cache IDs cannot select an arbitrary witness', async function (scope) {
        const cwd = await corpusDirectory(scope);
        const entry = { id: 'duplicate', savedAt: '', entry: replayableWitness() };
        await writeFile(path.join(cwd, 'cache.json'), JSON.stringify({ version: 1, entries: [ entry, entry ] }));
        for (const entryId of [ 'missing', 'duplicate' ]) {
            await scope.assert.rejects(async function ambiguous() {
                await inspectCorpus({
                    ...inspectionRequest(cwd, 'cache.json'),
                    source: { kind: 'cache-entry', path: 'cache.json', entryId }
                });
            }, { message: /Select exactly one existing cache entry/v });
        }
        return scope.assert.collect();
    }),
    test('empty and unselected multi-entry caches cannot be promoted', async function (scope) {
        const cwd = await corpusDirectory(scope);
        for (
            const entries of [ [], [ { id: 'one', savedAt: '', entry: replayableWitness() }, {
                id: 'two',
                savedAt: '',
                entry: replayableWitness()
            } ] ]
        ) {
            await writeFile(path.join(cwd, 'cache.json'), JSON.stringify({ version: 1, entries }));
            await scope.assert.rejects(async function unselected() {
                await promoteWitness({
                    ...inspectionRequest(cwd, 'cache.json'),
                    destination: 'output.json',
                    async beforeWrite() {
                        return undefined;
                    }
                });
            }, { message: /Writing requires one witness/v });
        }
        return scope.assert.collect();
    }),
    test(
        'cache inspection diagnoses incompatible inputs while selected inspection stays strict',
        async function (scope) {
            const cwd = await corpusDirectory(scope);
            const entry = { id: 'incompatible', savedAt: '', entry: propertyCorpusEntry };
            await writeFile(path.join(cwd, 'cache.json'), JSON.stringify({ version: 1, entries: [ entry ] }));
            const result = await inspectCorpus(inspectionRequest(cwd, 'cache.json'));
            scope.assert.deepEqual(result.entries, []);
            scope.assert.equal(result.diagnostics.length, 1);
            await scope.assert.rejects(async function strict() {
                await inspectCorpus({
                    ...inspectionRequest(cwd, 'cache.json'),
                    source: { kind: 'cache-entry', path: 'cache.json', entryId: 'incompatible' }
                });
            }, { message: /Unsupported corpus transport format/v });
            return scope.assert.collect();
        }
    ),
    test('standard inspection rejects custom codecs and malformed graph payloads', async function (scope) {
        const cwd = await corpusDirectory(scope);
        const original = replayableWitness();
        for (
            const counterexample of [ { ...original.counterexample, codec: { name: 'custom', version: 1 } }, {
                ...original.counterexample,
                payload: {}
            } ]
        ) {
            await writeFile(path.join(cwd, 'witness.json'), JSON.stringify({ ...original, counterexample }));
            await scope.assert.rejects(async function incompatible() {
                await inspectCorpus(inspectionRequest(cwd, 'witness.json'));
            }, { name: 'CorpusOperationError' });
        }
        return scope.assert.collect();
    }),
    test('source destinations and filesystem failures preserve the original witness', async function (scope) {
        const cwd = await corpusDirectory(scope);
        const content = JSON.stringify(replayableWitness());
        await writeFile(path.join(cwd, 'witness.json'), content);
        await writeFile(path.join(cwd, 'blocked'), 'existing file');
        for (const destination of [ 'witness.json', 'blocked/output.json' ]) {
            await scope.assert.rejects(async function unavailable() {
                await promoteWitness({
                    ...inspectionRequest(cwd, 'witness.json'),
                    destination,
                    async beforeWrite() {
                        return undefined;
                    }
                });
            }, { name: 'CorpusOperationError' });
        }
        scope.assert.equal(await readFile(path.join(cwd, 'witness.json'), 'utf8'), content);
        return scope.assert.collect();
    })
]);
