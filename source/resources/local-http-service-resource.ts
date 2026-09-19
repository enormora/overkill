import type { Server } from 'node:http';
import type {
    Awaitable,
    ExecutionRequirement,
    ResourceDefinition,
    ResourceDependencies,
    ResourceProjectionPayload,
    ResourceScope
} from './resources.ts';
import {
    defineLocalServiceResource,
    isProjectedLocalServiceScope,
    type LocalServiceAddressRequest,
    type LocalServiceConsumerHandle,
    type LocalServiceCreationContext,
    type LocalServiceDisposalContext,
    type LocalServiceHandleProjection,
    type LocalServiceAddress,
    type ProjectedLocalServiceResourceDefinitionInput,
    type ProjectedLocalServiceScope
} from './local-service-resource.ts';

export type LocalHttpServiceHandle = {
    readonly baseUrl: string;
    readonly endpoint: LocalServiceAddress;
};

type LocalHttpServer = Readonly<
    Pick<Server, 'address' | 'close' | 'listen' | 'listening' | 'off' | 'once'>
>;

type LocalHttpDefinition<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly dependencies: Dependencies;
    readonly dispose: (
        server: Server,
        context: LocalServiceDisposalContext<Dependencies>
    ) => Awaitable<void>;
    readonly name: Name;
    readonly ready: (
        server: Server,
        context: LocalServiceCreationContext<Dependencies>
    ) => Awaitable<ConsumerHandle>;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly start: (context: LocalServiceCreationContext<Dependencies>) => Awaitable<Server>;
};

export type LocalHttpServiceResourceInput<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly createServer: (
        context: LocalServiceCreationContext<Dependencies>
    ) => Server;
    readonly dependencies: Dependencies;
    readonly dispose: (
        server: Server,
        context: LocalServiceDisposalContext<Dependencies>
    ) => Awaitable<void>;
    readonly handle: (
        service: LocalHttpServiceHandle,
        server: Server,
        context: LocalServiceCreationContext<Dependencies>
    ) => ConsumerHandle;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
};

type ProjectedHttpServiceInput<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly createServer: LocalHttpServiceResourceInput<
        Name,
        ConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies
    >['createServer'];
    readonly dependencies: Dependencies;
    readonly deserializeHandle: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['deserializeHandle'];
    readonly dispose: LocalHttpServiceResourceInput<
        Name,
        ConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies
    >['dispose'];
    readonly handle: LocalHttpServiceResourceInput<
        Name,
        ConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies
    >['handle'];
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ProjectedLocalServiceScope;
    readonly serializeHandle: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['serializeHandle'];
};

type MaybeProjectedHttpServiceInput<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly createServer: LocalHttpServiceResourceInput<
        Name,
        ConsumerHandle,
        ResourceScope,
        Dependencies
    >['createServer'];
    readonly dependencies: Dependencies;
    readonly deserializeHandle?: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['deserializeHandle'];
    readonly dispose: LocalHttpServiceResourceInput<Name, ConsumerHandle, ResourceScope, Dependencies>['dispose'];
    readonly handle: LocalHttpServiceResourceInput<Name, ConsumerHandle, ResourceScope, Dependencies>['handle'];
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly serializeHandle?: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['serializeHandle'];
};

function serverEndpoint(server: Pick<Server, 'address'>, host: string): LocalServiceAddress {
    const address = server.address();

    if (typeof address !== 'object' || address === null) {
        throw new TypeError('Local HTTP service did not expose a TCP address.');
    }

    return Object.freeze({
        host,
        port: address.port
    });
}

async function listen(server: LocalHttpServer, address: LocalServiceAddress): Promise<void> {
    await new Promise<void>(function startListening(resolve, reject) {
        const listener = {
            reject(error: Error): void {
                server.off('listening', listener.resolve);
                reject(error);
            },
            resolve(): void {
                server.off('error', listener.reject);
                resolve();
            }
        };

        server.once('error', listener.reject);
        server.once('listening', listener.resolve);
        server.listen(address.port, address.host);
    });
}

async function closeServer(server: LocalHttpServer): Promise<void> {
    if (!server.listening) {
        return;
    }

    await new Promise<void>(function close(resolve, reject) {
        server.close(function finish(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function localHttpServiceHandle(endpoint: LocalServiceAddress): LocalHttpServiceHandle {
    return Object.freeze({
        endpoint,
        baseUrl: `http://${endpoint.host}:${endpoint.port}`
    });
}

function localHttpDefinition<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    const Dependencies extends ResourceDependencies
>(
    input: LocalHttpServiceResourceInput<Name, ConsumerHandle, Scope, Dependencies>
): LocalHttpDefinition<Name, ConsumerHandle, Scope, Dependencies> {
    return {
        name: input.name,
        scope: input.scope,
        requirements: input.requirements,
        dependencies: input.dependencies,
        address: input.address,
        start(context: LocalServiceCreationContext<Dependencies>): Server {
            return input.createServer(context);
        },
        async ready(server: Server, context: LocalServiceCreationContext<Dependencies>) {
            await listen(server, context.address);

            return input.handle(
                localHttpServiceHandle(serverEndpoint(server, context.address.host)),
                server,
                context
            );
        },
        async dispose(server: Server, context: LocalServiceDisposalContext<Dependencies>) {
            await closeServer(server);
            await input.dispose(server, context);
        }
    };
}

function projectedHttpDefinition<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    const Dependencies extends ResourceDependencies
>(
    input: ProjectedHttpServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): ProjectedLocalServiceResourceDefinitionInput<
    Name,
    Server,
    ConsumerHandle,
    Projection,
    ProjectedConsumerHandle,
    ProjectedLocalServiceScope,
    Dependencies
> {
    return {
        ...localHttpDefinition(input),
        serializeHandle: input.serializeHandle,
        deserializeHandle: input.deserializeHandle
    };
}

function assertProjectedHttpService<
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
>(
    input: MaybeProjectedHttpServiceInput<
        string,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): asserts input is ProjectedHttpServiceInput<
    string,
    ConsumerHandle,
    Projection,
    ProjectedConsumerHandle,
    Dependencies
> {
    if (input.serializeHandle === undefined || input.deserializeHandle === undefined) {
        throw new TypeError('Projected local HTTP services require handle projection callbacks.');
    }
}

export function createLocalHttpServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies
>(
    input: LocalHttpServiceResourceInput<Name, ConsumerHandle, Scope, Dependencies>
): ResourceDefinition<Name, ConsumerHandle, Dependencies>;
export function createLocalHttpServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    const Dependencies extends ResourceDependencies
>(
    input: ProjectedHttpServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): ResourceDefinition<Name, ConsumerHandle, Dependencies, ProjectedConsumerHandle>;
export function createLocalHttpServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    const Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle
>(
    input: MaybeProjectedHttpServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): unknown {
    if (isProjectedLocalServiceScope(input.scope)) {
        assertProjectedHttpService(input);

        return defineLocalServiceResource(projectedHttpDefinition(input));
    }

    return defineLocalServiceResource({
        ...localHttpDefinition(input),
        scope: input.scope
    });
}
