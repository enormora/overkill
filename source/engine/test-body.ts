import {
    isPropertyBodyDefinition,
    type PropertyBodyDefinition,
    type PropertyPolicyResolution
} from './property-node.ts';
import type { TestFamily } from './test-data.ts';
import type { WorkloadInput } from './workload-input.ts';

const testBodyFamilyBrand = Symbol.for('@overkill-dev/engine/TestBodyFamily');

export type TestBodyFamilyAttachment<Definition> = {
    readonly family: TestFamily;
    readonly definition: Definition;
};

type FamilyAttachedBody<Body, Definition> = Body & {
    readonly [testBodyFamilyBrand]: TestBodyFamilyAttachment<Definition>;
};

function hasTestBodyFamily(value: unknown): value is FamilyAttachedBody<unknown, unknown> {
    return typeof value === 'function' && Object.hasOwn(value, testBodyFamilyBrand);
}

export function readTestBodyFamily(value: unknown): TestBodyFamilyAttachment<unknown> | null {
    return hasTestBodyFamily(value) ? value[testBodyFamilyBrand] : null;
}

export function attachTestBodyFamily<Body extends (scope: never) => unknown, Definition>(
    body: Body,
    attachment: TestBodyFamilyAttachment<Definition>
): FamilyAttachedBody<Body, Definition> {
    if (typeof body !== 'function') {
        throw new TypeError('Test body family metadata requires a body function.');
    }
    if (hasTestBodyFamily(body)) {
        throw new TypeError('Test body already has family metadata.');
    }
    return Object.assign(body, { [testBodyFamilyBrand]: Object.freeze({ ...attachment }) });
}

export function forwardTestBodyFamily<Body extends (scope: never) => unknown>(
    source: unknown,
    body: Body
): Body {
    const attachment = readTestBodyFamily(source);
    if (attachment === null) {
        return body;
    }
    const existing = readTestBodyFamily(body);
    if (existing === null) {
        attachTestBodyFamily(body, attachment);
    } else if (existing.family !== attachment.family || existing.definition !== attachment.definition) {
        throw new TypeError('Cannot replace test body family metadata.');
    }
    return body;
}

export function resolveTestBodyFamily(body: unknown, family: TestFamily | null): TestFamily | null {
    const attachment = readTestBodyFamily(body);
    if (attachment === null) {
        return family;
    }
    if (family !== null && family !== attachment.family) {
        throw new TypeError(`Test body family "${attachment.family}" conflicts with test family "${family}".`);
    }
    return attachment.family;
}

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

export type PropertyBodyExecution<Body> = {
    readonly kind: 'body';
    readonly bodyMode: 'property';
    readonly body: Body;
    readonly definition: PropertyBodyDefinition;
    readonly policy: PropertyPolicyResolution;
};

type BuilderBodyExecution<Body> = { readonly kind: 'body'; readonly bodyMode: 'builder'; readonly body: Body; };
export type FamilyBodyExecution<Body> = BuilderBodyExecution<Body> | PropertyBodyExecution<Body>;

export function propertyExecutionForDefinition<Body>(
    body: Body,
    definition: PropertyBodyDefinition
): PropertyBodyExecution<Body> {
    return {
        kind: 'body',
        bodyMode: 'property',
        body,
        definition: { kind: definition.kind, settingsDeclarations: definition.settingsDeclarations },
        policy: { kind: 'unresolved' }
    };
}

function propertyExecutionForBody<Body>(body: Body): PropertyBodyExecution<Body> | null {
    const attachment = readTestBodyFamily(body);
    if (attachment?.family !== 'property' || !isPropertyBodyDefinition(attachment.definition)) {
        return null;
    }
    return propertyExecutionForDefinition(body, attachment.definition);
}

export function resolveFamilyBodyExecution<Body>(
    execution: FamilyBodyExecution<Body>,
    workload: WorkloadInput | null
): FamilyBodyExecution<Body> {
    const body = resolveTestBodyWorkload(execution.body, workload);
    return execution.bodyMode === 'property'
        ? { ...execution, body }
        : propertyExecutionForBody(body) ?? { ...execution, body };
}
