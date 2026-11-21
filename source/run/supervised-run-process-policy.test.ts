import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import type { CaseId } from '../engine/identity.ts';
import type { ProcessUsageSnapshot } from '../engine/process-usage.ts';
import type { ProcessBudgets } from '../config/types.ts';
import {
    crashError,
    findProcessBudgetBreach,
    processExhaustionError,
    type ProcessBudgetBreach
} from './supervised-run-process-policy.ts';
import { createSupervisedRunState, type SupervisedRunState } from './supervised-run-state.ts';

const firstCaseId: CaseId = {
    file: 'source/example.test.ts',
    title: 'first',
    params: null,
    suite: []
};
const secondCaseId: CaseId = {
    file: 'source/example.test.ts',
    title: 'second',
    params: null,
    suite: []
};
const previousSample: ProcessUsageSnapshot = {
    activeResourceCount: 1,
    activeResourceTypes: [],
    capturedAtMicroseconds: 1_000_000,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 100
};
const sample: ProcessUsageSnapshot = {
    activeResourceCount: 2,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMicroseconds: 2_000_000,
    javaScriptEngineHeapBytes: 200,
    residentSetBytes: 300
};
const noBudgetsExceeded: ProcessBudgets = {
    activeResourceCount: 2,
    javaScriptEngineHeapBytes: 200,
    residentSetBytes: 300,
    residentSetGrowthBytesPerSecond: 200
};

function noBudgets(): ProcessBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

const assertBreach = defineCompositeAssertion({
    name: 'breach',
    assert(check, actual: ProcessBudgetBreach | null, expected: ProcessBudgetBreach) {
        if (actual === undefined || actual === null) {
            return check.defined(actual);
        }
        return check.group([ check.deepEqual(actual, expected) ]);
    }
});

function activeCaseStates(): readonly [SupervisedRunState, SupervisedRunState, SupervisedRunState] {
    const singleState = createSupervisedRunState('first-failure-and-final');
    const multiState = createSupervisedRunState('first-failure-and-final');

    singleState.addActiveCase(
        'first',
        {
            capture: null,
            id: firstCaseId,
            workId: { familyVariant: null, case: firstCaseId, runtimes: [], workload: null }
        },
        0,
        { index: 0 }
    );
    multiState.addActiveCase(
        'first',
        {
            capture: null,
            id: firstCaseId,
            workId: { familyVariant: null, case: firstCaseId, runtimes: [], workload: null }
        },
        0,
        { index: 0 }
    );
    multiState.addActiveCase(
        'second',
        {
            capture: null,
            id: secondCaseId,
            workId: { familyVariant: null, case: secondCaseId, runtimes: [], workload: null }
        },
        0,
        { index: 0 }
    );

    return [ createSupervisedRunState('first-failure-and-final'), singleState, multiState ];
}

const assertCaseId = defineCompositeAssertion({
    name: 'case id',
    assert(check, actual: CaseId | null, expected: CaseId) {
        if (actual === undefined || actual === null) {
            return check.defined(actual);
        }
        return check.group([ check.deepEqual(actual, expected) ]);
    }
});

export const testNode = suite('Supervised run process policy', [
    test('findProcessBudgetBreach() selects the first exceeded process budget', function (scope) {
        scope.assert(
            assertBreach,
            findProcessBudgetBreach(
                {
                    ...noBudgets(),
                    activeResourceCount: 1,
                    residentSetBytes: 1
                },
                sample,
                previousSample
            ),
            { budget: 1, metric: 'activeResourceCount', observed: 2, sample }
        );
        scope.assert(
            assertBreach,
            findProcessBudgetBreach(
                {
                    ...noBudgets(),
                    residentSetGrowthBytesPerSecond: 150
                },
                sample,
                previousSample
            ),
            { budget: 150, metric: 'residentSetGrowthBytesPerSecond', observed: 200, sample }
        );
        scope.assert.equal(findProcessBudgetBreach(noBudgetsExceeded, sample, previousSample), null);

        return scope.assert.collect();
    }),
    test('process usage policy errors attribute active case boundaries', function (scope) {
        const [ emptyState, singleState, multiState ] = activeCaseStates();
        const breach = {
            budget: 1,
            metric: 'activeResourceCount' as const,
            observed: 2,
            sample
        };

        scope.assert.deepEqual(processExhaustionError(breach, emptyState), {
            attributedToAttempt: null,
            attributedTo: null,
            attributedToWork: null,
            cause: {
                ...breach,
                activeCases: [],
                activeAttempts: [],
                activeWork: [],
                enforcement: 'post-test-diagnostic'
            },
            diagnostics: [
                { label: 'metric', value: 'activeResourceCount' },
                { label: 'observed', value: '2' },
                { label: 'budget', value: '1' }
            ],
            message: 'Process budget exceeded: activeResourceCount observed 2, budget 1.',
            subtype: 'process-exhaustion'
        });
        scope.assert(assertCaseId, processExhaustionError(breach, singleState).attributedTo, firstCaseId);
        scope.assert(assertCaseId, crashError(singleState, 'Crashed.').attributedTo, firstCaseId);
        scope.assert.equal(processExhaustionError(breach, multiState).attributedTo, null);
        const activeWork = Array.from(multiState.activeCases.values(), function work(testCase) {
            return testCase.workId;
        });
        scope.assert.deepEqual(crashError(multiState, 'Crashed.').cause, {
            activeAttempts: [
                {
                    work: activeWork[0],
                    attempt: { index: 0 }
                },
                {
                    work: activeWork[1],
                    attempt: { index: 0 }
                }
            ],
            activeCases: [ firstCaseId, secondCaseId ],
            activeWork,
            reason: 'Crashed.'
        });

        return scope.assert.collect();
    })
]);
