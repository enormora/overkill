import type { PropertyInvocationEvidence } from '../engine/property-failure-evidence.ts';
import type { TestFailure, PropertyCaseEvidence } from '../engine/run-result.ts';

export function formatFailureSummary(failure: TestFailure): string {
    if (failure.kind === 'assertion') {
        return failure.checks[0].summary;
    }

    if (failure.kind === 'body-error') {
        return failure.error.message;
    }

    if (failure.kind === 'cleanup-error') {
        return failure.error.message;
    }

    if (failure.kind === 'timeout') {
        return `Timed out after ${failure.deadlineMilliseconds} ms.`;
    }

    return failure.summary;
}

const propertyDiagnosticMessages: Readonly<Record<string, string>> = {
    'shrinking-disabled': 'Shrinking is disabled',
    'failure-identity-unavailable': 'Shrinking stopped because failure identity is unavailable',
    'shrink-state-unavailable': 'Shrinking stopped because generator state is unavailable',
    'non-reproducible': 'The retained failure did not reproduce',
    'search-exhausted': 'Shrinking exhausted the candidate search',
    interrupted: 'Shrinking was interrupted',
    'work-exhausted': 'Shrinking stopped at the work budget',
    'unrelated-failure': 'Unrelated failures observed during shrinking',
    'additional-failures': 'Additional failures retained as diagnostics',
    'execution-error': 'Execution error during shrinking'
};

function propertyInvocationLines(invocation: PropertyInvocationEvidence): readonly string[] {
    const reasons = new Map<string, number>();
    for (const diagnostic of invocation.diagnostics) {
        reasons.set(diagnostic.reason, (reasons.get(diagnostic.reason) ?? 0) + 1);
    }
    if (
        invocation.shrinkStatus !== null && invocation.shrinkStatus !== 'in-progress' &&
        !reasons.has(invocation.shrinkStatus)
    ) {
        reasons.set(invocation.shrinkStatus, 1);
    }
    return Array.from(reasons, function reasonLine([ reason, count ]) {
        const message = propertyDiagnosticMessages[reason] ?? reason;
        return `Property ${invocation.identity}: ${message} (${count})`;
    });
}

export function formatPropertyDiagnostics(evidence: PropertyCaseEvidence | null): readonly string[] {
    return (evidence?.invocations ?? []).flatMap(propertyInvocationLines);
}
