import type { PropertyInvocationEvidence } from '../engine/property-failure-evidence.ts';
import { propertyCorpusSnapshot } from '../engine/property-execution-host.ts';
import { propertyRegressionInputs, corpusDiagnosticObservation } from './property-regressions.ts';
import { executePhases, type PropertyExecution } from './property-trial-phases.ts';
import { shrinkPropertyFailure } from './property-shrinking.ts';
import { invocationCoverage, coverageRequirements } from './property-coverage.ts';
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
    return result.kind === 'failed'
        ? await shrinkPropertyFailure(result, execution.invocation, execution, execution.work)
        : result;
}

function createExecution<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: PropertyInvocationContext
): PropertyExecution<Value> {
    const diagnostics: PropertyInvocationEvidence['diagnostics'][number][] = propertyCorpusSnapshot(context.host)
        .diagnostics
        .map(function diagnostic(item) {
            return { reason: `${item.path}: ${item.reason}`, observation: null };
        });
    const host = {
        ...context.host,
        async recordEvidence(evidence: PropertyInvocationEvidence) {
            await context.host.recordEvidence({
                ...evidence,
                diagnostics: [ ...diagnostics, ...evidence.diagnostics ]
            });
        }
    };
    const work = createPropertyWork(host.policy, context.signal);
    const coverage = invocationCoverage(
        coverageRequirements(Object.hasOwn(invocation, 'coverage') ? Reflect.get(invocation, 'coverage') : []),
        context.host.policy.maxLabels
    );
    const execution: PropertyExecution<Value> = {
        regressionDiagnostics() {
            return diagnostics;
        },
        diagnoseRegression(diagnostic) {
            diagnostics.push(diagnostic);
        },
        ...context,
        host,
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

async function executeWithDiagnostics<Value>(
    execution: PropertyExecution<Value>,
    regressions: PropertyRegressionInputs<Value>
): Promise<PropertyExecutionResult<Value>> {
    const result = await executeAndShrink(execution, regressions);
    if (execution.regressionDiagnostics().length > 0 && result.kind !== 'failed') {
        await execution.host.recordEvidence({
            confirmedWitness: null,
            shrinkStatus: null,
            identity: execution.identity,
            original: corpusDiagnosticObservation(),
            retained: corpusDiagnosticObservation(),
            diagnostics: []
        });
    }
    return result;
}

export async function executeProperty<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    regressions: PropertyRegressionInputs<Value>,
    context: PropertyInvocationContext
): Promise<PropertyExecutionResult<Value>> {
    const execution = createExecution(invocation, context);
    try {
        return await executeWithDiagnostics(execution, regressions);
    } catch (error: unknown) {
        const exhaustion = propertyExhaustion(error);
        if (exhaustion === null) {
            throw error;
        }
        return {
            kind: exhaustion,
            accounting: execution.work.snapshot(),
            coverage: execution.coverage.snapshot(),
            exhaustive: execution.exhaustive
        };
    }
}
