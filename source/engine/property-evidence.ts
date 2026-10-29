import type { PropertyInvocationEvidence } from './run-result.ts';

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
