import { z } from 'zod/v4';
import type { JsonValue } from 'type-fest';
import {
    workIdentityKey,
    type CollectedRunPlan,
    type PerTestResult,
    type RunExecutionLifecycle,
    type RunSelection
} from '../run/run.entry-point.ts';
import {
    canonicalWork,
    exactMutationSelection,
    eligibleMutationCatalog,
    hasRunnableMutationSelection,
    mutationCatalogSchema,
    mutationLifecycleDataSchema,
    sameMutationCatalog,
    type MutationCatalog
} from './mutation-catalog.ts';
import { createMutationDiagnostics } from './mutation-diagnostics.ts';
import { mutationCaseMatchesCatalog } from './mutation-observation.ts';
import { createInvocationInstrumentation } from './instrumentation-context.entry-point.ts';

export const mutationLifecycleUrl = import.meta.url;

export const mutationLifecycleInputSchema = z.strictObject({
    root: z.string(),
    mode: z.enum([ 'dry', 'runtime', 'static' ]),
    activeMutant: z.string().nullable(),
    hitLimit: z.number().nonnegative().nullable(),
    baseline: mutationCatalogSchema.nullable(),
    selected: z.array(z.string()).nullable(),
    disableBail: z.boolean(),
    files: z.array(z.string()).nullable()
});

type MutationLifecycleInput = Readonly<z.output<typeof mutationLifecycleInputSchema>>;
type MutationCaseSelection = {
    readonly catalog: MutationCatalog;
    readonly selected: readonly string[];
    readonly ids: ReadonlySet<string>;
    readonly byId: ReadonlyMap<string, MutationCatalog[number]>;
    readonly filter: RunSelection;
};
type MutationAdmission = {
    readonly active: Readonly<Set<string>>;
    readonly completed: Readonly<Set<string>>;
};

function validateSelectedCases(
    input: MutationLifecycleInput,
    catalog: MutationCatalog,
    selected: readonly string[],
    byId: ReadonlyMap<string, MutationCatalog[number]>
): void {
    if (
        selected.some(function ineligibleCase(id) {
            return !byId.has(id);
        })
    ) {
        throw new Error('Stryker requested an unknown test identity.');
    }
    if (input.mode !== 'dry' && !hasRunnableMutationSelection(catalog, selected)) {
        throw new Error('Stryker requested a mutant selection with no runnable tests.');
    }
}

function selectMutationCases(input: MutationLifecycleInput, plan: CollectedRunPlan): MutationCaseSelection {
    const catalog = eligibleMutationCatalog(input.root, plan, input.files);
    if (input.baseline !== null && !sameMutationCatalog(catalog, input.baseline)) {
        throw new Error('Eligible test catalog changed under mutation.');
    }
    const selected = input.selected ?? catalog.map(function testIdentity(entry) {
        return entry.id;
    });
    const byId = new Map(catalog.map(function catalogEntry(entry) {
        return [ entry.id, entry ];
    }));
    validateSelectedCases(input, catalog, selected, byId);
    return {
        catalog,
        selected,
        ids: new Set(selected),
        byId,
        filter: exactMutationSelection(input.root, plan, selected)
    };
}

function admitMutationCase(
    selection: MutationCaseSelection | null,
    admission: MutationAdmission,
    id: string
): void {
    if (admission.active.size > 0) {
        throw new Error('Mutation execution requires exclusive serial case admission.');
    }
    if (selection === null || !selection.ids.has(id) || admission.completed.has(id)) {
        throw new Error('Mutation execution admitted an unselected or repeated test.');
    }
    admission.active.add(id);
}

function recordMutationCompletion(
    root: string,
    selection: MutationCaseSelection | null,
    admission: MutationAdmission,
    result: PerTestResult
): void {
    const id = workIdentityKey(canonicalWork(root, result.workId));
    if (selection === null || !admission.active.has(id) || admission.completed.has(id)) {
        throw new Error('Mutation case completion does not match its active admission.');
    }
    admission.active.delete(id);
    if (!mutationCaseMatchesCatalog(root, result, selection.byId)) {
        throw new Error('Mutant execution changed intentional skip state or test identity.');
    }
    admission.completed.add(id);
}

export async function createMutationLifecycle(data: JsonValue): Promise<RunExecutionLifecycle> {
    const input = mutationLifecycleInputSchema.parse(data);
    const instrumentation = createInvocationInstrumentation();
    let selection: MutationCaseSelection | null = null;
    let bailed = false;
    const diagnostics = createMutationDiagnostics(input.root);
    const admission: MutationAdmission = {
        active: new Set(),
        completed: new Set()
    };
    function activate(): void {
        if (input.activeMutant !== null) {
            instrumentation.activate(input.activeMutant, input.hitLimit);
        }
    }
    if (input.mode === 'static') {
        activate();
    }
    return {
        async select(plan) {
            selection = selectMutationCases(input, plan);
            return selection.filter;
        },
        async beforeCases() {
            if (input.mode === 'runtime') {
                activate();
            }
        },
        async enterCase(work) {
            if (bailed || instrumentation.context.currentTestId !== undefined) {
                throw new Error('Mutation execution requires exclusive serial case admission.');
            }
            const id = workIdentityKey(canonicalWork(input.root, work));
            admitMutationCase(selection, admission, id);
            instrumentation.context.currentTestId = id;
        },
        async completeCase(result, errors) {
            delete instrumentation.context.currentTestId;
            recordMutationCompletion(input.root, selection, admission, result);
            const classification = diagnostics.record(
                result,
                errors,
                input.hitLimit !== null && (instrumentation.context.hitCount ?? 0) > input.hitLimit
            );
            const stop = input.mode !== 'dry' && !input.disableBail && classification.kind === 'killed';
            bailed = stop;
            return stop ? 'stop' : 'continue';
        },
        snapshot() {
            const collected = selection ?? { catalog: [], selected: [] };
            return mutationLifecycleDataSchema.parse({
                ...diagnostics.snapshot(),
                catalog: collected.catalog,
                coverage: structuredClone(instrumentation.context.mutantCoverage),
                hitLimitExceeded: input.hitLimit !== null && (instrumentation.context.hitCount ?? 0) > input.hitLimit,
                selected: collected.selected,
                completed: Array.from(admission.completed),
                bailed
            });
        },
        async dispose() {
            instrumentation.dispose();
        }
    };
}
