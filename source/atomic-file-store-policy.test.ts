import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from './packages/test/test.entry-point.ts';
import { atomicFileStore, reliableFileStore } from './test-support/atomic-file-store.ts';

const target = '/project/state/result.json';
export const testNode = suite('atomic runtime-state file storage', [
    test('reads UTF-8 content and represents missing files as null', async function (scope: TestScope) {
        const fixture = atomicFileStore(reliableFileStore, [ [ target, 'stored' ] ]);
        scope.assert.equal(await fixture.store.read(target), 'stored');
        scope.assert.equal(await fixture.store.read('/missing'), null);
        return scope.assert.collect();
    }),
    ...([ new Error('denied'), 'foreign failure' ] as const).map(function (failure, index) {
        return test(`preserves read failures other than missing files ${index}`, async function (scope: TestScope) {
            const fixture = atomicFileStore({ ...reliableFileStore, read: failure }, []);
            await scope.assert.rejects(async function () {
                await fixture.store.read(target);
            }, { exact: failure });
            return scope.assert.collect();
        });
    }),
    test('publishes exclusive creates without overwriting existing content', async function (scope: TestScope) {
        const fixture = atomicFileStore(reliableFileStore, []);
        await fixture.store.create(target, 'first');
        await scope.assert.rejects(async function () {
            await fixture.store.create(target, 'second');
        }, { message: 'Already exists.' });
        scope.assert.deepEqual(Array.from(fixture.files), [ [ target, 'first' ] ]);
        scope.assert.includes(fixture.events.join('\n'), 'write:/project/state/result.json.temporary-1.tmp:wx');
        scope.assert.includes(fixture.events.join('\n'), 'remove:/project/state/result.json.temporary-2.tmp:true');
        return scope.assert.collect();
    }),
    test('atomically replaces prior content and removes staging files', async function (scope: TestScope) {
        const fixture = atomicFileStore(reliableFileStore, [ [ target, 'old' ] ]);
        await fixture.store.write(target, 'new');
        scope.assert.deepEqual(Array.from(fixture.files), [ [ target, 'new' ] ]);
        scope.assert.deepEqual(fixture.events, [
            'directory:/project/state:true',
            'write:/project/state/result.json.temporary-1.tmp:wx',
            'rename:/project/state/result.json.temporary-1.tmp:/project/state/result.json',
            'remove:/project/state/result.json.temporary-1.tmp:true'
        ]);
        return scope.assert.collect();
    }),
    ...([ 'directory', 'write', 'publish' ] as const).map(function (phase) {
        return test(`preserves prior content when ${phase} fails`, async function (scope: TestScope) {
            const failure = new Error(`${phase} failed`);
            const fixture = atomicFileStore({ ...reliableFileStore, [phase]: failure }, [ [ target, 'old' ] ]);
            await scope.assert.rejects(async function () {
                await fixture.store.write(target, 'new');
            }, { exact: failure });
            scope.assert.deepEqual(Array.from(fixture.files), [ [ target, 'old' ] ]);
            return scope.assert.collect();
        });
    }),
    test('preserves publication and cleanup failures together', async function (scope: TestScope) {
        const publication = new Error('publish failed');
        const cleanup = new Error('cleanup failed');
        const fixture = atomicFileStore({ ...reliableFileStore, publish: publication, cleanup }, [ [ target, 'old' ] ]);
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
    test('reports failed staging cleanup after successful publication', async function (scope: TestScope) {
        const failure = new Error('cleanup failed');
        const fixture = atomicFileStore({ ...reliableFileStore, cleanup: failure }, []);
        await scope.assert.rejects(async function () {
            await fixture.store.write(target, 'new');
        }, { exact: failure });
        scope.assert.equal(fixture.files.get(target), 'new');
        return scope.assert.collect();
    }),
    test('gives concurrent writes distinct exclusive staging paths', async function (scope: TestScope) {
        const fixture = atomicFileStore(reliableFileStore, []);
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
await runIfMain(import.meta, testNode);
