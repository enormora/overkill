import { createHistory } from './history.ts';
import type { HistoryOptions } from './history-types.ts';
import { HistoryMaintenanceDeferredError, withinHistoryMaintenanceBudget } from './history-maintenance-budget.ts';

export async function maintainHistory(options: HistoryOptions): Promise<readonly string[]> {
    const budget = options.config.history.automaticMaintenanceBudgetMilliseconds;
    if (budget === 0) {
        return [];
    }
    try {
        return await withinHistoryMaintenanceBudget(budget, async function pruneCompletedHistory() {
            const result = await createHistory(options).prune({ dryRun: false });
            return result.diagnostics;
        });
    } catch (error: unknown) {
        if (error instanceof HistoryMaintenanceDeferredError) {
            return [];
        }
        return [ `History maintenance failed: ${error instanceof Error ? error.message : String(error)}` ];
    }
}
