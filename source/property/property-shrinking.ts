import {
    matchPropertyFailure,
    propertyFailureIdentity,
    serializeValue,
    type PropertyFailureObservation,
    type PropertyInvocationEvidence,
    type PropertyTrialResult
} from '../packages/engine/engine.entry-point.ts';
import { propertyLabels } from './property-targets.ts';
import { createCoverage } from './property-coverage.ts';
import { recipeInput, type GeneratedInput } from './generator-input.ts';
import type { PropertyExecutionResult, PropertyInvocationContext } from './property-execution-result.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import { propertyExhaustion, type PropertyWork } from './property-work.ts';
import { observePropertyTrial, type ObservedTrial } from './property-trial-observation.ts';

type FailedExecution<Value> = Extract<PropertyExecutionResult<Value>, { readonly kind: 'failed'; }>;
type Diagnostic = PropertyInvocationEvidence['diagnostics'][number];
type ShrinkSession<Value> = {
    readonly original: FailedExecution<Value>;
    readonly invocation: NormalizedPropertyInvocation<Value>;
    readonly context: PropertyInvocationContext;
    readonly work: PropertyWork;
    readonly identity: string | null;
    readonly state: ShrinkState<Value>;
};

type ShrinkState<Value> = {
    readonly retained: () => FailedExecution<Value>;
    readonly observation: () => PropertyFailureObservation;
    readonly diagnostics: () => readonly Diagnostic[];
    readonly diagnose: (diagnostic: Diagnostic) => void;
    readonly replace: (failure: FailedExecution<Value>, observation: PropertyFailureObservation) => void;
};

function shrinkState<Value>(original: FailedExecution<Value>): ShrinkState<Value> {
    let retained = original;
    let { observation } = original;
    const diagnostics: Diagnostic[] = [];
    return {
        retained() {
            return retained;
        },
        observation() {
            return observation;
        },
        diagnostics() {
            return Array.from(diagnostics);
        },
        diagnose(diagnostic) {
            diagnostics.push(diagnostic);
        },
        replace(failure, observed) {
            retained = failure;
            observation = observed;
        }
    };
}

function publish<Value>(session: ShrinkSession<Value>): void {
    session.context.host.recordEvidence({
        identity: session.context.identity,
        original: session.original.observation,
        retained: session.state.observation(),
        diagnostics: session.state.diagnostics()
    });
}

function diagnose<Value>(
    session: ShrinkSession<Value>,
    reason: string,
    observed: PropertyFailureObservation | null
): void {
    session.state.diagnose({ reason, observation: observed });
    publish(session);
}

function matching<Value>(session: ShrinkSession<Value>, candidate: ObservedTrial): PropertyTrialResult | null {
    const { original, identity } = session;
    const explicit = original.failureKey !== null;
    if (identity === null || explicit && candidate.key !== original.failureKey) {
        return null;
    }
    return matchPropertyFailure(original.trial, candidate.trial, identity, explicit);
}

async function evaluate<Value>(session: ShrinkSession<Value>, input: () => Value): Promise<ObservedTrial> {
    session.context.signal.throwIfAborted();
    session.work.context.consumeWork();
    const value = input();
    const preview = serializeValue(value);
    session.work.context.consumeWork();
    return await observePropertyTrial(value, preview, session.invocation, {
        host: session.context.host,
        signal: session.context.signal,
        work: session.work,
        observeLabel: propertyLabels(session.context.host.policy.maxLabels),
        observeScores() {
            return undefined;
        },
        observations: createCoverage([], propertyLabels(session.context.host.policy.maxLabels)).trial('shrinking')
    });
}

function diagnoseAdditional<Value>(
    session: ShrinkSession<Value>,
    trial: PropertyTrialResult,
    observation: PropertyFailureObservation
): void {
    if (trial.kind === 'assertion-failed' && trial.hasAdditionalFailures) {
        diagnose(session, 'additional-failures', observation);
    }
}

function replaceCounterexample<Value>(
    session: ShrinkSession<Value>,
    candidate: GeneratedInput<Value>,
    matched: Exclude<PropertyTrialResult, { readonly kind: 'passed'; }>,
    observed: ObservedTrial
): void {
    diagnoseAdditional(session, matched, observed.observation);
    session.state.replace({
        ...session.state.retained(),
        input: candidate.reconstruct,
        generated: candidate,
        trial: matched
    }, observed.observation);
    publish(session);
}

function acceptCandidate<Value>(
    session: ShrinkSession<Value>,
    candidate: GeneratedInput<Value>,
    observed: ObservedTrial
): boolean {
    if (observed.trial.kind === 'terminated') {
        session.state.replace({ ...session.state.retained(), trial: observed.trial }, session.state.observation());
        return true;
    }
    const matched = matching(session, observed);
    if (matched !== null && matched.kind !== 'passed') {
        replaceCounterexample(session, candidate, matched, observed);
        return true;
    }
    if (observed.trial.kind !== 'passed') {
        diagnose(session, 'unrelated-failure', observed.observation);
    }
    return false;
}

async function nextCounterexample<Value>(
    session: ShrinkSession<Value>,
    current: GeneratedInput<Value>
): Promise<GeneratedInput<Value> | null> {
    session.work.context.consumeWork();
    for (const candidate of current.shrink()) {
        session.context.signal.throwIfAborted();
        session.work.context.consumeWork();
        const observed = await evaluate(session, candidate.reconstruct);
        if (acceptCandidate(session, candidate, observed)) {
            return candidate;
        }
    }
    return null;
}

async function traverse<Value>(session: ShrinkSession<Value>, input: GeneratedInput<Value>): Promise<void> {
    session.work.enterPhase('shrinking');
    let current: GeneratedInput<Value> | null = input;
    while (current !== null && session.state.retained().trial.kind !== 'terminated') {
        current = await nextCounterexample(session, current);
    }
}

async function confirm<Value>(session: ShrinkSession<Value>, input: GeneratedInput<Value>): Promise<void> {
    const confirmation = await evaluate(session, input.reconstruct);
    if (confirmation.trial.kind === 'terminated') {
        session.state.replace({ ...session.state.retained(), trial: confirmation.trial }, session.state.observation());
        return;
    }
    if (matching(session, confirmation) === null) {
        diagnose(session, 'non-reproducible', confirmation.observation);
        return;
    }
    diagnoseAdditional(session, confirmation.trial, confirmation.observation);
    await traverse(session, input);
}

function canShrink<Value>(session: ShrinkSession<Value>): boolean {
    if (session.context.host.policy.maxShrinkWork === 0) {
        diagnose(session, 'shrinking-disabled', null);
        return false;
    }
    if (session.identity === null) {
        diagnose(session, 'failure-identity-unavailable', null);
        return false;
    }
    return true;
}

async function shrink<Value>(session: ShrinkSession<Value>): Promise<void> {
    if (!canShrink(session)) {
        return;
    }
    session.work.enterPhase('confirmation');
    const input = session.original.generated ??
        recipeInput(session.invocation.generator, session.original.input, session.work.context);
    if (input === null) {
        diagnose(session, 'shrink-state-unavailable', null);
        return;
    }
    await confirm(session, input);
}

async function boundedShrink<Value>(session: ShrinkSession<Value>): Promise<FailedExecution<Value>> {
    try {
        await shrink(session);
    } catch (error: unknown) {
        if (propertyExhaustion(error) === null) {
            diagnose(session, 'execution-error', {
                input: session.state.observation().input,
                failure: serializeValue(error)
            });
            throw error;
        }
        diagnose(session, 'work-exhausted', null);
    } finally {
        publish(session);
    }
    return { ...session.state.retained(), accounting: session.work.snapshot() };
}

export async function shrinkPropertyFailure<Value>(
    original: FailedExecution<Value>,
    invocation: NormalizedPropertyInvocation<Value>,
    context: PropertyInvocationContext,
    work: PropertyWork
): Promise<FailedExecution<Value>> {
    if (original.trial.kind === 'terminated') {
        return original;
    }
    const session: ShrinkSession<Value> = {
        original,
        invocation,
        context,
        work,
        identity: original.failureKey ?? propertyFailureIdentity(original.trial),
        state: shrinkState(original)
    };
    publish(session);
    diagnoseAdditional(session, original.trial, original.observation);
    return await boundedShrink(session);
}
