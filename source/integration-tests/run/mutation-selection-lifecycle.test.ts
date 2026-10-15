import type { JsonValue } from 'type-fest';
import { parseRunSelection, type RunExecutionLifecycle } from '../../packages/run/run.entry-point.ts';

export const mutationSelectionLifecycleUrl = import.meta.url;
export async function createMutationSelectionLifecycle(data: JsonValue): Promise<RunExecutionLifecycle> {
    const selection = parseRunSelection(data);
    return {
        async select() {
            return selection;
        },
        async beforeCases() {
            return undefined;
        },
        async enterCase() {
            return undefined;
        },
        async completeCase() {
            return 'continue';
        },
        snapshot() {
            return null;
        },
        async dispose() {
            return undefined;
        }
    };
}
