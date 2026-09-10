import { dirname, join } from 'node:path';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy.ts';
import type { RunRequest } from './run-types.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildCommand,
    SupervisedChildMessage
} from './supervised-protocol.ts';
import type { StoredRunValue, SupervisedRunState } from './supervised-run-state.ts';

type SupervisedChildEventListener = {
    readonly error: (error: Error) => void;
    readonly exit: () => void;
    readonly message: (message: SupervisedChildMessage) => void;
};

type SupervisedChildListenerRegistration = {
    readonly [Event in keyof SupervisedChildEventListener]: readonly [
        Event,
        SupervisedChildEventListener[Event]
    ];
}[keyof SupervisedChildEventListener];

type SupervisedChildProcessOutput = {
    readonly on: (event: 'data', listener: (chunk: Uint8Array) => void) => unknown;
};

export type SupervisedChildProcess = {
    readonly exitCode: number | null;
    readonly kill: (signal: 'SIGKILL') => unknown;
    readonly on: (...registration: SupervisedChildListenerRegistration) => unknown;
    readonly pid: number | undefined;
    readonly send: (message: SupervisedAssignmentCommand | SupervisedChildCommand) => unknown;
    readonly signalCode: string | null;
    readonly stderr: SupervisedChildProcessOutput | null;
    readonly stdout: SupervisedChildProcessOutput | null;
};

type SupervisedChildStartOptions = {
    readonly capabilityRestrictions: {
        readonly mode: 'disabled' | 'enabled';
    };
    readonly cwd: string;
    readonly environmentVariables: RuntimeCapabilityPolicyEnvironment;
};

type SupervisedChildForkOptions = {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly execArgv: readonly string[];
    readonly stdio: readonly ['ignore', 'pipe', 'pipe', 'ipc'];
};

export type SupervisedChildProcessStarterDependencies = {
    readonly childPackageRoot: string;
    readonly childProcessEntryPoint: string;
    readonly fork: (
        modulePath: string,
        childArguments: readonly string[],
        options: SupervisedChildForkOptions
    ) => SupervisedChildProcess;
    readonly realpath: (path: string) => Promise<string>;
};

export type SupervisedChildProcessStarter = (
    options: SupervisedChildStartOptions
) => Promise<SupervisedChildProcess>;

type TraceEnvMutation = {
    readonly capability: string;
    readonly message: string;
};

export type SupervisedChildOutputRuntime = {
    readonly capabilityRestrictions: {
        readonly mode: 'disabled' | 'enabled';
    };
    readonly capture: RunRequest['capture'];
    readonly child: SupervisedChildProcess;
    readonly dependencies: {
        readonly liveOutput: {
            readonly stderr: {
                readonly write: (chunk: Uint8Array) => void;
            };
            readonly stdout: {
                readonly write: (chunk: Uint8Array) => void;
            };
        };
        readonly wallClock: {
            readonly currentTimestampInMilliseconds: number;
        };
    };
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

const supervisedChildProcessEntryPointArgument = '--overkill-supervised-child';

function sanitizedChildEnvironment(environmentVariables: RuntimeCapabilityPolicyEnvironment): Record<string, string> {
    const environment = Object.fromEntries(
        Object.entries(environmentVariables).filter(function hasEnvironmentValue(
            entry
        ): entry is [string, string] {
            return entry[1] !== undefined;
        })
    );

    delete environment.NODE_OPTIONS;
    delete environment.NODE_V8_COVERAGE;
    delete environment.NODE_CONFIG;
    delete environment.NODE_CHANNEL_FD;
    delete environment.NODE_UNIQUE_ID;

    return environment;
}

function nodeModulesCandidates(startPath: string): readonly string[] {
    const candidates: string[] = [];
    let currentPath = startPath;
    let parentPath = dirname(currentPath);

    while (parentPath !== currentPath) {
        candidates.push(join(currentPath, 'node_modules'));
        currentPath = parentPath;
        parentPath = dirname(currentPath);
    }

    return [ ...candidates, join(currentPath, 'node_modules') ];
}

async function existingRealPath(
    path: string,
    dependencies: SupervisedChildProcessStarterDependencies
): Promise<string | null> {
    try {
        return await dependencies.realpath(path);
    } catch {
        return null;
    }
}

async function existingPermissionRoots(
    paths: readonly string[],
    dependencies: SupervisedChildProcessStarterDependencies
): Promise<readonly string[]> {
    const roots: string[] = [];

    for (const candidatePath of paths) {
        const realPath = await existingRealPath(candidatePath, dependencies);

        if (realPath !== null) {
            roots.push(candidatePath, realPath);
        }
    }

    return roots;
}

async function readPermissionRoots(
    options: SupervisedChildStartOptions,
    dependencies: SupervisedChildProcessStarterDependencies
): Promise<readonly string[]> {
    return Array.from(
        new Set(
            await existingPermissionRoots([
                options.cwd,
                dependencies.childPackageRoot,
                ...nodeModulesCandidates(options.cwd),
                ...nodeModulesCandidates(dependencies.childPackageRoot)
            ], dependencies)
        )
    );
}

async function supervisedChildExecArgv(
    options: SupervisedChildStartOptions,
    dependencies: SupervisedChildProcessStarterDependencies
): Promise<string[]> {
    if (options.capabilityRestrictions.mode === 'disabled') {
        return [];
    }

    const permissionRoots = await readPermissionRoots(options, dependencies);

    return [
        '--permission',
        '--trace-env',
        '--trace-env-js-stack',
        ...permissionRoots.map(function allowRead(root) {
            return `--allow-fs-read=${root}`;
        })
    ];
}

export function createSupervisedChildProcessStarter(
    dependencies: SupervisedChildProcessStarterDependencies
): SupervisedChildProcessStarter {
    return async function startSupervisedChild(options) {
        return dependencies.fork(
            dependencies.childProcessEntryPoint,
            [ supervisedChildProcessEntryPointArgument ],
            {
                cwd: options.cwd,
                env: sanitizedChildEnvironment(options.environmentVariables),
                execArgv: await supervisedChildExecArgv(options, dependencies),
                stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
            }
        );
    };
}

export async function runSupervisedChildProcessEntryPoint(
    childArguments: readonly string[],
    loadSupervisedChild: () => Promise<unknown>
): Promise<void> {
    if (childArguments.includes(supervisedChildProcessEntryPointArgument)) {
        await loadSupervisedChild();
    }
}

function activeCapture(runtime: SupervisedChildOutputRuntime): RunRequest['capture'] {
    const [ activeCase ] = Array.from(runtime.state.activeCases.values());

    if (runtime.capture === 'live' || runtime.state.activeCases.size !== 1 || activeCase === undefined) {
        return runtime.capture;
    }

    return activeCase.capture ?? runtime.capture;
}

function recordOrWriteCapturedOutput(
    stream: 'stderr' | 'stdout',
    chunk: Uint8Array,
    runtime: SupervisedChildOutputRuntime
): void {
    if (activeCapture(runtime) === 'live') {
        runtime.dependencies.liveOutput[stream].write(chunk);

        return;
    }

    runtime.state.recordCapturedOutput(
        stream,
        chunk,
        runtime.dependencies.wallClock.currentTimestampInMilliseconds
    );
}

function observeChildStdout(runtime: SupervisedChildOutputRuntime): void {
    runtime.child.stdout?.on('data', function recordStdoutOutput(chunk: Uint8Array) {
        if (chunk.length === 0) {
            return;
        }

        if (runtime.capabilityRestrictions.mode === 'disabled') {
            recordOrWriteCapturedOutput('stdout', chunk, runtime);

            return;
        }

        runtime.terminalFailure.write(true);
        runtime.state.recordRuntimePolicyViolation(
            'raw-stdout',
            'Runtime policy violation: supervised child wrote to stdout.'
        );
    });
}

const ignoredTraceEnvMutationVariables = new Set([
    'NODE_CHANNEL_FD',
    'NODE_CHANNEL_SERIALIZATION_MODE',
    'NODE_V8_COVERAGE',
    'NODE_UNIQUE_ID'
]);

function traceEnvMutationVariable(line: string): string | null {
    const match = /^\[--trace-env\] (?:delete|set) "(?<variable>[^"]+)"/u.exec(line);

    return match?.groups?.variable ?? null;
}

function traceEnvMutation(line: string): TraceEnvMutation | null {
    const variable = traceEnvMutationVariable(line);

    if (variable === null || ignoredTraceEnvMutationVariables.has(variable)) {
        return null;
    }

    if (line.startsWith('[--trace-env] set ')) {
        return {
            capability: 'process-env',
            message: `Runtime policy violation: process.env value was set: ${variable}.`
        };
    }

    return line.startsWith('[--trace-env] delete ')
        ? {
            capability: 'process-env',
            message: `Runtime policy violation: process.env value was deleted: ${variable}.`
        }
        : null;
}

function traceEnvStackLine(line: string): boolean {
    return line.trim() === '' || line === '----- JavaScript stack trace -----' || /^\d+:/u.test(line);
}

function recordTraceEnvMutation(
    mutation: TraceEnvMutation,
    runtime: SupervisedChildOutputRuntime
): void {
    runtime.terminalFailure.write(true);
    runtime.state.recordRuntimePolicyViolation(mutation.capability, mutation.message);
}

function recordRawStderr(runtime: SupervisedChildOutputRuntime): void {
    runtime.terminalFailure.write(true);
    runtime.state.recordRuntimePolicyViolation(
        'raw-stderr',
        'Runtime policy violation: supervised child wrote to stderr.'
    );
}

function ignoredStderrLine(line: string, readingTraceEnvStack: boolean): boolean {
    return line.startsWith('[--trace-env]') || readingTraceEnvStack && traceEnvStackLine(line);
}

function recordStderrLine(
    line: string,
    readingTraceEnvStack: boolean,
    runtime: SupervisedChildOutputRuntime
): boolean {
    const mutation = traceEnvMutation(line);

    if (mutation !== null) {
        recordTraceEnvMutation(mutation, runtime);

        return true;
    }

    if (ignoredStderrLine(line, readingTraceEnvStack)) {
        return true;
    }

    if (line.trim() !== '') {
        recordRawStderr(runtime);
    }

    return false;
}

function observeChildStderr(runtime: SupervisedChildOutputRuntime): void {
    let pending = '';
    let readingTraceEnvStack = false;

    runtime.child.stderr?.on('data', function recordStderrOutput(chunk: Uint8Array) {
        if (chunk.length === 0) {
            return;
        }

        if (runtime.capabilityRestrictions.mode === 'disabled') {
            recordOrWriteCapturedOutput('stderr', chunk, runtime);

            return;
        }

        pending += Buffer.from(chunk).toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';

        for (const line of lines) {
            readingTraceEnvStack = recordStderrLine(line, readingTraceEnvStack, runtime);
        }
    });
}

export function observeSupervisedChildOutput(runtime: SupervisedChildOutputRuntime): void {
    observeChildStdout(runtime);
    observeChildStderr(runtime);
}
