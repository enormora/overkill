import type { TestPlanCase } from './test-plan.ts';
import { readTestBodyFamily } from './test-body.ts';

function resolvedPropertyExecutionError(testCase: TestPlanCase): TypeError | null {
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property') {
        return null;
    }
    if (execution.policy.kind !== 'resolved') {
        return new TypeError('Property execution requires resolved collection policy.');
    }
    return testCase.resourceAttachments.resourceGraph.length === 0
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
    if (readTestBodyFamily(execution.body)?.family === 'property') {
        return new TypeError('Property execution requires a collected property declaration.');
    }
    return null;
}
