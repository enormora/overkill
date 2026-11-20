import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { moduleLoadingRuntime } from './test-support/module-loading-runtime.ts';
import { createModuleLoading, type DeliveredModule } from './module-delivery.ts';

const entry = 'file:///project/main.ts';
const dependency = 'file:///project/dependency.ts';
const builtEntry = `${entry}?overkill-build=build%3A0`;
const builtDependency = `${dependency}?overkill-build=build%3A0`;
const modules: readonly DeliveredModule[] = [ {
    url: entry,
    format: 'module',
    source: 'export const value = true;',
    dependencies: {}
}, { url: dependency, format: 'module', source: 'export const dependency = true;', dependencies: {} } ];
const delivery = { build: 'build', modules, builtins: [] };
export const testNode: TestNode = suite('frozen module delivery failure boundaries', [
    test('retains a rejected graph edge even when the operation catches it', async function (scope) {
        const fixture = moduleLoadingRuntime();
        await scope.assert.rejects(async function () {
            await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function () {
                scope.assert.throws(function () {
                    fixture.resolve('./outside.ts', builtEntry);
                }, { message: 'Implementation import is outside the frozen graph: ./outside.ts' });
            });
        }, { name: 'AggregateError', message: 'Implementation loading failed.' });
        scope.assert.equal(fixture.registrations.length, 1);
        return scope.assert.collect();
    }),
    table({
        title: 'retains frozen source rejection across namespaces',
        cases: [ { suffix: '', message: 'Implementation module is outside the frozen graph.' }, {
            suffix: '&overkill-namespace=1',
            message: 'Implementation namespace is outside the frozen graph.'
        } ] as const,
        caseTitle(scenario) {
            return scenario.suffix === '' ? 'original namespace' : 'isolated namespace';
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = moduleLoadingRuntime();
            const rejectSource = function (): void {
                fixture.load(`file:///outside.ts?overkill-build=build%3A0${scenario.suffix}`);
            };
            await scope.assert.rejects(async function () {
                await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function () {
                    scope.assert.throws(rejectSource, { message: scenario.message });
                });
            }, { name: 'AggregateError', message: 'Implementation loading failed.' });
            scope.assert.equal(fixture.registrations.length, 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects non-native module namespace',
        cases: [ null, 42, {}, { namespace: {} } ] as const,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        async test(scope) {
            const value = scope.parameters;

            const fixture = moduleLoadingRuntime();
            await scope.assert.rejects(async function () {
                await createModuleLoading({
                    ...fixture.runtime,
                    async load() {
                        return value;
                    }
                })
                    .withModuleDelivery(delivery, async function (load) {
                        return await load(entry);
                    });
            }, { message: 'Implementation modules must produce an ES module namespace.' });
            scope.assert.equal(fixture.registrations.length, 1);
            return scope.assert.collect();
        }
    }),
    test('rejects resolution redirected after graph preparation', async function (scope) {
        const fixture = moduleLoadingRuntime();
        const redirect = fixture.runtime.register({
            resolve(specifier, context, next) {
                const resolved = next(specifier, context);
                return specifier.includes('overkill-build') ? { ...resolved, url: 'file:///redirect.ts' } : resolved;
            }
        });
        scope.cleanup(redirect.deregister);
        await scope.assert.rejects(async function () {
            await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function (load) {
                return await load(entry);
            });
        }, { message: 'Implementation module resolution changed after preparation.' });
        return scope.assert.collect();
    }),
    test('normalizes already tagged declared graph edges', async function (scope: TestScope) {
        const fixture = moduleLoadingRuntime();
        const first = modules[0];
        scope.require.defined(first);
        await createModuleLoading(fixture.runtime).withModuleDelivery({
            ...delivery,
            modules: [ { ...first, dependencies: { './dependency': builtDependency } }, ...modules.slice(1) ]
        }, async function () {
            scope.assert.equal(fixture.resolve('./dependency', builtEntry).url, builtDependency);
        });
        scope.assert.equal(fixture.registrations.length, 1);
        return scope.assert.collect();
    }),
    test(
        'passes unrelated requests through temporary parent-aware resolution hooks',
        function (scope) {
            const fixture = moduleLoadingRuntime();
            const loading = createModuleLoading({
                ...fixture.runtime,
                resolve(specifier) {
                    scope.assert.equal(fixture.resolve('node:path', undefined).url, 'node:path');
                    return fixture.runtime.resolve(specifier);
                }
            });
            scope.assert.equal(loading.resolveModuleUrl('./dependency.ts', entry), dependency);
            scope.assert.equal(fixture.registrations.length, 0);
            return scope.assert.collect();
        }
    )
]);
