import { suite, test } from '@overkill-dev/test';
import * as parser from '@typescript-eslint/parser';
import { TSESLint } from '@typescript-eslint/utils';
import { overkillPlugin } from '../../packages/eslint-plugin/eslint-plugin.entry-point.ts';

const ruleId = 'overkill/no-single-use-trivial-assertion';
const imports = [
    "import { defineCompositeAssertion as composite, defineNarrowingCompositeAssertion as narrowing } from '@overkill-dev/assert';",
    "import { test, table } from '@overkill-dev/test';"
];

function lint(lines: readonly string[]): readonly (readonly (number | string | null | undefined)[])[] {
    const linter = new TSESLint.Linter();
    return linter.verify([ ...imports, ...lines ].join('\n'), {
        languageOptions: { parser },
        plugins: { overkill: overkillPlugin },
        rules: { [ruleId]: 'error' }
    }, 'fixture.js').map(function (message) {
        return [ message.ruleId, message.messageId, message.line, message.column ];
    });
}

const trivial = "const statusOk = composite({ name: 'ok', assert: (check, response) => check.equal(response.status, 200) });";
const use = "test('response', scope => scope.assert(statusOk, response));";
const diagnostic = [ ruleId, 'trivialAssertion', 3, 18 ];

export const testNode = suite('no-single-use-trivial-assertion', [
    test('reports at the factory for a single table use through an alias', function (scope) {
        scope.assert.deepEqual(lint([
            trivial,
            'const alias = statusOk;',
            "table({ title: 'responses', cases: [1, 2], caseTitle: String,",
            "    test({ assert, parameters }) { assert.annotated('response')(alias, parameters); return assert.collect(); }",
            '});'
        ]), [ diagnostic ]);
        return scope.assert.collect();
    }),
    test('follows known object fields and reaching writes', function (scope) {
        scope.assert.deepEqual(lint([
            "test('response', scope => {",
            '    ' + trivial,
            '    const holder = { ref: ordinary };',
            '    holder.ref = statusOk;',
            '    const { ref: alias } = holder;',
            '    scope.assert(alias, response);',
            '    holder.ref = ordinary;',
            '    scope.assert(holder.ref, response);',
            '});'
        ]), [ [ ruleId, 'trivialAssertion', 4, 22 ] ]);
        return scope.assert.collect();
    }),
    test('recognizes an inline definition in a direct engine case', function (scope) {
        scope.assert.deepEqual(lint([
            "import { createEngine } from '@overkill-dev/engine';",
            "import * as assertions from '@overkill-dev/test/assert';",
            'const engine = createEngine();',
            "engine.createTestCase({ body(scope) { scope.assert(assertions.defineCompositeAssertion({ name: 'ok', assert: (check, value) => check.true(value) }), true); } });"
        ]), [ [ ruleId, 'trivialAssertion', 6, 52 ] ]);
        return scope.assert.collect();
    }),
    test('preserves additional source uses, exports and escapes', function (scope) {
        const variants = [
            [ 'const alias = statusOk;', "test('two', scope => { scope.assert(alias, one); scope.assert(alias, two); });" ],
            [ 'const alias = statusOk;', 'export { alias };', use ],
            [ 'export const holder = { statusOk };', use ],
            [ 'const holder = { statusOk };', 'export { holder };', use ],
            [ "test('unreachable', scope => { scope.assert(statusOk, one); return; scope.assert(statusOk, two); });" ],
            [ 'register(statusOk);', use ],
            [ 'register(statusOk);' ],
            [ "test('shadowed', scope => { const statusOk = ordinary; scope.assert(statusOk, response); });" ],
            [ "test('shadowed', scope => { const composite = ordinary; const ref = composite({ name: 'ok', assert: (check, value) => check.true(value) }); scope.assert(ref, response); });" ]
        ];
        for (const variant of variants) {
            scope.assert.deepEqual(lint([ trivial, ...variant ]), []);
        }
        return scope.assert.collect();
    }),
    test('preserves narrowing, diagnostics and computation', function (scope) {
        const variants = [
            "narrowing({ name: 'ok', narrows: value => value === 200 })",
            "composite({ name: 'ok', formatSummary: () => 'status mismatch', assert: (check, value) => check.equal(value, 200) })",
            "composite({ name: 'ok', assert: (check, value) => check.annotated('status').equal(value, 200) })",
            "composite({ name: 'ok', assert: (check, value) => check.equal(normalize(value), 200) })",
            "composite({ name: label(), assert: (check, value) => check.equal(value, 200) })",
            "composite({ name: 'ok', assert: (check, value) => (record(value), check.equal(value, 200)) })",
            "composite({ name: 'ok', assert: (check, { status, extra = load() }) => check.equal(status, 200) })",
            "composite({ name: 'ok', assert: (check, value) => check.group([check.number(value), check.equal(value, 200)]) })",
            "composite({ name: 'ok', assert: (check, value) => check.fromThrowable('external check', value) })",
            "composite({ name: 'ok', assert: (check, value) => { if (value === undefined) return check.fail(); return check.equal(value, 200); } })"
        ];
        for (const definition of variants) {
            scope.assert.deepEqual(lint([ 'const statusOk = ' + definition + ';', use ]), []);
        }
        return scope.assert.collect();
    }),
    test('reports a one-child group and forwarded error checks', function (scope) {
        const bodies = [
            'assert(check, value) { const { equal } = check; const child = equal(value, 200); return check.group([child]); }',
            'assert: (check, run, matcher) => check.throws(run, matcher)',
            'assert: async (check, run, matcher) => await check.rejects(run, matcher)'
        ];
        for (const body of bodies) {
            scope.assert.deepEqual(lint([ "const statusOk = composite({ name: 'ok', " + body + ' });', use ]), [
                diagnostic
            ]);
        }
        return scope.assert.collect();
    })
]);
