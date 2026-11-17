import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';
import { boundedCorpusCache, corpusEntryIdentity } from './property-corpus-cache.ts';

const file = 'cache.json';
const now = '2026-11-02T00:00:00.000Z';
const previous = '2026-11-01T00:00:00.000Z';
const recent = { id: 'recent', entry: propertyCorpusEntry, savedAt: now };

export const testNode = suite('property corpus cache policy', [
    test('input identity ignores JSON key order and preserves distinct strings', function (scope: TestScope) {
        const entry = propertyCorpusEntry;
        const reordered = {
            ...entry,
            case: {
                title: entry.case.title,
                suite: entry.case.suite,
                params: entry.case.params,
                file: entry.case.file
            }
        };
        scope.assert.equal(corpusEntryIdentity(entry), corpusEntryIdentity(reordered));
        const composed = { ...entry, counterexample: { ...entry.counterexample, payload: [ '\u{E9}' ] } };
        const decomposed = { ...entry, counterexample: { ...entry.counterexample, payload: [ 'e\u{301}' ] } };
        scope.assert.notEqual(corpusEntryIdentity(composed), corpusEntryIdentity(decomposed));
        return scope.assert.collect();
    }),
    test('evicts older inputs to meet the serialized byte limit', function (scope: TestScope) {
        const older = { ...recent, id: 'older', savedAt: previous, entry: { ...propertyCorpusEntry, seed: '7' } };
        const maxBytes = Buffer.byteLength(JSON.stringify({
            version: 1,
            entries: [ {
                id: recent.id,
                savedAt: recent.savedAt
            } ]
        })) + Buffer.byteLength(JSON.stringify(recent.entry));
        const policy = propertyCorpusPolicySchema.parse({ localCache: { maxBytes, maxEntryBytes: maxBytes } });
        const current = { entries: [ older, recent ], diagnostics: [] };
        const bounded = boundedCorpusCache(current, [], { file, policy, now });
        const retained = bounded.entries;
        scope.require.defined(retained);
        scope.assert.deepEqual(retained, [ recent ]);
        scope.assert.deepEqual(bounded.diagnostics, []);
        return scope.assert.collect();
    }),
    test('diagnoses a limit smaller than the empty cache envelope', function (scope: TestScope) {
        const policy = propertyCorpusPolicySchema.parse({ localCache: { maxBytes: 1, maxEntryBytes: 1 } });
        const bounded = boundedCorpusCache({ entries: [], diagnostics: [] }, [], { file, policy, now });
        scope.assert.equal(bounded.entries, null);
        scope.assert.equal(bounded.diagnostics.length, 1);
        scope.assert.includes(bounded.diagnostics[0]?.reason ?? '', 'empty envelope');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
