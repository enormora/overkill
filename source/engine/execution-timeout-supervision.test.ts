import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import {
    createExecutionSupervision,
    executeCaseBody
} from './execution-supervision.ts';
import type { Engine } from './engine.ts';
import type { RunnerError } from './run-result.ts';

type TestCaseBody = Parameters<Engine['createTestCase']>[0]['body'];
type TestPlanCase = ReturnType<Engine['createTestPlan']>['cases'][number];
type FailedOutcome = {
    readonly failures: readonly unknown[];
    readonly kind: 'fail';
};

const softTimeoutPolicy = {
    hardTimeoutMilliseconds: 100,
    timeoutMilliseconds: 10
};

function createPlannedCase(name: string, body: TestCaseBody): TestPlanCase {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    body,
                    metadata: {},
                    name
                })
            ],
            metadata: {},
            name: 'root'
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

async function executeTimedCase(
    testCase: TestPlanCase,
    wallClock: ReturnType<typeof createDeterministicWallClock>,
    supervision = createExecutionSupervision()
): ReturnType<typeof executeCaseBody> {
    return executeCaseBody(testCase, softTimeoutPolicy, supervision, { wallClock });
}

async function finishSoftTimedCase(
    execution: ReturnType<typeof executeCaseBody>,
    wallClock: ReturnType<typeof createDeterministicWallClock>,
    bodyGate: PromiseWithResolvers<undefined>
): Promise<FailedOutcome> {
    wallClock.advanceByMilliseconds(softTimeoutPolicy.timeoutMilliseconds);
    bodyGate.resolve(undefined);

    return failedOutcomeFrom(await execution);
}

async function executeHardTimedCase(
    wallClock: ReturnType<typeof createDeterministicWallClock>,
    supervision = createExecutionSupervision()
): ReturnType<typeof executeCaseBody> {
    const bodyGate = Promise.withResolvers<never>();
    const testCase = createPlannedCase('hard timeout', async function hardTimeoutBody(testScope) {
        await bodyGate.promise;

        return testScope.assert.collect();
    });

    return executeCaseBody(
        testCase,
        {
            hardTimeoutMilliseconds: 10,
            timeoutMilliseconds: 100
        },
        supervision,
        { wallClock }
    );
}

function assertHardTimeoutResult(
    scope: OverkillScope,
    executedCase: Awaited<ReturnType<typeof executeCaseBody>>,
    error: RunnerError | undefined
): void {
    scope.require.defined(error);
    scope.require.defined(error.attributedTo);

    scope.assert.equal(executedCase.result.verdict, 'crashed');
    scope.assert.equal(error.subtype, 'crash');
    scope.assert.equal(error.attributedTo.name, 'hard timeout');
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/execution-timeout-supervision.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'executeCaseBody() completes active cases after the hard timeout',
            metadata: {},
            async body(scope: OverkillScope) {
                const wallClock = createDeterministicWallClock();
                const supervision = createExecutionSupervision();
                const execution = executeHardTimedCase(wallClock, supervision);

                wallClock.advanceByMilliseconds(10);
                const executedCase = await execution;
                const [ error ] = supervision.runnerErrors;

                assertHardTimeoutResult(scope, executedCase, error);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'executeCaseBody() appends a soft timeout failure to body failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const bodyGate = Promise.withResolvers<undefined>();
                const testCase = createPlannedCase(
                    'soft timeout and failure',
                    async function softTimeoutBody(testScope) {
                        await bodyGate.promise;
                        testScope.assert.equal(1, 2);

                        return testScope.assert.collect();
                    }
                );
                const wallClock = createDeterministicWallClock();
                const failedOutcome = await finishSoftTimedCase(
                    executeTimedCase(testCase, wallClock),
                    wallClock,
                    bodyGate
                );

                scope.assert.equal(failedOutcome.kind, 'fail');
                scope.assert.equal(failedOutcome.failures.length, 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'executeCaseBody() converts a passing body into a soft timeout failure',
            metadata: {},
            async body(scope: OverkillScope) {
                const bodyGate = Promise.withResolvers<undefined>();
                const testCase = createPlannedCase(
                    'soft timeout with passing body',
                    async function passingBody(testScope) {
                        await bodyGate.promise;
                        testScope.assert.true(true);

                        return testScope.assert.collect();
                    }
                );
                const wallClock = createDeterministicWallClock();
                const failedOutcome = await finishSoftTimedCase(
                    executeTimedCase(testCase, wallClock),
                    wallClock,
                    bodyGate
                );

                scope.assert.equal(failedOutcome.kind, 'fail');
                scope.assert.equal(failedOutcome.failures.length, 1);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
