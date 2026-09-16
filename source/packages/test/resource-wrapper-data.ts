import type {
    AnyResourceDefinition,
    ResourceMap,
    RuntimeGraph
} from '../resources/resources.entry-point.ts';
import type { TestScope } from '../engine/engine.entry-point.ts';

type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
};

type LifecycleMessages = {
    readonly acquisitionFailure: string;
    readonly disposalFailure: string;
};

export type ResourceEntry = {
    readonly key: string;
    readonly resource: AnyResourceDefinition;
};

export type ResourceWrapperResourcesStep = {
    readonly kind: 'resources';
    readonly resources: ResourceMap;
};

export type ResourceWrapperRuntimeStep = {
    readonly kind: 'runtime';
    readonly runtime: RuntimeGraph;
};

export type ResourceWrapperScopeStep = {
    readonly collision: 'preserve-existing' | 'replace-existing';
    readonly kind: 'scope';
    readonly mapScope: (scope: TestScope) => Readonly<Record<string, unknown>>;
    readonly name: string;
};

export type ResourceWrapperStep = ResourceWrapperResourcesStep | ResourceWrapperRuntimeStep;
export type ResourceWrapperAction = ResourceWrapperScopeStep | ResourceWrapperStep;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasResourceIdentity(value: Readonly<Record<string, unknown>>): boolean {
    return typeof value.name === 'string' && value.name.trim().length > 0;
}

function hasResourceGraphData(value: Readonly<Record<string, unknown>>): boolean {
    return isRecord(value.dependencies) &&
        Array.isArray(value.requirements) &&
        typeof value.scope === 'string';
}

function hasResourceLifecycle(value: Readonly<Record<string, unknown>>): boolean {
    return typeof value.acquire === 'function' &&
        (typeof value.dispose === 'function' || value.dispose === null);
}

function isResourceDescriptor(value: unknown): value is AnyResourceDefinition {
    return isRecord(value) &&
        hasResourceIdentity(value) &&
        hasResourceGraphData(value) &&
        hasResourceLifecycle(value);
}

function hasRuntimeIdentity(value: Readonly<Record<string, unknown>>): boolean {
    return typeof value.name === 'string' && value.name.trim().length > 0;
}

function hasRuntimeGraphData(value: Readonly<Record<string, unknown>>): boolean {
    return isRecord(value.dimensions) &&
        Array.isArray(value.requirements) &&
        isRecord(value.resources);
}

function hasRuntimeResources(value: Readonly<Record<string, unknown>>): boolean {
    return isRecord(value.resources) && Object.values(value.resources).every(isResourceDescriptor);
}

function isRuntimeGraph(value: unknown): value is RuntimeGraph {
    return isRecord(value) &&
        hasRuntimeIdentity(value) &&
        hasRuntimeGraphData(value) &&
        hasRuntimeResources(value);
}

function entries(record: Readonly<Record<string, AnyResourceDefinition>>): readonly [string, AnyResourceDefinition][] {
    return Object.entries(record);
}

export function ensureResourceDescriptor(resource: unknown, message: string): AnyResourceDefinition {
    if (isResourceDescriptor(resource)) {
        return resource;
    }

    throw new TypeError(message);
}

export function ensureRuntimeGraph(runtime: unknown, message: string): RuntimeGraph {
    if (isRuntimeGraph(runtime)) {
        return runtime;
    }

    throw new TypeError(message);
}

export function readResourceMap(resources: unknown, message: string): ResourceMap {
    if (!isRecord(resources)) {
        throw new TypeError(message);
    }

    const resourceEntries = Object.entries(resources);

    if (resourceEntries.length === 0) {
        throw new TypeError(message);
    }

    const resourceMap: Mutable<Record<string, AnyResourceDefinition>> = {};

    for (const [ key, resource ] of resourceEntries) {
        resourceMap[key] = ensureResourceDescriptor(resource, message);
    }

    return Object.freeze(resourceMap);
}

export function directResourceEntries(actions: readonly ResourceWrapperAction[]): readonly ResourceEntry[] {
    return actions.flatMap(function actionResourceEntries(action) {
        return action.kind === 'resources'
            ? entries(action.resources).map(function resourceEntry([ key, resource ]) {
                return { key, resource };
            })
            : [];
    });
}

export function resourceWrapperSteps(actions: readonly ResourceWrapperAction[]): readonly ResourceWrapperStep[] {
    return actions.flatMap(function actionResourceStep(action) {
        return action.kind === 'resources' || action.kind === 'runtime' ? [ action ] : [];
    });
}

export function stepRuntimeGraphs(actions: readonly ResourceWrapperAction[]): readonly RuntimeGraph[] {
    return actions.flatMap(function actionRuntimeGraph(action) {
        return action.kind === 'runtime' ? [ action.runtime ] : [];
    });
}

export function lifecycleMessages(actions: readonly ResourceWrapperAction[]): LifecycleMessages {
    const hasDirectResources = actions.some(function actionHasDirectResources(action) {
        return action.kind === 'resources';
    });

    return hasDirectResources
        ? {
            acquisitionFailure: 'Resource acquisition failed.',
            disposalFailure: 'Resource disposal failed.'
        }
        : {
            acquisitionFailure: 'Runtime resource acquisition failed.',
            disposalFailure: 'Runtime resource disposal failed.'
        };
}

export function resourceWrapperStep(resource: AnyResourceDefinition): ResourceWrapperStep {
    return {
        kind: 'resources',
        resources: Object.freeze({ [resource.name]: resource })
    };
}

export function resourcesWrapperStep(resources: ResourceMap): ResourceWrapperStep {
    return { kind: 'resources', resources };
}

export function runtimeWrapperStep(runtime: RuntimeGraph): ResourceWrapperStep {
    return { kind: 'runtime', runtime };
}

export function scopeWrapperStep(
    name: string,
    mapScope: (scope: TestScope) => Readonly<Record<string, unknown>>,
    collision: ResourceWrapperScopeStep['collision'] = 'preserve-existing'
): ResourceWrapperScopeStep {
    return { collision, kind: 'scope', mapScope, name };
}
