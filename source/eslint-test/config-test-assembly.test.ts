import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { configInventory, configTestOperations, runAssembledConfig } from '../test-support/config-test-operations.ts';
import { catalogRules, declaredRules, checkInventory } from './config-inventory.ts';

export const testNode = suite('config test assembly and declared inventories', [
    test('expands selected checks into executable cases', async function (scope: TestScope) {
        const fixture = configTestOperations(null, false);
        const result = await runAssembledConfig(fixture.tests.checks());
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.perTest.length, 3);
        scope.assert.deepEqual(fixture.calls, [ 'inventory:inventory', 'inventory:inventory', 'file:input.js' ]);
        return scope.assert.collect();
    }),
    ...([ false, true ] as const).map(function (custom) {
        return test(`retains fixture result with custom assertions ${custom}`, async function (scope: TestScope) {
            const fixture = configTestOperations(null, custom);
            const result = await runAssembledConfig(fixture.tests.fixtures());
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(result.perTest.length, 1);
            scope.assert.deepEqual(fixture.calls, [ 'fixture:input.js' ]);
            return scope.assert.collect();
        });
    }),
    test('records operation failures as failed checks', async function (scope: TestScope) {
        const fixture = configTestOperations(new Error('backend failed'), false);
        const result = await runAssembledConfig(fixture.tests.checks());
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(
            result
                .perTest
                .filter(function (value) {
                    return value.verdict === 'fail';
                })
                .length,
            3
        );
        return scope.assert.collect();
    }),
    test('merges later rule declarations over earlier layers', function (scope: TestScope) {
        scope.assert.deepEqual(
            declaredRules([ { rules: { first: 'warn', second: 'error' } }, { rules: { first: 'off' } }, {} ]),
            { first: 'off', second: 'error' }
        );
        return scope.assert.collect();
    }),
    test('reads plugin deprecation metadata without requiring rule implementations', function (scope: TestScope) {
        scope.assert.deepEqual(
            catalogRules({
                kind: 'plugin',
                namespace: 'plugin',
                rules: {
                    active: {},
                    unknown: { meta: {} },
                    old: { meta: { deprecated: true } },
                    replacement: { meta: { deprecated: { replacedBy: [] } } }
                }
            }),
            [ { ruleId: 'plugin/active', deprecated: false }, { ruleId: 'plugin/unknown', deprecated: false }, {
                ruleId: 'plugin/old',
                deprecated: true
            }, { ruleId: 'plugin/replacement', deprecated: true } ]
        );
        return scope.assert.collect();
    }),
    ...([ 'absent', 'allow', 'off' ] as const).map(function (policy) {
        return test(`accepts compatible ${policy} deprecated rule settings`, function (scope: TestScope) {
            checkInventory(
                policy === 'absent'
                    ? { 'plugin/active': 'error' }
                    : { 'plugin/active': 'error', 'plugin/old': policy === 'allow' ? 'warn' : 'off' },
                { ...configInventory, deprecated: policy }
            );
            scope.assert.throws(function () {
                checkInventory({}, configInventory);
            }, { message: /Rule inventory differs/u });
            return scope.assert.collect();
        });
    }),
    ...([ { name: 'missing', rules: {} }, {
        name: 'unknown',
        rules: { 'plugin/active': 'error', 'plugin/unknown': 'off' }
    }, { name: 'deprecated', rules: { 'plugin/active': 'error', 'plugin/old': 'off' } } ] as const)
        .map(function (entry) {
            return test(`rejects ${entry.name} rule inventory differences`, function (scope: TestScope) {
                scope.assert.throws(function () {
                    checkInventory(entry.rules, configInventory);
                }, { message: /Rule inventory differs/u });
                return scope.assert.collect();
            });
        }),
    test('permits documented exclusions and known-only incomplete inventories', function (scope: TestScope) {
        checkInventory({ 'plugin/old': 'error' }, {
            ...configInventory,
            completeness: 'known-only',
            exclusions: [ { ruleId: 'plugin/old', reason: 'legacy' } ]
        });
        scope.assert.throws(function () {
            checkInventory({}, { ...configInventory, catalog: { kind: 'rules', rules: [] } });
        }, { message: /Rule inventory must not be empty/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
