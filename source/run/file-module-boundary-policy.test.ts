import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { fileModuleBoundary } from '../test-support/file-module-boundary.ts';
import { withModuleBoundary } from './file-module-boundary.ts';

const boundary = { projectRoot: '/project', sharedRoots: [ '/shared' ] };
export const testNode = suite('file module boundary policy', [
    test('leaves unrestricted operations untouched', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({});
        scope.assert.equal(
            await withModuleBoundary(null, async function () {
                return 42;
            }, fixture.access),
            42
        );
        scope.assert.deepEqual(fixture.canonicalized, []);
        scope.assert.deepEqual(fixture.registrations, []);
        return scope.assert.collect();
    }),
    test('admits project and shared-root files during resolution and loading', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({});
        await withModuleBoundary(boundary, async function () {
            scope.assert.equal(
                fixture.resolve('./input.ts', 'file:///project/entry.ts').url,
                'file:///project/input.ts'
            );
            scope.assert.equal(fixture.resolve('file:///shared/input.ts', undefined).url, 'file:///shared/input.ts');
            scope.assert.equal(fixture.load('file:///shared/input.ts').source, 'native source');
        }, fixture.access);
        scope.assert.deepEqual(fixture.registrations, []);
        return scope.assert.collect();
    }),
    test(
        'rejects explicit relative absolute and file-URL escapes before resolving them',
        async function (scope: TestScope) {
            const fixture = fileModuleBoundary({});
            await withModuleBoundary(boundary, async function () {
                for (const specifier of [ '../outside.ts', '/outside.ts', 'file:///outside.ts' ]) {
                    scope.assert.throws(function () {
                        return fixture.resolve(specifier, 'file:///project/entry.ts');
                    }, {
                        message: 'Module import escapes its boundary: /outside.ts'
                    });
                }
            }, fixture.access);
            return scope.assert.collect();
        }
    ),
    test('rejects canonical symlink escapes during resolution and direct loading', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({ '/project/link.ts': '/outside/subject.ts' });
        await withModuleBoundary(boundary, async function () {
            scope.assert.throws(function () {
                return fixture.resolve('file:///project/link.ts', undefined);
            }, {
                message: 'Module import escapes its boundary: /outside/subject.ts'
            });
            scope.assert.throws(function () {
                return fixture.load('file:///project/link.ts');
            }, {
                message: 'Module import escapes its boundary: /outside/subject.ts'
            });
        }, fixture.access);
        return scope.assert.collect();
    }),
    test('admits requested root aliases that canonicalize inside the physical root', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({ '/alias': '/project', '/alias/input.ts': '/project/input.ts' });
        await withModuleBoundary({ projectRoot: '/alias', sharedRoots: [] }, async function () {
            scope.assert.equal(fixture.resolve('file:///alias/input.ts', undefined).url, 'file:///alias/input.ts');
            scope.assert.equal(fixture.load('file:///project/input.ts').source, 'native source');
        }, fixture.access);
        return scope.assert.collect();
    }),
    test('validates physical shared roots before registering hooks', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({ '/linked-shared': '/' });
        await scope.assert.rejects(
            async function () {
                return withModuleBoundary(
                    { projectRoot: '/project', sharedRoots: [ '/linked-shared' ] },
                    async function () {
                        return 42;
                    },
                    fixture.access
                );
            },
            { message: 'Shared module roots must not contain the project root.' }
        );
        scope.assert.deepEqual(fixture.registrations, []);
        return scope.assert.collect();
    }),
    test('validates absolute boundary roots before touching the filesystem', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({});
        await scope.assert.rejects(
            async function () {
                return withModuleBoundary({ projectRoot: 'relative', sharedRoots: [] }, async function () {
                    return 42;
                }, fixture.access);
            },
            { message: 'Module boundary requires absolute roots.' }
        );
        scope.assert.deepEqual(fixture.canonicalized, []);
        return scope.assert.collect();
    }),
    test('allows builtin modules through file-only boundaries', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({});
        await withModuleBoundary(boundary, async function () {
            scope.assert.equal(fixture.resolve('node:path', undefined).url, 'node:path');
            scope.assert.equal(fixture.load('node:path').source, 'native source');
        }, fixture.access);
        return scope.assert.collect();
    }),
    test('restores enclosing boundary hooks after a nested scope completes', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({});
        await withModuleBoundary(boundary, async function () {
            await withModuleBoundary({ projectRoot: '/project/nested', sharedRoots: [] }, async function () {
                scope.assert.throws(function () {
                    return fixture.resolve('file:///project/outer.ts', undefined);
                }, {
                    message: 'Module import escapes its boundary: /project/outer.ts'
                });
            }, fixture.access);
            scope.assert.equal(fixture.resolve('file:///project/outer.ts', undefined).url, 'file:///project/outer.ts');
        }, fixture.access);
        scope.assert.deepEqual(fixture.registrations, []);
        return scope.assert.collect();
    }),
    test('unregisters boundary hooks after execution failures', async function (scope: TestScope) {
        const fixture = fileModuleBoundary({});
        const failure = new Error('Bounded operation failed.');
        await scope.assert.rejects(async function () {
            return withModuleBoundary(boundary, async function () {
                throw failure;
            }, fixture.access);
        }, { exact: failure });
        scope.assert.deepEqual(fixture.registrations, []);
        return scope.assert.collect();
    })
]);
