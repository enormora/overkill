import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test } from '@overkill-dev/test';

import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';

import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import {
    createExecutionSupervision,
    executeCaseBody,
    type ExecuteTimeoutPolicy,
    type ExecutionSupervision,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import { createDisabledExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';
import type { Engine } from './engine.ts';
import type { RunnerError, TestFailure } from './run-result.ts';

type TestCaseBody = Parameters<Engine['createTestCase']>[0]['body'];
type TestPlanCase = ReturnType<Engine['createTestPlan']>['cases'][number];
type FailedOutcome = {
    readonly failures: readonly TestFailure[];
    readonly kind: 'fail';
};
type TimeoutFailure = Extract<TestFailure, { readonly kind: 'timeout'; }>;

const softTimeoutPolicy = {
    hardTimeoutMilliseconds: 100,
    timeoutMilliseconds: 10
};

function executionDependencies(
    wallClock: DeterministicClock
): ExecutionSupervisionDependencies {
    return {
        benchmarkEnvironment: null,
        globalErrorObserver: createDisabledExecutionGlobalErrorObserver(),
        wallClock
    };
}

function createPlannedCase(title: string, body: TestCaseBody): TestPlanCase {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body,
                    annotations: {},
                    controls: {},
                    title
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        })
    );
    const [ testCase ] = testPlan.cases;

    return testCase;
}

function failedOutcomeFrom(executedCase: Awaited<ReturnType<typeof executeCaseBody>>): FailedOutcome {
    const { outcome } = executedCase.result;

    if (outcome?.kind !== 'fail') {
        throw new Error('Expected a failed outcome.');
    }

    return outcome;
}

function timeoutFailureFrom(outcome: FailedOutcome): TimeoutFailure {
    const timeout = outcome.failures.find(function isTimeout(failure): failure is TimeoutFailure {
        return failure.kind === 'timeout';
    });

    if (timeout === undefined) {
        throw new Error('Expected a timeout failure.');
    }

    return timeout;
}

async function executeTimedCase(
    testCase: TestPlanCase,
    wallClock: DeterministicClock,
    supervision = createExecutionSupervision()
): ReturnType<typeof executeCaseBody> {
    return executeCaseBody({
        seed: 0n,
        propertyRun: { seed: 0n, projectRoot: null },
        async onPropertyUpdate() {
            return undefined;
        },
        async onBenchmarkUpdate() {
            return undefined;
        },
        testCase,
        timeoutPolicy: softTimeoutPolicy,
        supervision,
        dependencies: executionDependencies(wallClock),
        attempt: { index: 0 }
    });
}

async function finishSoftTimedCase(
    execution: ReturnType<typeof executeCaseBody>,
    wallClock: DeterministicClock,
    bodyGate: PromiseWithResolvers<undefined>
): Promise<FailedOutcome> {
    wallClock.advanceByMilliseconds(softTimeoutPolicy.timeoutMilliseconds);
    bodyGate.resolve(undefined);

    return failedOutcomeFrom(await execution);
}

async function executeHardTimedCase(
    wallClock: DeterministicClock,
    supervision: ExecutionSupervision,
    timeoutPolicy: ExecuteTimeoutPolicy,
    bodyGate: Promise<void>
): ReturnType<typeof executeCaseBody> {
    const testCase = createPlannedCase('hard timeout', async function hardTimeoutBody(testScope) {
        await bodyGate;

        return testScope.assert.collect();
    });

    return executeCaseBody({
        seed: 0n,
        propertyRun: { seed: 0n, projectRoot: null },
        async onPropertyUpdate() {
            return undefined;
        },
        async onBenchmarkUpdate() {
            return undefined;
        },
        testCase,
        timeoutPolicy,
        supervision,
        dependencies: executionDependencies(wallClock),
        attempt: { index: 0 }
    });
}

const assertHardTimeoutResult = defineCompositeAssertion({
    name: 'hard timeout result',
    assert(check, executedCase: Awaited<ReturnType<typeof executeCaseBody>>, error: RunnerError | undefined) {
        if (error === undefined || error === null) {
            return check.defined(error);
        }
        if (error.attributedTo === undefined || error.attributedTo === null) {
            return check.defined(error.attributedTo);
        }
        return check.group([
            check.equal(executedCase.result.verdict, 'crashed'),
            check.equal(error.subtype, 'crash'),
            check.equal(error.attributedTo.title, 'hard timeout')
        ]);
    }
});

export const testNode = suite('Case timeout supervision', [
    table({
        title: 'retains hard timeout after the soft limit',
        cases: [ { hardTimeoutMilliseconds: 10, timeoutMilliseconds: 100 }, softTimeoutPolicy ],
        caseTitle(timeoutPolicy) {
            return String(timeoutPolicy.timeoutMilliseconds);
        },
        async test(scope) {
            const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
            const supervision = createExecutionSupervision();
            const bodyGate = Promise.withResolvers<undefined>();
            scope.cleanup(function releaseTimedOutBody() {
                bodyGate.resolve(undefined);
            });
            const execution = executeHardTimedCase(wallClock, supervision, scope.parameters, bodyGate.promise);

            wallClock.advanceByMilliseconds(scope.parameters.hardTimeoutMilliseconds);
            const executedCase = await execution;
            const [ error ] = supervision.runnerErrors;

            scope.assert(assertHardTimeoutResult, executedCase, error);

            return scope.assert.collect();
        }
    }),
    test('appends a soft timeout failure to body failures', async function (scope) {
        const bodyGate = Promise.withResolvers<undefined>();
        const testCase = createPlannedCase(
            'soft timeout and failure',
            async function softTimeoutBody(testScope) {
                await bodyGate.promise;
                testScope.assert.equal(1, 2);

                return testScope.assert.collect();
            }
        );
        const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const failedOutcome = await finishSoftTimedCase(
            executeTimedCase(testCase, wallClock),
            wallClock,
            bodyGate
        );

        scope.assert.equal(failedOutcome.kind, 'fail');
        scope.assert.equal(failedOutcome.failures.length, 2);

        return scope.assert.collect();
    }),
    test(
        'converts a passing body into a soft timeout failure',
        async function (scope) {
            const bodyGate = Promise.withResolvers<undefined>();
            const testCase = createPlannedCase(
                'soft timeout with passing body',
                async function passingBody(testScope) {
                    await bodyGate.promise;
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                }
            );
            const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
            const failedOutcome = await finishSoftTimedCase(
                executeTimedCase(testCase, wallClock),
                wallClock,
                bodyGate
            );

            scope.assert.equal(failedOutcome.kind, 'fail');
            scope.assert.equal(failedOutcome.failures.length, 1);

            return scope.assert.collect();
        }
    ),
    test(
        'detects a synchronous body that reaches its timeout',
        async function (scope) {
            const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
            const testCase = createPlannedCase(
                'synchronous timeout',
                function synchronousTimeoutBody(testScope) {
                    wallClock.advanceByMilliseconds(softTimeoutPolicy.timeoutMilliseconds);
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                }
            );
            const failedOutcome = failedOutcomeFrom(await executeTimedCase(testCase, wallClock));

            scope.assert.equal(failedOutcome.failures.length, 1);
            scope.assert.equal(failedOutcome.failures[0]?.kind, 'timeout');

            return scope.assert.collect();
        }
    ),
    test('reports timeout elapsed time in milliseconds', async function (scope) {
        const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const bodyGate = Promise.withResolvers<undefined>();
        const testCase = createPlannedCase(
            'elapsed timeout',
            async function elapsedTimeoutBody(testScope) {
                await bodyGate.promise;
                testScope.assert.true(true);

                return testScope.assert.collect();
            }
        );
        const execution = executeTimedCase(testCase, wallClock);

        wallClock.advanceByMicroseconds(10_500n);
        bodyGate.resolve(undefined);
        const timeout = timeoutFailureFrom(failedOutcomeFrom(await execution));

        scope.assert.equal(timeout.deadlineMilliseconds, 10);
        scope.assert.equal(timeout.elapsedMilliseconds, 10.5);

        return scope.assert.collect();
    })
]);
