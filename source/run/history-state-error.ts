import { RunCollectionError } from './run-errors.ts';

export function historyStateError(cause: unknown): RunCollectionError {
    if (cause instanceof RunCollectionError) {
        return cause;
    }
    return new RunCollectionError(
        'History state is unavailable. Run overkill history compact to repair it.',
        { cause },
        'runtime-state'
    );
}

export class UnsupportedHistoryVersionError extends RunCollectionError {
    public constructor(version: number, options: Readonly<ErrorOptions>) {
        super(
            `Unsupported history schema version ${version}. Use a compatible Overkill version.`,
            options,
            'runtime-state'
        );
        this.name = 'UnsupportedHistoryVersionError';
    }
}

function parsedSchemaVersion(value: unknown): number | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const version: unknown = Reflect.get(value, 'version');
    return typeof version === 'number' ? version : null;
}

export function historySchemaVersion(source: string): number | null {
    try {
        return parsedSchemaVersion(JSON.parse(source));
    } catch {
        return null;
    }
}

export function assertSupportedHistoryVersion(source: string, maximum: number): void {
    const version = historySchemaVersion(source);
    if (version !== null && version > maximum) {
        throw new UnsupportedHistoryVersionError(version, { cause: null });
    }
}
