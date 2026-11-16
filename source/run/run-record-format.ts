import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod/v4';

export const currentRunRecordVersion = 4;
export const previousRunRecordVersion = 2;
export const familyRunRecordVersion = 3;
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
    return !hasImplementationEvidence(value['facts']) || !hasImplementationEvidence(value['replayPlan']) ||
        isDeepStrictEqual(value['facts'].implementations, value['replayPlan'].implementations);
}
export function validateImplementationRecord(value: unknown, context: Readonly<z.RefinementCtx>): void {
    if (!recordFields(value)) {
        return;
    }
    if (value['version'] === currentRunRecordVersion) {
        requireImplementationEvidence(value['facts'], context);
        if (Object.hasOwn(value, 'replayPlan')) {
            requireImplementationEvidence(value['replayPlan'], context);
        }
    }
    if (
        !evidenceMatches(value)
    ) {
        context.addIssue({ code: 'custom', message: 'Recorded implementation provenance is inconsistent.' });
    }
}
