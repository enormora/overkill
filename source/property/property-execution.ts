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

async function executeAndShrink<Value>(
    execution: PropertyExecution<Value>,
    regressions: PropertyRegressionInputs<Value>
): Promise<PropertyExecutionResult<Value>> {
    const result = await executePhases(execution, regressions);
    return result.kind === 'failed'
        ? await shrinkPropertyFailure(result, execution.invocation, execution, execution.work)
        : result;
}

export async function executeProperty<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    regressions: PropertyRegressionInputs<Value>,
    context: PropertyInvocationContext
): Promise<PropertyExecutionResult<Value>> {
    const work = createPropertyWork(context.host.policy);
    const coverage = invocationCoverage(
        coverageRequirements(Object.hasOwn(invocation, 'coverage') ? Reflect.get(invocation, 'coverage') : []),
        context.host.policy.maxLabels
    );
    const execution: PropertyExecution<Value> = {
        ...context,
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
    try {
        return await executeAndShrink(execution, regressions);
    } catch (error: unknown) {
        const exhaustion = propertyExhaustion(error);
        if (exhaustion === null) {
            throw error;
        }
        return {
            kind: exhaustion,
            accounting: work.snapshot(),
            coverage: coverage.snapshot(),
            exhaustive: execution.exhaustive
        };
    }
}
