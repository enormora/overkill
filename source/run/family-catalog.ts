import type { TestPlan } from '../engine/test-plan.ts';
import type { FamilyRunFacts, FamilyPreparationFacts } from '../engine/family-run.ts';
import type { BuiltinFamilyId } from '../engine/builtin-test-families.ts';
import type { WorkId } from '../engine/identity.ts';
import type { FamilyModuleReference, FamilyValue } from '../engine/test-family.ts';

type BuiltinFamilySource = { readonly kind: 'builtin'; readonly id: BuiltinFamilyId; };
type ConfigFamilySource = { readonly kind: 'config-file'; readonly configPath: string; readonly profile: string; };
type ModuleFamilySource = { readonly kind: 'module'; readonly module: FamilyModuleReference; };
export type FamilyResolutionSource = BuiltinFamilySource | ConfigFamilySource | ModuleFamilySource;

export type FrozenFamilyDefinition = {
    readonly projectRoot: string;
    readonly definitionLocationCapture: 'disabled' | 'enabled';
    readonly processModel: 'in-process' | 'supervised-process' | 'worker-pool';
    readonly selection: readonly WorkId[] | null;
    readonly checkpoint: { readonly preparation: FamilyPreparationFacts; readonly catalog: FamilyValue; } | null;
    readonly source: FamilyResolutionSource;
    readonly id: string;
    readonly version: string;
    readonly settings: FamilyValue;
};

export type CollectedFamilyMetadata = {
    readonly definition: FrozenFamilyDefinition;
    readonly facts: FamilyRunFacts;
};
const metadata = new WeakMap<TestPlan, CollectedFamilyMetadata>();
export function setFamilyCatalog(plan: TestPlan, family: CollectedFamilyMetadata): void {
    metadata.set(plan, family);
}
export function familyCatalog(plan: TestPlan): CollectedFamilyMetadata | null {
    return metadata.get(plan) ?? null;
}
