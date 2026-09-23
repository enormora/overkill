import { createCaseId, createDefaultWorkId, workIdentityKey, type WorkId } from '../engine/identity.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunCase,
    type CollectedRunPlan,
    type DuplicateExecutionSafety,
    type WorkUnitResourceConstraints
} from './run-types.ts';

type ResourceRequirementSummary = Readonly<Record<string, unknown>>;
type ResourceSummary = CollectedRunCase['resourceAttachments']['resourceGraph'][number];
type RuntimeSummary = CollectedRunCase['resourceAttachments']['runtimeGraphs'][number];
type RequirementSource = {
    readonly name: string;
};
type ConstraintSets = {
    readonly affinityKeys: ReadonlySet<string>;
    readonly duplicateExecution: ReadonlySet<DuplicateExecutionSafety>;
    readonly faultDomains: ReadonlySet<string>;
    readonly serialKeys: ReadonlySet<string>;
    readonly singleWorkerKeys: ReadonlySet<string>;
};
type RequirementApplicator = (
    sets: ConstraintSets,
    source: RequirementSource,
    requirement: ResourceRequirementSummary
) => ConstraintSets;

function suiteTitles(suitePath: CollectedRunCase['suitePath']): readonly string[] {
    return suitePath.map(function toTitle(entry) {
        return entry.title;
    });
}

function collectedCaseWorkId(file: string, testCase: CollectedRunCase): WorkId {
    return testCase.workId ??
        createDefaultWorkId(createCaseId(file, suiteTitles(testCase.suitePath), testCase.title, testCase.params));
}

function collectedCaseEntriesByKey(plan: CollectedRunPlan): ReadonlyMap<string, CollectedRunCase> {
    return new Map(plan.files.flatMap(function toEntries(file) {
        return file.cases.map(function toEntry(testCase): readonly [string, CollectedRunCase] {
            return [ workIdentityKey(collectedCaseWorkId(file.file, testCase)), testCase ];
        });
    }));
}

function stringRequirementValue(requirement: ResourceRequirementSummary, key: string): string | null {
    const value = Reflect.get(requirement, key);

    return typeof value === 'string' ? value : null;
}

function numberRequirementValue(requirement: ResourceRequirementSummary, key: string): number | null {
    const value = Reflect.get(requirement, key);

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function withOptionalValue<Value extends string>(values: ReadonlySet<Value>, value: Value | null): ReadonlySet<Value> {
    return value === null ? values : new Set([ ...values, value ]);
}

function suitePlacementKey(testCase: CollectedRunCase): string {
    return JSON.stringify(testCase.suitePath.map(function toTitle(suite) {
        return suite.title;
    }));
}

function resourceScopePlacementKey(
    resource: ResourceSummary,
    testCase: CollectedRunCase,
    file: string
): string | null {
    if (resource.scope === 'per-run') {
        return null;
    }

    if (resource.scope === 'shared-per-worker') {
        return `resource:worker:${resource.name}`;
    }

    if (resource.scope === 'per-file') {
        return `resource:file:${file}:${resource.name}`;
    }

    if (resource.scope === 'per-suite') {
        return `resource:suite:${file}:${suitePlacementKey(testCase)}:${resource.name}`;
    }

    return null;
}

function emptyConstraintSets(): ConstraintSets {
    return {
        affinityKeys: new Set(),
        duplicateExecution: new Set(),
        faultDomains: new Set(),
        serialKeys: new Set(),
        singleWorkerKeys: new Set()
    };
}

function applySerialRequirement(sets: ConstraintSets, source: RequirementSource): ConstraintSets {
    return { ...sets, serialKeys: new Set([ ...sets.serialKeys, `serial:${source.name}` ]) };
}

function applyExclusiveResourceRequirement(
    sets: ConstraintSets,
    _source: RequirementSource,
    requirement: ResourceRequirementSummary
): ConstraintSets {
    return { ...sets, serialKeys: withOptionalValue(sets.serialKeys, stringRequirementValue(requirement, 'name')) };
}

function applySingleWorkerRequirement(sets: ConstraintSets, source: RequirementSource): ConstraintSets {
    return { ...sets, singleWorkerKeys: new Set([ ...sets.singleWorkerKeys, `single-worker:${source.name}` ]) };
}

function applyAffinityRequirement(
    sets: ConstraintSets,
    _source: RequirementSource,
    requirement: ResourceRequirementSummary
): ConstraintSets {
    return {
        ...sets,
        affinityKeys: withOptionalValue(sets.affinityKeys, stringRequirementValue(requirement, 'key'))
    };
}

function applyFaultDomainRequirement(
    sets: ConstraintSets,
    _source: RequirementSource,
    requirement: ResourceRequirementSummary
): ConstraintSets {
    return {
        ...sets,
        faultDomains: withOptionalValue(sets.faultDomains, stringRequirementValue(requirement, 'key'))
    };
}

function duplicateExecutionSafety(requirement: ResourceRequirementSummary): DuplicateExecutionSafety | null {
    const value = stringRequirementValue(requirement, 'safety');

    return value === 'disposable-isolated' || value === 'idempotent' ? value : null;
}

function applyDuplicateExecutionRequirement(
    sets: ConstraintSets,
    _source: RequirementSource,
    requirement: ResourceRequirementSummary
): ConstraintSets {
    return {
        ...sets,
        duplicateExecution: withOptionalValue(sets.duplicateExecution, duplicateExecutionSafety(requirement))
    };
}

const requirementApplicators: Readonly<Record<string, RequirementApplicator>> = {
    'affinity-key': applyAffinityRequirement,
    'duplicate-execution': applyDuplicateExecutionRequirement,
    'exclusive-resource': applyExclusiveResourceRequirement,
    'fault-domain': applyFaultDomainRequirement,
    serial: applySerialRequirement,
    'single-worker': applySingleWorkerRequirement
};

function applyRequirement(
    sets: ConstraintSets,
    source: RequirementSource,
    requirement: ResourceRequirementSummary
): ConstraintSets {
    const kind = stringRequirementValue(requirement, 'kind');
    const apply = kind === null ? undefined : requirementApplicators[kind];

    return apply === undefined ? sets : apply(sets, source, requirement);
}

function requirementCapacityWeight(requirement: ResourceRequirementSummary): number {
    return stringRequirementValue(requirement, 'kind') === 'capacity-weight'
        ? Math.max(numberRequirementValue(requirement, 'weight') ?? 0, 0)
        : 0;
}

function resourceConstraintSets(
    resource: ResourceSummary,
    testCase: CollectedRunCase,
    file: string,
    sets: ConstraintSets
): ConstraintSets {
    return resource.requirements.reduce<ConstraintSets>(function applyResourceRequirement(nextSets, requirement) {
        return applyRequirement(nextSets, resource, requirement);
    }, {
        ...sets,
        singleWorkerKeys: withOptionalValue(
            sets.singleWorkerKeys,
            resourceScopePlacementKey(resource, testCase, file)
        )
    });
}

function runtimeRequirementSource(runtime: RuntimeSummary): RequirementSource {
    return { name: `runtime:${runtime.name}` };
}

function runtimeRequirements(runtime: RuntimeSummary): readonly ResourceRequirementSummary[] {
    return runtime.kind === 'runtime-matrix'
        ? runtime.variants.flatMap(function variantRequirements(variant) {
            return variant.runtime.requirements;
        })
        : runtime.requirements;
}

function runtimeConstraintSets(runtime: RuntimeSummary, sets: ConstraintSets): ConstraintSets {
    return runtimeRequirements(runtime).reduce<ConstraintSets>(function applyRuntimeRequirement(nextSets, requirement) {
        return applyRequirement(nextSets, runtimeRequirementSource(runtime), requirement);
    }, sets);
}

function runtimeCapacityWeight(runtime: RuntimeSummary): number {
    return runtimeRequirements(runtime).reduce(function addRuntimeRequirementWeight(total, requirement) {
        return total + requirementCapacityWeight(requirement);
    }, 0);
}

function caseResourceConstraints(testCase: CollectedRunCase, file: string): WorkUnitResourceConstraints {
    const resourceSets = testCase.resourceAttachments.resourceGraph.reduce(function applyResource(nextSets, resource) {
        return resourceConstraintSets(resource, testCase, file, nextSets);
    }, emptyConstraintSets());
    const sets = testCase.resourceAttachments.runtimeGraphs.reduce(function applyRuntime(nextSets, runtime) {
        return runtimeConstraintSets(runtime, nextSets);
    }, resourceSets);
    const resourceCapacityWeight = testCase.resourceAttachments.resourceGraph.reduce(
        function addCapacityWeight(total, resource) {
            return total + resource.requirements.reduce(function addRequirementWeight(resourceTotal, requirement) {
                return resourceTotal + requirementCapacityWeight(requirement);
            }, 0);
        },
        emptyWorkUnitResourceConstraints.capacityWeight
    );
    const capacityWeight = testCase.resourceAttachments.runtimeGraphs.reduce(
        function addRuntimeWeight(total, runtime) {
            return total + runtimeCapacityWeight(runtime);
        },
        resourceCapacityWeight
    );

    return {
        affinityKeys: Array.from(sets.affinityKeys),
        capacityWeight,
        duplicateExecution: testCase.controls.duplicateExecution === 'forbidden'
            ? []
            : Array.from(
                new Set([
                    ...sets.duplicateExecution,
                    ...testCase.controls.duplicateExecution === 'idempotent' ? [ 'idempotent' as const ] : []
                ])
            ),
        faultDomains: Array.from(sets.faultDomains),
        serialKeys: Array.from(sets.serialKeys),
        singleWorkerKeys: Array.from(sets.singleWorkerKeys)
    };
}

function resourceConstraintsAreEmpty(constraints: WorkUnitResourceConstraints): boolean {
    return constraints.affinityKeys.length === 0 &&
        constraints.capacityWeight === emptyWorkUnitResourceConstraints.capacityWeight &&
        constraints.duplicateExecution.length === 0 &&
        constraints.faultDomains.length === 0 &&
        constraints.serialKeys.length === 0 &&
        constraints.singleWorkerKeys.length === 0;
}

function normalizeResourceConstraints(constraints: WorkUnitResourceConstraints): WorkUnitResourceConstraints {
    return resourceConstraintsAreEmpty(constraints)
        ? emptyWorkUnitResourceConstraints
        : constraints;
}

function mergeResourceConstraints(
    left: WorkUnitResourceConstraints,
    right: WorkUnitResourceConstraints
): WorkUnitResourceConstraints {
    return normalizeResourceConstraints({
        affinityKeys: Array.from(new Set([ ...left.affinityKeys, ...right.affinityKeys ])),
        capacityWeight: left.capacityWeight + right.capacityWeight - emptyWorkUnitResourceConstraints.capacityWeight,
        duplicateExecution: Array.from(new Set([ ...left.duplicateExecution, ...right.duplicateExecution ])),
        faultDomains: Array.from(new Set([ ...left.faultDomains, ...right.faultDomains ])),
        serialKeys: Array.from(new Set([ ...left.serialKeys, ...right.serialKeys ])),
        singleWorkerKeys: Array.from(new Set([ ...left.singleWorkerKeys, ...right.singleWorkerKeys ]))
    });
}

export function workResourceConstraints(
    work: readonly WorkId[],
    plan: CollectedRunPlan
): WorkUnitResourceConstraints {
    const cases = collectedCaseEntriesByKey(plan);

    return work.reduce(function mergeConstraints(constraints, item) {
        const testCase = cases.get(workIdentityKey(item));

        return testCase === undefined || item.case.file === null
            ? constraints
            : mergeResourceConstraints(constraints, caseResourceConstraints(testCase, item.case.file));
    }, emptyWorkUnitResourceConstraints);
}
