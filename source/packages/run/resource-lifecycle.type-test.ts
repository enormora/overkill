import { describe, expect, test } from 'tstyche';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceSession,
    RuntimeContext,
    RuntimeGraph,
    RuntimeResourceMap
} from '../resources/resources.entry-point.ts';
import {
    resourceContextForStep,
    runtimeContextForStep,
    type activeManagedLifecycle,
    type combinedResourceEntries,
    type composedResourceSession,
    type directResourceEntries,
    type resourceMapFromEntries,
    type resourceWrapperErrorFromUnknown,
    type resourceWrapperLifecycleError,
    type stepRuntimeGraphs,
    type ComposedResourceSession,
    type LifecycleMessages,
    type ResourceWrapperStep
} from './resource-lifecycle.entry-point.ts';

declare const resource: AnyResourceDefinition;
declare const resourceHandles: ResourceContext<RuntimeResourceMap>;
declare const resourceSession: ResourceSession<RuntimeResourceMap>;
declare const resources: RuntimeResourceMap;
declare const runtime: RuntimeGraph;
declare const session: ComposedResourceSession;

describe('@overkill-dev/run/resource-lifecycle', function () {
    test('exposes lifecycle state coordination', function () {
        expect<typeof activeManagedLifecycle>().type.toBeCallableWith();
    });

    test('exposes wrapper session composition contracts', function () {
        expect<LifecycleMessages>().type.toBe<{
            readonly acquisitionFailure: string;
            readonly disposalFailure: string;
        }>();
        expect<{ readonly kind: 'resources'; readonly resources: RuntimeResourceMap; }>().type.toBeAssignableTo<
            ResourceWrapperStep
        >();
        expect<{ readonly kind: 'runtime'; readonly runtime: RuntimeGraph; }>().type.toBeAssignableTo<
            ResourceWrapperStep
        >();
        expect<typeof directResourceEntries>().type.toBeCallableWith([ { kind: 'resources', resources } ]);
        expect<typeof stepRuntimeGraphs>().type.toBeCallableWith([ { kind: 'runtime', runtime } ]);
        expect<typeof combinedResourceEntries>().type.toBeCallableWith([
            { kind: 'resources', resources },
            { kind: 'runtime', runtime }
        ]);
        expect<typeof resourceMapFromEntries>().type.toBeCallableWith([ { key: 'resource', resource } ]);
        expect<typeof composedResourceSession>().type.toBeCallableWith(resources, [ runtime ], resourceSession);
    });

    test('exposes scoped context projection', function () {
        expect(resourceContextForStep(resources, resourceHandles)).type.toBe<ResourceContext<RuntimeResourceMap>>();
        expect(runtimeContextForStep(runtime, session)).type.toBe<RuntimeContext<RuntimeGraph>>();
    });

    test('exposes lifecycle error wrapping', function () {
        expect<typeof resourceWrapperLifecycleError>().type.toBeCallableWith('Failed.', resource);
        expect<typeof resourceWrapperErrorFromUnknown>().type.toBeCallableWith('Failed.', resource);
    });
});
