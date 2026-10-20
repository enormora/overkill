import { createCalibrationReferenceStore } from '../baselines/calibration-store.ts';
import { readCalibrationHostMetadata, calibrationMachineClass } from '../bench/calibration-machine.ts';
import type { BenchmarkNormalizationContext } from '../engine/benchmark-result.ts';
import { calibrationNodeArguments } from './benchmark-calibration.ts';
import { calibrationMaintenanceSession } from './calibration-maintenance.ts';
import { createCalibrationCaptureSession } from './calibration-capture-session.ts';
import { readSavedCalibrationReferences } from './calibration-baseline-references.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunResultSession } from './run-support.ts';

type ComparableCalibration = Extract<
    NonNullable<ResolvedRunInput['benchmarkCalibration']>,
    { readonly kind: 'comparable'; }
>;
type NormalizationPreparation = {
    readonly context: BenchmarkNormalizationContext;
    readonly capture: RunResultSession | null;
    readonly maintain: (baseline: RunResultSession | null) => RunResultSession | null;
};
function normalizationMachine(
    input: ResolvedRunInput,
    calibration: ComparableCalibration | null
): BenchmarkNormalizationContext['machine'] {
    if (input.profile.testFamily !== 'benchmark') {
        throw new TypeError('Calibration requires a benchmark profile.');
    }
    const metadata = readCalibrationHostMetadata(calibrationNodeArguments(input.profile.execution));
    return calibration === null
        ? { machineClass: calibrationMachineClass(metadata), metadata }
        : { machineClass: calibration.machineClass, metadata: calibration.metadata };
}
export async function prepareBenchmarkNormalization(
    input: ResolvedRunInput,
    calibration: ComparableCalibration | null,
    dependencies: RunOrchestratorDependencies
): Promise<NormalizationPreparation> {
    if (input.profile.testFamily !== 'benchmark') {
        throw new TypeError('Calibration references require a benchmark profile.');
    }
    const storeInput = {
        projectRoot: input.projectRoot,
        directory: input.profile.baselines.directory,
        maxBytes: input.profile.attachments.maxArtifactBytes
    };
    const store = await createCalibrationReferenceStore(storeInput);
    const references = input.benchmarkPurpose === 'capture' ? [] : await store.list();
    const machine = normalizationMachine(input, calibration);
    const context: BenchmarkNormalizationContext = {
        mode: input.benchmarkPurpose,
        profile: input.request.profile,
        machine,
        references: references
            .filter(function matchingReference(entry) {
                return entry.profile === input.request.profile && entry.snapshot.machineClass === machine.machineClass;
            })
            .map(function snapshot(entry) {
                return entry.snapshot;
            }),
        saved: await readSavedCalibrationReferences({
            profile: input.profile,
            profileName: input.request.profile,
            machineClass: machine.machineClass,
            projectRoot: input.projectRoot,
            purpose: input.benchmarkPurpose
        })
    };
    return {
        context,
        capture: input.benchmarkPurpose === 'capture'
            ? createCalibrationCaptureSession({
                store,
                profile: input.request.profile,
                maxBytes: storeInput.maxBytes,
                dependencies
            })
            : null,
        maintain(baseline) {
            return calibrationMaintenanceSession({
                input: { ...input, benchmarkNormalization: context },
                references,
                store,
                baseline,
                dependencies
            });
        }
    };
}
