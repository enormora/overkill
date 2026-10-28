import type { AssertAssertionNode, AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { ExecutedBody } from './body-result.ts';
import type { WorkId } from './identity.ts';
import type { PropertyPolicy } from './property-node.ts';
import type { TestBody, TestScope } from './test-scope.ts';

const propertyHost = Symbol.for('@overkill-dev/engine/PropertyExecutionHost/v1');
const propertyTermination = Symbol.for('@overkill-dev/engine/PropertyTermination/v1');

export type PropertyTrialResult = {
    readonly kind: 'assertion-failed';
    readonly assertion: AssertAssertionNode;
    readonly result: ExecutedBody;
} | {
    readonly kind: 'passed';
} | {
    readonly kind: 'terminated';
    readonly result: ExecutedBody;
};

export type PropertyRunContext = { readonly seed: bigint; readonly projectRoot: string | null; };

export type PropertyExecutionHost = PropertyRunContext & {
    readonly scope: TestScope;
    readonly policy: PropertyPolicy;
    readonly workId: WorkId;
    readonly evaluateTrial: (body: TestBody, signal: AbortSignal) => Promise<PropertyTrialResult>;
    readonly recordBoundary: (
        evaluate: () => Promise<AssertAssertionNode>,
        signal: AbortSignal
    ) => Promise<AssertionResult>;
};

type PropertyScope = TestScope & { readonly [propertyHost]: PropertyExecutionHost; };
type PropertyTermination = Readonly<Error> & { readonly [propertyTermination]: true; readonly result: ExecutedBody; };

export function propertyScope(scope: TestScope, host: PropertyExecutionHost): TestScope {
    const injected: PropertyScope = { ...scope, [propertyHost]: host };
    return injected;
}

function hasPropertyHost(scope: Pick<TestScope, 'cleanup' | 'signal'>): scope is PropertyScope {
    return Object.hasOwn(scope, propertyHost);
}

export function readPropertyExecutionHost(scope: Pick<TestScope, 'cleanup' | 'signal'>): PropertyExecutionHost {
    if (!hasPropertyHost(scope)) {
        throw new TypeError('Property execution requires an engine property scope and resolved collection policy.');
    }
    return scope[propertyHost];
}

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
