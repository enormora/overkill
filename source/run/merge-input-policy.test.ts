import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';

import { mergeInputStorage, mergedInputDocument } from '../test-support/merge-input-storage.ts';
import { RunResolutionError } from './run-errors.ts';
import { readMergeInput } from './merge-results-input.ts';

export const testNode = authoredSuite('merge input discovery and decoding', [
    test('sorts equal shard indices by canonical path', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        fixture.seed('/records/second.json', JSON.stringify(mergeRecordFixture('second', 1, 1)));
        const result = await readMergeInput(fixture.command, fixture.access);
        scope.assert.deepEqual(
            result.sources.map(function (source) {
                return source.path;
            }),
            [ '/records/first.json', '/records/second.json' ]
        );
        scope.assert.deepEqual(result.errors, []);
        return scope.assert.collect();
    }),
    test('preserves classified input failures from storage discovery', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        const failure = new RunResolutionError('Invalid merge location.', {}, 'invalid-request');
        await scope.assert.rejects(async function () {
            await readMergeInput(fixture.command, {
                ...fixture.access,
                async inspect() {
                    throw failure;
                }
            });
        }, { exact: failure });
        return scope.assert.collect();
    }),
    test('retains canonical records when explicit-path reinspection fails', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        let inspections = 0;
        const result = await readMergeInput({
            ...fixture.command,
            inputs: [ { kind: 'file', path: 'records/first.json' } ]
        }, {
            ...fixture.access,
            async inspect(path) {
                inspections += 1;
                if (inspections > 1) {
                    throw new Error('Reinspection failed.');
                }
                return await fixture.access.inspect(path);
            }
        });
        scope.assert.deepEqual(
            result.sources.map(function (source) {
                return source.record.id;
            }),
            [ 'first' ]
        );
        scope.assert.deepEqual(result.errors, []);
        scope.assert.equal(inspections, 2);
        return scope.assert.collect();
    }),

    test('sorts shard records and excludes unrelated directory entries', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        fixture.seed('/records/notes.txt', 'ignore');
        const result = await readMergeInput(fixture.command, fixture.access);
        scope.assert.deepEqual(
            result.sources.map(function (source) {
                return source.record.id;
            }),
            [ 'first', 'second' ]
        );
        scope.assert.deepEqual(result.errors, []);
        return scope.assert.collect();
    }),
    test('canonicalizes and deduplicates explicit aliases', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        fixture.alias('/alias', '/records/first.json');
        const result = await readMergeInput({
            ...fixture.command,
            inputs: [ { kind: 'path', path: 'alias' }, { kind: 'file', path: 'records/first.json' } ]
        }, fixture.access);
        scope.assert.equal(result.sources.length, 1);
        scope.assert.equal(result.sources[0]?.path, '/records/first.json');
        return scope.assert.collect();
    }),
    test('skips previous merged results discovered in a directory', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        fixture.seed('/records/merged.json', mergedInputDocument());
        const result = await readMergeInput(fixture.command, fixture.access);
        scope.assert.equal(result.sources.length, 2);
        scope.assert.deepEqual(result.errors, []);
        return scope.assert.collect();
    }),
    test('reports an explicitly selected merged record as invalid input', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        fixture.seed('/records/merged.json', mergedInputDocument());
        const result = await readMergeInput({
            ...fixture.command,
            inputs: [ { kind: 'file', path: 'records/merged.json' } ]
        }, fixture.access);
        scope.assert.equal(result.sources.length, 0);
        scope.assert.equal(result.errors[0]?.subtype, 'merge');
        return scope.assert.collect();
    }),
    test('retains valid records alongside malformed JSON diagnostics', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        fixture.seed('/records/broken.json', '{');
        const result = await readMergeInput(fixture.command, fixture.access);
        scope.assert.equal(result.sources.length, 2);
        scope.assert.equal(result.errors[0]?.message, 'Cannot read merge input: /records/broken.json');
        return scope.assert.collect();
    }),
    test('rejects a declared input kind that disagrees with storage', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        await scope.assert.rejects(async function () {
            return await readMergeInput(
                { ...fixture.command, inputs: [ { kind: 'file', path: 'records' } ] },
                fixture.access
            );
        }, { message: 'Merge input is not a file: /records' });
        return scope.assert.collect();
    }),
    test('rejects storage entries that are neither files nor directories', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        await scope.assert.rejects(async function () {
            return await readMergeInput(fixture.command, {
                ...fixture.access,
                async inspect() {
                    return 'other';
                }
            });
        }, { message: 'Merge input must be a file or directory: records' });
        return scope.assert.collect();
    }),
    test('reports unreadable inputs without discarding their cause', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        const result = await readMergeInput(
            { ...fixture.command, inputs: [ { kind: 'path', path: 'missing' } ] },
            fixture.access
        );
        scope.assert.equal(result.sources.length, 0);
        scope.assert.equal(result.errors[0]?.subtype, 'merge');
        scope.assert.equal(result.errors[0]?.message, 'Cannot read merge input: missing');
        return scope.assert.collect();
    }),
    test('rejects an empty directory instead of reporting a successful merge', async function (scope: TestScope) {
        const fixture = mergeInputStorage();
        await scope.assert.rejects(async function () {
            return await readMergeInput(fixture.command, {
                ...fixture.access,
                async children() {
                    return [];
                }
            });
        }, { message: 'Merge results requires at least one run-record file.' });
        return scope.assert.collect();
    })
]);
