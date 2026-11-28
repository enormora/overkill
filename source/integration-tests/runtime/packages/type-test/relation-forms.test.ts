import { suite, test } from '@overkill-dev/test';

import { runNativeProject } from '../../../../test-support/native-type-project.ts';

export const testNode = suite('public type comparisons', [
    test('checks equality, assignability, and keys without executing callback fixtures', async function (scope) {
        const definitions = `function literal(): 'literal' { bodyCalls++; throw new Error('executed operand'); }
const nodes=[test('comparisons',scope=>{
    bodyCalls++;
    const value = literal();
    scope.assert(types.equal<typeof value, 'literal'>());
    scope.assert(types.notEqual<typeof value, string>());
    scope.assert(types.assignableTo<typeof value, string>());
    scope.assert(types.notAssignableTo<string, typeof value>());
    scope.assert(types.hasKey<{ value?: string }, 'value'>());
    scope.assert(types.lacksKey<{ value?: string }, 'load'>());
    return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.deepEqual(result.errors, []);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.checkerFacts?.compilers[0]?.evidence?.length, 6);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    })
]);
