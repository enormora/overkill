import {
    captureErrorHttpTranscript,
    emptyTranscriptView,
    type HttpTranscript
} from '../packages/simulation/transcript.entry-point.ts';
import { observeHttpFailureArtifacts, type HttpFailureCapture } from './local-http-failure-capture.ts';
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
import { observeLocalHttpServer, type LocalHttpTranscriptObserver } from './local-http-transcript-observer.ts';

export type LocalHttpServiceHandle = {
    readonly baseUrl: string;
    readonly endpoint: LocalServiceAddress;
    readonly transcript: HttpTranscript<unknown>;
};

type CustomLocalHttpTranscriptPolicy<Context> = {
    readonly kind: 'custom';
    readonly transcript: (server: LocalHttpServer) => HttpTranscript<Context>;
};
type DisabledLocalHttpTranscriptPolicy = { readonly kind: 'disabled'; };
type LocalHttpTranscriptPolicies<Context> = {
    readonly custom: CustomLocalHttpTranscriptPolicy<Context>;
    readonly disabled: DisabledLocalHttpTranscriptPolicy;
};

export type LocalHttpTranscriptPolicy<Context = unknown> = LocalHttpTranscriptPolicies<Context>[
    keyof LocalHttpTranscriptPolicies<Context>
];

export type LocalHttpResourceHandle<Handle extends LocalServiceConsumerHandle, Context = null> = Handle & {
    readonly transcript: HttpTranscript<Context>;
};

type TranscriptPolicyInput = readonly [] | readonly [LocalHttpTranscriptPolicy];
type PolicyContext<Policy> = Policy extends CustomLocalHttpTranscriptPolicy<infer Value> ? Value : null;
type TranscriptContext<Input extends TranscriptPolicyInput> = PolicyContext<Input[0]>;

type LocalHttpServerAddress = {
    readonly port: number;
};

export type LocalHttpServer = {
    readonly address: () => LocalHttpServerAddress | string | null;
    readonly close: (callback: (error?: Error) => void) => unknown;
    readonly listen: (port: number, host: string) => unknown;
    readonly listening: boolean;
    readonly off: {
        (event: 'error', listener: (error: Error) => void): unknown;
        (event: 'listening', listener: () => void): unknown;
    };
    readonly once: {
        (event: 'error', listener: (error: Error) => void): unknown;
        (event: 'listening', listener: () => void): unknown;
    };
};

type LocalHttpDefinition<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly dependencies: Dependencies;
    readonly dispose: (
        server: LocalHttpServer,
        context: LocalServiceDisposalContext<Dependencies>
    ) => Awaitable<void>;
    readonly name: Name;
    readonly ready: (
        server: LocalHttpServer,
        context: LocalServiceCreationContext<Dependencies>
    ) => Awaitable<ConsumerHandle>;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly start: (context: LocalServiceCreationContext<Dependencies>) => Awaitable<LocalHttpServer>;
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
    ) => LocalHttpServer;
    readonly dependencies: Dependencies;
    readonly dispose: (
        server: LocalHttpServer,
        context: LocalServiceDisposalContext<Dependencies>
    ) => Awaitable<void>;
    readonly handle: (
        service: LocalHttpServiceHandle,
        server: LocalHttpServer,
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
    ProjectedConsumerHandle extends LocalServiceConsumerHandle,
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

function serverEndpoint(server: Pick<LocalHttpServer, 'address'>, host: string): LocalServiceAddress {
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

function localHttpServiceHandle(
    endpoint: LocalServiceAddress,
    transcript: HttpTranscript<unknown>
): LocalHttpServiceHandle {
    return Object.freeze({
        endpoint,
        baseUrl: `http://${endpoint.host}:${endpoint.port}`,
        transcript
    });
}

function withTranscript<Handle extends LocalServiceConsumerHandle, Context>(
    handle: Handle,
    transcript: HttpTranscript<Context>
): LocalHttpResourceHandle<Handle, Context> {
    return Object.freeze({ ...handle, transcript });
}

function customTranscript(policy: LocalHttpTranscriptPolicy, server: LocalHttpServer): HttpTranscript<unknown> {
    if (policy.kind === 'disabled') {
        return emptyTranscriptView();
    }

    try {
        return policy.transcript(server);
    } catch (error: unknown) {
        return captureErrorHttpTranscript(error);
    }
}

type ServiceTranscript = {
    readonly view: HttpTranscript<unknown>;
    readonly observer: LocalHttpTranscriptObserver | null;
};
function serviceTranscript(
    server: LocalHttpServer,
    baseUrl: string,
    policy: LocalHttpTranscriptPolicy | null,
    scope: ResourceScope
): ServiceTranscript {
    if (policy === null) {
        const observer = observeLocalHttpServer(server, baseUrl, scope === 'per-case' ? 'attempt' : 'lifetime');
        return { view: observer.transcript, observer };
    }
    return { view: customTranscript(policy, server), observer: null };
}
function localHttpDefinition<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    const Dependencies extends ResourceDependencies
>(
    input: LocalHttpServiceResourceInput<Name, ConsumerHandle, Scope, Dependencies>,
    policy: LocalHttpTranscriptPolicy | null
): LocalHttpDefinition<Name, LocalHttpResourceHandle<ConsumerHandle, unknown>, Scope, Dependencies> {
    const observers = new WeakMap<LocalHttpServer, LocalHttpTranscriptObserver>();
    const captures = new WeakMap<LocalHttpServer, HttpFailureCapture>();

    return {
        name: input.name,
        scope: input.scope,
        requirements: input.requirements,
        dependencies: input.dependencies,
        address: input.address,
        start(context: LocalServiceCreationContext<Dependencies>): LocalHttpServer {
            return input.createServer(context);
        },
        async ready(server: LocalHttpServer, context: LocalServiceCreationContext<Dependencies>) {
            await listen(server, context.address);
            const endpoint = serverEndpoint(server, context.address.host);
            const { view, observer } = serviceTranscript(
                server,
                `http://${endpoint.host}:${endpoint.port}`,
                policy,
                input.scope
            );
            if (observer !== null) {
                observers.set(server, observer);
            }
            const capture = policy?.kind === 'disabled' ? null : observeHttpFailureArtifacts(input.name, view);
            if (capture !== null) {
                captures.set(server, capture);
            }

            return withTranscript(
                input.handle(
                    localHttpServiceHandle(endpoint, view),
                    server,
                    context
                ),
                view
            );
        },
        async dispose(server: LocalHttpServer, context: LocalServiceDisposalContext<Dependencies>) {
            try {
                await closeServer(server);
            } finally {
                observers.get(server)?.dispose();
                observers.delete(server);
                await captures.get(server)?.close();
                captures.delete(server);
            }
            await input.dispose(server, context);
        }
    };
}

function projectedHttpDefinition<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle extends LocalServiceConsumerHandle,
    const Dependencies extends ResourceDependencies
>(
    input: ProjectedHttpServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >,
    policy: LocalHttpTranscriptPolicy | null
): ProjectedLocalServiceResourceDefinitionInput<
    Name,
    LocalHttpServer,
    LocalHttpResourceHandle<ConsumerHandle, unknown>,
    Projection,
    LocalHttpResourceHandle<ProjectedConsumerHandle, unknown>,
    ProjectedLocalServiceScope,
    Dependencies
> {
    return {
        ...localHttpDefinition(input, policy),
        serializeHandle: input.serializeHandle,
        deserializeHandle(payload, context) {
            return withTranscript(input.deserializeHandle(payload, context), emptyTranscriptView());
        }
    };
}

function assertProjectedHttpService<
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle extends LocalServiceConsumerHandle,
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
    const Dependencies extends ResourceDependencies,
    const PolicyInput extends readonly [] | readonly [LocalHttpTranscriptPolicy]
>(
    input: LocalHttpServiceResourceInput<Name, ConsumerHandle, Scope, Dependencies>,
    ...policyInput: PolicyInput
): ResourceDefinition<
    Name,
    LocalHttpResourceHandle<ConsumerHandle, TranscriptContext<PolicyInput>>,
    Dependencies
>;
export function createLocalHttpServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle extends LocalServiceConsumerHandle,
    const Dependencies extends ResourceDependencies,
    const PolicyInput extends readonly [] | readonly [LocalHttpTranscriptPolicy]
>(
    input: ProjectedHttpServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >,
    ...policyInput: PolicyInput
): ResourceDefinition<
    Name,
    LocalHttpResourceHandle<ConsumerHandle, TranscriptContext<PolicyInput>>,
    Dependencies,
    LocalHttpResourceHandle<ProjectedConsumerHandle, TranscriptContext<PolicyInput>>
>;
export function createLocalHttpServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    const Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle extends LocalServiceConsumerHandle
>(
    input: MaybeProjectedHttpServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >,
    ...policyInput: readonly [] | readonly [LocalHttpTranscriptPolicy]
): unknown {
    const policy = policyInput[0] ?? null;

    if (isProjectedLocalServiceScope(input.scope)) {
        assertProjectedHttpService(input);

        return defineLocalServiceResource(projectedHttpDefinition(input, policy));
    }

    return defineLocalServiceResource({
        ...localHttpDefinition(input, policy),
        scope: input.scope
    });
}
