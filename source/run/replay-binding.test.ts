import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
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
type InvalidBinding = {
    readonly title: string;
    readonly change: (current: TestPlanCase) => TestPlanCase;
    readonly message: RegExp;
};
const replacementRuntime = { name: 'replacement', dimensions: {}, scenarios: {}, variantId: null };
function invalidBindings(): readonly InvalidBinding[] {
    return [
        {
            title: 'rejects an executable case replaced by a skip',
            change(current) {
                return { ...current, execution: { kind: 'skip', reason: 'changed' } };
            },
            message: /no longer has a body/u
        },
        {
            title: 'rejects a changed case family',
            change(current) {
                return { ...current, testFamily: 'integration' };
            },
            message: /case family changed/u
        },
        {
            title: 'rejects changed resource descriptors',
            change(current) {
                return {
                    ...current,
                    resourceAttachments: {
                        ...current.resourceAttachments,
                        directResources: [ { key: 'replacement', resourceName: 'replacement' } ]
                    }
                };
            },
            message: /descriptors changed/u
        },
        {
            title: 'rejects replacing work without runtime variants',
            change(current) {
                return { ...current, workId: { ...current.workId, runtimes: [ replacementRuntime ] } };
            },
            message: /workload variant is unavailable/u
        },
        {
            title: 'rejects replacing the selected workload',
            change(current) {
                return { ...current, workId: { ...current.workId, workload: { name: 'replacement', params: {} } } };
            },
            message: /workload variant is unavailable/u
        },
        {
            title: 'rejects a changed family for an unavailable variant',
            change(current) {
                return {
                    ...current,
                    testFamily: 'integration',
                    workId: { ...current.workId, runtimes: [ replacementRuntime ] }
                };
            },
            message: /case family changed/u
        }
    ];
}
export const testNode = suite('saved case binding', [
    ...invalidBindings().map(function incompatibleCase(entry) {
        return test(entry.title, function (scope: TestScope) {
            const original = sourcePlan([ 'retained' ], ignoreCase);
            const saved = collectedRunPlanFromTestPlanCases(original, original.cases);
            const current: TestPlan = { ...original, discoveredCases: [ entry.change(original.cases[0]) ] };
            scope.assert.throws(function rejectChangedCase() {
                bindRecordedTestPlan(current, saved);
            }, { message: entry.message });
            return scope.assert.collect();
        });
    }),
    test('restores a saved skip without invoking the current body', async function (scope: TestScope) {
        const original = sourcePlan([ 'retained' ], ignoreCase);
        const saved = collectedRunPlanFromTestPlanCases(original, [ {
            ...original.cases[0],
            execution: { kind: 'skip', reason: 'saved skip' }
        } ]);
        const observed: string[] = [];
        const current = sourcePlan([ 'retained' ], function observedBody(title) {
            observed.push(title);
        });
        const result = await defaultRunEngine.execute(bindRecordedTestPlan(current, saved));
        scope.assert.deepEqual(observed, []);
        scope.assert.equal(result.summary.skipped, 1);
        scope.assert.includes(JSON.stringify(result), 'saved skip');
        return scope.assert.collect();
    }),
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
