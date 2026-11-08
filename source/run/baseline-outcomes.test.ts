import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { baselineCaseEvent, baselineCaseResult, storedBaseline } from '../test-support/baseline-case-fixture.ts';
import {
    baselineFailedCheck,
    baselineRunnerError,
    withBaselineChecks,
    withBaselineVerdicts
} from './baseline-outcomes.ts';

const failed = withBaselineChecks(baselineCaseEvent, [ baselineFailedCheck(baselineCaseEvent, 'changed', {
    actual: 43,
    expected: 42,
    summary: 'Output changed.'
}) ]);
const failedEvents = new Map([ [ workIdentityKey(storedBaseline.work), failed ] ]);
export const testNode = suite('ordinary baseline outcomes', [
    test('attributes errors to explicit work and preserves non-Error causes', function (scope: TestScope) {
        const unattributed = baselineRunnerError('unavailable', null);
        const fallback = baselineRunnerError('unavailable', baselineCaseEvent);
        const explicit = baselineRunnerError(new Error('unavailable'), {
            ...baselineCaseEvent,
            workId: storedBaseline.work
        });
        scope.assert.equal(unattributed.attributedTo, null);
        scope.assert.equal(unattributed.message, 'unavailable');
        scope.assert.deepEqual<unknown, unknown>(fallback.attributedToWork, storedBaseline.work);
        scope.assert.deepEqual<unknown, unknown>(fallback.attributedToAttempt, { index: 0 });
        scope.assert.deepEqual<unknown, unknown>(explicit.attributedToWork, storedBaseline.work);
        scope.assert.equal(explicit.message, 'unavailable');
        return scope.assert.collect();
    }),
    test('updates only the matching retry attempt and its final verdict', function (scope: TestScope) {
        const [ entry ] = baselineCaseResult.perTest;
        scope.require.defined(entry);
        const [ first ] = entry.attempts;
        const retry = { ...first, attempt: { index: 1 } };
        const events = new Map([ [ workIdentityKey(storedBaseline.work), { ...failed, attempt: 1 } ] ]);
        const result = withBaselineVerdicts({
            ...baselineCaseResult,
            perTest: [ { ...entry, attempts: [ first, retry ], retried: { attempts: 2, finalVerdict: 'pass' } } ]
        }, events);
        scope.assert.equal(result.perTest[0]?.attempts[0], first);
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.retried, { attempts: 2, finalVerdict: 'fail' });
        scope.assert.equal(result.perTest[0]?.attempts[1]?.verdict, 'fail');
        return scope.assert.collect();
    }),
    test('preserves case failures and unrelated successful attempts', function (scope: TestScope) {
        const failedResult = {
            ...baselineCaseResult,
            perTest: baselineCaseResult.perTest.map(function (entry) {
                return { ...entry, verdict: 'fail' as const };
            })
        };
        const originalFailure = withBaselineVerdicts(failedResult, failedEvents);
        const unrelated = withBaselineVerdicts(baselineCaseResult, new Map());
        scope.assert.deepEqual(originalFailure.perTest, failedResult.perTest);
        scope.assert.deepEqual(unrelated.perTest, baselineCaseResult.perTest);
        scope.assert.equal(unrelated.status, 'passed');
        return scope.assert.collect();
    })
]);
