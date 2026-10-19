import { z } from 'zod/v4';

const configurationLoadingFailureSchema = z.object({
    kind: z.literal('configuration-loading'),
    failure: z.object({ kind: z.literal('config-error'), name: z.literal('ConfigError'), cause: z.unknown() })
});

export function hitLimitGuardMessage(message: string): boolean {
    return /^Stryker: Hit count limit reached \(\d+\)$/u.test(message);
}

export function isHitLimitGuard(error: unknown): boolean {
    return error instanceof Error && error.name === 'Error' && hitLimitGuardMessage(error.message) &&
        error.cause === undefined;
}

function isConfigurationLoadingGuard(error: unknown): boolean {
    const parsed = configurationLoadingFailureSchema.safeParse(error);
    return parsed.success && isHitLimitGuard(parsed.data.failure.cause);
}

function isRevalidationGuard(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('Frozen policy revalidation failed: ') &&
        isConfigurationLoadingGuard(error.cause);
}

export function isWrappedHitLimitGuard(error: unknown): boolean {
    if (isConfigurationLoadingGuard(error) || isRevalidationGuard(error) || isHitLimitGuard(error)) {
        return true;
    }
    return error instanceof Error && [ 'ConfigError', 'RunResolutionError' ].includes(error.name) &&
        isHitLimitGuard(error.cause);
}
