import type { AssertionResult, AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { ExecutedBody } from './body-result.ts';
import { classifyPropertyTrial, propertyTrialWithPolicyErrors } from './property-trial-outcome.ts';
import { createAssertionRecorder, TestContractSignalError, type AssertionRecorder } from './assertion-recorder.ts';
import { bodyResultContext, completedBody, failedBody } from './case-body-execution.ts';
import { propertyScope, type PropertyTrialResult, type PropertyRunContext } from './property-execution-host.ts';
import type { TestBody, TestScope } from './test-scope.ts';
import type { PropertyCaseEvidence, RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';
import { createTestScopeLifecycle } from './test-scope-lifecycle.ts';

type PropertyBoundaryContext = {
    readonly signal: AbortSignal;
    readonly caseSignal: AbortSignal;
    readonly locations: TestPlanCase['definitionLocations'];
};

async function resolvePropertyBoundary(
    evaluate: () => Promise<AssertAssertionNode>,
    context: PropertyBoundaryContext
): Promise<AssertAssertionNode> {
    try {
        return await evaluate();
    } catch (error: unknown) {
        if (context.signal.aborted && !context.caseSignal.aborted && error === context.signal.reason) {
            return {
                check: 'fail',
                message: 'Property invocation canceled after a scope-contract violation.',
                source: 'assert',
                sourceLocations: context.locations
            };
        }
        throw error;
    }
}

async function evaluatePropertyTrial(
    testCase: TestPlanCase,
    signal: AbortSignal,
    body: TestBody,
    seed: bigint
): Promise<PropertyTrialResult> {
    const recorder = createAssertionRecorder();
    const lifecycle = createTestScopeLifecycle(recorder, { seed, work: testCase.workId });
    const controller = new AbortController();
    const trialSignal = AbortSignal.any([ signal, controller.signal ]);
    const completion = await (async function runTrialBody() {
        try {
            trialSignal.throwIfAborted();
            return { kind: 'returned', value: await lifecycle.runBody(trialSignal, body) } as const;
        } catch (error: unknown) {
            return { kind: 'threw', error } as const;
        }
    })();
    const context = bodyResultContext(recorder, testCase, await lifecycle.finish(controller), []);
    const result = completion.kind === 'returned'
        ? completedBody({ assertionResult: completion.value, context })
        : failedBody({ context, error: completion.error, testCase });
    const countFailure = recorder.validateAssertionCount(result.returnedAssertions.length);
    const checked: ExecutedBody = countFailure === null || result.bodyError !== null || result.requireFailed
        ? result
        : { ...result, contractFailures: [ ...result.contractFailures, countFailure ] };
    return classifyPropertyTrial(checked);
}

export function propertyObservationContractFailure(summary: string): never {
    throw new TestContractSignalError({
        kind: 'test-contract',
        code: 'property-observation',
        summary,
        actual: summary,
        expected: 'finite scores and valid labels within an active property trial'
    }, undefined);
}

export function propertyScopeContractFailure(summary: string): never {
    throw new TestContractSignalError({
        kind: 'test-contract',
        code: 'property-scope',
        summary,
        actual: summary,
        expected: 'one awaited property invocation at a time in an active case'
    }, undefined);
}

type PropertyCaseBody = {
    readonly body: TestBody;
    readonly scope: TestScope;
    readonly run: PropertyRunContext;
    readonly recorder: AssertionRecorder;
    readonly onPropertyUpdate: (property: PropertyCaseEvidence) => Promise<void>;
    readonly takeTrialErrors: () => readonly RunnerError[];
};

export async function runPropertyCaseBody(testCase: TestPlanCase, context: PropertyCaseBody): Promise<AssertionResult> {
    const { execution } = testCase;
    const { scope, body, recorder } = context;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property' || execution.policy.kind !== 'resolved') {
        return await body(scope);
    }
    return await body(propertyScope(scope, {
        scope,
        policy: execution.policy.policy,
        ...context.run,
        workId: testCase.workId,
        async recordEvidence(evidence) {
            recorder.recordPropertyEvidence(evidence);
            await context.onPropertyUpdate({ invocations: recorder.propertyEvidence() });
        },
        async evaluateTrial(trial, signal) {
            const result = await evaluatePropertyTrial(
                testCase,
                AbortSignal.any([ scope.signal, signal ]),
                trial,
                context.run.seed
            );
            await scope.yieldToNextTurn();
            return propertyTrialWithPolicyErrors(result, context.takeTrialErrors());
        },
        async recordBoundary(evaluate, signal) {
            const pending = recorder.recordPendingAssert();
            const assertion = await resolvePropertyBoundary(evaluate, {
                signal,
                caseSignal: scope.signal,
                locations: testCase.definitionLocations
            });
            pending.resolve(assertion);
            return assertion;
        }
    }));
}
