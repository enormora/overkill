import {
    disposePreparedFamily,
    type CollectedFamilyRun,
    type PreparedFamilyRun
} from '../engine/family-run.ts';
import { prepareDefinedFamily, type Engine } from '../engine/engine.ts';
import { familySettings, type ProfileConfig } from '../config/types.ts';
import { builtinTestFamily } from '../engine/builtin-test-families.ts';
import { bindFamilySettings, type BoundFamilySettings } from '../engine/test-family.ts';
import { preparedFamilyMetadata, selectedPreparedPlan } from './prepared-family-plan.ts';
import { validateRecordedFamilyFacts } from './replay-family-validation.ts';
import type { LocalFamilyRunPlan, RunnerFamilyPreparation } from './family-profile-types.ts';
import type {
    ResolvedRun,
    ResolvedRunPlan
} from './run-types.ts';
import { RunCollectionError } from './run-errors.ts';

export function isFamilyPlan(plan: ResolvedRunPlan): plan is LocalFamilyRunPlan {
    return Object.hasOwn(plan, 'family');
}

export function isAnalysisFamilyPlan(plan: ResolvedRunPlan): plan is LocalFamilyRunPlan {
    return isFamilyPlan(plan) && plan.family.preparation.binding.testFamily.features.execution === 'analysis';
}

type TestPlan = RunnerFamilyPreparation['sourcePlan'];

type FamilyPreparationContext = { readonly projectRoot: string; readonly signal: AbortSignal; };

async function withFamilySetupDiagnostics<Value>(operation: () => Promise<Value>): Promise<Value> {
    try {
        return await operation();
    } catch (error: unknown) {
        throw new RunCollectionError(
            error instanceof Error ? error.message : String(error),
            { cause: error },
            'loader'
        );
    }
}

async function prepareFamilyBinding(
    engine: Engine,
    testPlan: TestPlan,
    binding: BoundFamilySettings,
    context: FamilyPreparationContext
): Promise<RunnerFamilyPreparation> {
    const { projectRoot, signal } = context;
    const prepared = await withFamilySetupDiagnostics(async function prepareBackend(): Promise<PreparedFamilyRun> {
        return await prepareDefinedFamily(engine, {
            testPlan,
            testFamily: binding.testFamily,
            binding,
            projectRoot,
            signal
        });
    });
    return { engine, prepared, sourcePlan: testPlan, binding, projectRoot, signal, definition: null };
}

export async function prepareProfileFamily(
    engine: Engine,
    testPlan: TestPlan,
    profile: ProfileConfig,
    context: FamilyPreparationContext
): Promise<RunnerFamilyPreparation> {
    const binding = typeof profile.testFamily === 'string'
        ? bindFamilySettings(builtinTestFamily(profile.testFamily), null)
        : profile[familySettings];
    return await prepareFamilyBinding(engine, testPlan, binding, context);
}

async function collectSelectedFamily(preparation: RunnerFamilyPreparation, run: ResolvedRun): Promise<ResolvedRun> {
    if (run.plan.kind !== 'local') {
        const facts = { ...preparation.prepared.facts, collection: null };
        validateRecordedFamilyFacts(facts);
        await disposePreparedFamily(preparation.prepared);
        return {
            ...run,
            facts: { ...run.facts, family: facts },
            plan: {
                ...run.plan,
                collectedPlan: { ...run.plan.collectedPlan, family: preparedFamilyMetadata(preparation, facts) }
            }
        };
    }
    const { testPlan } = run.plan;
    const collected = await withFamilySetupDiagnostics(async function collectBackend(): Promise<CollectedFamilyRun> {
        return await preparation.prepared.collect({
            workIds: testPlan.cases.map(function identity(testCase) {
                return testCase.workId;
            }),
            signal: preparation.signal
        });
    });
    validateRecordedFamilyFacts(collected.facts);
    const plan: LocalFamilyRunPlan = { ...run.plan, family: { preparation, collected } };
    return { ...run, facts: { ...run.facts, family: collected.facts }, plan };
}

async function preparationCleanup(prepared: PreparedFamilyRun): Promise<readonly unknown[]> {
    try {
        await disposePreparedFamily(prepared);
        return [];
    } catch (error: unknown) {
        return [ error ];
    }
}

async function rejectWithPreparation(error: unknown, preparation: RunnerFamilyPreparation): Promise<never> {
    const cleanup = await preparationCleanup(preparation.prepared);
    if (cleanup.length > 0) {
        throw new AggregateError([ error, ...cleanup ], 'Family setup and cleanup failed.', { cause: error });
    }
    throw error;
}

export async function observeResolvedFamily<Value>(
    run: ResolvedRun,
    operation: () => Promise<Value>
): Promise<Value> {
    try {
        return await operation();
    } catch (error: unknown) {
        if (isFamilyPlan(run.plan)) {
            return await rejectWithPreparation(error, run.plan.family.preparation);
        }
        throw error;
    }
}

export async function resolveFamilyRun(
    preparation: RunnerFamilyPreparation,
    resolve: () => Promise<ResolvedRun>
): Promise<ResolvedRun> {
    async function resolveAndCollect(): Promise<ResolvedRun> {
        return await collectSelectedFamily(preparation, await resolve());
    }
    try {
        return await resolveAndCollect();
    } catch (error: unknown) {
        return await rejectWithPreparation(error, preparation);
    }
}

export async function recollectProfileFamily(
    previous: RunnerFamilyPreparation,
    selection: TestPlan,
    resolve: (plan: TestPlan) => ResolvedRun
): Promise<ResolvedRun> {
    const { signal } = new AbortController();
    const fresh = await prepareFamilyBinding(previous.engine, previous.sourcePlan, previous.binding, {
        projectRoot: previous.projectRoot,
        signal
    });
    return await resolveFamilyRun(
        { ...fresh, definition: previous.definition },
        async function selectFreshPreparation() {
            return resolve(selectedPreparedPlan(fresh.prepared, selection));
        }
    );
}

export async function disposeResolvedFamily(run: ResolvedRun): Promise<void> {
    if (isFamilyPlan(run.plan)) {
        await disposePreparedFamily(run.plan.family.preparation.prepared);
    }
}
