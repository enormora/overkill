import { TestContractSignalError } from './assertion-control-error.ts';
import type { ExecutedBody } from './body-result.ts';

export function propertyObservationContractFailure(summary: string): never {
    throw new TestContractSignalError({
        kind: 'test-contract',
        code: 'property-observation',
        summary,
        actual: summary,
        expected: 'finite scores and valid labels within an active property trial'
    }, undefined);
}

export function propertyScopeContractFailure(summary: string): never {
    throw new TestContractSignalError({
        kind: 'test-contract',
        code: 'property-scope',
        summary,
        actual: summary,
        expected: 'one awaited property invocation at a time in an active case'
    }, undefined);
}

const propertyTermination = Symbol.for('@overkill-dev/engine/PropertyTermination/v1');

type PropertyTermination = Readonly<Error> & { readonly [propertyTermination]: true; readonly result: ExecutedBody; };

export function stopPropertyExecution(result: ExecutedBody): never {
    const termination = Object.assign(new Error('Property execution terminated.'), {
        [propertyTermination]: true as const,
        result
    });
    throw termination;
}

export function isPropertyTermination(value: unknown): value is PropertyTermination {
    return typeof value === 'object' && value !== null && Reflect.get(value, propertyTermination) === true;
}
