import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResourcesModule, type ResourcesModule } from '../../resources/resources.ts';

const resourcesModule = createResourcesModule({
    temporaryDirectoryPathPrefix: join(tmpdir(), 'overkill-temporary-directory-'),
    async createTemporaryDirectory(pathPrefix) {
        return await mkdtemp(pathPrefix);
    },
    async removeDirectory(path) {
        await rm(path, { force: true, recursive: true });
    }
});

export const composeRuntimeContext: ResourcesModule['composeRuntimeContext'] = resourcesModule.composeRuntimeContext;
export const composeRuntimes: ResourcesModule['composeRuntimes'] = resourcesModule.composeRuntimes;
export const createTemporaryDirectoryResource: ResourcesModule['createTemporaryDirectoryResource'] =
    resourcesModule.createTemporaryDirectoryResource;
export const defineLocalServiceResource: ResourcesModule['defineLocalServiceResource'] =
    resourcesModule.defineLocalServiceResource;
export const defineResource: ResourcesModule['defineResource'] = resourcesModule.defineResource;
export const defineRuntime: ResourcesModule['defineRuntime'] = resourcesModule.defineRuntime;
export const defineRuntimeMatrix: ResourcesModule['defineRuntimeMatrix'] = resourcesModule.defineRuntimeMatrix;

export {
    createSimulatedHttpServerResource
} from '../../resources/simulated-http-server-resource.ts';
export {
    isDefinedResource,
    isDefinedRuntime,
    isDefinedRuntimeGraph,
    isDefinedRuntimeMatrix,
    runtimeGraphLeaves
} from '../../resources/resources.ts';
export {
    assertPerCaseResourceGraph,
    assertResourceDependencyScopes
} from '../../resources/resource-graph.ts';
export {
    startResources
} from '../../resources/resource-session.ts';
export {
    ResourceLifecycleError
} from '../../resources/resource-lifecycle-error.ts';
export {
    startRuntime
} from '../../resources/runtime-lifecycle.ts';
export type {
    AnyResourceDefinition,
    ComposedRuntimeGraph,
    ExecutionRequirement,
    LocalServiceAddress,
    LocalServiceCreationContext,
    LocalServiceResourceDefinitionInput,
    ResourceContext,
    ResourceCreationContext,
    ResourceDependencies,
    ResourceDefinition,
    ResourceDefinitionInput,
    ResourceDisposalContext,
    ResourceHandle,
    ResourceProjectionContext,
    ResourceProjectionPayload,
    ResourceScope,
    RuntimeContext,
    RuntimeContextComposition,
    RuntimeDefinition,
    RuntimeDefinitionInput,
    RuntimeDimensions,
    RuntimeGraph,
    RuntimeGraphLeaf,
    RuntimeGraphContext,
    RuntimeId,
    RuntimeMatrixDefinition,
    RuntimeMatrixDefinitionInput,
    RuntimeMatrixVariant,
    RuntimeMatrixVariantMap,
    RuntimeResourceMap,
    RuntimeScopeContext,
    SharedRuntimeMatrixDefinitionInput,
    TemporaryDirectoryHandle
} from '../../resources/resources.ts';
export type {
    SimulatedHttpServerResource,
    SimulatedHttpServerResourceOptions
} from '../../resources/simulated-http-server-resource.ts';
export type {
    RuntimeDefinition as Runtime,
    RuntimeResourceMap as ResourceMap
} from '../../resources/resources.ts';
export type {
    ResourceLifecycleFailure,
    ResourceLifecyclePhase
} from '../../resources/resource-lifecycle-error.ts';
export type {
    ResourceSession,
    ResourceSessionDisposalContext,
    StartResourcesRequest
} from '../../resources/resource-session.ts';
export type {
    RuntimeSession,
    RuntimeSessionDisposalContext,
    StartRuntimeRequest
} from '../../resources/runtime-lifecycle.ts';
