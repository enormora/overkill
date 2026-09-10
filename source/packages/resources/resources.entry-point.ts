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
