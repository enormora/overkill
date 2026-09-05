import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { CaseId } from '../engine/identity.ts';
import type { ResourceUsageSnapshot } from '../engine/run-result.ts';
import {
    crashError,
    findResourceBudgetBreach,
    resourceExhaustionError,
    type ResourceBudgetBreach
} from './supervised-run-resource-policy.ts';
import { createSupervisedRunState, type SupervisedRunState } from './supervised-run-state.ts';
import type { RunResourceBudgets } from './run-types.ts';

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
const previousSample: ResourceUsageSnapshot = {
    activeResourceCount: 1,
    activeResourceTypes: [],
    capturedAtMilliseconds: 1000,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 100
};
const sample: ResourceUsageSnapshot = {
    activeResourceCount: 2,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMilliseconds: 2000,
    javaScriptEngineHeapBytes: 200,
    residentSetBytes: 300
};
const noBudgetsExceeded: RunResourceBudgets = {
    activeResourceCount: 2,
    javaScriptEngineHeapBytes: 200,
    residentSetBytes: 300,
    residentSetGrowthBytesPerSecond: 200
};

function noBudgets(): RunResourceBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function assertBreach(
    scope: OverkillScope,
    actual: ResourceBudgetBreach | null,
    expected: ResourceBudgetBreach
): void {
    scope.require.defined(actual);
    scope.assert.deepEqual(actual, expected);
}

function activeCaseStates(): readonly [SupervisedRunState, SupervisedRunState, SupervisedRunState] {
    const singleState = createSupervisedRunState();
    const multiState = createSupervisedRunState();

    singleState.addActiveCase('first', { id: firstCaseId });
    multiState.addActiveCase('first', { id: firstCaseId });
    multiState.addActiveCase('second', { id: secondCaseId });

    return [ createSupervisedRunState(), singleState, multiState ];
}

function assertCaseId(scope: OverkillScope, actual: CaseId | null, expected: CaseId): void {
    scope.require.defined(actual);
    scope.assert.deepEqual(actual, expected);
}

export const testSuite = createOverkillSuite({
    title: 'source/run/supervised-run-resource-policy.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'findResourceBudgetBreach() selects the first exceeded resource budget',
            metadata: {},
            body(scope: OverkillScope) {
                assertBreach(
                    scope,
                    findResourceBudgetBreach(
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
                assertBreach(
                    scope,
                    findResourceBudgetBreach(
                        {
                            ...noBudgets(),
                            residentSetGrowthBytesPerSecond: 150
                        },
                        sample,
                        previousSample
                    ),
                    { budget: 150, metric: 'residentSetGrowthBytesPerSecond', observed: 200, sample }
                );
                scope.assert.equal(findResourceBudgetBreach(noBudgetsExceeded, sample, previousSample), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'resource policy errors attribute active case boundaries',
            metadata: {},
            body(scope: OverkillScope) {
                const [ emptyState, singleState, multiState ] = activeCaseStates();
                const breach = {
                    budget: 1,
                    metric: 'activeResourceCount' as const,
                    observed: 2,
                    sample
                };

                scope.assert.deepEqual(resourceExhaustionError(breach, emptyState), {
                    attributedTo: null,
                    cause: {
                        ...breach,
                        activeCases: [],
                        enforcement: 'post-test-diagnostic'
                    },
                    message: 'Resource budget exceeded: activeResourceCount observed 2, budget 1.',
                    subtype: 'resource-exhaustion'
                });
                assertCaseId(scope, resourceExhaustionError(breach, singleState).attributedTo, firstCaseId);
                assertCaseId(scope, crashError(singleState, 'Crashed.').attributedTo, firstCaseId);
                scope.assert.equal(resourceExhaustionError(breach, multiState).attributedTo, null);
                scope.assert.deepEqual(crashError(multiState, 'Crashed.').cause, {
                    activeCases: [ firstCaseId, secondCaseId ],
                    reason: 'Crashed.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
