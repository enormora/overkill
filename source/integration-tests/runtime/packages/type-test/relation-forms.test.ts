import { suite, test } from '@overkill-dev/test';

import { runNativeProject } from '../../../../test-support/native-type-project.ts';

type RelationExample = {
    readonly reference: string;
    readonly actualType: string;
    readonly expectedType: string;
    readonly actual: string;
    readonly expected: string;
};
const examples: readonly RelationExample[] = [
    {
        reference: 'same',
        actualType: "'literal'",
        expectedType: "'literal'",
        actual: 'literal()',
        expected: 'literal()'
    },
    {
        reference: 'same.not',
        actualType: "'literal'",
        expectedType: 'string',
        actual: 'literal()',
        expected: 'general()'
    },
    {
        reference: 'assignableTo',
        actualType: "'literal'",
        expectedType: 'string',
        actual: 'literal()',
        expected: 'general()'
    },
    {
        reference: 'assignableTo.not',
        actualType: 'string',
        expectedType: "'literal'",
        actual: 'general()',
        expected: 'literal()'
    },
    {
        reference: 'assignableFrom',
        actualType: 'string',
        expectedType: "'literal'",
        actual: 'general()',
        expected: 'literal()'
    },
    {
        reference: 'assignableFrom.not',
        actualType: "'literal'",
        expectedType: 'string',
        actual: 'literal()',
        expected: 'general()'
    }
];
function relationCases(example: RelationExample): readonly string[] {
    const { reference, actualType, expectedType, actual, expected } = example;
    const statements = {
        typed: `scope.assert(${reference}<${actualType},${expectedType}>());`,
        withActual: `scope.assert(${reference}.withActual<${expectedType}>(),${actual});`,
        withExpected: `scope.assert(${reference}.withExpected<${actualType}>(),${expected});`,
        expressions: `scope.assert(${reference}.expressions,${actual},${expected});`
    };
    return Object.entries(statements).map(function authoredCase([ form, statement ]) {
        const title = JSON.stringify(`${reference} ${form}`);
        return `test(${title},scope=>{
            bodyCalls++;${statement}return scope.assert.collect();
        })`;
    });
}
export const testNode = suite('public relation forms', [
    test('checks every form and negation without executing operands', async function (scope) {
        const definitions = `function literal():'literal'{bodyCalls++;throw new Error('executed operand');}
        function general():string{bodyCalls++;throw new Error('executed operand');}
        const nodes=[${examples.flatMap(relationCases).join(',')}];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.status, 'passed', {
            message: [ ...result.errors, ...result.diagnostics ].join('\n')
        });
        scope.assert.equal(result.summary.passed, 24);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    })
]);
