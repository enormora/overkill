import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';
import { parseCorpusCache, boundedCorpusCache } from './property-corpus-cache.ts';

const file = 'cache.json';
const now = '2026-11-02T00:00:00.000Z';
const previous = '2026-11-01T00:00:00.000Z';
const recent = { id: 'recent', entry: propertyCorpusEntry, savedAt: now };

export const testNode = suite('property corpus cache policy', [
    ...[ '{', '{"version":2,"entries":[]}' ].map(function corruptCache(content) {
        return test(`diagnoses corrupt cache ${content}`, function (scope) {
            const parsed = parseCorpusCache(content, file);
            scope.assert.deepEqual(parsed.entries, []);
            scope.assert.equal(parsed.diagnostics.length, 1);
            scope.assert.equal(parsed.diagnostics[0]?.path, file);
            return scope.assert.collect();
        });
    }),
    test('skips malformed cached entries while preserving valid entries', function (scope) {
        const parsed = parseCorpusCache(JSON.stringify({ version: 1, entries: [ {}, recent ] }), file);
        scope.assert.deepEqual(parsed.entries, [ recent ]);
        scope.assert.equal(parsed.diagnostics.length, 1);
        scope.assert.equal(parsed.diagnostics[0]?.path, file);
        return scope.assert.collect();
    }),
    test('evicts older inputs to meet the serialized byte limit', function (scope) {
        const older = { ...recent, id: 'older', savedAt: previous, entry: { ...propertyCorpusEntry, seed: '7' } };
        const maxBytes = Buffer.byteLength(JSON.stringify({ version: 1, entries: [ recent ] }));
        const policy = propertyCorpusPolicySchema.parse({ localCache: { maxBytes, maxEntryBytes: maxBytes } });
        const current = { entries: [ older, recent ], diagnostics: [] };
        const bounded = boundedCorpusCache(current, [], { file, policy, now });
        const retained = parseCorpusCache(bounded.content, file);
        scope.assert.deepEqual(retained.entries, [ recent ]);
        scope.assert.true(Buffer.byteLength(bounded.content ?? '') <= maxBytes);
        scope.assert.deepEqual(bounded.diagnostics, []);
        return scope.assert.collect();
    }),
    test('diagnoses a limit smaller than the empty cache envelope', function (scope) {
        const policy = propertyCorpusPolicySchema.parse({ localCache: { maxBytes: 1, maxEntryBytes: 1 } });
        const bounded = boundedCorpusCache({ entries: [], diagnostics: [] }, [], { file, policy, now });
        scope.assert.equal(bounded.content, null);
        scope.assert.equal(bounded.diagnostics.length, 1);
        scope.assert.includes(bounded.diagnostics[0]?.reason ?? '', 'empty envelope');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
