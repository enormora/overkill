import { suite, test } from '@overkill-dev/test';
import * as parser from '@typescript-eslint/parser';
import { TSESLint } from '@typescript-eslint/utils';
import { overkillPlugin } from '../../packages/eslint-plugin/eslint-plugin.entry-point.ts';

const ruleId = 'overkill/no-self-comparison';

function lint(lines: readonly string[]): readonly (readonly (number | string | null | undefined)[])[] {
    const linter = new TSESLint.Linter();
    return linter.verify([
        "import { test as scenario } from '@overkill-dev/test';",
        ...lines
    ].join('\n'), {
        files: [ '**/*.ts' ],
        languageOptions: { parser },
        plugins: { overkill: overkillPlugin },
        rules: { [ruleId]: 'error' }
    }, 'fixture.ts').map(message => [ message.ruleId, message.messageId, message.line ]);
}

function reports(...lines: readonly number[]): readonly (readonly (string | number)[])[] {
    return lines.map(line => [ ruleId, 'selfComparison', line ]);
}

export const testNode = suite('no-self-comparison', [
    test('reports each equality method through stable aliases and local data fields', function (scope) {
        scope.assert.deepEqual(lint([
            "scenario('equality', ({ assert }) => {",
            '    const value = load();',
            '    const box = { value };',
            '    const { value: copy } = box;',
            '    const { equal } = assert;',
            '    equal(value, copy);',
            '    assert.annotated("negated").notEqual(box.value, value);',
            '    assert.deepEqual(box.value, box["value"]);',
            '    const check = assert.notDeepEqual.bind(null);',
            '    check(value, value as unknown);',
            '    const other = { flag: opaque() };',
            '    assert.equal(other.flag, other.flag);',
            '});'
        ]), reports(7, 8, 9, 11, 13));
        return scope.assert.collect();
    }),
    test('follows all reaching copies without conflating assignments or loop iterations', function (scope) {
        scope.assert.deepEqual(lint([
            "scenario('flow', ({ assert }) => {",
            '    let left, right;',
            '    if (input) { left = load(); right = left; }',
            '    else { right = load(); left = right; }',
            '    assert.equal(left, right);',
            '    right = load();',
            '    assert.equal(left, right);',
            '    let previous;',
            '    for (const input of inputs) {',
            '        const current = load(input);',
            '        const alias = current;',
            '        assert.equal(current, alias);',
            '        assert.equal(previous, current);',
            '        previous = current;',
            '    }',
            '});'
        ]), reports(6, 13));
        return scope.assert.collect();
    }),
    test('recognizes check builders, declared scopes, and stable captured copies', function (scope) {
        scope.assert.deepEqual(lint([
            "import { defineCompositeAssertion as composite, defineNarrowingCompositeAssertion as narrowing } from '@overkill-dev/assert';",
            "import { createEngine } from '@overkill-dev/engine';",
            "import { throwingTest } from '@overkill-dev/test/compatibility';",
            "import { withResource } from '@overkill-dev/test/resources';",
            "import { table, defineParameterizedTestBody } from '@overkill-dev/test';",
            'const value = load(); const alias = value;',
            'const body = ({ assert }) => assert.equal(value, alias);',
            "scenario('resource', withResource(resource, body));",
            "throwingTest('throws', body);",
            'table({ test: body });',
            'defineParameterizedTestBody(({ assert }, value) => assert.equal(value, value));',
            'createEngine().createPropertyTestCase({ body(scope) {',
            '    return scope.forall(generator, (data, trial) => trial.assert.equal(data, data));',
            '} });',
            'const checkBody = (check, data) => check.group([check.annotated("same").deepEqual(data, data)]);',
            'composite({ name: "composite", assert: checkBody, formatSummary: format });',
            'narrowing({ narrows: (check, data) => check.equal(data, data) });'
        ]), reports(8, 12, 14, 16));
        return scope.assert.collect();
    }),
    test('applies method overwrites at their reaching use and preserves extracted methods', function (scope) {
        scope.assert.deepEqual(lint([
            "scenario('overwrites', ({ assert }) => {",
            '    const value = load();',
            '    const saved = assert.equal;',
            '    assert.equal(value, value);',
            '    if (replace) { assert.equal = ordinary; }',
            '    assert.equal(value, value);',
            '    saved(value, value);',
            '    const { equal } = assert;',
            '    equal(value, value);',
            '});'
        ]), reports(5, 8));
        return scope.assert.collect();
    }),
    test('preserves opaque reads, distinct observations, and unrelated methods', function (scope) {
        scope.assert.deepEqual(lint([
            "scenario('unproven', ({ assert }, value) => {",
            '    const box = { get value() { return load(); } };',
            '    assert.equal(box.value, box.value);',
            '    const proxy = new Proxy({}, handlers);',
            '    assert.equal(proxy.value, proxy.value);',
            '    assert.equal(load(), load());',
            '    const holder = { value };',
            '    mutate(holder);',
            '    assert.equal(holder.value, holder.value);',
            '    const removed = { value };',
            '    delete removed.value;',
            '    assert.equal(removed.value, removed.value);',
            '    const bound = assert.equal.bind(null, other);',
            '    bound(value, value);',
            '    assert.partialDeepEqual(value, value);',
            '    assert.equal(1, 1);',
            '    assert.equal(...operands, value);',
            '    { const assert = application; assert.equal(value, value); }',
            '    let equal = assert.equal; equal = application.equal;',
            '    equal(value, value);',
            '    assert.notEqual = application.equal;',
            '    assert.notEqual(value, value);',
            '});'
        ]), []);
        return scope.assert.collect();
    })
]);
