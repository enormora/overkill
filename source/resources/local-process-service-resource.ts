import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
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
    type ProjectedLocalServiceResourceDefinitionInput,
    type ProjectedLocalServiceScope
} from './local-service-resource.ts';

export type LocalProcessOutputBuffer = {
    readonly bytes: () => Uint8Array;
    readonly text: () => string;
};

export type LocalProcessOutput = {
    readonly stderr: LocalProcessOutputBuffer;
    readonly stdout: LocalProcessOutputBuffer;
};

export type LocalProcessCommand = {
    readonly arguments: readonly string[];
    readonly command: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly workingDirectory: string | null;
};

export type LocalProcessSignal = 'SIGHUP' | 'SIGINT' | 'SIGKILL' | 'SIGTERM' | 'SIGUSR1' | 'SIGUSR2';

export type LocalProcessShutdown = {
    readonly forceSignal: LocalProcessSignal;
    readonly graceMilliseconds: number;
    readonly gracefulSignal: LocalProcessSignal;
};

type LocalProcessChild = {
    readonly exitCode: number | null;
    readonly kill: (signal: LocalProcessSignal) => boolean;
    readonly once: (
        event: 'error' | 'exit',
        listener: ((code: number | null, signal: string | null) => void) | ((error: Error) => void)
    ) => unknown;
    readonly signalCode: string | null;
};

export type LocalProcessOwner = {
    readonly child: LocalProcessChild;
    readonly output: LocalProcessOutput;
};

export type LocalProcessServiceResourceInput<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly command: (context: LocalServiceCreationContext<Dependencies>) => Awaitable<LocalProcessCommand>;
    readonly dependencies: Dependencies;
    readonly name: Name;
    readonly outputBufferBytes: number;
    readonly ready: (
        owner: LocalProcessOwner,
        context: LocalServiceCreationContext<Dependencies>
    ) => Awaitable<ConsumerHandle>;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly shutdown: LocalProcessShutdown;
};

type LocalProcessOutputWriters = {
    readonly appendStderr: (chunk: Buffer) => void;
    readonly appendStdout: (chunk: Buffer) => void;
    readonly output: LocalProcessOutput;
};

type LocalProcessDefinition<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly dependencies: Dependencies;
    readonly dispose: (
        owner: LocalProcessOwner,
        context: LocalServiceDisposalContext<Dependencies>
    ) => Awaitable<void>;
    readonly name: Name;
    readonly ready: (
        owner: LocalProcessOwner,
        context: LocalServiceCreationContext<Dependencies>
    ) => Awaitable<ConsumerHandle>;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly start: (context: LocalServiceCreationContext<Dependencies>) => Awaitable<LocalProcessOwner>;
};

type ProcessInputValidation = {
    readonly outputBufferBytes: number;
    readonly shutdown: LocalProcessShutdown;
};

type BoundedOutputBufferController = {
    readonly append: (chunk: Buffer) => void;
    readonly buffer: LocalProcessOutputBuffer;
};

type ProjectedProcessServiceInput<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly command: LocalProcessServiceResourceInput<
        Name,
        ConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies
    >['command'];
    readonly dependencies: Dependencies;
    readonly deserializeHandle: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['deserializeHandle'];
    readonly name: Name;
    readonly outputBufferBytes: number;
    readonly ready: LocalProcessServiceResourceInput<
        Name,
        ConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies
    >['ready'];
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ProjectedLocalServiceScope;
    readonly serializeHandle: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['serializeHandle'];
    readonly shutdown: LocalProcessShutdown;
};

type MaybeProjectedProcessServiceInput<
    Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
> = {
    readonly address: LocalServiceAddressRequest;
    readonly command: LocalProcessServiceResourceInput<Name, ConsumerHandle, ResourceScope, Dependencies>['command'];
    readonly dependencies: Dependencies;
    readonly deserializeHandle?: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['deserializeHandle'];
    readonly name: Name;
    readonly outputBufferBytes: number;
    readonly ready: LocalProcessServiceResourceInput<Name, ConsumerHandle, ResourceScope, Dependencies>['ready'];
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly serializeHandle?: LocalServiceHandleProjection<
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >['serializeHandle'];
    readonly shutdown: LocalProcessShutdown;
};

function createBoundedOutputBuffer(maxBytes: number): BoundedOutputBufferController {
    let value = Buffer.alloc(0);

    return {
        append(chunk) {
            value = Buffer.concat([ value, chunk ]);

            if (value.byteLength > maxBytes) {
                value = value.subarray(value.byteLength - maxBytes);
            }
        },
        buffer: Object.freeze({
            bytes() {
                return new Uint8Array(value);
            },
            text() {
                return value.toString('utf8');
            }
        })
    };
}

function localProcessOutput(maxBytes: number): LocalProcessOutputWriters {
    const stdout = createBoundedOutputBuffer(maxBytes);
    const stderr = createBoundedOutputBuffer(maxBytes);

    return {
        appendStderr: stderr.append,
        appendStdout: stdout.append,
        output: Object.freeze({
            stderr: stderr.buffer,
            stdout: stdout.buffer
        })
    };
}

function attachOutputDrains(child: ChildProcess, output: LocalProcessOutputWriters): void {
    if (child.stdout === null || child.stderr === null) {
        throw new TypeError('Local process service requires piped stdout and stderr.');
    }

    child.stdout.on('data', output.appendStdout);
    child.stderr.on('data', output.appendStderr);
}

function spawnLocalProcess(command: LocalProcessCommand, output: LocalProcessOutputWriters): ChildProcess {
    const child = spawn(command.command, command.arguments, {
        cwd: command.workingDirectory ?? process.cwd(),
        env: command.environment,
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    });

    attachOutputDrains(child, output);

    return child;
}

async function processExitFailure(owner: LocalProcessOwner): Promise<never> {
    return await new Promise(function rejectOnProcessExit(_resolve, reject) {
        owner.child.once('error', reject);
        owner.child.once('exit', function rejectEarlyExit(code, signal) {
            reject(
                new Error(
                    [
                        `Local process service exited before readiness: code ${String(code)}, signal ${
                            String(signal)
                        }.`,
                        owner.output.stderr.text()
                    ]
                        .filter(Boolean)
                        .join('\n')
                )
            );
        });
    });
}

async function readyLocalProcess<
    ConsumerHandle extends LocalServiceConsumerHandle,
    Dependencies extends ResourceDependencies
>(
    owner: LocalProcessOwner,
    context: LocalServiceCreationContext<Dependencies>,
    input: Pick<LocalProcessServiceResourceInput<string, ConsumerHandle, ResourceScope, Dependencies>, 'ready'>
): Promise<ConsumerHandle> {
    return await Promise.race([
        input.ready(owner, context),
        processExitFailure(owner)
    ]);
}

async function waitForProcessExit(child: LocalProcessChild): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    await new Promise<void>(function resolveOnExit(resolve) {
        child.once('exit', function resolveExit() {
            resolve();
        });
    });
}

async function disposeLocalProcess(owner: LocalProcessOwner, shutdown: LocalProcessShutdown): Promise<void> {
    if (owner.child.exitCode !== null || owner.child.signalCode !== null) {
        return;
    }

    owner.child.kill(shutdown.gracefulSignal);
    const exited = waitForProcessExit(owner.child);
    const result = await Promise.race([ exited, wait(shutdown.graceMilliseconds, 'delay') ]);

    if (result === 'delay') {
        owner.child.kill(shutdown.forceSignal);
        await waitForProcessExit(owner.child);
    }
}

function assertProcessInput(input: ProcessInputValidation): void {
    if (!Number.isSafeInteger(input.outputBufferBytes) || input.outputBufferBytes < 0) {
        throw new TypeError('Local process service outputBufferBytes must be a non-negative integer.');
    }

    if (!Number.isSafeInteger(input.shutdown.graceMilliseconds) || input.shutdown.graceMilliseconds < 0) {
        throw new TypeError('Local process service shutdown.graceMilliseconds must be a non-negative integer.');
    }
}

function localProcessDefinition<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    const Dependencies extends ResourceDependencies
>(
    input: LocalProcessServiceResourceInput<Name, ConsumerHandle, Scope, Dependencies>
): LocalProcessDefinition<Name, ConsumerHandle, Scope, Dependencies> {
    return {
        name: input.name,
        scope: input.scope,
        requirements: input.requirements,
        dependencies: input.dependencies,
        address: input.address,
        async start(context: LocalServiceCreationContext<Dependencies>): Promise<LocalProcessOwner> {
            const command = await input.command(context);
            const output = localProcessOutput(input.outputBufferBytes);

            return Object.freeze({
                child: spawnLocalProcess(command, output),
                output: output.output
            });
        },
        async ready(owner: LocalProcessOwner, context: LocalServiceCreationContext<Dependencies>) {
            return await readyLocalProcess(owner, context, input);
        },
        async dispose(owner: LocalProcessOwner) {
            await disposeLocalProcess(owner, input.shutdown);
        }
    };
}

function projectedProcessDefinition<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    const Dependencies extends ResourceDependencies
>(
    input: ProjectedProcessServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): ProjectedLocalServiceResourceDefinitionInput<
    Name,
    LocalProcessOwner,
    ConsumerHandle,
    Projection,
    ProjectedConsumerHandle,
    ProjectedLocalServiceScope,
    Dependencies
> {
    return {
        ...localProcessDefinition(input),
        serializeHandle: input.serializeHandle,
        deserializeHandle: input.deserializeHandle
    };
}

function assertProjectedProcessService<
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
>(
    input: MaybeProjectedProcessServiceInput<
        string,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): asserts input is ProjectedProcessServiceInput<
    string,
    ConsumerHandle,
    Projection,
    ProjectedConsumerHandle,
    Dependencies
> {
    if (input.serializeHandle === undefined || input.deserializeHandle === undefined) {
        throw new TypeError('Projected local process services require handle projection callbacks.');
    }
}

export function createLocalProcessServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies
>(
    input: LocalProcessServiceResourceInput<Name, ConsumerHandle, Scope, Dependencies>
): ResourceDefinition<Name, ConsumerHandle, Dependencies>;
export function createLocalProcessServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    const Dependencies extends ResourceDependencies
>(
    input: ProjectedProcessServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): ResourceDefinition<Name, ConsumerHandle, Dependencies, ProjectedConsumerHandle>;
export function createLocalProcessServiceResource<
    const Name extends string,
    ConsumerHandle extends LocalServiceConsumerHandle,
    const Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle
>(
    input: MaybeProjectedProcessServiceInput<
        Name,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Dependencies
    >
): unknown {
    assertProcessInput(input);

    if (isProjectedLocalServiceScope(input.scope)) {
        assertProjectedProcessService(input);

        return defineLocalServiceResource(projectedProcessDefinition(input));
    }

    return defineLocalServiceResource({
        ...localProcessDefinition(input),
        scope: input.scope
    });
}
