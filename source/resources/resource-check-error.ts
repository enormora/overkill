import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';

type ResourceCheckErrorOptions = {
    readonly resourceChecks: readonly ResourceCheckSnapshot[];
    readonly errors: readonly unknown[];
};
export class ResourceCheckError extends AggregateError {
    private readonly snapshots: readonly ResourceCheckSnapshot[];
    public constructor(message: string, options: ResourceCheckErrorOptions) {
        // eslint-disable-next-line unicorn/custom-error-definition -- AggregateError takes errors before its message.
        super(options.errors, message);
        this.name = 'ResourceCheckError';
        this.snapshots = options.resourceChecks;
    }

    public resourceChecks(): readonly ResourceCheckSnapshot[] {
        return this.snapshots;
    }
}
