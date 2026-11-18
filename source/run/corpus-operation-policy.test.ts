import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    corpusOperations,
    corpusOperationFaults,
    corpusWitness,
    corpusIndex,
    corpusRequest,
    corpusSource
} from '../test-support/corpus-operations.ts';
import { loadCorpusEntries } from './corpus-source.ts';

const first = 'a'.repeat(64);
const second = 'b'.repeat(64);

export const testNode = suite('fixed corpus operation policy', [
    test('inspects a witness without creating output', async function (scope: TestScope) {
        const fixture = corpusOperations(JSON.stringify(corpusWitness), corpusOperationFaults);
        const result = await fixture.operations.inspect(fixture.request);
        scope.assert.deepEqual(result, {
            sourcePath: '/project/input.json',
            entries: [ {
                entryId: null,
                witness: corpusWitness,
                preview: { kind: 'string', value: 'decoded', truncation: null }
            } ],
            diagnostics: []
        });
        scope.assert.equal(fixture.files.size, 0);
        return scope.assert.collect();
    }),
    ...([ 'promote', 'migrate' ] as const).map(function (verb) {
        return test(`previews before ${verb} publication`, async function (scope: TestScope) {
            const fixture = corpusOperations(JSON.stringify(corpusWitness), corpusOperationFaults);
            const result = await fixture.operations[verb](fixture.request);
            scope.assert.equal(result.destination, '/project/output.json');
            scope.assert.equal(fixture.files.get(result.destination), `${JSON.stringify(corpusWitness, null, 2)}\n`);
            scope.assert.deepEqual(fixture.calls, [
                'read:/project/input.json',
                `inspect:${verb === 'migrate'}`,
                'preview',
                'create:/project/output.json'
            ]);
            scope.assert.partialDeepEqual(fixture.previews, [ {
                source: { entryId: null, preview: { kind: 'string', value: 'original' } },
                output: { preview: { kind: 'string', value: 'decoded' } }
            } ]);
            return scope.assert.collect();
        });
    }),
    test('copies previews so a recipient cannot change verified publication', async function (scope: TestScope) {
        const fixture = corpusOperations(JSON.stringify(corpusWitness), corpusOperationFaults);
        const result = await fixture.operations.promote({
            ...fixture.request,
            async beforeWrite(preview) {
                Reflect.set(preview.output.witness, 'seed', '999');
            }
        });
        scope.assert.equal(result.entry.witness.seed, corpusWitness.seed);
        scope.assert.equal(fixture.files.get(result.destination), `${JSON.stringify(corpusWitness, null, 2)}\n`);
        return scope.assert.collect();
    }),
    ...([ 'read', 'inspect', 'preview', 'create' ] as const).map(function (phase) {
        return test(`preserves ${phase} failures and prevents later work`, async function (scope: TestScope) {
            const failure = new Error(phase);
            const fixture = corpusOperations(JSON.stringify(corpusWitness), {
                ...corpusOperationFaults,
                [phase]: failure
            });
            await scope.assert.rejects(async function () {
                await fixture.operations.promote(fixture.request);
            }, {
                message: {
                    read: 'Cannot read corpus source.',
                    preview: 'Corpus preview delivery failed.',
                    create: 'Cannot create corpus destination.',
                    inspect: 'inspect'
                }[phase]
            });
            scope.assert.equal(fixture.files.size, 0);
            scope.assert.false(fixture.calls.includes('create:/project/output.json') && phase !== 'create');
            return scope.assert.collect();
        });
    }),
    test('classifies existing destinations as conflicts', async function (scope: TestScope) {
        const fixture = corpusOperations(JSON.stringify(corpusWitness), {
            ...corpusOperationFaults,
            create: Object.assign(new Error('exists'), { code: 'EEXIST' })
        });
        await scope.assert.rejects(async function () {
            await fixture.operations.promote(fixture.request);
        }, { message: 'Cannot create corpus destination.' });
        scope.assert.equal(fixture.previews.length, 1);
        return scope.assert.collect();
    }),
    test('rejects publication onto the input path', async function (scope: TestScope) {
        const fixture = corpusOperations(JSON.stringify(corpusWitness), corpusOperationFaults);
        await scope.assert.rejects(async function () {
            await fixture.operations.promote({ ...fixture.request, destination: './input.json' });
        }, { message: 'Source and destination must differ.' });
        scope.assert.deepEqual(fixture.calls, [ 'read:/project/input.json' ]);
        return scope.assert.collect();
    }),
    ...([ [], [ first ], [ first, second ] ] as const).map(function (ids) {
        return test(
            `requires explicit selection when publishing a cache of ${ids.length} entries`,
            async function (scope: TestScope) {
                const fixture = corpusOperations(corpusIndex(ids), corpusOperationFaults);
                await scope.assert.rejects(async function () {
                    await fixture.operations.promote(fixture.request);
                }, { message: 'Writing requires one witness or an explicit cache entry.' });
                scope.assert.equal(fixture.files.size, 0);
                return scope.assert.collect();
            }
        );
    }),
    test('publishes an explicitly selected cache entry', async function (scope: TestScope) {
        const fixture = corpusOperations(corpusIndex([ second, first ]), corpusOperationFaults);
        const result = await fixture.operations.promote({
            ...fixture.request,
            source: { kind: 'cache-entry', path: 'input.json', entryId: first }
        });
        scope.assert.equal(result.entry.entryId, first);
        scope.assert.equal(fixture.files.size, 1);
        return scope.assert.collect();
    }),
    test('orders cache entries and retains malformed entry diagnostics', async function (scope: TestScope) {
        const content = corpusIndex([ second, first ]);
        const source = corpusSource(content);
        const result = await loadCorpusEntries(corpusRequest, {
            ...source,
            async readCache(target) {
                return {
                    ...await source.readCache(target),
                    diagnostics: [ { path: target, reason: 'Invalid input' } ]
                };
            }
        });
        scope.assert.deepEqual(
            result.entries.map(function (value) {
                return value.id;
            }),
            [ first, second ]
        );
        scope.assert.equal(result.diagnostics.length, 1);
        return scope.assert.collect();
    }),
    ...([ 'missing', 'duplicate' ] as const).map(function (kind) {
        return test(`rejects ${kind} cache selection`, async function (scope: TestScope) {
            await scope.assert.rejects(async function () {
                await loadCorpusEntries({
                    ...corpusRequest,
                    source: { kind: 'cache-entry', path: 'input.json', entryId: first }
                }, corpusSource(corpusIndex(kind === 'missing' ? [ second ] : [ first, first ])));
            }, { message: 'Select exactly one existing cache entry.' });
            return scope.assert.collect();
        });
    }),
    ...([ '{', '{}', 'null', '[]' ] as const).map(function (content) {
        return test(`rejects invalid corpus envelope ${content}`, async function (scope: TestScope) {
            await scope.assert.rejects(async function () {
                await loadCorpusEntries(corpusRequest, corpusSource(content));
            }, {
                message: content === '{'
                    ? 'Cannot read corpus source.'
                    : 'Expected a property witness or corpus cache index.'
            });
            return scope.assert.collect();
        });
    }),
    test('retains failed entry diagnostics when inspecting an entire cache', async function (scope: TestScope) {
        const fixture = corpusOperations(corpusIndex([ first, second ]), {
            ...corpusOperationFaults,
            inspect: new Error('decode')
        });
        const result = await fixture.operations.inspect(fixture.request);
        scope.assert.deepEqual(result.entries, []);
        scope.assert.deepEqual(result.diagnostics, [ `${first}: Error: decode`, `${second}: Error: decode` ]);
        return scope.assert.collect();
    }),
    test('propagates decoding failures for an explicitly selected cache entry', async function (scope: TestScope) {
        const failure = new Error('decode');
        const fixture = corpusOperations(corpusIndex([ first ]), { ...corpusOperationFaults, inspect: failure });
        await scope.assert.rejects(async function () {
            await fixture.operations.inspect({
                ...fixture.request,
                source: { kind: 'cache-entry', path: 'input.json', entryId: first }
            });
        }, { exact: failure });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
