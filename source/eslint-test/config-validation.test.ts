import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineConfigTests } from '../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, emptyConfigProject } from '../test-support/eslint-config.ts';

export const testNode = suite('config definition validation', [
    ...[ [], [ 'missing' ], [ 'basic', 'basic' ] ].map(function selection(configs) {
        return test(`rejects invalid selection ${JSON.stringify(configs)}`, function (scope) {
            const input: unknown = configs;
            scope.assert.throws(function invalid() {
                Reflect.apply(defineConfigTests, undefined, [ {
                    ...configDefinition([]),
                    files: [ { title: 'file', configs: input, filename: 'file.js', expect: { kind: 'ignored' } } ]
                } ]);
            }, { message: /unique known/ });
            return scope.assert.collect();
        });
    }),
    test('rejects empty configuration maps and relative existing roots', function (scope) {
        scope.assert.throws(function noConfigs() {
            defineConfigTests<string>({ ...configDefinition([]), configs: {} });
        }, { message: /at least one/ });
        scope.assert.throws(function relativeRoot() {
            defineConfigTests({ ...configDefinition([]), project: { kind: 'existing', root: 'relative' } });
        }, { message: /absolute/ });
        return scope.assert.collect();
    }),
    test('rejects fake generators and empty or repeated contracts', function (scope) {
        const base = { title: 'generated', configs: 'all', project: emptyConfigProject };
        scope.assert.throws(function fakeGenerator() {
            Reflect.apply(defineConfigTests, undefined, [ {
                ...configDefinition([]),
                generation: [ { ...base, generator: { kind: 'custom', input: {} } } ]
            } ]);
        }, { message: /Overkill generator/ });
        for (const contracts of [ [], [ { kind: 'crash-freedom' }, { kind: 'crash-freedom' } ] ]) {
            scope.assert.throws(function invalidContracts() {
                Reflect.apply(defineConfigTests, undefined, [ {
                    ...configDefinition([]),
                    generation: [ {
                        ...base,
                        generator: { kind: 'syntax', syntax: 'javascript', filename: 'file.js' },
                        contracts
                    } ]
                } ]);
            }, { message: /unique property contracts/ });
        }
        return scope.assert.collect();
    })
]);
