import type { TestBody } from './test-node.ts';

const testBodyResourceAttachmentsBrand = Symbol.for('@overkill-dev/engine/TestBodyResourceAttachments');

export type TestBodyExecutionRequirementSummary = Readonly<Record<string, unknown>>;

export type TestBodyResourceSummary = {
    readonly dependencies: readonly string[];
    readonly name: string;
    readonly requirements: readonly TestBodyExecutionRequirementSummary[];
    readonly scope: string;
};

export type TestBodyRuntimeSummary = {
    readonly dimensions: Readonly<Record<string, string>>;
    readonly name: string;
    readonly requirements: readonly TestBodyExecutionRequirementSummary[];
    readonly resources: readonly TestBodyDirectResourceAttachmentSummary[];
};

export type TestBodyDirectResourceAttachmentSummary = {
    readonly key: string;
    readonly resourceName: string;
};

export type TestBodyResourceAttachments = {
    readonly directResources: readonly TestBodyDirectResourceAttachmentSummary[];
    readonly resourceGraph: readonly TestBodyResourceSummary[];
    readonly runtimeGraphs: readonly TestBodyRuntimeSummary[];
};

export type ResourceAttachedTestBody<Body> = Body & {
    readonly [testBodyResourceAttachmentsBrand]: TestBodyResourceAttachments;
};

export type ResourceFreeTestBody<Body> = Body & {
    readonly [testBodyResourceAttachmentsBrand]?: never;
};

const emptyTestBodyResourceAttachments: TestBodyResourceAttachments = Object.freeze({
    directResources: Object.freeze([]),
    resourceGraph: Object.freeze([]),
    runtimeGraphs: Object.freeze([])
});

function hasEntries(attachments: TestBodyResourceAttachments): boolean {
    return attachments.directResources.length > 0 ||
        attachments.resourceGraph.length > 0 ||
        attachments.runtimeGraphs.length > 0;
}

function freezeRequirements(
    requirements: readonly TestBodyExecutionRequirementSummary[]
): readonly TestBodyExecutionRequirementSummary[] {
    return Object.freeze(requirements.map(function freezeRequirement(requirement) {
        return Object.freeze({ ...requirement });
    }));
}

function freezeResourceGraph(resources: readonly TestBodyResourceSummary[]): readonly TestBodyResourceSummary[] {
    return Object.freeze(resources.map(function freezeResource(resource) {
        return Object.freeze({
            dependencies: Object.freeze(Array.from(resource.dependencies)),
            name: resource.name,
            requirements: freezeRequirements(resource.requirements),
            scope: resource.scope
        });
    }));
}

function freezeRuntimeGraphs(runtimes: readonly TestBodyRuntimeSummary[]): readonly TestBodyRuntimeSummary[] {
    return Object.freeze(runtimes.map(function freezeRuntime(runtime) {
        return Object.freeze({
            dimensions: Object.freeze({ ...runtime.dimensions }),
            name: runtime.name,
            requirements: freezeRequirements(runtime.requirements),
            resources: Object.freeze(runtime.resources.map(function freezeRuntimeResource(resource) {
                return Object.freeze({
                    key: resource.key,
                    resourceName: resource.resourceName
                });
            }))
        });
    }));
}

function freezeAttachments(attachments: TestBodyResourceAttachments): TestBodyResourceAttachments {
    return Object.freeze({
        directResources: Object.freeze(attachments.directResources.map(function freezeDirectResource(resource) {
            return Object.freeze({
                key: resource.key,
                resourceName: resource.resourceName
            });
        })),
        resourceGraph: freezeResourceGraph(attachments.resourceGraph),
        runtimeGraphs: freezeRuntimeGraphs(attachments.runtimeGraphs)
    });
}

export function hasTestBodyResourceAttachments(value: unknown): value is ResourceAttachedTestBody<TestBody> {
    return typeof value === 'function' && Object.hasOwn(value, testBodyResourceAttachmentsBrand);
}

export function attachTestBodyResourceAttachments<Scope>(
    body: (scope: Scope) => ReturnType<TestBody>,
    attachments: TestBodyResourceAttachments
): ResourceAttachedTestBody<(scope: Scope) => ReturnType<TestBody>> {
    if (typeof body !== 'function') {
        throw new TypeError('Resource attachments require a test body function.');
    }

    if (hasTestBodyResourceAttachments(body)) {
        throw new TypeError('Test body already has resource attachments.');
    }

    if (!hasEntries(attachments)) {
        throw new TypeError('Test body resource attachments must not be empty.');
    }

    return Object.assign(body, {
        [testBodyResourceAttachmentsBrand]: freezeAttachments(attachments)
    });
}

export function readTestBodyResourceAttachments(value: unknown): TestBodyResourceAttachments {
    if (!hasTestBodyResourceAttachments(value)) {
        return emptyTestBodyResourceAttachments;
    }

    return value[testBodyResourceAttachmentsBrand];
}
