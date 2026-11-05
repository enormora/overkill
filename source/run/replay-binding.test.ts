import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import { bindRecordedTestPlan } from './replay-binding.ts';

function sourcePlan(titles: readonly string[], observe: (title: string) => void): TestPlan {
    const testNode = suite(
        'retained suite',
        titles.map(function authoredCase(title) {
            return test(title, function (scope) {
                observe(title);
                scope.assert.true(true);
                return scope.assert.collect();
            });
        })
    );
    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file: 'case.test.ts', testNode } ],
        root: { title: 'project', annotations: {}, controls: {} }
    });
}
function ignoreCase(): void {
    return undefined;
}
export const testNode = suite('saved case binding', [
    test('binds current bodies in saved order without admitting extra cases', async function (scope: TestScope) {
        const original = sourcePlan([ 'second', 'first' ], ignoreCase);
        const selected = original.cases[0];
        const saved = collectedRunPlanFromTestPlanCases(original, [ selected ]);
        const observed: string[] = [];
        const current = sourcePlan([ 'extra', 'second', 'first' ], function observe(title) {
            observed.push(title);
        });
        const result = await defaultRunEngine.execute(bindRecordedTestPlan(current, saved));
        scope.assert.deepEqual(observed, [ 'second' ]);
        scope.assert.equal(result.summary.defined, original.defined);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('reports unavailable runtime variants without running a substitute body', async function (scope: TestScope) {
        const original = sourcePlan([ 'variant' ], ignoreCase);
        const first = original.cases[0];
        const runtimeCase = {
            ...first,
            workId: {
                ...first.workId,
                runtimes: [ { name: 'unavailable', dimensions: {}, scenarios: {}, variantId: null } ]
            }
        };
        const saved = collectedRunPlanFromTestPlanCases({
            ...original,
            cases: [ runtimeCase ],
            discoveredCases: [ runtimeCase ]
        }, [ runtimeCase ]);
        const result = await defaultRunEngine.execute(bindRecordedTestPlan(original, saved));
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(JSON.stringify(result), 'Recorded runtime is unavailable');
        return scope.assert.collect();
    }),
    test('rejects missing and ambiguous case identities', function (scope: TestScope) {
        const original = sourcePlan([ 'retained' ], ignoreCase);
        const saved = collectedRunPlanFromTestPlanCases(original, original.cases);
        scope.assert.throws(function missing() {
            bindRecordedTestPlan(sourcePlan([ 'renamed' ], ignoreCase), saved);
        }, { message: /Recorded case is unavailable/u });
        scope.assert.throws(function ambiguous() {
            bindRecordedTestPlan({ ...original, discoveredCases: [ original.cases[0], original.cases[0] ] }, saved);
        }, { message: /Recorded case is ambiguous/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
