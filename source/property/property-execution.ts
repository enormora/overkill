import type { PropertyInvocationEvidence } from '../engine/property-failure-evidence.ts';
import { propertyCorpusSnapshot } from '../engine/property-execution-host.ts';
import { createPropertyReporting } from './property-reporting.ts';
import { propertyRegressionInputs } from './property-regressions.ts';
import { executePhases, type PropertyExecution } from './property-trial-phases.ts';
import { shrinkPropertyFailure } from './property-shrinking.ts';
import { invocationCoverage } from './property-coverage.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import { createPropertyWork, propertyExhaustion } from './property-work.ts';
import type {
    PropertyExecutionResult,
    PropertyRegressionInputs,
    PropertyInvocationContext
} from './property-execution-result.ts';

function* regressionInputs<Value>(first: Iterable<() => Value>, second: Iterable<() => Value>): Generator<() => Value> {
    yield* first;
    yield* second;
}

async function executeAndShrink<Value>(
    execution: PropertyExecution<Value>,
    regressions: PropertyRegressionInputs<Value>
): Promise<PropertyExecutionResult<Value>> {
    const stored = propertyRegressionInputs(
        execution.invocation,
        execution,
        execution.work.context,
        function diagnose(diagnostic) {
            execution.diagnoseRegression(diagnostic);
        }
    );
    const result = await executePhases(execution, {
        checkedIn: regressionInputs(stored.checkedIn, regressions.checkedIn),
        localCache: regressionInputs(stored.localCache, regressions.localCache)
    });
    if (result.kind === 'failed') {
        await execution.host.recordEvidence({
            summary: null,
            identity: execution.identity,
            confirmedWitness: null,
            shrinkStatus: null,
            original: result.observation,
            retained: result.observation,
            diagnostics: []
        });
    }
    return result.kind === 'failed'
        ? await shrinkPropertyFailure(result, execution.invocation, execution, execution.work)
        : result;
}

export function createPropertyExecution<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: PropertyInvocationContext
): PropertyExecution<Value> {
    const diagnostics: PropertyInvocationEvidence['diagnostics'][number][] = propertyCorpusSnapshot(context.host)
        .diagnostics
        .map(function diagnostic(item) {
            return { reason: `${item.path}: ${item.reason}`, observation: null };
        });
    const work = createPropertyWork(context.host.policy, context.signal);
    const coverage = invocationCoverage(invocation.coverage, context.host.policy.maxLabels);
    const reporting = createPropertyReporting(context, work, coverage, diagnostics);
    const execution: PropertyExecution<Value> = {
        regressionDiagnostics() {
            return diagnostics;
        },
        diagnoseRegression(diagnostic) {
            diagnostics.push(diagnostic);
        },
        ...context,
        ...reporting,
        invocation,
        work,
        coverage,
        observeLabel: coverage.observeLabel,
        observeScores() {
            return undefined;
        },
        phase: 'checked-in-corpus',
        exhaustive: null
    };
    return execution;
}

function failureStatus(kind: string): 'failed' | 'interrupted' {
    return kind === 'terminated' ? 'interrupted' : 'failed';
}

async function executeWithDiagnostics<Value>(
    execution: PropertyExecution<Value>,
    regressions: PropertyRegressionInputs<Value>
): Promise<PropertyExecutionResult<Value>> {
    const result = await executeAndShrink(execution, regressions);
    if (execution.regressionDiagnostics().length > 0 && result.kind !== 'failed') {
        await execution.host.recordEvidence({
            summary: null,
            confirmedWitness: null,
            shrinkStatus: null,
            identity: execution.identity,
            original: null,
            retained: null,
            diagnostics: []
        });
    }
    const status = result.kind === 'failed' ? failureStatus(result.trial.kind) : result.kind;
    await execution.publish(status, result.exhaustive);
    return result;
}

export async function executeProperty<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    regressions: PropertyRegressionInputs<Value>,
    context: PropertyInvocationContext
): Promise<PropertyExecutionResult<Value>> {
    const execution = createPropertyExecution(invocation, context);
    await execution.publish('in-progress', null);
    try {
        return await executeWithDiagnostics(execution, regressions);
    } catch (error: unknown) {
        const exhaustion = propertyExhaustion(error);
        if (exhaustion === null) {
            await execution.publish(context.signal.aborted ? 'interrupted' : 'execution-error', execution.exhaustive);
            throw error;
        }
        await execution.publish(exhaustion, execution.exhaustive);
        return {
            kind: exhaustion,
            accounting: execution.work.snapshot(),
            coverage: execution.coverage.snapshot(),
            exhaustive: execution.exhaustive
        };
    }
}
