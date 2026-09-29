import {
    resolvedResourceScenarioBindings,
    type AnyResourceDefinition
} from '../resources/resources.ts';
import { sourceResourceDefinition } from '../resources/resource-scenario-binding.ts';

type ResourceCacheScenarioBinding = {
    readonly name: string;
    readonly timing: 'acquire' | 'request-routed';
    readonly value: string;
};

export type ResourceCacheIdentityNode = {
    readonly dependencies: readonly {
        readonly key: string;
        readonly resource: ResourceCacheIdentityNode;
    }[];
    readonly scenarios: readonly ResourceCacheScenarioBinding[];
};

type ScenarioIdentity = readonly [name: string, value: string];
type AcquisitionIdentity = {
    readonly dependencies: readonly (readonly [key: string, identity: HandleIdentity])[];
    readonly scenarios: readonly ScenarioIdentity[];
};
type HandleIdentity = {
    readonly acquisition: AcquisitionIdentity | null;
    readonly scenarios: readonly ScenarioIdentity[];
};
type ResourceIdentities = {
    readonly acquisition: AcquisitionIdentity | null;
    readonly handle: HandleIdentity | null;
};

function compareText(left: string, right: string): number {
    return left.localeCompare(right);
}

function scenarioIdentity(
    node: ResourceCacheIdentityNode,
    timing: ResourceCacheScenarioBinding['timing']
): readonly ScenarioIdentity[] {
    return node
        .scenarios
        .filter(function timingMatches(binding) {
            return binding.timing === timing;
        })
        .toSorted(function compareBindings(left, right) {
            return compareText(left.name, right.name);
        })
        .map(function toIdentity(binding) {
            return [ binding.name, binding.value ] as const;
        });
}

function resourceIdentities(node: ResourceCacheIdentityNode): ResourceIdentities {
    const scenarios = scenarioIdentity(node, 'acquire');
    const dependencies = node
        .dependencies
        .toSorted(function compareDependencies(left, right) {
            return compareText(left.key, right.key);
        })
        .flatMap(function dependencyIdentity(dependency) {
            const identity = resourceIdentities(dependency.resource).handle;

            return identity === null ? [] : [ [ dependency.key, identity ] as const ];
        });
    const acquisition = scenarios.length === 0 && dependencies.length === 0
        ? null
        : { dependencies, scenarios };
    const routedScenarios = scenarioIdentity(node, 'request-routed');
    const handle = acquisition === null && routedScenarios.length === 0
        ? null
        : { acquisition, scenarios: routedScenarios };

    return { acquisition, handle };
}

export function resourceAcquisitionCacheIdentity(node: ResourceCacheIdentityNode): string {
    const identity = resourceIdentities(node).acquisition;

    return identity === null ? '' : JSON.stringify(identity);
}

export function resourceHandleCacheIdentity(node: ResourceCacheIdentityNode): string {
    const identity = resourceIdentities(node).handle;

    return identity === null ? '' : JSON.stringify(identity);
}

export function resourceDescriptorCacheIdentityNode(resource: AnyResourceDefinition): ResourceCacheIdentityNode {
    const bindings = resolvedResourceScenarioBindings(resource);

    return {
        dependencies: Object.values(resource.dependencies).map(function dependencyNode(dependency) {
            return {
                key: sourceResourceDefinition(dependency).name,
                resource: resourceDescriptorCacheIdentityNode(dependency)
            };
        }),
        scenarios: Object.entries(resource.scenarios).map(function scenarioBinding([ name, slot ]) {
            return {
                name,
                timing: slot.timing,
                value: bindings[name] ?? slot.default
            };
        })
    };
}
