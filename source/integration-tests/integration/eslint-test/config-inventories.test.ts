import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { defineConfigTests, type ConfigInventory } from '../../../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, executeConfigNode } from '../../../test-support/eslint-config.ts';

const inventory: ConfigInventory<'basic'> = {
    title: 'catalog',
    configs: 'all',
    target: { kind: 'declared' },
    completeness: 'all',
    deprecated: 'allow',
    exclusions: [],
    catalog: {
        kind: 'rules',
        rules: [ { ruleId: 'no-debugger', deprecated: false }, { ruleId: 'no-alert', deprecated: false } ]
    }
};
const cases = [
    {
        title: 'explicit disabling counts as configured',
        rules: { 'no-debugger': 'off', 'no-alert': 'warn' },
        passed: 1
    },
    { title: 'missing rules fail completeness', rules: { 'no-debugger': 'off' }, passed: 0 },
    {
        title: 'unknown rules fail separately',
        rules: { 'no-debugger': 'off', 'no-alert': 'off', unknown: 'off' },
        passed: 0
    }
] as const;

export const testNode: TestNode = suite('config inventories', [
    test('allows retained deprecated entries and can require their absence', async function (scope) {
        const definition = defineConfigTests({
            ...configDefinition([]),
            configs: {
                basic() {
                    return [ { rules: { 'alias/old': 'off' } } ];
                }
            },
            inventories: [
                {
                    ...inventory,
                    title: 'allowed',
                    catalog: { kind: 'rules', rules: [ { ruleId: 'alias/old', deprecated: true } ] }
                },
                {
                    ...inventory,
                    title: 'absent',
                    deprecated: 'absent',
                    catalog: { kind: 'rules', rules: [ { ruleId: 'alias/old', deprecated: true } ] }
                }
            ]
        });
        const result = await executeConfigNode(definition.checks());
        scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 1, 1 ]);
        return scope.assert.collect();
    }),
    test('rejects effective inventories for ignored files', async function (scope) {
        const definition = defineConfigTests({
            ...configDefinition([ { ignores: [ '**/ignored.js' ] } ]),
            inventories: [ { ...inventory, target: { kind: 'effective', filename: 'ignored.js' } } ]
        });
        const result = await executeConfigNode(definition.checks());
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    table({
        title: 'checks configured rule inventories',
        cases: cases,
        caseTitle(entry) {
            return entry.title;
        },
        async test(scope) {
            const entry = scope.parameters;

            const definition = defineConfigTests({
                ...configDefinition([ { rules: entry.rules } ]),
                inventories: [ inventory ]
            });
            const result = await executeConfigNode(definition.checks());
            scope.assert.equal(result.summary.passed, entry.passed);
            scope.assert.equal(result.summary.failed, 1 - entry.passed);
            return scope.assert.collect();
        }
    }),
    test('uses plugin aliases and recognizes deprecated metadata', async function (scope) {
        const catalog = {
            kind: 'plugin',
            namespace: 'alias',
            rules: {
                current: {
                    create() {
                        return {};
                    }
                },
                old: {
                    meta: { deprecated: { replacedBy: [] } },
                    create() {
                        return {};
                    }
                }
            }
        } as const;
        const entry = { ...inventory, catalog, deprecated: 'off' } as const;
        const good = defineConfigTests({
            ...configDefinition([ { rules: { 'alias/current': 'off', 'alias/old': 'off' } } ]),
            inventories: [ entry ]
        });
        const bad = defineConfigTests({
            ...configDefinition([ { rules: { 'alias/current': 'off', 'alias/old': 'warn' } } ]),
            inventories: [ entry ]
        });
        const result1 = await executeConfigNode(good.checks());
        scope.assert.equal(result1.summary.passed, 1);
        const result2 = await executeConfigNode(bad.checks());
        scope.assert.equal(result2.summary.failed, 1);
        return scope.assert.collect();
    }),
    test(
        'validates exclusions and distinguishes declaration from filename applicability',
        async function (scope) {
            const base = configDefinition([ { files: [ '**/*.js' ], rules: { 'no-debugger': 'off' } }, {
                files: [ '**/*.ts' ],
                rules: { 'no-alert': 'off' }
            } ]);
            const definitions = defineConfigTests({
                ...base,
                inventories: [ inventory, {
                    ...inventory,
                    title: 'effective',
                    target: { kind: 'effective', filename: 'test.js' }
                } ]
            });
            const result = await executeConfigNode(definitions.checks());
            scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 1, 1 ]);
            scope.assert.throws(function invalidExclusion() {
                defineConfigTests({
                    ...base,
                    inventories: [ { ...inventory, exclusions: [ { ruleId: 'no-alert', reason: '' } ] } ]
                });
            }, { message: /Too small/ });
            return scope.assert.collect();
        }
    ),
    test(
        'known-only permits intentionally partial inventories and justified exclusions',
        async function (scope) {
            const base = configDefinition([ { rules: { 'no-debugger': 'off' } } ]);
            const definitions = defineConfigTests({
                ...base,
                inventories: [
                    { ...inventory, completeness: 'known-only' },
                    {
                        ...inventory,
                        title: 'excluded',
                        exclusions: [ { ruleId: 'no-alert', reason: 'Browser-only policy.' } ]
                    }
                ]
            });
            const result3 = await executeConfigNode(definitions.checks());
            scope.assert.equal(result3.summary.passed, 2);
            return scope.assert.collect();
        }
    )
]);
