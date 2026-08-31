import { fork, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy.ts';
import type { RunOrchestratorDependencies } from './run-types.ts';
import type { StoredRunValue, SupervisedRunState } from './supervised-run-state.ts';

export type SupervisedChildProcess = ChildProcess;

export type SupervisedChildStartOptions = {
    readonly capabilityRestrictions: {
        readonly mode: 'disabled' | 'enabled';
    };
    readonly cwd: string;
};

type TraceEnvMutation = {
    readonly capability: string;
    readonly message: string;
};

export type SupervisedChildOutputRuntime = {
    readonly child: SupervisedChildProcess;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

const childProcessEntryPoint = fileURLToPath(import.meta.url);
export const supervisedChildProcessEntryPointArgument = '--overkill-supervised-child';
const childRuntimeRoot = dirname(childProcessEntryPoint);
const childPackageRoot = dirname(childRuntimeRoot);

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

async function existingRealPath(path: string): Promise<string | null> {
    try {
        return await realpath(path);
    } catch {
        return null;
    }
}

async function existingRealPaths(paths: readonly string[]): Promise<readonly string[]> {
    const realPaths = await Promise.all(paths.map(existingRealPath));

    return realPaths.filter(function existingPath(path) {
        return path !== null;
    });
}

async function readPermissionRoots(options: SupervisedChildStartOptions): Promise<readonly string[]> {
    const nodeModulesPaths = await existingRealPaths([
        ...nodeModulesCandidates(options.cwd),
        ...nodeModulesCandidates(childPackageRoot)
    ]);

    return Array.from(
        new Set([
            await realpath(options.cwd),
            await realpath(childPackageRoot),
            ...nodeModulesPaths
        ])
    );
}

async function supervisedChildExecArgv(options: SupervisedChildStartOptions): Promise<string[]> {
    if (options.capabilityRestrictions.mode === 'disabled') {
        return [];
    }

    const permissionRoots = await readPermissionRoots(options);

    return [
        '--permission',
        '--trace-env',
        '--trace-env-js-stack',
        ...permissionRoots.map(function allowRead(root) {
            return `--allow-fs-read=${root}`;
        })
    ];
}

export async function startSupervisedChild(
    options: SupervisedChildStartOptions,
    dependencies: RunOrchestratorDependencies
): Promise<SupervisedChildProcess> {
    return fork(childProcessEntryPoint, [ supervisedChildProcessEntryPointArgument ], {
        cwd: options.cwd,
        env: sanitizedChildEnvironment(dependencies.runtimeCapabilityPolicy.readEnvironment()),
        execArgv: await supervisedChildExecArgv(options),
        stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
    });
}

if (process.argv.includes(supervisedChildProcessEntryPointArgument)) {
    await import('./supervised-child.entry-point.ts');
}

function observeChildStdout(runtime: SupervisedChildOutputRuntime): void {
    runtime.child.stdout?.on('data', function recordStdoutOutput(chunk: Buffer) {
        if (chunk.length === 0) {
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

    runtime.child.stderr?.on('data', function recordStderrOutput(chunk: Buffer) {
        pending += chunk.toString('utf8');
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
