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
export const createTemporaryDirectoryResource: ResourcesModule['createTemporaryDirectoryResource'] =
    resourcesModule.createTemporaryDirectoryResource;
export const defineResource: ResourcesModule['defineResource'] = resourcesModule.defineResource;
export const defineRuntime: ResourcesModule['defineRuntime'] = resourcesModule.defineRuntime;

export {
    ResourceLifecycleError,
    startRuntime
} from '../../resources/runtime-lifecycle.ts';
export type {
    ExecutionRequirement,
    ResourceContext,
    ResourceCreationContext,
    ResourceDependencies,
    ResourceDefinition,
    ResourceDefinitionInput,
    ResourceDisposalContext,
    ResourceHandle,
    ResourceScope,
    RuntimeContext,
    RuntimeContextComposition,
    RuntimeDefinition,
    RuntimeDefinitionInput,
    RuntimeDimensions,
    RuntimeId,
    TemporaryDirectoryHandle
} from '../../resources/resources.ts';
export type {
    ResourceLifecycleFailure,
    ResourceLifecyclePhase,
    RuntimeSession,
    RuntimeSessionDisposalContext,
    StartRuntimeRequest
} from '../../resources/runtime-lifecycle.ts';
