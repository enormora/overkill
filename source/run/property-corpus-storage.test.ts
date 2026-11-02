import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { test, suite, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';
import { propertyCorpusEntry as entry } from '../test-support/property-corpus.ts';
import { testNode as cachePolicy } from './property-corpus-cache.test.ts';
import { readPropertyCorpus, savePropertyCorpus } from './property-corpus-storage.ts';

async function corpusDirectory(scope: TestScope): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-corpus-'));
    scope.cleanup(async function removeCorpus() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}

async function cachedFile(directory: string): Promise<string> {
    const [ profile ] = await readdir(path.join(directory, 'corpus'));
    if (profile === undefined) {
        throw new Error('Expected a corpus cache directory.');
    }
    return path.join(directory, 'corpus', profile, 'index.json');
}

async function corruptCorpus(scope: TestScope): Promise<string> {
    const directory = await corpusDirectory(scope);
    await savePropertyCorpus(directory, 'laws', propertyCorpusPolicySchema.parse({}), [ entry ]);
    await writeFile(await cachedFile(directory), '{');
    return directory;
}

async function checkedInDirectory(scope: TestScope): Promise<string> {
    const directory = await corpusDirectory(scope);
    const nested = path.join(directory, 'regressions', 'nested');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(directory, 'regressions', 'a.json'), JSON.stringify(entry));
    await writeFile(path.join(nested, 'b.json'), JSON.stringify({ ...entry, seed: '7' }));
    await writeFile(path.join(nested, 'notes.txt'), 'not a corpus entry');
    return directory;
}

export const testNode = suite('property corpus storage', [
    cachePolicy,
    test('recovers a corrupt local cache on the next save', async function (scope) {
        const directory = await corruptCorpus(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        const corrupt = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.deepEqual(corrupt.localCache, []);
        scope.assert.equal(corrupt.diagnostics.length, 1);
        const diagnostics = await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        const recovered = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.equal(diagnostics.length, 1);
        scope.assert.deepEqual(recovered.localCache, [ entry ]);
        return scope.assert.collect();
    }),
    test('discovers nested checked-in directories and deduplicates named paths', async function (scope) {
        const directory = await checkedInDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({ checkedIn: [ 'regressions', 'regressions/a.json' ] });
        const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.deepEqual(snapshot.checkedIn, [ entry, { ...structuredClone(entry), seed: '7' } ]);
        return scope.assert.collect();
    }),
    test('preserves both inputs from concurrent cache writers', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        const other = { ...entry, counterexample: { ...entry.counterexample, payload: [ 43 ] } };
        await Promise.all([
            savePropertyCorpus(directory, 'laws', policy, [ entry ]),
            savePropertyCorpus(directory, 'laws', policy, [ other ])
        ]);
        const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.equal(snapshot.localCache.length, 2);
        scope.assert.true(snapshot.localCache.some(function original(saved) {
            return JSON.stringify(saved.counterexample.payload) === '[42]';
        }));
        scope.assert.true(snapshot.localCache.some(function concurrent(saved) {
            return JSON.stringify(saved.counterexample.payload) === '[43]';
        }));
        return scope.assert.collect();
    }),
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
