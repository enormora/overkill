import { runtimeIdentityKey, workIdentityKey, type RuntimeId, type WorkId } from '../engine/identity.ts';
import type { TestBodyResourceSummary, TestBodyRuntimeSummary } from '../engine/test-body-resource-attachment.ts';
import { resourceDependencyScopeAllowed } from '../resources/resource-graph.ts';
import {
    caseResourceOwnershipBoundaries,
    resourceScopes,
    type ResourceOwnershipBoundary
} from './resource-lifecycle-boundaries.ts';
import type { RunExecutionPlanConflict } from './run-errors.ts';
import { collectedRunCaseEntries, type CollectedRunCaseEntry } from './collected-run-plan.ts';
import type {
    CollectedRunPlan,
    PlacementLane,
    RunWorkerCountFacts,
    WorkUnit
} from './run-types.ts';
import type { ResourceOwnershipPlan } from './resource-ownership-plan.ts';
import { hardConstraintKeys } from './work-unit-resource-constraints.ts';

type ResourceScope = ResourceOwnershipBoundary['scope'];
type SharedResourceScope = Extract<ResourceScope, 'per-file' | 'per-run' | 'per-suite'>;
type SharedResourceBoundary = ResourceOwnershipBoundary & { readonly scope: SharedResourceScope; };
type BoundaryWork = {
    readonly boundary: SharedResourceBoundary;
    readonly work: readonly WorkId[];
};
type ExecutionPlanCompatibilityInput = {
    readonly selectedPlan: CollectedRunPlan;
    readonly units: readonly WorkUnit[];
    readonly workerCount: RunWorkerCountFacts;
    readonly requiredLifecycleLanes: number;
};
type ResourceOwnershipInput = {
    readonly lanes: readonly PlacementLane[];
    readonly selectedPlan: CollectedRunPlan;
    readonly units: readonly WorkUnit[];
};

function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }

    const keys = Object.keys(value).toSorted(function compareKeys(left, right) {
        return left.localeCompare(right);
    });

    return `{${
        keys
            .map(function entry(key) {
                return `${JSON.stringify(key)}:${stableJson(Reflect.get(value, key))}`;
            })
            .join(',')
    }}`;
}

function nonEmpty<Value>(values: readonly Value[], message: string): readonly [Value, ...readonly Value[]] {
    const first = values[0];

    if (first === undefined) {
        throw new Error(message);
    }

    return [ first, ...values.slice(1) ];
}

function mapWith<Key, Value>(values: ReadonlyMap<Key, Value>, key: Key, value: Value): ReadonlyMap<Key, Value> {
    const updatedValues = new Map(values);

    updatedValues.set(key, value);

    return updatedValues;
}

function uniqueWork(work: readonly WorkId[]): readonly WorkId[] {
    const workByKey = new Map(work.map(function workEntry(item) {
        return [ workIdentityKey(item), item ];
    }));

    return Array.from(workByKey.values());
}

const resourceScopeNames: ReadonlySet<string> = resourceScopes;

function isResourceScope(scope: string): scope is ResourceScope {
    return resourceScopeNames.has(scope);
}

function resourceScope(resource: TestBodyResourceSummary): ResourceScope | null {
    return isResourceScope(resource.scope) ? resource.scope : null;
}

function resourceFacts(
    resource: TestBodyResourceSummary
): { readonly name: string; readonly scope: ResourceScope; } | null {
    const scope = resourceScope(resource);

    return scope === null ? null : { name: resource.name, scope };
}

function resourceDefinitionEnvelope(resource: TestBodyResourceSummary): unknown {
    return {
        dependencies: resource.dependencies.toSorted(function compareDependencies(left, right) {
            return left.localeCompare(right);
        }),
        handleTransport: resource.handleTransport,
        requirements: resource.requirements,
        scenarios: resource.scenarios,
        scope: resource.scope
    };
}

function runtimeSummaryForId(
    runtimes: readonly TestBodyRuntimeSummary[],
    runtimeId: RuntimeId
): TestBodyRuntimeSummary | null {
    return runtimes.find(function runtimeNameMatches(runtime) {
        return runtime.name === runtimeId.name;
    }) ?? null;
}

type ResourceDefinitionRecord = {
    readonly resource: TestBodyResourceSummary;
    readonly work: readonly WorkId[];
};
type RuntimeDefinitionRecord = {
    readonly definitions: ReadonlyMap<string, readonly WorkId[]>;
    readonly runtime: RuntimeId;
};

function recordResourceDefinitions(
    entry: CollectedRunCaseEntry,
    resources: ReadonlyMap<string, Map<string, ResourceDefinitionRecord>>
): ReadonlyMap<string, Map<string, ResourceDefinitionRecord>> {
    const updatedResources = new Map(resources);

    for (const resource of entry.testCase.resourceAttachments.resourceGraph) {
        const definitions = new Map(updatedResources.get(resource.name));
        const envelope = stableJson(resourceDefinitionEnvelope(resource));
        const definition = definitions.get(envelope) ?? { resource, work: [] };

        definitions.set(envelope, { resource, work: [ ...definition.work, entry.workId ] });
        updatedResources.set(resource.name, definitions);
    }

    return updatedResources;
}

function recordRuntimeDefinition(
    entry: CollectedRunCaseEntry,
    runtimeId: RuntimeId,
    runtimes: ReadonlyMap<string, RuntimeDefinitionRecord>
): ReadonlyMap<string, RuntimeDefinitionRecord> {
    const runtime = runtimeSummaryForId(entry.testCase.resourceAttachments.runtimeGraphs, runtimeId);

    if (runtime === null) {
        return runtimes;
    }

    const runtimeKey = runtimeIdentityKey(runtimeId);
    const existing = runtimes.get(runtimeKey);
    const definitions = new Map(existing?.definitions);
    const envelope = stableJson(runtime);

    definitions.set(envelope, [ ...definitions.get(envelope) ?? [], entry.workId ]);
    return mapWith(runtimes, runtimeKey, { definitions, runtime: runtimeId });
}

function resourceDefinitionConflict(
    name: string,
    definitions: ReadonlyMap<string, ResourceDefinitionRecord>
): readonly RunExecutionPlanConflict[] {
    const values = Array.from(definitions.values());
    const facts = values.flatMap(function definitionFacts(definition) {
        const factsForResource = resourceFacts(definition.resource);

        return factsForResource === null ? [] : [ factsForResource ];
    });
    const work = uniqueWork(values.flatMap(function definitionWork(definition) {
        return definition.work;
    }));

    return definitions.size <= 1 || facts.length === 0 || work.length === 0 ? [] : [ {
        definitions: nonEmpty(facts, 'Resource definition conflict requires resource facts.'),
        kind: 'resource-definition',
        name,
        work: nonEmpty(work, 'Resource definition conflict requires work.')
    } ];
}

function runtimeDefinitionConflict(record: RuntimeDefinitionRecord): readonly RunExecutionPlanConflict[] {
    const work = uniqueWork(Array.from(record.definitions.values()).flat());

    return record.definitions.size <= 1 ? [] : [ {
        kind: 'runtime-definition',
        runtime: record.runtime,
        work: nonEmpty(work, 'Runtime definition conflict requires work.')
    } ];
}

function identityConflicts(plan: CollectedRunPlan): readonly RunExecutionPlanConflict[] {
    let resources: ReadonlyMap<string, Map<string, ResourceDefinitionRecord>> = new Map();
    let runtimes: ReadonlyMap<string, RuntimeDefinitionRecord> = new Map();

    for (const entry of collectedRunCaseEntries(plan)) {
        resources = recordResourceDefinitions(entry, resources);

        for (const runtimeId of entry.workId.runtimes) {
            runtimes = recordRuntimeDefinition(entry, runtimeId, runtimes);
        }
    }

    return [
        ...Array
            .from(resources, function resourceConflict([ name, definitions ]) {
                return resourceDefinitionConflict(name, definitions);
            })
            .flat(),
        ...Array.from(runtimes.values()).flatMap(runtimeDefinitionConflict)
    ];
}

type DependencyScopeConflictRecord = {
    readonly dependency: { readonly name: string; readonly scope: ResourceScope; };
    readonly resource: { readonly name: string; readonly scope: ResourceScope; };
    readonly work: readonly WorkId[];
};
type DependencyScopeConflictFacts = {
    readonly dependency: DependencyScopeConflictRecord['dependency'];
    readonly resource: DependencyScopeConflictRecord['resource'];
};

function dependencyConflictRecord(
    resource: TestBodyResourceSummary,
    dependency: TestBodyResourceSummary
): DependencyScopeConflictFacts | null {
    const resourceValue = resourceFacts(resource);
    const dependencyValue = resourceFacts(dependency);

    if (resourceValue === null || dependencyValue === null) {
        return null;
    }

    return resourceDependencyScopeAllowed(resourceValue, dependencyValue)
        ? null
        : { dependency: dependencyValue, resource: resourceValue };
}

function recordResourceDependencyConflicts(
    entry: CollectedRunCaseEntry,
    resource: TestBodyResourceSummary,
    resources: ReadonlyMap<string, TestBodyResourceSummary>,
    conflicts: ReadonlyMap<string, DependencyScopeConflictRecord>
): ReadonlyMap<string, DependencyScopeConflictRecord> {
    let updatedConflicts = conflicts;

    for (const dependencyName of resource.dependencies) {
        const dependency = resources.get(dependencyName);
        const record = dependency === undefined ? null : dependencyConflictRecord(resource, dependency);

        if (record !== null) {
            const key = stableJson(record);
            const existing = updatedConflicts.get(key);

            updatedConflicts = mapWith(updatedConflicts, key, {
                ...record,
                work: [ ...existing?.work ?? [], entry.workId ]
            });
        }
    }

    return updatedConflicts;
}

function recordDependencyConflicts(
    entry: CollectedRunCaseEntry,
    conflicts: ReadonlyMap<string, DependencyScopeConflictRecord>
): ReadonlyMap<string, DependencyScopeConflictRecord> {
    const resources = new Map(entry.testCase.resourceAttachments.resourceGraph.map(function resourceEntry(resource) {
        return [ resource.name, resource ] as const;
    }));
    let updatedConflicts = conflicts;

    for (const resource of resources.values()) {
        updatedConflicts = recordResourceDependencyConflicts(entry, resource, resources, updatedConflicts);
    }

    return updatedConflicts;
}

function dependencyScopeConflicts(plan: CollectedRunPlan): readonly RunExecutionPlanConflict[] {
    let conflicts: ReadonlyMap<string, DependencyScopeConflictRecord> = new Map();

    for (const entry of collectedRunCaseEntries(plan)) {
        conflicts = recordDependencyConflicts(entry, conflicts);
    }

    return Array.from(conflicts.values(), function dependencyConflict(conflict) {
        return {
            dependency: conflict.dependency,
            kind: 'resource-dependency-scope',
            resource: conflict.resource,
            work: nonEmpty(uniqueWork(conflict.work), 'Resource dependency conflict requires work.')
        };
    });
}

function caseBoundaryRecords(entry: CollectedRunCaseEntry): readonly ResourceOwnershipBoundary[] {
    return caseResourceOwnershipBoundaries({
        id: entry.id,
        resourceAttachments: entry.testCase.resourceAttachments,
        workId: entry.workId
    });
}

const sharedResourceScopes: ReadonlySet<ResourceScope> = new Set([ 'per-file', 'per-run', 'per-suite' ]);

function isSharedBoundary(boundary: ResourceOwnershipBoundary): boundary is SharedResourceBoundary {
    return sharedResourceScopes.has(boundary.scope);
}

function recordSharedBoundaries(
    entry: CollectedRunCaseEntry,
    boundaries: ReadonlyMap<string, BoundaryWork>
): ReadonlyMap<string, BoundaryWork> {
    return caseBoundaryRecords(entry).reduce(function addSharedBoundary(updatedBoundaries, boundary) {
        if (!isSharedBoundary(boundary)) {
            return updatedBoundaries;
        }

        const record = updatedBoundaries.get(boundary.key) ?? { boundary, work: [] };

        return mapWith(updatedBoundaries, boundary.key, {
            boundary,
            work: [ ...record.work, entry.workId ]
        });
    }, boundaries);
}

function sharedBoundaryWork(plan: CollectedRunPlan): readonly BoundaryWork[] {
    let boundaries: ReadonlyMap<string, BoundaryWork> = new Map();

    for (const entry of collectedRunCaseEntries(plan)) {
        boundaries = recordSharedBoundaries(entry, boundaries);
    }

    return Array.from(boundaries.values(), function boundaryRecord(record) {
        return { boundary: record.boundary, work: uniqueWork(record.work) };
    });
}

function unitsByWork(units: readonly WorkUnit[]): ReadonlyMap<string, WorkUnit> {
    return new Map(units.flatMap(function unitWorkEntries(unit) {
        return unit.work.map(function unitWorkEntry(work) {
            return [ workIdentityKey(work), unit ] as const;
        });
    }));
}

function boundaryUnits(boundary: BoundaryWork, units: ReadonlyMap<string, WorkUnit>): readonly WorkUnit[] {
    const unitsById = new Map(boundary.work.flatMap(function boundaryUnit(work) {
        const unit = units.get(workIdentityKey(work));

        return unit === undefined ? [] : [ [ stableJson(unit.id), unit ] as const ];
    }));

    return Array.from(unitsById.values());
}

function projectionConflicts(
    plan: CollectedRunPlan,
    units: readonly WorkUnit[],
    workerCount: number
): readonly RunExecutionPlanConflict[] {
    const indexedUnits = unitsByWork(units);

    return sharedBoundaryWork(plan).flatMap(function boundaryConflict(record) {
        const owners = boundaryUnits(record, indexedUnits);
        const usesFreshWorker = owners.some(function unitUsesFreshWorker(unit) {
            return unit.workerLifecycle === 'fresh-worker-per-unit';
        });
        const spansUnitsWithoutOneReusableLane = owners.length > 1 && (workerCount > 1 || usesFreshWorker);
        const needsProjection = record.boundary.scope === 'per-run' || spansUnitsWithoutOneReusableLane;

        if (!needsProjection || record.boundary.handleTransport === 'projected') {
            return [];
        }

        return [ {
            boundaryKey: record.boundary.key,
            kind: 'resource-projection-required' as const,
            resource: {
                name: record.boundary.resourceName,
                scope: record.boundary.scope
            },
            work: nonEmpty(record.work, 'Resource projection conflict requires work.')
        } ];
    });
}

function lifecycleConflicts(units: readonly WorkUnit[]): readonly RunExecutionPlanConflict[] {
    const unitsByConstraint = new Map<string, WorkUnit[]>();

    for (const unit of units) {
        for (const constraint of hardConstraintKeys(unit.resourceConstraints)) {
            const constrainedUnits = unitsByConstraint.get(constraint) ?? [];

            constrainedUnits.push(unit);
            unitsByConstraint.set(constraint, constrainedUnits);
        }
    }

    return Array
        .from(unitsByConstraint, function lifecycleConflict([ constraint, constrainedUnits ]) {
            const lifecycleSet = new Set(constrainedUnits.map(function unitLifecycle(unit) {
                return unit.workerLifecycle;
            }));
            const lifecycles = Array.from(lifecycleSet);

            return lifecycles.length <= 1 ? [] : [ {
                constraint,
                kind: 'worker-lifecycle' as const,
                lifecycles: nonEmpty(lifecycles, 'Worker lifecycle conflict requires lifecycles.'),
                units: nonEmpty(
                    constrainedUnits.map(function conflictingUnit(unit) {
                        return unit.id;
                    }),
                    'Worker lifecycle conflict requires units.'
                )
            } ];
        })
        .flat();
}

function workerCapacityConflict(input: ExecutionPlanCompatibilityInput): readonly RunExecutionPlanConflict[] {
    if (input.workerCount.resolved >= input.requiredLifecycleLanes) {
        return [];
    }

    const lifecycleSet = new Set(input.units.map(function unitLifecycle(unit) {
        return unit.workerLifecycle;
    }));
    const lifecycles = Array.from(lifecycleSet);

    return [ {
        available: input.workerCount.resolved,
        kind: 'worker-capacity',
        lifecycles: nonEmpty(lifecycles, 'Worker capacity conflict requires lifecycles.'),
        required: input.requiredLifecycleLanes
    } ];
}

function conflictKey(conflict: RunExecutionPlanConflict): string {
    return `${conflict.kind}:${stableJson(conflict)}`;
}

function sortedConflicts(conflicts: readonly RunExecutionPlanConflict[]): readonly RunExecutionPlanConflict[] {
    return conflicts.toSorted(function compareConflicts(left, right) {
        return conflictKey(left).localeCompare(conflictKey(right));
    });
}

export function collectedPlanCompatibilityConflicts(
    plan: CollectedRunPlan
): readonly RunExecutionPlanConflict[] {
    return sortedConflicts([ ...identityConflicts(plan), ...dependencyScopeConflicts(plan) ]);
}

export function executionPlanCompatibilityConflicts(
    input: ExecutionPlanCompatibilityInput
): readonly RunExecutionPlanConflict[] {
    return sortedConflicts([
        ...collectedPlanCompatibilityConflicts(input.selectedPlan),
        ...projectionConflicts(input.selectedPlan, input.units, input.workerCount.resolved),
        ...lifecycleConflicts(input.units),
        ...workerCapacityConflict(input)
    ]);
}

function singleReuseLane(units: readonly WorkUnit[], lanes: readonly PlacementLane[]): PlacementLane | null {
    const lane = lanes[0];
    const allUnitsReuseWorkers = units.every(function unitReusesWorker(unit) {
        return unit.workerLifecycle === 'reuse';
    });

    return lanes.length === 1 && lane !== undefined && allUnitsReuseWorkers
        ? lane
        : null;
}

function infrastructureOwner(): ResourceOwnershipPlan['owners'][number]['placement'] {
    return { id: 'resource-owner', kind: 'infrastructure-worker' };
}

function ownerPlacement(
    record: BoundaryWork,
    ownerUnits: readonly WorkUnit[],
    reusableLane: PlacementLane | null
): ResourceOwnershipPlan['owners'][number]['placement'] {
    if (record.boundary.scope === 'per-run') {
        return reusableLane === null
            ? infrastructureOwner()
            : { kind: 'executor-lane', lane: reusableLane.id };
    }

    const onlyUnit = ownerUnits[0];

    if (ownerUnits.length === 1 && onlyUnit !== undefined) {
        return { kind: 'work-unit', unit: onlyUnit.id };
    }

    return reusableLane === null
        ? infrastructureOwner()
        : { kind: 'executor-lane', lane: reusableLane.id };
}

export function createResourceOwnershipPlan(input: ResourceOwnershipInput): ResourceOwnershipPlan {
    const indexedUnits = unitsByWork(input.units);
    const reusableLane = singleReuseLane(input.units, input.lanes);
    const owners = sharedBoundaryWork(input.selectedPlan)
        .map(function plannedOwner(record) {
            const ownerUnits = boundaryUnits(record, indexedUnits);

            return {
                boundaryKey: record.boundary.key,
                placement: ownerPlacement(record, ownerUnits, reusableLane),
                resourceName: record.boundary.resourceName,
                scope: record.boundary.scope,
                work: nonEmpty(record.work, 'Resource owner requires work.')
            };
        })
        .toSorted(function compareOwners(left, right) {
            return left.boundaryKey.localeCompare(right.boundaryKey);
        });

    return { owners };
}
