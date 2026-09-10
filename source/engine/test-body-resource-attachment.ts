import type { TestBody } from './test-node.ts';

const resourceAttachedTestBodyBrand = Symbol.for('@overkill-dev/engine/ResourceAttachedTestBody');

export type ResourceAttachedTestBody<Body> = Body & {
    readonly [resourceAttachedTestBodyBrand]: true;
};

export type ResourceFreeTestBody<Body> = Body & {
    readonly [resourceAttachedTestBodyBrand]?: never;
};

export function markResourceAttachedTestBody<Scope>(
    body: (scope: Scope) => ReturnType<TestBody>
): ResourceAttachedTestBody<(scope: Scope) => ReturnType<TestBody>> {
    return Object.assign(body, { [resourceAttachedTestBodyBrand]: true as const });
}

export function isResourceAttachedTestBody(value: unknown): value is ResourceAttachedTestBody<TestBody> {
    return typeof value === 'function' && Object.hasOwn(value, resourceAttachedTestBodyBrand);
}
