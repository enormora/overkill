import { type TestNode, suite, test } from '@overkill-dev/test';

import {
    defineConfigTests,
    type ConfigFileExpectation
} from '../../../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, executeConfigNode } from '../../../test-support/eslint-config.ts';

const included: ConfigFileExpectation = {
    kind: 'included',
    ruleMatch: 'subset',
    rules: { 'no-debugger': 'error', 'no-alert': null },
    languageOptions: {},
    settings: {}
};
export const testNode: TestNode = suite('effective config checks', [
    test('resolves matching, ignores, severity aliases and ordered overrides', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([
                { ignores: [ '**/ignored.js' ] },
                { files: [ '**/*.js' ], rules: { 'no-debugger': 'warn' }, settings: { nested: { base: true } } },
                { files: [ '**/strict.js' ], rules: { 'no-debugger': 2 }, settings: { nested: { overlay: true } } }
            ]),
            files: [
                {
                    title: 'strict',
                    configs: 'all',
                    filename: 'strict.js',
                    expect: { ...included, settings: { nested: { base: true, overlay: true } } }
                },
                { title: 'ignored', configs: 'all', filename: 'ignored.js', expect: { kind: 'ignored' } },
                { title: 'ordinary', configs: 'all', filename: 'ordinary.js', expect: included }
            ]
        });
        const result = await executeConfigNode(definitions.checks());
        scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 2, 1 ]);
        return scope.assert.collect();
    }),
    test(
        'distinguishes absent rules from disabled rules and exact from subset checks',
        async function (scope) {
            const definitions = defineConfigTests({
                ...configDefinition([ { rules: { 'no-debugger': 'off', 'no-alert': 'warn' } } ]),
                files: [
                    {
                        title: 'off',
                        configs: 'all',
                        filename: 'file.js',
                        expect: { ...included, rules: { 'no-debugger': 0 } }
                    },
                    {
                        title: 'absent',
                        configs: 'all',
                        filename: 'file.js',
                        expect: { ...included, rules: { 'no-debugger': null } }
                    },
                    {
                        title: 'exact',
                        configs: 'all',
                        filename: 'file.js',
                        expect: { ...included, rules: { 'no-debugger': 0 }, ruleMatch: 'exact' }
                    }
                ]
            });
            const result = await executeConfigNode(definitions.checks());
            scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 1, 2 ]);
            return scope.assert.collect();
        }
    ),
    test('does not read an existing project when checking static declarations', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([ { rules: { 'no-debugger': 'off' } } ]),
            project: { kind: 'existing', root: '/missing/eslint-project' },
            inventories: [ {
                title: 'inventory',
                configs: 'all',
                target: { kind: 'declared' },
                completeness: 'all',
                deprecated: 'allow',
                exclusions: [],
                catalog: { kind: 'rules', rules: [ { ruleId: 'no-debugger', deprecated: false } ] }
            } ]
        });
        const result1 = await executeConfigNode(definitions.checks());
        scope.assert.equal(result1.summary.passed, 1);
        return scope.assert.collect();
    })
]);
