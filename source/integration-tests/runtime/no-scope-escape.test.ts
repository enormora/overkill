import { suite, test } from '@overkill-dev/test';
import * as parser from '@typescript-eslint/parser';
import { TSESLint } from '@typescript-eslint/utils';
import { overkillPlugin as plugin } from '../../packages/eslint-plugin/eslint-plugin.entry-point.ts';

const ruleId = 'overkill/no-scope-escape';

function diagnostics(code: string): readonly (readonly (number | string | null | undefined)[])[] {
    const linter = new TSESLint.Linter();
    return linter
        .verify(code, {
            languageOptions: { parser },
            plugins: { overkill: plugin },
            rules: { [ruleId]: 'error' }
        }, 'fixture.js')
        .map(function diagnostic(message) {
            return [ message.ruleId, message.messageId, message.line, message.column ];
        });
}

export const testNode = suite('no-scope-escape', [
    test('reports direct and aggregate transfers with reaching values', function (scope) {
        scope.assert.deepEqual(
            diagnostics([
                "import { test as authored } from '@overkill-dev/test';",
                "authored('case', context => {",
                '    const { assert: checks, plan } = context;',
                "    let compare = checks.annotated('user').equal;",
                '    if (condition) compare = ordinary;',
                '    helper(compare);',
                '    compare = ordinary;',
                '    helper(compare);',
                '    const container = { nested: [plan] };',
                '    new Helper(container);',
                '    helper(context.resources.file);',
                '    function local(checks) { helper(checks); }',
                '    checks.equal(1, 1);',
                '    return checks.collect();',
                '});'
            ]
                .join('\n')),
            [ [ ruleId, 'forward', 6, 12 ], [ ruleId, 'forward', 10, 16 ] ]
        );
        return scope.assert.collect();
    }),
    test('follows TypeScript casts and skips type-only imports', function (scope) {
        scope.assert.deepEqual(
            diagnostics([
                "import { test } from '@overkill-dev/test';",
                "import type { test as TypeOnly } from '@overkill-dev/test';",
                "TypeOnly('unclaimed', scope => helper(scope.assert));",
                "test('known', scope => {",
                "    const checks = scope.assert as typeof scope.assert;",
                "    helper(checks);",
                "    return scope.assert.collect();",
                "});"
            ]
                .join('\n')),
            [ [ ruleId, 'forward', 6, 12 ] ]
        );
        return scope.assert.collect();
    }),
    test('requires evidence before reporting a captured scope', function (scope) {
        scope.assert.deepEqual(
            diagnostics([
                "import { test } from '@overkill-dev/test';",
                'let saved;',
                "test('case', scope => {",
                '    const check = () => scope.require.equal(1, 1);',
                '    [1].forEach(check);',
                '    unknown(check);',
                '    scope.startInFlight(async () => check());',
                '    setTimeout(check, 10);',
                '    saved = { check: () => check() };',
                '    return scope.assert.collect();',
                '});',
                "test('return', scope => scope.assert);"
            ]
                .join('\n')),
            [
                [ ruleId, 'escape', 8, 16 ],
                [ ruleId, 'escape', 9, 13 ],
                [ ruleId, 'escape', 12, 25 ]
            ]
        );
        return scope.assert.collect();
    }),
    test('honors public authoring positions across wrappers, engines, and trials', function (scope) {
        scope.assert.deepEqual(
            diagnostics([
                "import * as authoring from '@overkill-dev/test';",
                "import { throwingTest } from '@overkill-dev/test/compatibility';",
                "import { withResource } from '@overkill-dev/test/resources';",
                "import { withProperties, property } from '@overkill-dev/test/property';",
                "import { createEngine } from '@overkill-dev/engine';",
                'const engine = createEngine();',
                'const body = ({ require }) => helper(require.equal);',
                "authoring.test('wrapped', withResource(resource, body));",
                "throwingTest('throwing', scope => helper(scope));",
                'authoring.table({ test(scope) { helper(scope.plan); }, caseTitle(scope) { helper(scope); } });',
                'authoring.defineParameterizedTestBody((scope, data) => { helper(scope.assert); helper(data); });',
                'engine.createTable({ cases: [{ body(scope) { helper(scope); } }] });',
                'engine.createWorkloadTestCase({ workloads: [{ body(scope) { helper(scope); } }] });',
                "authoring.test('property', withProperties(scope => scope.forall(generator, (data, sample) => {",
                '    helper(data); helper(sample.require);',
                '})));',
                'property({ test(data, sample) { helper(data); helper(sample.assert); } });',
                'ordinary.test("unrelated", scope => helper(scope));'
            ]
                .join('\n'))
                .map(function location([ rule, message, line ]) {
                    return [ rule, message, line ];
                }),
            [ 7, 9, 10, 11, 12, 13, 15, 17 ].map(function expected(line) {
                return [ ruleId, 'forward', line ];
            })
        );
        return scope.assert.collect();
    })
]);
