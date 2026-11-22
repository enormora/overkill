import { suite, table, test, transcriptUsage, type TestScope } from '@overkill-dev/test';

import { atomicFileStore, reliableFileStore } from './test-support/atomic-file-store.ts';

const target = '/project/state/result.json';
export const testNode = suite('atomic runtime-state file storage', [
    test('reads UTF-8 content and represents missing files as null', async function (scope) {
        const fixture = atomicFileStore.create({ initial: [ [ target, 'stored' ] ] });
        scope.assert.equal(await fixture.store.read(target), 'stored');
        scope.assert.equal(await fixture.store.read('/missing'), null);
        return scope.assert.collect();
    }),
    table({
        title: 'preserves read failures other than missing files',
        cases: [ new Error('denied'), 'foreign failure' ],
        caseTitle(failure) {
            return failure instanceof Error ? 'Error' : 'non-Error';
        },
        async test(scope) {
            const failure = scope.parameters;
            const fixture = atomicFileStore.create({ faults: { ...reliableFileStore, read: failure }, initial: [] });
            await scope.assert.rejects(async function () {
                await fixture.store.read(target);
            }, { exact: failure });
            return scope.assert.collect();
        }
    }),
    test('publishes exclusive creates without overwriting existing content', async function (scope) {
        const fixture = atomicFileStore.create({});
        await fixture.store.create(target, 'first');
        await scope.assert.rejects(async function () {
            await fixture.store.create(target, 'second');
        }, { message: 'Already exists.' });
        scope.assert.deepEqual(Array.from(fixture.files), [ [ target, 'first' ] ]);
        scope.assert(transcriptUsage.contains, fixture.events, [
            'file',
            'write:/project/state/result.json.temporary-1.tmp:wx'
        ]);
        scope.assert(transcriptUsage.contains, fixture.events, [
            'file',
            'remove:/project/state/result.json.temporary-2.tmp:true'
        ]);
        return scope.assert.collect();
    }),
    test('atomically replaces prior content and removes staging files', async function (scope) {
        const fixture = atomicFileStore.create({ initial: [ [ target, 'old' ] ] });
        await fixture.store.write(target, 'new');
        scope.assert.deepEqual(Array.from(fixture.files), [ [ target, 'new' ] ]);
        scope.assert(transcriptUsage.exactly, fixture.events, [
            [ 'file', 'directory:/project/state:true' ],
            [ 'file', 'write:/project/state/result.json.temporary-1.tmp:wx' ],
            [ 'file', 'rename:/project/state/result.json.temporary-1.tmp:/project/state/result.json' ],
            [ 'file', 'remove:/project/state/result.json.temporary-1.tmp:true' ]
        ]);
        return scope.assert.collect();
    }),
    table({
        title: 'preserves prior content when staging or publication fails',
        cases: [ 'directory', 'write', 'publish' ] as const,
        caseTitle(phase) {
            return phase;
        },
        async test(scope) {
            const phase = scope.parameters;
            const failure = new Error(`${phase} failed`);
            const fixture = atomicFileStore.create({
                faults: { ...reliableFileStore, [phase]: failure },
                initial: [ [ target, 'old' ] ]
            });
            await scope.assert.rejects(async function () {
                await fixture.store.write(target, 'new');
            }, { exact: failure });
            scope.assert.deepEqual(Array.from(fixture.files), [ [ target, 'old' ] ]);
            return scope.assert.collect();
        }
    }),
    test('preserves publication and cleanup failures together', async function (scope: TestScope) {
        const publication = new Error('publish failed');
        const cleanup = new Error('cleanup failed');
        const fixture = atomicFileStore.create({
            faults: { ...reliableFileStore, publish: publication, cleanup },
            initial: [ [ target, 'old' ] ]
        });
        let failure: unknown = null;
        try {
            await fixture.store.write(target, 'new');
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, AggregateError);
        scope.assert.deepEqual({ errors: failure.errors, cause: failure.cause }, {
            errors: [ publication, cleanup ],
            cause: cleanup
        });
        return scope.assert.collect();
    }),
    test('reports failed staging cleanup after successful publication', async function (scope) {
        const failure = new Error('cleanup failed');
        const fixture = atomicFileStore.create({ faults: { ...reliableFileStore, cleanup: failure }, initial: [] });
        await scope.assert.rejects(async function () {
            await fixture.store.write(target, 'new');
        }, { exact: failure });
        scope.assert.equal(fixture.files.get(target), 'new');
        return scope.assert.collect();
    }),
    test('gives concurrent writes distinct exclusive staging paths', async function (scope) {
        const fixture = atomicFileStore.create({});
        await Promise.all([ fixture.store.create('/project/one', 'one'), fixture.store.create('/project/two', 'two') ]);
        scope.assert.deepEqual(
            Array.from(fixture.files).toSorted(function ([ left ], [ right ]) {
                return left.localeCompare(right);
            }),
            [ [ '/project/one', 'one' ], [
                '/project/two',
                'two'
            ] ]
        );
        return scope.assert.collect();
    })
]);
