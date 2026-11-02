import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { test, suite, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';
import type { PropertyWitnessFile as CorpusEntry } from '../engine/property-corpus.ts';
import { readPropertyCorpus, savePropertyCorpus } from './property-corpus-storage.ts';

const entry: CorpusEntry = {
    version: 1,
    kind: 'property',
    producedBy: { library: '@overkill-dev/property', libraryVersion: 'test' },
    case: { file: 'laws.ts', suite: [], title: 'law', params: null },
    runtimes: [],
    target: { kind: 'property-value' },
    seed: '42',
    failureIdentity: null,
    shrinkPath: null,
    counterexample: { format: { name: 'graph', version: 1 }, codec: { name: 'standard', version: 1 }, payload: [ 42 ] }
};

async function corpusDirectory(scope: TestScope): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-corpus-'));
    scope.cleanup(async function removeCorpus() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}

export const testNode = suite('property corpus storage', [
    test('deduplicates entries and keeps profiles separate', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        await savePropertyCorpus(directory, 'laws', policy, [ entry, entry ]);
        const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.deepEqual(snapshot.localCache, [ entry ]);
        const other = await readPropertyCorpus(directory, directory, 'other', policy);
        scope.assert.deepEqual(other.localCache, []);
        return scope.assert.collect();
    }),
    test('preserves checked-in files', async function (scope) {
        const directory = await corpusDirectory(scope);
        const file = path.join(directory, 'law.json');
        const text = JSON.stringify(entry);
        await writeFile(file, text);
        const policy = propertyCorpusPolicySchema.parse({ checkedIn: [ 'law.json' ] });
        const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.deepEqual(snapshot.checkedIn, [ entry ]);
        scope.assert.equal(await readFile(file, 'utf8'), text);
        return scope.assert.collect();
    }),
    test('rejects malformed checked-in entries', async function (scope) {
        const directory = await corpusDirectory(scope);
        await writeFile(path.join(directory, 'law.json'), '{}');
        const policy = propertyCorpusPolicySchema.parse({ checkedIn: [ 'law.json' ] });
        await scope.assert.rejects(async function () {
            return readPropertyCorpus(directory, directory, 'laws', policy);
        }, { message: /Cannot read checked-in corpus entry/ });
        return scope.assert.collect();
    }),
    test('enforces count limits', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({ localCache: { maxEntries: 1 } });
        await savePropertyCorpus(directory, 'laws', policy, [ entry, {
            ...entry,
            counterexample: { ...entry.counterexample, payload: [ 43 ] }
        } ]);
        const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.equal(snapshot.localCache.length, 1);
        return scope.assert.collect();
    }),
    test('diagnoses oversized inputs', async function (scope) {
        const directory = await corpusDirectory(scope);
        const bounded = propertyCorpusPolicySchema.parse({ localCache: { maxEntryBytes: 1 } });
        const diagnostics = await savePropertyCorpus(directory, 'small', bounded, [ entry ]);
        scope.assert.equal(diagnostics.length, 1);
        const small = await readPropertyCorpus(directory, directory, 'small', bounded);
        scope.assert.deepEqual(small.localCache, []);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
