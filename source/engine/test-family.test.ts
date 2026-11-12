import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    defineTestFamily,
    isDefinedTestFamily,
    workIdentityKey,
    type FamilyValue,
    type TestFamilyDefinition
} from '../packages/engine/engine.entry-point.ts';
import { bindFamilySettings } from './test-family.ts';

function settingsDefinition<Settings extends FamilyValue>(
    parseSettings: (input: unknown) => Settings
): TestFamilyDefinition<Settings> {
    return {
        id: '@example/checks',
        version: '1',
        module: null,
        features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings,
        async load() {
            throw new Error('Backend loaded');
        }
    };
}

const invalidSettings = [
    {
        name: 'cycles',
        value: (function () {
            const cycle = { next: null };
            Reflect.set(cycle, 'next', cycle);
            return cycle;
        })()
    },
    {
        name: 'functions',
        value() {
            return null;
        }
    },
    { name: 'class instances', value: new Date(0) },
    {
        name: 'sparse arrays',
        value: (function () {
            const array = [ null ];
            Reflect.deleteProperty(array, '0');
            return array;
        })()
    },
    { name: 'negative zero', value: -0 },
    { name: 'undefined', value: undefined }
];

const invalidDefinitions = [
    { name: 'empty IDs', field: 'id', value: '' },
    { name: 'empty versions', field: 'version', value: '' },
    { name: 'non-callable parsers', field: 'parseSettings', value: null },
    { name: 'non-callable loaders', field: 'load', value: null },
    {
        name: 'empty process models',
        field: 'features',
        value: {
            execution: 'runtime',
            processModels: [],
            profileOptions: []
        }
    }
];

export const testNode = suite('executable family definitions', [
    test('binds normalized settings independently without loading backends', function (scope) {
        let loads = 0;
        const family = defineTestFamily({
            ...settingsDefinition(function (input) {
                if (typeof input !== 'string') {
                    throw new TypeError('Expected a project path.');
                }
                return { project: input.trim() };
            }),
            async load() {
                loads += 1;
                throw new Error('Backend loaded');
            }
        });
        const first = bindFamilySettings(family, ' first ');
        const second = bindFamilySettings(family, ' second ');
        scope.assert.deepEqual([ JSON.stringify(first.settings), JSON.stringify(second.settings) ], [
            '{"project":"first"}',
            '{"project":"second"}'
        ]);
        scope.assert.equal(Object.isFrozen(first.settings), true);
        scope.assert.equal(loads, 0);
        scope.assert.throws(function rejectInvalidSettings() {
            bindFamilySettings(family, 42);
        }, { message: 'Expected a project path.' });
        scope.assert.equal(loads, 0);
        return scope.assert.collect();
    }),
    ...invalidDefinitions.map(function rejectedDefinition(entry) {
        return test(`rejects definitions with ${entry.name}`, function (scope) {
            const definition = settingsDefinition(function () {
                return null;
            });
            Reflect.set(definition, entry.field, entry.value);
            scope.assert.throws(function invalidDefinition() {
                defineTestFamily(definition);
            }, {
                message: new RegExp(entry.field, 'v')
            });
            return scope.assert.collect();
        });
    }),
    ...invalidSettings.map(function rejectedSettings(entry) {
        return test(`rejects settings containing ${entry.name}`, function (scope) {
            const family = defineTestFamily(
                settingsDefinition(function () {
                    return Object.defineProperty({ value: null }, 'value', { value: entry.value });
                })
            );
            scope.assert.throws(function invalidOutput() {
                family.parseSettings(null);
            }, {
                message: 'Family settings require lossless, acyclic JSON.'
            });
            return scope.assert.collect();
        });
    }),
    test('snapshots settings and metadata without loading a backend', function (scope) {
        const input = { nested: { enabled: true } };
        let loads = 0;
        const family = defineTestFamily({
            id: '@example/checks',
            version: '1',
            module: null,
            features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
            parseSettings() {
                return input;
            },
            async load() {
                loads += 1;
                throw new Error('Backend loaded');
            }
        });
        const settings = family.parseSettings(null);
        input.nested.enabled = false;
        scope.assert.equal(settings.nested.enabled, true);
        scope.assert.equal(Object.isFrozen(settings.nested), true);
        scope.assert.equal(loads, 0);
        scope.assert.equal(isDefinedTestFamily(family) && !isDefinedTestFamily({ ...family }), true);
        return scope.assert.collect();
    }),
    test('validates module references and snapshots transport metadata', function (scope) {
        const module = { moduleUrl: 'file:///missing-family.ts', exportName: 'family' };
        const family = defineTestFamily({
            ...settingsDefinition(function () {
                return null;
            }),
            module
        });
        module.exportName = 'changed';
        scope.assert.equal(family.module?.exportName, 'family');
        scope.assert.throws(function relativeModule() {
            defineTestFamily({
                ...settingsDefinition(function () {
                    return null;
                }),
                module: { moduleUrl: './family.ts', exportName: 'family' }
            });
        }, { message: /Invalid URL/v });
        return scope.assert.collect();
    }),
    test('rejects incompatible analysis features', function (scope) {
        scope.assert.throws(function analysisCoverage() {
            defineTestFamily({
                ...settingsDefinition(function () {
                    return null;
                }),
                features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [ 'coverage' ] }
            });
        }, { message: 'Analysis families cannot enable runtime profile options.' });
        return scope.assert.collect();
    }),
    test('retains parser failures and invokes the lazy loader only on request', async function (scope) {
        const family = defineTestFamily(settingsDefinition(function () {
            throw new Error('Invalid settings');
        }));
        scope.assert.throws(function rejectedInput() {
            family.parseSettings(null);
        }, { message: 'Invalid settings' });
        await scope.assert.rejects(async function lazyLoad() {
            await family.load();
        }, { message: 'Backend loaded' });
        return scope.assert.collect();
    }),
    test('rejects nonserializable parser output', function (scope) {
        const family = defineTestFamily({
            id: '@example/checks',
            version: '1',
            module: null,
            features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
            parseSettings() {
                return { value: Number.NaN };
            },
            async load() {
                throw new Error('Backend loaded');
            }
        });
        scope.assert.throws(function nonfiniteSettings() {
            family.parseSettings(null);
        }, { message: 'Family settings require lossless, acyclic JSON.' });
        return scope.assert.collect();
    }),
    test('preserves neutral keys and isolates family variants', function (scope) {
        const logical = { file: null, suite: [], title: 'example', params: null };
        const neutral = { case: logical, runtimes: [], workload: null, familyVariant: null };
        scope.assert.equal(workIdentityKey(neutral), JSON.stringify([ null, [], 'example', null ]));
        const first = { ...neutral, familyVariant: { family: '@example/checks', key: 'one' } };
        const second = { ...neutral, familyVariant: { family: '@example/checks', key: 'two' } };
        scope.assert.equal(workIdentityKey(first) === workIdentityKey(second), false);
        const otherFamily = { ...first, familyVariant: { family: '@other/checks', key: 'one' } };
        scope.assert.equal(workIdentityKey(first) === workIdentityKey(otherFamily), false);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
