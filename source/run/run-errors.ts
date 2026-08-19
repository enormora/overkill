import type { RunnerError } from '../engine/run-result.ts';

export type RunResolutionErrorCode = 'invalid-request' | 'no-tests-collected' | 'unsupported-request';

export class RunResolutionError extends Error {
    private readonly errorCode: RunResolutionErrorCode;

    public constructor(message: string, options: Readonly<ErrorOptions> | undefined, code: RunResolutionErrorCode) {
        super(message, options);
        this.name = 'RunResolutionError';
        this.errorCode = code;
    }

    public code(): RunResolutionErrorCode {
        return this.errorCode;
    }
}

export class RunCollectionError extends Error {
    private readonly errorSubtype: RunnerError['subtype'];

    public constructor(message: string, options: Readonly<ErrorOptions>, subtype: RunnerError['subtype']) {
        super(message, options);
        this.name = 'RunCollectionError';
        this.errorSubtype = subtype;
    }

    public runnerError(): RunnerError {
        return {
            attributedTo: null,
            cause: this.cause,
            message: this.message,
            subtype: this.errorSubtype
        };
    }
}

export function unsupportedRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'unsupported-request');
}

export function invalidRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'invalid-request');
}

export function noTestsCollected(message: string): never {
    throw new RunResolutionError(message, undefined, 'no-tests-collected');
}
