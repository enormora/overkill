import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { AttemptId, RunnerError, TestPlanCase, WorkId } from '../packages/engine/engine.entry-point.ts';
import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { snapshotWire } from '../test-support/snapshot-fixture.ts';
import { createResourceLifecycleRuntimePolicy } from './resource-lifecycle.ts';
import { snapshotRuntimePolicy } from './snapshot-runtime.ts';
import { markSnapshotExecutionError, isSnapshotExecutionError } from './snapshot-error.ts';
import { currentSnapshotRun } from './execution-session-context.ts';

type PolicyFixture = { readonly testCase: TestPlanCase; readonly policy: TestRuntimePolicy; };
type ExpectedSnapshotError = { readonly work: WorkId; readonly attempt: AttemptId; readonly cause: Error; };

function createPolicyFixture(scope: TestScope): PolicyFixture {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        title: 'snapshot runtime',
        annotations: {},
        controls: {},
        children: [ engine.createTestCase({
            title: 'case',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(caseScope) {
                return caseScope.assert.collect();
            }
        }) ]
    }));
    const testCase = plan.cases[0];
    const policy = snapshotRuntimePolicy(createResourceLifecycleRuntimePolicy(plan.cases, null), snapshotWire);
    scope.require.defined(testCase);
    scope.require.notNull(policy);
    return { testCase, policy };
}

function assertSnapshotError(
    scope: TestScope,
    errors: readonly RunnerError[],
    expected: ExpectedSnapshotError
): void {
    const { work, attempt, cause } = expected;
    scope.assert.equal(errors.length, 1);
    const [ error ] = errors;
    scope.require.defined(error);
    scope.assert.equal(error.cause, cause);
    scope.assert.equal(error.subtype, 'artifact');
    scope.assert.deepEqual({ work: error.attributedToWork, attempt: error.attributedToAttempt }, { work, attempt });
}

export const testNode = suite('snapshot runtime error ownership', [
    test('attributes infrastructure errors to attempts and drains each once', async function (scope: TestScope) {
        const { testCase, policy } = createPolicyFixture(scope);
        const cause = new TypeError('invalid snapshot');
        for (const index of [ 0, 1 ]) {
            await scope.assert.rejects(async function failedAttempt() {
                await policy.runAttempt(testCase, { index }, async function captureFailure() {
                    throw markSnapshotExecutionError(cause);
                });
            }, { message: 'invalid snapshot' });
        }
        scope.assert.deepEqual(policy.takeAttemptErrors(testCase, { index: 2 }), []);
        assertSnapshotError(
            scope,
            policy.takeAttemptErrors(testCase, { index: 0 }),
            { work: testCase.workId, attempt: { index: 0 }, cause }
        );
        scope.assert.deepEqual(policy.takeAttemptErrors(testCase, { index: 0 }), []);
        assertSnapshotError(scope, policy.takeRunErrors(), { work: testCase.workId, attempt: { index: 1 }, cause });
        scope.assert.deepEqual(policy.takeRunErrors(), []);
        return scope.assert.collect();
    }),
    test('restores context and preserves ordinary body failures', async function (scope: TestScope) {
        const { testCase, policy } = createPolicyFixture(scope);
        const completed = await policy.runAttempt(testCase, { index: 0 }, async function inspectContext() {
            scope.assert.deepEqual({ active: currentSnapshotRun() }, { active: snapshotWire });
            return 'completed';
        });
        scope.assert.equal(completed, 'completed');
        scope.assert.equal(currentSnapshotRun(), null);
        await scope.assert.rejects(async function ordinaryFailure() {
            await policy.runAttempt(testCase, { index: 1 }, async function failedBody() {
                throw new RangeError('body failed');
            });
        }, { message: 'body failed' });
        scope.assert.deepEqual(policy.takeAttemptErrors(testCase, { index: 1 }), []);
        scope.assert.deepEqual(policy.takeRunErrors(), []);
        return scope.assert.collect();
    }),
    test('preserves disabled policies and non-error causes', function (scope: TestScope) {
        const fixture = createPolicyFixture(scope);
        scope.assert.equal(snapshotRuntimePolicy(null, snapshotWire), null);
        scope.assert.equal(snapshotRuntimePolicy(fixture.policy, null), fixture.policy);
        const error = markSnapshotExecutionError('invalid');
        scope.assert.equal(error.message, 'invalid');
        scope.assert.equal(error.cause, 'invalid');
        scope.assert.true(isSnapshotExecutionError(error));
        scope.assert.false(isSnapshotExecutionError('invalid'));
        return scope.assert.collect();
    })
]);
