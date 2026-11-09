import { runIfMain } from '#test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import { runMatrixTypeProject } from '../../test-support/native-type-project.ts';

const sharedBody = `const nodes=[table({title:'rows',cases:[1,2],test:scope=>{
    bodyCalls++;scope.assert(same<typeof scope.parameters,number>());return scope.assert.collect();
}})];`;

const changedAfterChecking = `const nodes=[test('passing',scope=>{
    bodyCalls++;scope.assert(same<string,string>());return scope.assert.collect();
})];
const {EventEmitter}=await import('tstyche/api');
const {appendFileSync}=await import('node:fs');
let changed=false;
new EventEmitter().addHandler({on(event:readonly unknown[]){
    if(!changed&&event[0]==='file:end'){
        changed=true;appendFileSync(import.meta.filename,'\\n');
    }
}});`;

export const testNode = suite('compiler matrix evidence', [
    test('preserves shared table ownership for each compiler', async function (scope) {
        const result = await runMatrixTypeProject(scope, sharedBody);
        scope.assert.equal(result.status, 'passed', { message: result.errors.join('\n') });
        scope.assert.equal(result.summary.passed, 4);
        scope.assert.equal(result.logicalCaseCount, 2);
        const compilers = new Set(result.compilerVersions);
        scope.assert.equal(compilers.size, 2);
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

await runIfMain(import.meta, testNode);
