const testBodyResourceAttachmentsBrand = Symbol.for('@overkill-dev/engine/TestBodyResourceAttachments');

export type TestBodyExecutionRequirementSummary = Readonly<Record<string, unknown>>;

export type TestBodyScenarioSlotSummary = {
    readonly default: string;
    readonly name: string;
    readonly timing: 'acquire' | 'request-routed';
    readonly values: readonly string[];
};

export type TestBodyRuntimeScenarioBindingSummary = TestBodyScenarioSlotSummary & {
    readonly owner: {
        readonly path: readonly string[];
        readonly resourceName: string;
    };
    readonly value: string;
};

export type TestBodyResourceSummary = {
    readonly dependencies: readonly string[];
    readonly handleTransport: 'local' | 'projected';
    readonly name: string;
    readonly requirements: readonly TestBodyExecutionRequirementSummary[];
    readonly scenarios: readonly TestBodyScenarioSlotSummary[];
    readonly scope: string;
};

export type TestBodyLeafRuntimeSummary = {
    readonly dimensions: Readonly<Record<string, string>>;
    readonly kind?: 'runtime';
    readonly name: string;
    readonly requirements: readonly TestBodyExecutionRequirementSummary[];
    readonly resources: readonly TestBodyDirectResourceAttachmentSummary[];
    readonly scenarioBindings: readonly TestBodyRuntimeScenarioBindingSummary[];
};

export type TestBodyRuntimeMatrixVariantSummary = {
    readonly id: string;
    readonly runtime: TestBodyLeafRuntimeSummary;
};

export type TestBodyRuntimeMatrixSummary = {
    readonly kind: 'runtime-matrix';
    readonly name: string;
    readonly resources: readonly TestBodyDirectResourceAttachmentSummary[];
    readonly variants: readonly TestBodyRuntimeMatrixVariantSummary[];
};

export type TestBodyRuntimeSummary = TestBodyLeafRuntimeSummary | TestBodyRuntimeMatrixSummary;

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

type AttachedTestBody = (...parameters: readonly [unknown]) => unknown;

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

function assertUniqueKeys(
    values: readonly string[],
    message: (key: string) => string
): void {
    const seenKeys = new Set<string>();

    for (const key of values) {
        if (seenKeys.has(key)) {
            throw new TypeError(message(key));
        }

        seenKeys.add(key);
    }
}

function validateAttachments(attachments: TestBodyResourceAttachments): void {
    assertUniqueKeys(
        attachments.directResources.map(function directResourceKey(resource) {
            return resource.key;
        }),
        function duplicateDirectResourceKey(key) {
            return `Resource scope "${key}" is attached multiple times.`;
        }
    );
    assertUniqueKeys(
        attachments.resourceGraph.map(function resourceGraphName(resource) {
            return resource.name;
        }),
        function duplicateResourceGraphName(name) {
            return `Resource descriptor "${name}" is attached multiple times.`;
        }
    );
    assertUniqueKeys(
        attachments.runtimeGraphs.map(function runtimeGraphName(runtime) {
            return runtime.name;
        }),
        function duplicateRuntimeGraphName(name) {
            return `Runtime scope "${name}" is attached multiple times.`;
        }
    );

    for (const runtime of attachments.runtimeGraphs) {
        const runtimeVariants = runtime.kind === 'runtime-matrix'
            ? runtime.variants
            : [ { id: runtime.name, runtime } ];

        for (const variant of runtimeVariants) {
            assertUniqueKeys(
                variant.runtime.resources.map(function runtimeResourceKey(resource) {
                    return resource.key;
                }),
                function duplicateRuntimeResourceKey(key) {
                    return `Runtime scope "${runtime.name}" resource "${key}" is attached multiple times.`;
                }
            );
        }
    }
}

export function hasAttachedResourceDescriptors(attachments: TestBodyResourceAttachments): boolean {
    return attachments.directResources.length > 0 ||
        attachments.resourceGraph.length > 0 ||
        attachments.runtimeGraphs.some(function runtimeHasResources(runtime) {
            return runtime.kind === 'runtime-matrix'
                ? runtime.variants.some(function variantHasResources(variant) {
                    return variant.runtime.resources.length > 0;
                })
                : runtime.resources.length > 0;
        });
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
            handleTransport: resource.handleTransport,
            name: resource.name,
            requirements: freezeRequirements(resource.requirements),
            scenarios: Object.freeze(resource.scenarios.map(function freezeScenario(scenario) {
                return Object.freeze({
                    ...scenario,
                    values: Object.freeze(Array.from(scenario.values))
                });
            })),
            scope: resource.scope
        });
    }));
}

function freezeLeafRuntime(runtime: TestBodyLeafRuntimeSummary): TestBodyLeafRuntimeSummary {
    return Object.freeze({
        dimensions: Object.freeze({ ...runtime.dimensions }),
        kind: 'runtime',
        name: runtime.name,
        requirements: freezeRequirements(runtime.requirements),
        resources: Object.freeze(runtime.resources.map(function freezeRuntimeResource(resource) {
            return Object.freeze({
                key: resource.key,
                resourceName: resource.resourceName
            });
        })),
        scenarioBindings: Object.freeze(runtime.scenarioBindings.map(function freezeScenarioBinding(binding) {
            return Object.freeze({
                ...binding,
                owner: Object.freeze({
                    path: Object.freeze(Array.from(binding.owner.path)),
                    resourceName: binding.owner.resourceName
                }),
                values: Object.freeze(Array.from(binding.values))
            });
        }))
    });
}

function freezeRuntimeGraphs(runtimes: readonly TestBodyRuntimeSummary[]): readonly TestBodyRuntimeSummary[] {
    return Object.freeze(runtimes.map(function freezeRuntime(runtime) {
        if (runtime.kind === 'runtime-matrix') {
            return Object.freeze({
                kind: runtime.kind,
                name: runtime.name,
                resources: Object.freeze(Array.from(runtime.resources)),
                variants: Object.freeze(runtime.variants.map(function freezeVariant(variant) {
                    return Object.freeze({
                        id: variant.id,
                        runtime: freezeLeafRuntime(variant.runtime)
                    });
                }))
            });
        }

        return freezeLeafRuntime(runtime);
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

export function hasTestBodyResourceAttachments(value: unknown): value is ResourceAttachedTestBody<AttachedTestBody> {
    return typeof value === 'function' && Object.hasOwn(value, testBodyResourceAttachmentsBrand);
}

export function attachTestBodyResourceAttachments<Scope, Result>(
    body: (scope: Scope) => Result,
    attachments: TestBodyResourceAttachments
): ResourceAttachedTestBody<(scope: Scope) => Result> {
    if (typeof body !== 'function') {
        throw new TypeError('Resource attachments require a test body function.');
    }

    if (hasTestBodyResourceAttachments(body)) {
        throw new TypeError('Test body already has resource attachments.');
    }

    if (!hasEntries(attachments)) {
        throw new TypeError('Test body resource attachments must not be empty.');
    }

    validateAttachments(attachments);

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
