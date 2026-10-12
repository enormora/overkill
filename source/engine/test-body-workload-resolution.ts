import type { WorkloadInput } from './workload-input.ts';

const workloadResolverBrand = Symbol.for('@overkill-dev/engine/TestBodyWorkloadResolver');

type WorkloadResolvedBody<Body> = Body & {
    readonly [workloadResolverBrand]: (workload: WorkloadInput | null) => Body;
};

function hasWorkloadResolver<Body>(body: Body): body is WorkloadResolvedBody<Body> {
    return typeof body === 'function' && Object.hasOwn(body, workloadResolverBrand);
}

export function attachTestBodyWorkloadResolver<Body>(
    body: Body,
    resolve: (workload: WorkloadInput | null) => Body
): Body {
    Object.defineProperty(body, workloadResolverBrand, { value: resolve });
    return body;
}

export function resolveTestBodyWorkload<Body>(body: Body, workload: WorkloadInput | null): Body {
    return hasWorkloadResolver(body) ? body[workloadResolverBrand](workload) : body;
}

export function forwardTestBodyResources<Scope, Result>(
    source: (scope: Scope) => Result,
    forward: (body: (scope: Scope) => Result) => (scope: Scope) => Result
): (scope: Scope) => Result {
    const body = forward(source);
    for (const symbol of Object.getOwnPropertySymbols(source)) {
        const descriptor = Object.getOwnPropertyDescriptor(source, symbol);
        if (symbol !== workloadResolverBrand && descriptor !== undefined) {
            Object.defineProperty(body, symbol, descriptor);
        }
    }
    if (hasWorkloadResolver(source)) {
        attachTestBodyWorkloadResolver(body, function resolveForwardedBody(workload) {
            return forwardTestBodyResources(resolveTestBodyWorkload(source, workload), forward);
        });
    }
    return body;
}
