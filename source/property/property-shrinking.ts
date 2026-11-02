import {
    matchPropertyFailure,
    propertyFailureIdentity,
    serializeValue,
    type PropertyFailureObservation,
    type PropertyInvocationEvidence,
    type PropertyShrinkStatus,
    type PropertyTrialResult
} from '../packages/engine/engine.entry-point.ts';
import type { PropertyExecutionResult, PropertyInvocationContext } from './property-execution-result.ts';
import { confirmedPropertyWitness } from './property-witness.ts';
import { PropertyCodecError } from './property-graph.ts';
import { shrinkCoverage } from './property-coverage.ts';
import { recipeInput, type GeneratedInput } from './generator-input.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import { propertyExhaustion, type PropertyWork } from './property-work.ts';
import { observePropertyTrial, type ObservedTrial } from './property-trial-observation.ts';

type PropertyWitnessFile = NonNullable<PropertyInvocationEvidence['confirmedWitness']>;

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
    readonly confirmed: () => PropertyWitnessFile | null;
    readonly confirm: (witness: PropertyWitnessFile | null) => void;
    readonly status: () => PropertyShrinkStatus;
    readonly stop: (status: PropertyShrinkStatus) => void;
    readonly retained: () => FailedExecution<Value>;
    readonly observation: () => PropertyFailureObservation;
    readonly diagnostics: () => readonly Diagnostic[];
    readonly diagnose: (diagnostic: Diagnostic) => void;
    readonly replace: (failure: FailedExecution<Value>, observation: PropertyFailureObservation) => void;
};

function shrinkState<Value>(original: FailedExecution<Value>): ShrinkState<Value> {
    let status: PropertyShrinkStatus = 'in-progress';
    let confirmed: PropertyWitnessFile | null = null;
    let retained = original;
    let { observation } = original;
    const diagnostics: Diagnostic[] = [];
    return {
        confirmed() {
            return confirmed;
        },
        confirm(witness) {
            confirmed = witness;
        },
        status() {
            return status;
        },
        stop(value) {
            status = value;
        },
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
            if (failure.trial.kind === 'terminated') {
                status = 'interrupted';
            }
            retained = { ...failure, observation: observed };
            observation = observed;
        }
    };
}

async function publish<Value>(session: ShrinkSession<Value>): Promise<void> {
    await session.context.host.recordEvidence({
        confirmedWitness: session.state.confirmed(),
        shrinkStatus: session.state.status(),
        identity: session.context.identity,
        original: session.original.observation,
        retained: session.state.observation(),
        diagnostics: session.state.diagnostics()
    });
}

async function diagnose<Value>(
    session: ShrinkSession<Value>,
    reason: string,
    observed: PropertyFailureObservation | null
): Promise<void> {
    session.state.diagnose({ reason, observation: observed });
    await publish(session);
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
    session.work.context.consumeWork();
    return await observePropertyTrial(value, session.invocation, {
        reconstruct: input,
        host: session.context.host,
        signal: session.context.signal,
        work: session.work,
        ...shrinkCoverage(session.context.host.policy.maxLabels),
        observeScores() {
            return undefined;
        }
    });
}

async function diagnoseAdditional<Value>(
    session: ShrinkSession<Value>,
    trial: PropertyTrialResult,
    observation: PropertyFailureObservation
): Promise<void> {
    if (trial.kind === 'assertion-failed' && trial.hasAdditionalFailures) {
        await diagnose(session, 'additional-failures', observation);
    }
}

async function replaceCounterexample<Value>(
    session: ShrinkSession<Value>,
    candidate: GeneratedInput<Value>,
    matched: Exclude<PropertyTrialResult, { readonly kind: 'passed'; }>,
    observed: ObservedTrial
): Promise<void> {
    await diagnoseAdditional(session, matched, observed.observation);
    session.state.replace({
        ...session.state.retained(),
        input: candidate.reconstruct,
        generated: candidate,
        trial: matched
    }, observed.observation);
    await publish(session);
}

async function acceptCandidate<Value>(
    session: ShrinkSession<Value>,
    candidate: GeneratedInput<Value>,
    observed: ObservedTrial
): Promise<boolean> {
    if (observed.trial.kind === 'terminated') {
        session.state.replace({ ...session.state.retained(), trial: observed.trial }, session.state.observation());
        return true;
    }
    const matched = matching(session, observed);
    if (matched !== null && matched.kind !== 'passed') {
        await replaceCounterexample(session, candidate, matched, observed);
        return true;
    }
    if (observed.trial.kind !== 'passed') {
        await diagnose(session, 'unrelated-failure', observed.observation);
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
        if (await acceptCandidate(session, candidate, observed)) {
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

async function recordConfirmedInput<Value>(session: ShrinkSession<Value>, confirmation: ObservedTrial): Promise<void> {
    session.state.confirm(confirmedPropertyWitness(session.context, session.state.observation(), session.identity));
    await publish(session);
    await diagnoseAdditional(session, confirmation.trial, confirmation.observation);
}

async function applyConfirmation<Value>(session: ShrinkSession<Value>, confirmation: ObservedTrial): Promise<void> {
    if (confirmation.trial.kind === 'terminated') {
        session.state.stop('interrupted');
        session.state.replace({ ...session.state.retained(), trial: confirmation.trial }, session.state.observation());
        return;
    }
    if (matching(session, confirmation) !== null) {
        await recordConfirmedInput(session, confirmation);
        return;
    }
    session.state.confirm(null);
    session.state.stop('non-reproducible');
    await diagnose(session, 'non-reproducible', confirmation.observation);
}

async function confirm<Value>(session: ShrinkSession<Value>, input: () => Value): Promise<void> {
    await applyConfirmation(session, await evaluate(session, input));
}

async function searchConfirmedFailure<Value>(
    session: ShrinkSession<Value>,
    input: GeneratedInput<Value>
): Promise<void> {
    if (session.state.status() !== 'in-progress') {
        return;
    }
    await traverse(session, input);
    if (session.state.status() === 'in-progress') {
        session.state.stop('search-exhausted');
        session.work.enterPhase('confirmation');
        await confirm(session, (session.state.retained().generated ?? input).reconstruct);
    }
}

async function canShrink<Value>(session: ShrinkSession<Value>): Promise<boolean> {
    if (session.context.host.policy.maxShrinkWork === 0) {
        session.state.stop('shrinking-disabled');
        await diagnose(session, 'shrinking-disabled', null);
        return false;
    }
    if (session.identity === null) {
        session.state.stop('failure-identity-unavailable');
        await diagnose(session, 'failure-identity-unavailable', null);
        return false;
    }
    return true;
}

async function shrinkGeneratedFailure<Value>(session: ShrinkSession<Value>): Promise<void> {
    const input = session.original.generated ??
        recipeInput(session.invocation.generator, session.original.input, session.work.context);
    if (input === null) {
        session.state.stop('shrink-state-unavailable');
        await diagnose(session, 'shrink-state-unavailable', null);
        return;
    }
    await confirm(session, input.reconstruct);
    await searchConfirmedFailure(session, input);
}

async function shrink<Value>(session: ShrinkSession<Value>): Promise<void> {
    if (!await canShrink(session)) {
        return;
    }
    session.work.enterPhase('confirmation');
    if (!session.original.regression) {
        await shrinkGeneratedFailure(session);
        return;
    }
    await confirm(session, session.original.input);
    if (session.state.status() === 'in-progress') {
        session.state.stop('shrink-state-unavailable');
    }
}

async function failShrinkExecution<Value>(session: ShrinkSession<Value>, error: unknown): Promise<never> {
    session.state.stop('execution-error');
    await diagnose(session, 'execution-error', {
        capture: { kind: 'unavailable' },
        input: session.state.observation().input,
        failure: serializeValue(error)
    });
    throw error;
}

async function recordCodecError<Value>(session: ShrinkSession<Value>, error: PropertyCodecError): Promise<void> {
    session.state.stop('execution-error');
    const retained = session.state.retained();
    session.state.replace(retained, {
        ...session.state.observation(),
        capture: { kind: 'codec-error', reason: error.message }
    });
    await diagnose(session, 'codec-error', {
        capture: { kind: 'unavailable' },
        input: retained.observation.input,
        failure: serializeValue(error)
    });
}

async function recordShrinkExhaustion<Value>(session: ShrinkSession<Value>, error: unknown): Promise<void> {
    const exhaustion = propertyExhaustion(error);
    if (exhaustion === null) {
        await failShrinkExecution(session, error);
    }
    session.state.stop(exhaustion === 'work-exhausted' ? 'work-exhausted' : 'search-exhausted');
    await diagnose(session, session.state.status(), null);
}

async function recordShrinkError<Value>(session: ShrinkSession<Value>, error: unknown): Promise<void> {
    if (session.context.signal.aborted) {
        session.state.stop('interrupted');
        throw error;
    }
    if (error instanceof PropertyCodecError) {
        await recordCodecError(session, error);
        return;
    }
    await recordShrinkExhaustion(session, error);
}

async function boundedShrink<Value>(session: ShrinkSession<Value>): Promise<FailedExecution<Value>> {
    try {
        await shrink(session);
    } catch (error: unknown) {
        await recordShrinkError(session, error);
    } finally {
        await publish(session);
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
    await publish(session);
    await diagnoseAdditional(session, original.trial, original.observation);
    return await boundedShrink(session);
}
