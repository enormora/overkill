import { AsyncLocalStorage } from 'node:async_hooks';

type MaintenanceBudget = {
    readonly deadline: number;
    readonly diagnostics: () => readonly string[];
    readonly recordDiagnostic: (message: string) => void;
};
const deadlines = new AsyncLocalStorage<MaintenanceBudget>();

export class HistoryMaintenanceDeferredError extends Error {
    public constructor() {
        super('History maintenance was deferred.');
        this.name = 'HistoryMaintenanceDeferredError';
    }
}

export function historyMaintenanceDeadline(): number {
    return deadlines.getStore()?.deadline ?? Number.POSITIVE_INFINITY;
}

export function historyMaintenanceDiagnostics(): readonly string[] {
    return deadlines.getStore()?.diagnostics() ?? [];
}

export function recordHistoryMaintenanceDiagnostic(message: string): void {
    deadlines.getStore()?.recordDiagnostic(message);
}

export function checkHistoryMaintenanceBudget(): void {
    if (performance.now() >= historyMaintenanceDeadline()) {
        throw new HistoryMaintenanceDeferredError();
    }
}

export async function withinHistoryMaintenanceBudget<T>(milliseconds: number, operation: () => Promise<T>): Promise<T> {
    const messages = new Set<string>();
    return await deadlines.run({
        deadline: performance.now() + milliseconds,
        diagnostics() {
            return Array.from(messages);
        },
        recordDiagnostic(message) {
            messages.add(message);
        }
    }, operation);
}
