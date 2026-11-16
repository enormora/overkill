import { withResourceCheckCancellation } from '../resource-check-cancellation.ts';
import type { CaseExecutionOptions } from './case-execution-context.ts';
import type { TestPlanCase } from './test-plan.ts';
import { readTestBodyFamily, isPropertyBodyAttachment } from './test-body.ts';

function resolvedPropertyExecutionError(testCase: TestPlanCase): TypeError | null {
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property') {
        return null;
    }
    if (execution.policy.kind !== 'resolved') {
        return new TypeError('Property execution requires resolved collection policy.');
    }
    return testCase.testFamily === 'integration' || testCase.resourceAttachments.resourceGraph.length === 0
        ? null
        : new TypeError('Property execution cannot use resource descriptors.');
}

export function testBodyExecutionError(testCase: TestPlanCase): TypeError | null {
    const { execution } = testCase;
    if (execution.kind !== 'body') {
        return null;
    }
    if (execution.bodyMode === 'property') {
        return resolvedPropertyExecutionError(testCase);
    }
    if (isPropertyBodyAttachment(readTestBodyFamily(execution.body))) {
        return new TypeError('Property execution requires a collected property declaration.');
    }
    return null;
}

export async function runCaseBodyWithCancellation<Value>(
    testCase: TestPlanCase,
    options: Pick<CaseExecutionOptions, 'attempt' | 'controller'>,
    run: () => Promise<Value>
): Promise<Value> {
    return await withResourceCheckCancellation(testCase.workId, options.attempt, function cancel(cause) {
        options.controller.abort(cause);
    }, run);
}
