import type { Engine } from '../engine/engine.ts';
import type { BoundFamilySettings } from '../engine/test-family.ts';
import type { PreparedFamilyRun, CollectedFamilyRun } from '../engine/family-run.ts';
import type { TestPlan } from '../engine/test-plan.ts';

export type RunnerFamilyPreparation = {
    readonly engine: Engine;
    readonly prepared: PreparedFamilyRun;
    readonly sourcePlan: TestPlan;
    readonly binding: BoundFamilySettings;
    readonly projectRoot: string;
    readonly signal: AbortSignal;
};
export type LocalFamilyRunPlan = {
    readonly kind: 'local';
    readonly testPlan: TestPlan;
    readonly family: { readonly preparation: RunnerFamilyPreparation; readonly collected: CollectedFamilyRun; };
};
