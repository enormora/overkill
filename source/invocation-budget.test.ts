import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import { suite, test, type TestScope } from './packages/test/test.entry-point.ts';
import {
    createInvocationBudget,
    InvocationDeadlineExceededError,
    isInvocationCancellation,
    type InvocationBudget
} from './invocation-budget.ts';

type BudgetFixture = {
    readonly clock: DeterministicClock;
    readonly budget: InvocationBudget;
};
function budgetFixture(scope: TestScope, signal: Readonly<AbortSignal> | null): BudgetFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const budget = createInvocationBudget(10, signal, clock);
    scope.cleanup(budget.dispose);
    return { clock, budget };
}

export const testNode = suite('invocation budgets', [
    test('uses elapsed monotonic time despite Unix clock changes', function (scope) {
        const { clock, budget } = budgetFixture(scope, null);
        clock.setCurrentUnixEpochMicroseconds(9_000_000_000n);
        clock.advanceByMilliseconds(4);
        scope.assert.equal(budget.remainingMilliseconds(), 6);
        clock.setCurrentUnixEpochMicroseconds(0n);
        clock.advanceByMilliseconds(6);
        scope.assert.true(budget.expired());
        scope.assert.true(budget.signal.reason instanceof InvocationDeadlineExceededError);
        return scope.assert.collect();
    }),
    test('retains caller cancellation and clears its own timer on disposal', function (scope) {
        const controller = new AbortController();
        const { clock, budget } = budgetFixture(scope, controller.signal);
        const reason = new Error('caller sentinel');
        controller.abort(reason);
        scope.assert.true(isInvocationCancellation(reason, budget.signal));
        scope.assert.false(isInvocationCancellation(new Error('independent sentinel'), budget.signal));
        budget.dispose();
        clock.advanceByMilliseconds(20);
        scope.assert.equal(budget.signal.reason, reason);
        return scope.assert.collect();
    }),
    test('preserves independent failures aggregated with deadline cancellation', function (scope) {
        const { clock, budget } = budgetFixture(scope, null);
        clock.advanceByMilliseconds(10);
        const reason: unknown = budget.signal.reason;
        scope.assert.false(isInvocationCancellation(
            new AggregateError([ reason, new Error('cleanup sentinel') ], 'combined failure', { cause: reason }),
            budget.signal
        ));
        scope.assert.false(isInvocationCancellation(new Error('cleanup sentinel', { cause: reason }), budget.signal));
        return scope.assert.collect();
    }),
    test('stops its timer when a successful invocation releases the budget', function (scope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const budget = createInvocationBudget(10, null, clock);
        budget.dispose();
        clock.advanceByMilliseconds(20);
        scope.assert.false(budget.signal.aborted);
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);
