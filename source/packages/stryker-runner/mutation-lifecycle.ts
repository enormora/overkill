import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import type { JsonValue } from 'type-fest';
import { workIdentityKey, type RunExecutionLifecycle } from '../run/run.entry-point.ts';
import {
    canonicalWork,
    exactMutationSelection,
    eligibleMutationCatalog,
    mutationCatalogSchema,
    mutationLifecycleDataSchema,
    type MutationCatalog
} from './mutation-catalog.ts';
import { safeMutationFailure } from './mutation-results.ts';
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

export async function createMutationLifecycle(data: JsonValue): Promise<RunExecutionLifecycle> {
    const input = mutationLifecycleInputSchema.parse(data);
    const instrumentation = createInvocationInstrumentation();
    let catalog: MutationCatalog = [];
    let selected: readonly string[] = [];
    const completed = new Set<string>();
    let bailed = false;

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
            catalog = eligibleMutationCatalog(input.root, plan, input.files);
            if (input.baseline !== null && !isDeepStrictEqual(catalog, input.baseline)) {
                throw new Error('Eligible test catalog changed under mutation.');
            }
            selected = input.selected ?? catalog.map(function testIdentity(entry) {
                return entry.id;
            });
            return exactMutationSelection(input.root, plan, selected);
        },
        async beforeCases() {
            if (input.mode === 'runtime') {
                activate();
            }
        },
        async enterCase(work) {
            if (instrumentation.context.currentTestId !== undefined) {
                throw new Error('Mutation execution requires exclusive serial case admission.');
            }
            instrumentation.context.currentTestId = workIdentityKey(canonicalWork(input.root, work));
        },
        async completeCase(result, errors) {
            delete instrumentation.context.currentTestId;
            const id = workIdentityKey(canonicalWork(input.root, result.workId));
            if (completed.has(id)) {
                throw new Error('Duplicate mutation case completion.');
            }
            completed.add(id);
            const stop = input.mode !== 'dry' && !input.disableBail && safeMutationFailure(input.root, result, errors);
            if (stop) {
                bailed = true;
            }
            return stop ? 'stop' : 'continue';
        },
        snapshot() {
            return mutationLifecycleDataSchema.parse({
                catalog,
                coverage: structuredClone(instrumentation.context.mutantCoverage),
                hitLimitExceeded: input.hitLimit !== null && (instrumentation.context.hitCount ?? 0) > input.hitLimit,
                selected,
                completed: Array.from(completed),
                bailed
            });
        },
        async dispose() {
            instrumentation.dispose();
        }
    };
}
