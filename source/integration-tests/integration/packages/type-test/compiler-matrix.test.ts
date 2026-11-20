import { type TestNode, suite, test } from '@overkill-dev/test';

import { runMatrixTypeProject } from '../../../../test-support/native-type-project.ts';

const sharedBody = `const nodes=[table({title:'rows',cases:[1,2],test:scope=>{
    bodyCalls++;scope.assert(same<typeof scope.parameters,number>());return scope.assert.collect();
}})];`;

const changedAfterChecking = `const nodes=[test('passing',scope=>{
    bodyCalls++;scope.assert(same<string,string>());return scope.assert.collect();
})];
const {Program}=await import('typescript-beta/async');
const {appendFileSync}=await import('node:fs');
const semanticDiagnostics=Program.prototype.getSemanticDiagnostics;
let changed=false;
Program.prototype.getSemanticDiagnostics=async function readDiagnostics(
    this:import('typescript-beta/async').Program,
    ...args:Parameters<typeof semanticDiagnostics>
){
    const diagnostics=await semanticDiagnostics.apply(this,args);
    if(!changed){
        changed=true;appendFileSync(import.meta.filename,'\\n');
    }
    return diagnostics;
};`;

export const testNode: TestNode = suite('compiler matrix evidence', [
    test('preserves shared table ownership for each compiler', async function (scope) {
        const result = await runMatrixTypeProject(scope, sharedBody);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.passed, 2);
        scope.assert.equal(result.logicalCaseCount, 2);
        scope.assert.deepEqual(result.compilerVersions, [ '7.1.0-beta', '7.1.0-beta' ]);
        const compilers = new Set(result.compilerVersions);
        scope.assert.equal(compilers.size, 1);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('discards matrix evidence when inputs change during checking', async function (scope) {
        const result = await runMatrixTypeProject(scope, changedAfterChecking);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.includes(result.errors.join('\n'), 'changed after collection');
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    })
]);
