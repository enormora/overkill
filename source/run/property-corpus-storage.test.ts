import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { test, suite, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';
import { propertyCorpusEntry as entry } from '../test-support/property-corpus.ts';
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

async function damageCachedInput(directory: string, content: string | null): Promise<void> {
    const inputs = path.join(path.dirname(await cachedFile(directory)), 'inputs');
    const names = await readdir(inputs);
    const file = path.join(inputs, names[0] ?? 'missing');
    if (content === null) {
        await rm(file);
    } else {
        await writeFile(file, content);
    }
}

export const testNode = suite('property corpus storage', [
    ...[ {
        name: 'missing',
        content: null,
        reason: 'Invalid input'
    }, {
        name: 'mismatched',
        content: JSON.stringify({ ...entry, counterexample: { ...entry.counterexample, payload: [ 99 ] } }),
        reason: 'identity differs'
    } ]
        .map(function damagedReference(input) {
            return test(`diagnoses ${input.name} referenced inputs without scheduling them`, async function (scope) {
                const directory = await corpusDirectory(scope);
                const policy = propertyCorpusPolicySchema.parse({});
                await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
                await damageCachedInput(directory, input.content);
                const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
                scope.assert.deepEqual(snapshot.localCache, []);
                scope.assert.equal(snapshot.diagnostics.length, 1);
                scope.assert.equal(snapshot.diagnostics[0]?.reason.includes(input.reason), true);
                return scope.assert.collect();
            });
        }),
    test('prunes superseded supported input files after publishing the bounded index', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({ localCache: { maxEntries: 1 } });
        await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        const inputs = path.join(path.dirname(await cachedFile(directory)), 'inputs');
        await savePropertyCorpus(directory, 'laws', policy, [ {
            ...entry,
            counterexample: { ...entry.counterexample, payload: [ 43 ] }
        } ]);
        const names = await readdir(inputs);
        const snapshot = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.equal(names.length, 1);
        scope.assert.deepEqual(
            snapshot.localCache.map(function payload(input) {
                return input.counterexample.payload;
            }),
            [ [ 43 ] ]
        );
        return scope.assert.collect();
    }),
    test('rejects unreadable input directories instead of replacing their index', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        const file = await cachedFile(directory);
        await rm(path.join(path.dirname(file), 'inputs'), { recursive: true });
        await writeFile(path.join(path.dirname(file), 'inputs'), 'blocked');
        await rm(file);
        await scope.assert.rejects(async function unreadableInputs() {
            return await readPropertyCorpus(directory, directory, 'laws', policy);
        }, { code: 'ENOTDIR' });
        return scope.assert.collect();
    }),
    test('recovers a corrupt local cache on the next save', async function (scope) {
        const directory = await corruptCorpus(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        const corrupt = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.deepEqual(corrupt.localCache, [ entry ]);
        scope.assert.equal(corrupt.diagnostics.length, 1);
        const diagnostics = await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        const recovered = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.equal(diagnostics.length, 1);
        scope.assert.deepEqual(recovered.localCache, [ entry ]);
        return scope.assert.collect();
    }),
    test('rebuilds a missing index from saved inputs', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        await rm(await cachedFile(directory));
        const recovered = await readPropertyCorpus(directory, directory, 'laws', policy);
        scope.assert.deepEqual(recovered.localCache, [ entry ]);
        scope.assert.deepEqual(recovered.diagnostics, []);
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
    test('retention preserves inputs with unsupported formats', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        const input = path.join(path.dirname(await cachedFile(directory)), 'inputs', `${'f'.repeat(64)}.json`);
        const future = JSON.stringify({ ...entry, version: 2 });
        await writeFile(input, future);
        await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        scope.assert.equal(await readFile(input, 'utf8'), future);
        return scope.assert.collect();
    }),
    test('preserves unsupported cache indexes on save', async function (scope) {
        const directory = await corpusDirectory(scope);
        const policy = propertyCorpusPolicySchema.parse({});
        await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        const file = await cachedFile(directory);
        const source = JSON.stringify({ version: 2, entries: [] });
        await writeFile(file, source);
        await scope.assert.rejects(async function unsupportedIndex() {
            await savePropertyCorpus(directory, 'laws', policy, [ entry ]);
        }, { name: 'ZodError' });
        scope.assert.equal(await readFile(file, 'utf8'), source);
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
