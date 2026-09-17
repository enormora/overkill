import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type {
    TestBodyResourceAttachments,
    TestBodyResourceSummary,
    TestBodyRuntimeMatrixSummary,
    TestBodyRuntimeMatrixVariantSummary,
    TestBodyRuntimeSummary
} from '../engine/test-body-resource-attachment.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import { RunCollectionError } from './run-errors.ts';

type RuntimeMatrixAttachment = Extract<TestBodyRuntimeSummary, { readonly kind: 'runtime-matrix'; }>;

function runtimeMatrices(testCase: TestPlanCase): readonly RuntimeMatrixAttachment[] {
    return testCase.resourceAttachments.runtimeGraphs.filter(function isRuntimeMatrix(
        runtime
    ): runtime is RuntimeMatrixAttachment {
        return runtime.kind === 'runtime-matrix';
    });
}

function runtimeMatrixError(message: string): RunCollectionError {
    return new RunCollectionError(message, { cause: null }, 'loader');
}

function assertSingleRuntimeMatrix(testCase: TestPlanCase): RuntimeMatrixAttachment | null {
    const matrices = runtimeMatrices(testCase);
    const [ matrix = null ] = matrices;

    if (matrices.length > 1) {
        throw runtimeMatrixError(
            'Multiple runtime matrices on one test case require runtime composition, which is not implemented yet.'
        );
    }

    return matrix;
}

function resourcesByName(resources: readonly TestBodyResourceSummary[]): ReadonlyMap<string, TestBodyResourceSummary> {
    return new Map(resources.map(function toEntry(resource) {
        return [ resource.name, resource ];
    }));
}

function runtimeResourceNames(runtime: TestBodyRuntimeSummary): readonly string[] {
    return runtime.kind === 'runtime-matrix'
        ? runtime.variants.flatMap(function variantResourceNames(runtimeVariant) {
            return runtimeVariant.runtime.resources.map(function runtimeResourceName(resource) {
                return resource.resourceName;
            });
        })
        : runtime.resources.map(function runtimeResourceName(resource) {
            return resource.resourceName;
        });
}

function selectedRuntimeGraphs(
    runtimes: readonly TestBodyRuntimeSummary[],
    matrix: TestBodyRuntimeMatrixSummary,
    variant: TestBodyRuntimeMatrixVariantSummary
): readonly TestBodyRuntimeSummary[] {
    return runtimes.map(function selectRuntime(runtime) {
        return runtime === matrix
            ? {
                kind: 'runtime-matrix',
                name: matrix.name,
                resources: variant.runtime.resources,
                variants: [ variant ]
            }
            : runtime;
    });
}

function selectedResourceNames(
    attachments: TestBodyResourceAttachments,
    matrix: TestBodyRuntimeMatrixSummary,
    variant: TestBodyRuntimeMatrixVariantSummary
): readonly string[] {
    return [
        ...attachments.directResources.map(function directResourceName(resource) {
            return resource.resourceName;
        }),
        ...selectedRuntimeGraphs(attachments.runtimeGraphs, matrix, variant).flatMap(runtimeResourceNames)
    ];
}

function reachableResourceGraph(
    resources: readonly TestBodyResourceSummary[],
    roots: readonly string[]
): readonly TestBodyResourceSummary[] {
    const resourcesByResourceName = resourcesByName(resources);
    const reachable = new Set<string>();
    const pending = Array.from(roots);

    while (pending.length > 0) {
        const resourceName = pending.pop();

        if (resourceName !== undefined && !reachable.has(resourceName)) {
            reachable.add(resourceName);
            pending.push(...resourcesByResourceName.get(resourceName)?.dependencies ?? []);
        }
    }

    return resources.filter(function isReachable(resource) {
        return reachable.has(resource.name);
    });
}

function attachmentsForVariant(
    attachments: TestBodyResourceAttachments,
    matrix: TestBodyRuntimeMatrixSummary,
    variant: TestBodyRuntimeMatrixVariantSummary
): TestBodyResourceAttachments {
    const runtimeGraphs = selectedRuntimeGraphs(attachments.runtimeGraphs, matrix, variant);

    return {
        directResources: attachments.directResources,
        resourceGraph: reachableResourceGraph(
            attachments.resourceGraph,
            selectedResourceNames(attachments, matrix, variant)
        ),
        runtimeGraphs
    };
}

function expandCase(testCase: TestPlanCase): readonly TestPlanCase[] {
    const matrix = assertSingleRuntimeMatrix(testCase);

    if (matrix === null) {
        return [ testCase ];
    }

    return matrix.variants.map(function variantCase(variant) {
        return {
            ...testCase,
            resourceAttachments: attachmentsForVariant(testCase.resourceAttachments, matrix, variant),
            workId: {
                case: testCase.id,
                runtime: {
                    dimensions: variant.runtime.dimensions,
                    name: matrix.name,
                    variantId: variant.id
                },
                workload: null
            }
        };
    });
}

function expandCases(cases: NonEmptyReadonlyArray<TestPlanCase>): NonEmptyReadonlyArray<TestPlanCase> {
    const [ firstCase, ...remainingCases ] = cases;
    const [ firstExpandedCase = firstCase, ...remainingExpandedCases ] = expandCase(firstCase);

    return [
        firstExpandedCase,
        ...remainingExpandedCases,
        ...remainingCases.flatMap(expandCase)
    ];
}

export function expandRuntimeMatrices(testPlan: TestPlan): TestPlan {
    return {
        ...testPlan,
        cases: expandCases(testPlan.cases),
        discoveredCases: expandCases(testPlan.discoveredCases)
    };
}
