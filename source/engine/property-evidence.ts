import type { PropertyInvocationEvidence } from './property-failure-evidence.ts';
import type { PropertyCaseEvidence } from './run-result.ts';

type PropertyEvidenceRecorder = {
    readonly recordPropertyEvidence: (evidence: PropertyInvocationEvidence) => void;
    readonly propertyEvidence: () => readonly PropertyInvocationEvidence[];
};

export function createPropertyEvidenceRecorder(): PropertyEvidenceRecorder {
    const invocations = new Map<string, PropertyInvocationEvidence>();
    return {
        recordPropertyEvidence(evidence) {
            invocations.set(evidence.identity, evidence);
        },
        propertyEvidence() {
            return Array.from(invocations.values());
        }
    };
}

export function interruptedPropertyEvidence(evidence: PropertyCaseEvidence | null): PropertyCaseEvidence | null {
    return evidence === null ? null : {
        invocations: evidence.invocations.map(function interrupt(invocation) {
            const interrupted = invocation.summary?.status === 'in-progress'
                ? { ...invocation, summary: { ...invocation.summary, status: 'interrupted' as const } }
                : invocation;
            return interrupted.shrinkStatus === 'in-progress'
                ? { ...interrupted, shrinkStatus: 'interrupted' as const }
                : interrupted;
        })
    };
}
