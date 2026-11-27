import type { AssertionResult, AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import { isPropertyTermination } from './property-control-error.ts';
import { classifyPropertyTrialWithAssertionCount, propertyTrialWithPolicyErrors } from './property-trial-outcome.ts';
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
import { runScopeBodyWithInterruption } from './test-scope-lifecycle.ts';

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

type TrialExecution = {
    readonly testCase: TestPlanCase;
    readonly scope: TestScope;
    readonly seed: bigint;
    readonly owner: AssertionRecorder;
};
type PropertyTrialIdentity = NonNullable<AssertionRecorder['origin']['trial']>;

async function evaluatePropertyTrial(
    execution: TrialExecution,
    body: TestBody,
    identity: PropertyTrialIdentity,
    cancellation: AbortSignal
): Promise<PropertyTrialResult> {
    const { testCase, scope, seed, owner } = execution;
    const recorder = createAssertionRecorder({ ...owner.origin, trial: identity });
    const { cleanup, completion } = await runScopeBodyWithInterruption(
        recorder,
        { seed, work: testCase.workId },
        body,
        {
            parent: scope.signal,
            cancellation,
            ownerInterruption: owner.interruption,
            afterCleanup: scope.yieldToNextTurn
        }
    );
    recorder.close('settled');
    recorder.publish();
    const context = bodyResultContext(recorder, testCase, cleanup, []);
    return classifyPropertyTrialWithAssertionCount(
        completion.kind === 'returned'
            ? completedBody({ assertionResult: completion.value, context })
            : failedBody({ context, error: completion.error, testCase }),
        recorder.validateAssertionCount
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

export function runPropertyCaseBody(
    testCase: TestPlanCase,
    context: PropertyCaseBody
): AssertionResult | Promise<AssertionResult> {
    const { execution } = testCase;
    const { scope, body, recorder } = context;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property' || execution.policy.kind !== 'resolved') {
        assertOrdinaryPropertyRun(context.run);
        return body(scope);
    }
    const witness = propertyReplayWitness(context.run);
    if (witness !== null && !matchesReplayDeclaration(witness.target.kind, execution.definition.kind)) {
        throw new CaseRunnerError('Witness target does not match the current property declaration kind.', {
            subtype: 'witness-replay',
            cause: null
        });
    }
    let unlabelledTrial = 0;
    return body(propertyScope(scope, {
        scope,
        policy: execution.policy.policy,
        ...context.run,
        workId: testCase.workId,
        async recordEvidence(evidence) {
            if (recorder.recordPropertyEvidence(evidence)) {
                await context.onPropertyUpdate({ invocations: recorder.propertyEvidence() });
            }
        },
        async evaluateTrial(...[ trial, signal, coordinate ]) {
            recorder.assertRecording('start a property trial');
            const identity: PropertyTrialIdentity = coordinate === undefined
                ? { kind: 'unlabelled-trial', index: unlabelledTrial }
                : { kind: 'property', ...coordinate };
            if (coordinate === undefined) {
                unlabelledTrial += 1;
            }
            const result = await evaluatePropertyTrial(
                { testCase, scope, seed: context.run.seed, owner: recorder },
                trial,
                identity,
                signal
            );
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
                recorder.interruption.throwIfAborted();
                pending.resolve(assertion);
                return assertion;
            } catch (error: unknown) {
                if (
                    isPropertyTermination(error) && error.result.contractFailures.length > 0 &&
                    !recorder.interruption.aborted
                ) {
                    pending.discard();
                    recorder.retainContractFailures(error.result.contractFailures);
                }
                throw error;
            }
        }
    }, recorder.assertRecording));
}
