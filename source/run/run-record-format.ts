import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod/v4';

export const currentRunRecordVersion = 1;
function recordFields(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}
function hasImplementationEvidence(value: unknown): value is { readonly implementations: unknown; } {
    return recordFields(value) && Object.hasOwn(value, 'implementations');
}
function requireImplementationEvidence(value: unknown, context: Readonly<z.RefinementCtx>): void {
    if (value !== null && !hasImplementationEvidence(value)) {
        context.addIssue({ code: 'custom', message: 'Current records require explicit implementation provenance.' });
    }
}
function evidenceMatches(value: Readonly<Record<string, unknown>>): boolean {
    return !hasImplementationEvidence(value.facts) || !hasImplementationEvidence(value.replayPlan) ||
        isDeepStrictEqual(value.facts.implementations, value.replayPlan.implementations);
}
function validateResourceCheckRecord(
    value: Readonly<Record<string, unknown>>,
    context: Readonly<z.RefinementCtx>
): void {
    if (
        value.version === currentRunRecordVersion && recordFields(value.result) &&
        !Object.hasOwn(value.result, 'resourceChecks')
    ) {
        context.addIssue({ code: 'custom', message: 'Current records require explicit resource-check evidence.' });
    }
}
function validateCurrentImplementationRecord(
    value: Readonly<Record<string, unknown>>,
    context: Readonly<z.RefinementCtx>
): void {
    if (value.version === currentRunRecordVersion) {
        requireImplementationEvidence(value.facts, context);
        if (Object.hasOwn(value, 'replayPlan')) {
            requireImplementationEvidence(value.replayPlan, context);
        }
    }
}
export function validateImplementationRecord(value: unknown, context: Readonly<z.RefinementCtx>): void {
    if (!recordFields(value)) {
        return;
    }
    validateResourceCheckRecord(value, context);
    validateCurrentImplementationRecord(value, context);
    if (
        !evidenceMatches(value)
    ) {
        context.addIssue({ code: 'custom', message: 'Recorded implementation provenance is inconsistent.' });
    }
}
