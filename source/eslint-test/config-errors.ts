import { ResourceLifecycleError } from '../packages/resources/resources.entry-point.ts';
import { observeRule } from './rule-observation.ts';

type ConfigExecutionErrorOptions = Readonly<ErrorOptions> & { readonly originalStack: string | null; };
class ConfigExecutionError extends Error {
    public constructor(message: string, options: ConfigExecutionErrorOptions) {
        super(message, options);
        this.name = 'ConfigExecutionError';
        if (options.originalStack !== null) {
            this.stack = options.originalStack;
        }
    }
}

export function propagateConfigControls(error: unknown, signal: AbortSignal): void {
    const pending = [ error ];
    const seen = new Set<unknown>();
    while (pending.length > 0) {
        const current = pending.pop();
        if (!seen.has(current)) {
            seen.add(current);
            observeRule(function failed() {
                throw current;
            }, signal);
            if (current instanceof ResourceLifecycleError) {
                pending.push(
                    ...current.failures().map(function cause(failure) {
                        return failure.cause;
                    })
                );
            } else if (current instanceof Error && current.cause !== undefined) {
                pending.push(current.cause);
            }
        }
    }
}

export function projectFailure(error: unknown, root: string, signal: AbortSignal): unknown {
    propagateConfigControls(error, signal);
    return error instanceof Error
        ? new ConfigExecutionError(error.message.replaceAll(root, '<project>'), {
            originalStack: error.stack === undefined ? null : error.stack.replaceAll(root, '<project>')
        })
        : error;
}
