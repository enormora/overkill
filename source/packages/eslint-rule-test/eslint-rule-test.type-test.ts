import { expect, test } from 'tstyche';
import type { Rule } from 'eslint';
import type { Suite } from '../engine/engine.entry-point.ts';
import { defineRuleTests, type ConfigSelection } from './eslint-rule-test.entry-point.ts';

const rule: Rule.RuleModule = {
    create() {
        return {};
    }
};

test('returns ordinary suite builders for shared configurations', function () {
    const definition = defineRuleTests({
        name: 'rule',
        rule,
        configs: { js: {}, ts: {} },
        valid: [ 'value', { code: 'value', configs: [ 'ts' ] } ],
        invalid: []
    });
    expect(definition.examples()).type.toBe<Suite>();
    expect(definition.properties()).type.toBe<Suite>();
});

test('restricts configuration selections to declared names', function () {
    expect([ 'js' ] as const).type.toBeAssignableTo<ConfigSelection<'js' | 'ts'>>();
    expect([ 'missing' ] as const).type.not.toBeAssignableTo<ConfigSelection<'js' | 'ts'>>();
    expect([] as const).type.not.toBeAssignableTo<ConfigSelection<'js' | 'ts'>>();
    expect(defineRuleTests<'js'>).type.not.toBeCallableWith({
        name: 'rule',
        rule,
        configs: { js: {} },
        valid: [ { code: 'value', configs: [ 'missing' ] } ],
        invalid: []
    });
});
