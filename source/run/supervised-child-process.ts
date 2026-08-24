import { fork, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy.ts';
import type { ResolvedRun, RunOrchestratorDependencies } from './run-types.ts';
import type { StoredRunValue, SupervisedRunState } from './supervised-run-state.ts';

export type SupervisedChildProcess = ChildProcess;

type TraceEnvMutation = {
    readonly capability: string;
    readonly message: string;
};

export type SupervisedChildOutputRuntime = {
    readonly child: SupervisedChildProcess;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

const childEntryPoint = fileURLToPath(new URL('./supervised-child.entry-point.ts', import.meta.url));
const childRuntimeRoot = dirname(childEntryPoint);

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

async function readPermissionRoots(resolvedRun: ResolvedRun): Promise<readonly string[]> {
    return Array.from(
        new Set([
            await realpath(resolvedRun.cwd),
            await realpath(childRuntimeRoot)
        ])
    );
}

async function supervisedChildExecArgv(resolvedRun: ResolvedRun): Promise<string[]> {
    if (resolvedRun.request.capabilityRestrictions.mode === 'disabled') {
        return [];
    }

    const permissionRoots = await readPermissionRoots(resolvedRun);

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
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<SupervisedChildProcess> {
    return fork(childEntryPoint, [], {
        cwd: resolvedRun.cwd,
        env: sanitizedChildEnvironment(dependencies.runtimeCapabilityPolicy.readEnvironment()),
        execArgv: await supervisedChildExecArgv(resolvedRun),
        stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
    });
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
