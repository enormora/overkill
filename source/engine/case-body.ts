import type { ExecutedBody } from './body-result.ts';
import { runPropertyCaseBody } from './property-trial.ts';
import { testBodyExecutionError } from './case-policy.ts';
import { builderBodyForAttempt, type BenchmarkAttempt } from './benchmark-attempt.ts';
import {
    bodyResultContext,
    bodyErrorResult,
    completedBody,
    completedThrowingBody,
    failedBody,
    type BodyResultContext
} from './case-body-execution.ts';
import type { AssertionRecorder } from './assertion-recorder.ts';
import type { CaseExecutionOptions } from './case-execution-context.ts';
import { createTestScopeLifecycle, createThrowingTestScope } from './test-scope-lifecycle.ts';
import type { CaseInterruption } from './case-interruption.ts';
import type { TestPlanCase } from './test-plan.ts';

type AssertionResult = Parameters<AssertionRecorder['returnedAssertions']>[0];
type CaseBodyOptions = CaseExecutionOptions & { readonly interruption: CaseInterruption; };

async function prepareCaseArtifacts(testCase: TestPlanCase, options: CaseBodyOptions): Promise<readonly unknown[]> {
    const policy = options.runtimePolicy;
    if (policy === null) {
        return [];
    }
    try {
        await policy.prepareAttempt(testCase, options.attempt);
        return [];
    } catch (error: unknown) {
        return [ error ];
    }
}

function interruptedBody(context: BodyResultContext): ExecutedBody {
    return {
        bodyError: null,
        inconclusiveReason: null,
        cleanupErrors: context.cleanupErrors,
        contractFailures: context.contractFailures,
        requireFailed: context.recorder.requireFailed(),
        runnerErrors: context.runnerErrors,
        returnedAssertions: context.recorder.activeRecordedAssertions()
    };
}

async function runBuilderCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: CaseBodyOptions,
    benchmarkAttempt: BenchmarkAttempt
): Promise<ExecutedBody> {
    const lifecycle = createTestScopeLifecycle(recorder, { seed: options.seed, work: testCase.workId });
    const runBody = async function runUserBody(): Promise<AssertionResult> {
        return await lifecycle.runBody(
            options.controller.signal,
            async function runFamilyBody(scope) {
                return await runPropertyCaseBody(testCase, {
                    scope,
                    recorder,
                    run: options.propertyRun,
                    body: builderBodyForAttempt(testCase, benchmarkAttempt),
                    takeTrialErrors() {
                        return options.runtimePolicy?.takeAttemptErrors(testCase, options.attempt) ?? [];
                    }
                });
            }
        );
    };
    const runAndCleanUp = async function runBodyAndScopeCleanup(): Promise<ExecutedBody> {
        const completion = await options.interruption.run(runBody);
        const preparationErrors = await prepareCaseArtifacts(testCase, options);
        const context = bodyResultContext(
            recorder,
            testCase,
            await lifecycle.finish(options.controller),
            [ ...preparationErrors, ...benchmarkAttempt.cleanupErrors() ]
        );
        if (completion.kind === 'returned') {
            return completedBody({ assertionResult: completion.value, context });
        }
        return completion.kind === 'threw'
            ? failedBody({ context, error: completion.error, testCase })
            : interruptedBody(context);
    };

    return options.runtimePolicy === null
        ? await runAndCleanUp()
        : await options.runtimePolicy.runAttempt(testCase, options.attempt, runAndCleanUp);
}

async function runThrowingCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: CaseBodyOptions
): Promise<ExecutedBody> {
    const runBody = async function runUserBody(): Promise<void> {
        if (testCase.execution.kind !== 'body' || testCase.execution.bodyMode !== 'throwing') {
            throw new TypeError('Non-throwing test cases do not have throwing bodies.');
        }

        await testCase.execution.body(createThrowingTestScope(
            recorder,
            options.controller.signal,
            { seed: options.seed, work: testCase.workId }
        ));
    };
    const runAndPrepare = async function runThrowingBodyAndPreparation(): Promise<ExecutedBody> {
        const completion = await options.interruption.run(runBody);
        const preparationErrors = await prepareCaseArtifacts(testCase, options);
        options.controller.abort();
        const context = bodyResultContext(
            recorder,
            testCase,
            { cleanupErrors: preparationErrors, lifecycleFailures: [] },
            []
        );
        if (completion.kind === 'threw') {
            return failedBody({ context, error: completion.error, testCase });
        }
        const body = completion.kind === 'returned' ? completedThrowingBody(recorder) : interruptedBody(context);
        return { ...body, cleanupErrors: context.cleanupErrors, runnerErrors: context.runnerErrors };
    };
    return options.runtimePolicy === null
        ? await runAndPrepare()
        : await options.runtimePolicy.runAttempt(testCase, options.attempt, runAndPrepare);
}

export async function runCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: CaseBodyOptions,
    benchmarkAttempt: BenchmarkAttempt
): Promise<ExecutedBody> {
    if (testCase.execution.kind !== 'body') {
        throw new TypeError('Skipped test cases do not have executable bodies.');
    }

    const executionError = testBodyExecutionError(testCase);
    if (executionError !== null) {
        return bodyErrorResult({ cleanupErrors: [], contractFailures: [], recorder, runnerErrors: [] }, executionError);
    }

    return testCase.execution.bodyMode === 'throwing'
        ? await runThrowingCaseBody(testCase, recorder, options)
        : await runBuilderCaseBody(testCase, recorder, options, benchmarkAttempt);
}
