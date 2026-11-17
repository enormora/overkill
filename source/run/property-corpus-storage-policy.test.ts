import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusStorage, corpusStorageScenario } from '../test-support/property-corpus-storage.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { loadPropertyCorpus, persistPropertyCorpus } from './property-corpus-storage.ts';

export const testNode = suite('property corpus storage policy', [
    test(
        'discovers deduplicated checked-in JSON witnesses recursively in stable path order',
        async function (scope: TestScope) {
            const fixture = propertyCorpusStorage(corpusStorageScenario);
            fixture.seed('/project/corpus/b.json', JSON.stringify({ ...propertyCorpusEntry, seed: '2' }));
            fixture.seed('/project/corpus/nested/a.json', JSON.stringify(propertyCorpusEntry));
            fixture.seed('/project/corpus/ignored.txt', 'ignored');
            const result = await loadPropertyCorpus({
                ...fixture.input,
                policy: { ...fixture.input.policy, checkedIn: [ 'corpus', 'corpus/b.json' ] }
            }, fixture.access);
            scope.assert.deepEqual(
                result.checkedIn.map(function (entry) {
                    return entry.seed;
                }),
                [ '2', '42' ]
            );
            scope.assert.deepEqual(result.localCache, []);
            scope.assert.deepEqual(result.diagnostics, []);
            return scope.assert.collect();
        }
    ),
    test('round trips confirmed inputs within a profile-specific locked cache', async function (scope: TestScope) {
        const fixture = propertyCorpusStorage(corpusStorageScenario);
        scope.assert.deepEqual(
            await persistPropertyCorpus({ ...fixture.input, entries: [ propertyCorpusEntry ] }, fixture.access),
            []
        );
        const sameProfile = await loadPropertyCorpus(fixture.input, fixture.access);
        const otherProfile = await loadPropertyCorpus({ ...fixture.input, profile: 'other' }, fixture.access);
        scope.assert.deepEqual(sameProfile.localCache, [ propertyCorpusEntry ]);
        scope.assert.deepEqual(otherProfile.localCache, []);
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'lock', 'write', 'release' ]);
        return scope.assert.collect();
    }),
    test('skips empty publications without creating storage or locks', async function (scope: TestScope) {
        const fixture = propertyCorpusStorage(corpusStorageScenario);
        scope.assert.deepEqual(await persistPropertyCorpus({ ...fixture.input, entries: [] }, fixture.access), []);
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('reports unreadable local caches while preserving checked-in inventory', async function (scope: TestScope) {
        const fixture = propertyCorpusStorage({
            ...corpusStorageScenario,
            readFailure: new Error('Cannot read cache.')
        });
        const result = await loadPropertyCorpus(fixture.input, fixture.access);
        scope.assert.deepEqual(result.localCache, []);
        scope.assert.equal(result.diagnostics.length, 1);
        scope.assert.includes(result.diagnostics[0]?.reason ?? '', 'Cannot read cache.');
        return scope.assert.collect();
    }),
    test('wraps invalid checked-in witness failures with their source path', async function (scope: TestScope) {
        const fixture = propertyCorpusStorage(corpusStorageScenario);
        fixture.seed('/project/corpus/bad.json', 'not JSON');
        await scope.assert.rejects(
            async function () {
                return loadPropertyCorpus({
                    ...fixture.input,
                    policy: { ...fixture.input.policy, checkedIn: [ 'corpus' ] }
                }, fixture.access);
            },
            { message: 'Cannot read checked-in corpus entry /project/corpus/bad.json.', cause: { name: 'SyntaxError' } }
        );
        return scope.assert.collect();
    }),
    test('releases the cache lock when persistence fails', async function (scope: TestScope) {
        const failure = new Error('Cannot persist cache.');
        const fixture = propertyCorpusStorage({ ...corpusStorageScenario, writeFailure: failure });
        await scope.assert.rejects(
            async function () {
                return persistPropertyCorpus({ ...fixture.input, entries: [ propertyCorpusEntry ] }, fixture.access);
            },
            { exact: failure }
        );
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'lock', 'release' ]);
        return scope.assert.collect();
    }),
    test('does not write before acquiring its cache lock', async function (scope: TestScope) {
        const failure = new Error('Cannot lock cache.');
        const fixture = propertyCorpusStorage({ ...corpusStorageScenario, lockFailure: failure });
        await scope.assert.rejects(
            async function () {
                return persistPropertyCorpus({ ...fixture.input, entries: [ propertyCorpusEntry ] }, fixture.access);
            },
            { exact: failure }
        );
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'lock' ]);
        return scope.assert.collect();
    }),
    test('does not write a cache envelope larger than its byte budget', async function (scope: TestScope) {
        const fixture = propertyCorpusStorage(corpusStorageScenario);
        const policy = { ...fixture.input.policy, localCache: { ...fixture.input.policy.localCache, maxBytes: 1 } };
        const diagnostics = await persistPropertyCorpus(
            { ...fixture.input, policy, entries: [ propertyCorpusEntry ] },
            fixture.access
        );
        scope.assert.true(diagnostics.some(function (diagnostic) {
            return diagnostic.reason.includes('empty envelope');
        }));
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'lock', 'release' ]);
        return scope.assert.collect();
    })
]);
