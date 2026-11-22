import type { TestContractFailure } from './run-result.ts';

const requireFailedSignal = Symbol.for('@overkill-dev/engine/RequireFailedSignal/v1');
const testContractSignal = Symbol.for('@overkill-dev/engine/TestContractSignal/v1');

export function isRequireFailedSignalError(value: unknown): value is RequireFailedSignalError {
    return typeof value === 'object' && value !== null && Reflect.get(value, requireFailedSignal) === true;
}

export function isTestContractSignalError(value: unknown): value is TestContractSignalError {
    return typeof value === 'object' && value !== null && Reflect.get(value, testContractSignal) === true &&
        typeof Reflect.get(value, 'failure') === 'function';
}

export class RequireFailedSignalError extends Error {
    public constructor() {
        super('Requirement failed.');
        this.name = 'RequireFailedSignalError';
        Object.defineProperty(this, requireFailedSignal, { value: true });
    }
}

export class TestContractSignalError extends Error {
    private readonly contractFailure: TestContractFailure;

    public constructor(failure: TestContractFailure, options: Readonly<ErrorOptions> | undefined) {
        super(failure.summary, options);
        this.name = 'TestContractSignalError';
        Object.defineProperty(this, testContractSignal, { value: true });
        this.contractFailure = failure;
    }

    public failure(): TestContractFailure {
        return this.contractFailure;
    }
}
