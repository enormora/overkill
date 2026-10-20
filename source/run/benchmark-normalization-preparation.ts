import { randomUUID } from 'node:crypto';
import { createCalibrationReferenceStore } from '../baselines/calibration-store.ts';
import type { BenchmarkNormalizationContext } from '../engine/benchmark-result.ts';
import { benchmarkNormalizationMachine } from './benchmark-calibration.ts';
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
    const machine = benchmarkNormalizationMachine(input.profile.execution, calibration);
    const context: BenchmarkNormalizationContext = {
        executionId: randomUUID(),
        mode: input.benchmarkPurpose,
        profile: input.request.profile,
        machine,
        references: references
            .filter(function matchingReference(entry) {
                return entry.profile === input.request.profile;
            })
            .map(function snapshot(entry) {
                return entry.snapshot;
            }),
        saved: await readSavedCalibrationReferences({
            profile: input.profile,
            profileName: input.request.profile,
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
