import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { defineConfigTests } from '../../../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, emptyConfigProject } from '../../../test-support/eslint-config.ts';

export const testNode: TestNode = suite('config definition validation', [
    test('rejects inventory exclusions for rules outside the catalog', function (scope) {
        scope.assert.throws(function () {
            defineConfigTests({
                ...configDefinition([]),
                inventories: [ {
                    title: 'inventory',
                    configs: 'all',
                    catalog: { kind: 'rules', rules: [ { ruleId: 'known', deprecated: false } ] },
                    target: { kind: 'declared' },
                    completeness: 'all',
                    deprecated: 'allow',
                    exclusions: [ { ruleId: 'unknown', reason: 'not applicable' } ]
                } ]
            });
        }, { message: 'Inventory exclusions must name catalog rules.' });
        return scope.assert.collect();
    }),
    test('validates effective inventory paths after admitting known exclusions', function (scope) {
        scope.assert.throws(function () {
            defineConfigTests({
                ...configDefinition([]),
                inventories: [ {
                    title: 'inventory',
                    configs: 'all',
                    catalog: { kind: 'rules', rules: [ { ruleId: 'known', deprecated: false } ] },
                    target: { kind: 'effective', filename: '../outside.js' },
                    completeness: 'all',
                    deprecated: 'allow',
                    exclusions: [ { ruleId: 'known', reason: 'not applicable' } ]
                } ]
            });
        }, { message: 'Project filenames must stay inside the project root.' });
        return scope.assert.collect();
    }),
    test('validates expected fixed-output paths before creating fixture tests', function (scope) {
        scope.assert.throws(function () {
            defineConfigTests({
                ...configDefinition([]),
                fixtures: [ {
                    title: 'fix',
                    configs: 'all',
                    source: { kind: 'inline', filename: 'input.js', code: '' },
                    expect: {
                        kind: 'fix',
                        diagnostics: { kind: 'clean' },
                        output: { kind: 'file', filename: '../outside.js' }
                    }
                } ]
            });
        }, { message: 'Project filenames must stay inside the project root.' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid configuration selection',
        cases: [ [], [ 'missing' ], [ 'basic', 'basic' ] ],
        caseTitle(configs) {
            return JSON.stringify(configs);
        },
        test(scope) {
            const configs = scope.parameters;

            const input: unknown = configs;
            scope.assert.throws(function invalid() {
                Reflect.apply(defineConfigTests, undefined, [ {
                    ...configDefinition([]),
                    files: [ { title: 'file', configs: input, filename: 'file.js', expect: { kind: 'ignored' } } ]
                } ]);
            }, { message: /unique known/ });
            return scope.assert.collect();
        }
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
