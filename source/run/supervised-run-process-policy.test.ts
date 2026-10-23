import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
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

function assertBreach(
    scope: OverkillScope,
    actual: ProcessBudgetBreach | null,
    expected: ProcessBudgetBreach
): void {
    scope.require.defined(actual);
    scope.assert.deepEqual(actual, expected);
}

function activeCaseStates(): readonly [SupervisedRunState, SupervisedRunState, SupervisedRunState] {
    const singleState = createSupervisedRunState('first-failure-and-final');
    const multiState = createSupervisedRunState('first-failure-and-final');

    singleState.addActiveCase('first', { capture: null, id: firstCaseId }, 0, { index: 0 });
    multiState.addActiveCase('first', { capture: null, id: firstCaseId }, 0, { index: 0 });
    multiState.addActiveCase('second', { capture: null, id: secondCaseId }, 0, { index: 0 });

    return [ createSupervisedRunState('first-failure-and-final'), singleState, multiState ];
}

function assertCaseId(scope: OverkillScope, actual: CaseId | null, expected: CaseId): void {
    scope.require.defined(actual);
    scope.assert.deepEqual(actual, expected);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-process-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'findProcessBudgetBreach() selects the first exceeded process budget',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                assertBreach(
                    scope,
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
                assertBreach(
                    scope,
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'process usage policy errors attribute active case boundaries',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
                assertCaseId(scope, processExhaustionError(breach, singleState).attributedTo, firstCaseId);
                assertCaseId(scope, crashError(singleState, 'Crashed.').attributedTo, firstCaseId);
                scope.assert.equal(processExhaustionError(breach, multiState).attributedTo, null);
                scope.assert.deepEqual(crashError(multiState, 'Crashed.').cause, {
                    activeAttempts: [
                        { work: { case: firstCaseId, runtimes: [], workload: null }, attempt: { index: 0 } },
                        { work: { case: secondCaseId, runtimes: [], workload: null }, attempt: { index: 0 } }
                    ],
                    activeCases: [ firstCaseId, secondCaseId ],
                    activeWork: [
                        { case: firstCaseId, runtimes: [], workload: null },
                        { case: secondCaseId, runtimes: [], workload: null }
                    ],
                    reason: 'Crashed.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('#test-runner');

await runTestFileIfMain(import.meta, testNode);
