export type ResourceLifecyclePhase = 'acquire' | 'dispose' | 'graph';

export type ResourceLifecycleFailure = {
    readonly cause: unknown;
    readonly phase: ResourceLifecyclePhase;
    readonly resourceName: string;
};

type ResourceLifecycleErrorOptions = {
    readonly cause: unknown;
    readonly failures: readonly ResourceLifecycleFailure[];
};

export class ResourceLifecycleError extends Error {
    private readonly lifecycleFailures: readonly ResourceLifecycleFailure[];

    public constructor(
        message: string,
        options: ResourceLifecycleErrorOptions
    ) {
        super(message, options);
        this.name = 'ResourceLifecycleError';
        this.lifecycleFailures = options.failures;
    }

    public failures(): readonly ResourceLifecycleFailure[] {
        return this.lifecycleFailures;
    }
}

export function resourceLifecycleError(
    message: string,
    failures: readonly ResourceLifecycleFailure[],
    cause: unknown
): ResourceLifecycleError {
    return new ResourceLifecycleError(message, { cause, failures });
}

function lifecycleFailuresFrom(reason: unknown, fallbackResourceName: string): readonly ResourceLifecycleFailure[] {
    if (reason instanceof ResourceLifecycleError) {
        return reason.failures();
    }

    return [ { cause: reason, phase: 'acquire', resourceName: fallbackResourceName } ];
}

export function lifecycleFailures(
    results: readonly PromiseSettledResult<unknown>[],
    fallbackResourceName: string
): readonly ResourceLifecycleFailure[] {
    const failures = new Set<ResourceLifecycleFailure>();

    for (const result of results) {
        if (result.status === 'rejected') {
            for (const failure of lifecycleFailuresFrom(result.reason, fallbackResourceName)) {
                failures.add(failure);
            }
        }
    }

    return Array.from(failures);
}
