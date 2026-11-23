import { suite, test } from '@overkill-dev/test';

import {
    createRunResult,
    singleAttemptResult,
    type RunResult,
    type TestPlan
} from '../../../../packages/engine/engine.entry-point.ts';
import { executeCompilerMatrix } from '../../../../packages/type-test/compiler-plan.ts';
import { nativeCheckResult } from '../../../../packages/type-test/native-results.ts';
import { observationPlan } from '../../../../test-support/observation-lifetime.ts';
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

function matrixPlan(): TestPlan {
    const original = observationPlan();
    const first = original.cases[0];
    const failed = { ...first, workId: { ...first.workId, familyVariant: { family: 'types', key: 'failed' } } };
    const passed = { ...first, workId: { ...first.workId, familyVariant: { family: 'types', key: 'passed' } } };
    return { ...original, cases: [ passed, failed ], discoveredCases: [ passed, failed ] };
}

function compilerResults(plan: TestPlan): readonly [RunResult, RunResult] {
    const [ passed, failed ] = plan.cases;
    if (failed === undefined) {
        throw new Error('Expected a compiler matrix fixture with two work items.');
    }
    const failedRun = nativeCheckResult({
        plan: { ...plan, cases: [ failed ] },
        assertionPlan: { modules: [], sites: [], issues: [] },
        checked: null,
        error: new Error('Compiler project failed'),
        started: performance.now()
    });
    const passingCase = singleAttemptResult({
        id: passed.id,
        workId: passed.workId,
        definitionLocations: passed.definitionLocations,
        outcome: { kind: 'pass' },
        verdict: 'pass',
        durationMicroseconds: 0
    }, { index: 0 });
    const passedRun = createRunResult({ ...plan, cases: [ passed ] }, [ passingCase ], [], {
        startedAtMicroseconds: 0,
        completedAtMicroseconds: 0,
        testExecutionWallTimeMicroseconds: 0,
        processUsage: null,
        planStatus: 'planned'
    });
    return [ failedRun, passedRun ];
}

async function verifyInputs(): Promise<void> {
    return undefined;
}

export const testNode = suite('compiler matrix evidence', [
    test('delivers validated evidence from a compiler whose project succeeded', async function (scope) {
        const plan = matrixPlan();
        const [ failedRun, passedRun ] = compilerResults(plan);
        const execution = await executeCompilerMatrix({
            plan,
            groups: [
                {
                    facts: null,
                    verify: verifyInputs,
                    async check() {
                        return { result: failedRun, facts: null };
                    }
                },
                {
                    facts: null,
                    verify: verifyInputs,
                    async check() {
                        return { result: passedRun, facts: { evidence: 'checked' } };
                    }
                }
            ],
            verifyInputs,
            planning: { version: 3 },
            signal: scope.signal
        });
        scope.assert.deepEqual(
            execution.result.perTest.map(function (result) {
                return result.verdict;
            }),
            [ 'pass', 'inconclusive' ]
        );
        scope.assert.deepEqual(
            execution.result.perTest.map(function identity(result) {
                return result.workId;
            }),
            plan.cases.map(function plannedWork(testCase) {
                return testCase.workId;
            })
        );
        scope.assert.deepEqual(
            execution.result.perTest.map(function outcome(result) {
                return result.outcome?.kind;
            }),
            [ 'pass', 'inconclusive' ]
        );
        scope.assert.equal(execution.result.runnerErrors[0]?.message, 'Compiler project failed');
        scope.assert.deepEqual<unknown, unknown>(execution.facts, {
            version: 3,
            compilers: [ null, { evidence: 'checked' } ]
        });
        return scope.assert.collect();
    }),
    test('preserves shared table ownership for each compiler', async function (scope) {
        const result = await runMatrixTypeProject(scope.cleanup, sharedBody);
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
        const result = await runMatrixTypeProject(scope.cleanup, changedAfterChecking);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.deepEqual(result.completions, [ { title: 'passing', verdict: 'inconclusive' } ]);
        scope.assert.equal(result.checkerFacts?.compilers[0]?.evidence, undefined);
        scope.assert.includes(result.errors.join('\n'), 'changed after collection');
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    })
]);
