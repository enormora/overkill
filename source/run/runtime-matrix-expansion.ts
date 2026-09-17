import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RuntimeId } from '../engine/identity.ts';
import type {
    TestBodyResourceAttachments,
    TestBodyLeafRuntimeSummary,
    TestBodyResourceSummary,
    TestBodyRuntimeMatrixSummary,
    TestBodyRuntimeMatrixVariantSummary,
    TestBodyRuntimeSummary
} from '../engine/test-body-resource-attachment.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';

type RuntimeMatrixAttachment = Extract<TestBodyRuntimeSummary, { readonly kind: 'runtime-matrix'; }>;
type RuntimeSelection = {
    readonly runtimeGraph: TestBodyRuntimeSummary;
    readonly runtimeId: RuntimeId;
};
type RuntimeSelectionCombination = readonly RuntimeSelection[];

function compareRuntimeIdNames(left: RuntimeId, right: RuntimeId): number {
    return left.name.localeCompare(right.name);
}

function sortedRuntimeIds(runtimeIds: readonly RuntimeId[]): readonly RuntimeId[] {
    return runtimeIds.toSorted(compareRuntimeIdNames);
}

function runtimeId(runtime: TestBodyLeafRuntimeSummary): RuntimeId {
    return {
        dimensions: runtime.dimensions,
        name: runtime.name,
        variantId: null
    };
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

function runtimeVariantId(
    matrix: TestBodyRuntimeMatrixSummary,
    variant: TestBodyRuntimeMatrixVariantSummary
): RuntimeId {
    return {
        dimensions: variant.runtime.dimensions,
        name: matrix.name,
        variantId: variant.id
    };
}

function leafRuntimeSelection(runtime: TestBodyLeafRuntimeSummary): RuntimeSelection {
    return {
        runtimeGraph: runtime,
        runtimeId: runtimeId(runtime)
    };
}

function matrixRuntimeSelections(matrix: RuntimeMatrixAttachment): readonly RuntimeSelection[] {
    return matrix.variants.map(function variantSelection(variant) {
        return {
            runtimeGraph: {
                kind: 'runtime-matrix',
                name: matrix.name,
                resources: variant.runtime.resources,
                variants: [ variant ]
            },
            runtimeId: runtimeVariantId(matrix, variant)
        };
    });
}

function runtimeSelections(runtime: TestBodyRuntimeSummary): readonly RuntimeSelection[] {
    return runtime.kind === 'runtime-matrix' ? matrixRuntimeSelections(runtime) : [ leafRuntimeSelection(runtime) ];
}

function combineSelections(
    left: readonly RuntimeSelectionCombination[],
    right: readonly RuntimeSelection[]
): readonly RuntimeSelectionCombination[] {
    return left.flatMap(function appendRight(leftCombination) {
        return right.map(function appendSelection(selection) {
            return [ ...leftCombination, selection ];
        });
    });
}

function runtimeSelectionCombinations(
    runtimes: readonly TestBodyRuntimeSummary[]
): readonly RuntimeSelectionCombination[] {
    return runtimes.reduce<readonly RuntimeSelectionCombination[]>(function addRuntime(combinations, runtime) {
        return combineSelections(combinations, runtimeSelections(runtime));
    }, [ [] ]);
}

function selectedRuntimeGraphs(
    combination: RuntimeSelectionCombination
): readonly TestBodyRuntimeSummary[] {
    return combination.map(function selectedRuntime(selection) {
        return selection.runtimeGraph;
    });
}

function selectedResourceNames(
    attachments: TestBodyResourceAttachments,
    combination: RuntimeSelectionCombination
): readonly string[] {
    return [
        ...attachments.directResources.map(function directResourceName(resource) {
            return resource.resourceName;
        }),
        ...selectedRuntimeGraphs(combination).flatMap(runtimeResourceNames)
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
    combination: RuntimeSelectionCombination
): TestBodyResourceAttachments {
    const runtimeGraphs = selectedRuntimeGraphs(combination);

    return {
        directResources: attachments.directResources,
        resourceGraph: reachableResourceGraph(
            attachments.resourceGraph,
            selectedResourceNames(attachments, combination)
        ),
        runtimeGraphs
    };
}

function expandCase(testCase: TestPlanCase): readonly TestPlanCase[] {
    const combinations = runtimeSelectionCombinations(testCase.resourceAttachments.runtimeGraphs);

    if (combinations.length === 1 && combinations[0]?.length === 0) {
        return [ testCase ];
    }

    return combinations.map(function variantCase(combination) {
        return {
            ...testCase,
            resourceAttachments: attachmentsForVariant(testCase.resourceAttachments, combination),
            workId: {
                case: testCase.id,
                runtimes: sortedRuntimeIds(combination.map(function selectedRuntime(selection) {
                    return selection.runtimeId;
                })),
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
