import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { OrdinaryBaselineAdapter, OrdinaryBaselineEvaluation } from '../baselines/ordinary-baseline-adapter.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import { baselineCaseEvent, storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { evaluateBaselineAdapter } from './baseline-evaluation.ts';
import { ordinaryBaselineIdentity } from './baseline-record.ts';

function adapter(evaluation: OrdinaryBaselineEvaluation): OrdinaryBaselineAdapter {
    return {
        id: 'output',
        subtype: 'content-snapshot',
        comparisonContext: {},
        async evaluate() {
            return evaluation;
        }
    };
}
const existing = new Map([ [ baselineIdentityKey(ordinaryBaselineIdentity(storedBaseline)), storedBaseline ] ]);
export const testNode = suite('ordinary baseline evaluation', [
    test('ignores explicitly inapplicable observations', async function (scope: TestScope) {
        const result = await evaluateBaselineAdapter({
            adapter: adapter({ kind: 'not-applicable' }),
            event: baselineCaseEvent,
            profile: 'unit',
            mode: 'none',
            existing
        });
        scope.assert.deepEqual(result, { kind: 'not-applicable' });
        return scope.assert.collect();
    }),
    test('rejects mismatches without diagnostic evidence', async function (scope: TestScope) {
        const malformed = {
            kind: 'mismatch' as const,
            diagnostics: [ { actual: 43, expected: 42, summary: 'Changed.' } ] as const
        };
        Reflect.set(malformed, 'diagnostics', []);
        await scope.assert.rejects(async function () {
            return await evaluateBaselineAdapter({
                adapter: adapter({
                    kind: 'observed',
                    comparison: malformed,
                    proposal: null
                }),
                event: baselineCaseEvent,
                profile: 'unit',
                mode: 'none',
                existing
            });
        }, { message: 'Baseline mismatch requires diagnostics.' });
        return scope.assert.collect();
    }),
    test('preserves missing observation reasons', async function (scope: TestScope) {
        await scope.assert.rejects(async function () {
            return await evaluateBaselineAdapter({
                adapter: adapter({ kind: 'missing', reason: 'Output is unavailable.' }),
                event: baselineCaseEvent,
                profile: 'unit',
                mode: 'update',
                existing
            });
        }, { message: 'Output is unavailable.' });
        return scope.assert.collect();
    }),
    test('uses explicit workload identity when looking up expectations', async function (scope: TestScope) {
        const work = { ...storedBaseline.work, workload: { name: 'large', params: {} } };
        const result = await evaluateBaselineAdapter({
            adapter: adapter({ kind: 'observed', comparison: null, proposal: null }),
            event: { ...baselineCaseEvent, workId: work },
            profile: 'unit',
            mode: 'none',
            existing
        });
        scope.assert.equal(result.kind, 'evaluated');
        if (result.kind === 'evaluated') {
            scope.assert.deepEqual(result.identity.work, work);
            scope.assert.equal(result.checks.length, 1);
            scope.assert.equal(result.change, null);
        }
        return scope.assert.collect();
    })
]);
