import type { AssertionResult, AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import { isPropertyTermination } from './property-control-error.ts';
import { classifyPropertyTrial, propertyTrialWithPolicyErrors } from './property-trial-outcome.ts';
import { createAssertionRecorder, type AssertionRecorder } from './assertion-recorder.ts';
import { bodyResultContext, completedBody, failedBody } from './case-body-execution.ts';
import {
    propertyReplayWitness,
    propertyScope,
    type PropertyTrialResult,
    type PropertyRunContext
} from './property-execution-host.ts';
import type { TestBody, TestScope } from './test-scope.ts';
import { CaseRunnerError, type PropertyCaseEvidence, type RunnerError } from './run-result.ts';
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
    const unsuccessful = [
        result.contractFailures.length > 0,
        result.inconclusiveReason !== null,
        result.bodyError !== null,
        result.requireFailed
    ]
        .includes(true);
    return classifyPropertyTrial(
        countFailure === null || unsuccessful
            ? result
            : { ...result, contractFailures: [ ...result.contractFailures, countFailure ] }
    );
}

type PropertyCaseBody = {
    readonly body: TestBody;
    readonly scope: TestScope;
    readonly run: PropertyRunContext;
    readonly recorder: AssertionRecorder;
    readonly onPropertyUpdate: (property: PropertyCaseEvidence) => Promise<void>;
    readonly takeTrialErrors: () => readonly RunnerError[];
};

function assertOrdinaryPropertyRun(run: PropertyRunContext): void {
    if (propertyReplayWitness(run) !== null) {
        throw new CaseRunnerError('Witness replay requires a resolved property declaration.', {
            subtype: 'witness-replay',
            cause: null
        });
    }
}

function matchesReplayDeclaration(target: 'forall' | 'property-value', declaration: 'nested' | 'property'): boolean {
    const expected = target === 'property-value' ? 'property' : 'nested';
    return expected === declaration;
}

export async function runPropertyCaseBody(testCase: TestPlanCase, context: PropertyCaseBody): Promise<AssertionResult> {
    const { execution } = testCase;
    const { scope, body, recorder } = context;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property' || execution.policy.kind !== 'resolved') {
        assertOrdinaryPropertyRun(context.run);
        return await body(scope);
    }
    const witness = propertyReplayWitness(context.run);
    if (witness !== null && !matchesReplayDeclaration(witness.target.kind, execution.definition.kind)) {
        throw new CaseRunnerError('Witness target does not match the current property declaration kind.', {
            subtype: 'witness-replay',
            cause: null
        });
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
            try {
                const assertion = await resolvePropertyBoundary(evaluate, {
                    signal,
                    caseSignal: scope.signal,
                    locations: testCase.definitionLocations
                });
                pending.resolve(assertion);
                return assertion;
            } catch (error: unknown) {
                if (isPropertyTermination(error) && error.result.contractFailures.length > 0) {
                    recorder.retainContractFailures(error.result.contractFailures);
                    pending.discard();
                }
                throw error;
            }
        }
    }));
}
