import { canonicalIdentityJson } from '../canonical-identity.ts';
import { caseIdentityKey } from '../engine/identity.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { StoredCalibration } from '../baselines/calibration-reference.ts';

export type CalibrationInventory = readonly StoredCalibration[];
type CalibrationInventoryInput = {
    readonly profile: string;
    readonly machineClass: string | null;
    readonly result: RunResult;
    readonly references: CalibrationInventory;
};
export function staleCalibrationReferences(input: CalibrationInventoryInput): CalibrationInventory {
    const { result, references } = input;
    const active = new Set(result.perTest.flatMap(function usedReferences(test) {
        return (test.benchmark?.normalization?.calibrations ?? []).map(function identity(snapshot) {
            return canonicalIdentityJson(snapshot.identity);
        });
    }));
    const skipped = new Set(
        result
            .perTest
            .filter(function skippedCase(test) {
                return test.verdict === 'skip';
            })
            .map(function identity(test) {
                return caseIdentityKey(test.id);
            })
    );
    return references.filter(function staleReference(reference) {
        const preserved = active.has(canonicalIdentityJson(reference.snapshot.identity)) ||
            reference.owners.some(function skippedOwner(owner) {
                return skipped.has(caseIdentityKey(owner.case));
            });
        const sameScope = reference.profile === input.profile && reference.snapshot.machineClass === input.machineClass;
        return sameScope && reference.owners.length > 0 && !preserved;
    });
}
