import type { RunFacts } from '../engine/reporter.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string | null {
    const field = value[key];

    return typeof field === 'string' ? field : null;
}

export function formatRunFactSummary(facts: RunFacts): string | null {
    const { execution, reproducibility } = facts;

    if (!isRecord(execution) || !isRecord(reproducibility)) {
        return null;
    }

    const order = stringField(execution, 'order');
    const seed = stringField(reproducibility, 'seed');

    if (order === null || seed === null) {
        return null;
    }

    return `order=${order} seed=${seed}`;
}
