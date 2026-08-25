import { createWallClock } from '@enormora/wall-clock';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import type { Reporter, RunResourceUsageTracker, TestPlan } from '../packages/engine/engine.entry-point.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { discoverRunFiles } from './run-discovery.ts';
import { loadRunTestModules } from './run-test-modules.ts';
import { loadRunEngineModule } from './run-engine-selection.ts';
import { RunCollectionError } from './run-errors.ts';
import {
    createRuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicyDependencies
} from './capability-policy.ts';
import type {
    SupervisedAssignmentCommand,
    SupervisedChildCommand,
    SupervisedChildMessage,
    SupervisedRunCommand
} from './supervised-protocol.ts';

type ChildExecutionMode = 'concurrent-in-process' | 'serial-in-process';

type CollectedTestPlan = {
    readonly runnerErrors: readonly RunnerError[];
    readonly testPlan: TestPlan;
};

function currentRunStartTime(wallClock: ReturnType<typeof createWallClock>): string {
    const startedAt = new Date(wallClock.currentTimestampInMilliseconds);

    return startedAt.toISOString();
}

export type SupervisedChildHost = RuntimeCapabilityPolicyDependencies & {
    readonly disconnect: () => void;
    readonly dropBodyReadPermission: (command: SupervisedRunCommand) => void;
    readonly receiveAssignment: () => Promise<SupervisedAssignmentCommand>;
    readonly receiveCommand: () => Promise<SupervisedChildCommand>;
    readonly send: (message: SupervisedChildMessage) => void;
    readonly setExitCode: (code: number) => void;
    readonly validatePermissionHost: (command: SupervisedChildCommand) => void;
};

function ignoreLine(): void {
    return undefined;
}

function renderNothing(): string {
    return '';
}

function createIpcReporter(host: SupervisedChildHost): Reporter {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'supervised-child-ipc',
        onEvent(event) {
            if (event.kind !== 'run-start' && event.kind !== 'run-end') {
                host.send({ event, kind: 'event' });
            }
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
}

async function selectedEngine(command: SupervisedChildCommand) {
    return command.engine.kind === 'module' ? await loadRunEngineModule(command.engine) : defaultRunEngine;
}

async function createTestPlan(command: SupervisedChildCommand): Promise<TestPlan> {
    const engine = await selectedEngine(command);
    const files = await discoverRunFiles({ cwd: command.cwd, paths: command.paths });
    const testFiles = await loadRunTestModules(files, engine);

    try {
        return engine.createTestPlanFromTestFiles({
            files: testFiles,
            root: {
                metadata: {},
                name: command.cwd
            }
        });
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to collect tests from explicit run inputs.', { cause: error }, 'loader');
    }
}

function selectAssignedCases(
    testPlan: TestPlan,
    assignedCases: readonly CaseId[]
): TestPlan {
    const assigned = new Set(assignedCases.map(caseIdentityKey));
    const cases = testPlan.cases.filter(function assignedCase(testCase) {
        return assigned.has(caseIdentityKey(testCase.id));
    });
    const first = cases[0];

    if (first === undefined || cases.length !== assigned.size) {
        throw new Error('Supervised child test plan did not match assigned case identities.');
    }

    return {
        ...testPlan,
        cases: [ first, ...cases.slice(1) ]
    };
}

function createResourceUsageTracker(
    command: SupervisedRunCommand,
    host: SupervisedChildHost
): RunResourceUsageTracker {
    const tracker = createNodeResourceUsageTracker(createWallClock(), {
        samplingIntervalMilliseconds: command.resourceUsageSamplingIntervalMilliseconds
    });

    return {
        finish: tracker.finish,
        start(onSample) {
            tracker.start(function forwardSample(sample) {
                host.send({ kind: 'sample', sample });
                onSample?.(sample);
            });
        }
    };
}

function executionMode(command: SupervisedRunCommand): ChildExecutionMode {
    return command.scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

function createRuntimePolicy(
    command: SupervisedChildCommand,
    host: SupervisedChildHost
): RuntimeCapabilityPolicy | null {
    return command.capabilityRestrictions.mode === 'enabled'
        ? createRuntimeCapabilityPolicy({
            dependencies: {
                installIpcRestriction: host.installIpcRestriction,
                installProcessExecutionRestriction: host.installProcessExecutionRestriction,
                readEnvironment: host.readEnvironment,
                readStorage: host.readStorage
            },
            observedStderr: false,
            observedStdout: false
        })
        : null;
}

async function createPolicyCheckedTestPlan(
    command: SupervisedChildCommand,
    runtimePolicy: RuntimeCapabilityPolicy | null
): Promise<TestPlan> {
    const createPlan = async function createTestPlanInsidePolicy(): Promise<TestPlan> {
        return await createTestPlan(command);
    };

    return runtimePolicy === null ? await createPlan() : await runtimePolicy.runLoad(createPlan);
}

function sendRuntimePolicyErrors(
    host: SupervisedChildHost,
    runtimePolicy: RuntimeCapabilityPolicy | null
): void {
    const errors = runtimePolicy?.takeRunErrors() ?? [];

    for (const runtimePolicyError of errors) {
        host.send({
            event: {
                error: runtimePolicyError,
                kind: 'runner-error'
            },
            kind: 'event'
        });
    }
}

async function createCollectedTestPlan(
    command: SupervisedChildCommand,
    host: SupervisedChildHost,
    runtimePolicy: RuntimeCapabilityPolicy | null
): Promise<CollectedTestPlan> {
    try {
        const testPlan = await createPolicyCheckedTestPlan(command, runtimePolicy);
        const runnerErrors = runtimePolicy?.takeRunErrors() ?? [];

        return { runnerErrors, testPlan };
    } catch (error: unknown) {
        sendRuntimePolicyErrors(host, runtimePolicy);
        throw error;
    }
}

function sendCollectedPlan(collectedPlan: CollectedTestPlan, host: SupervisedChildHost): void {
    host.send({
        collectedPlan: collectedRunPlanFromTestPlan(collectedPlan.testPlan),
        kind: 'collected',
        runnerErrors: collectedPlan.runnerErrors
    });
}

async function collect(command: SupervisedChildCommand, host: SupervisedChildHost): Promise<CollectedTestPlan> {
    host.validatePermissionHost(command);
    const runtimePolicy = createRuntimePolicy(command, host);
    const collectedPlan = await createCollectedTestPlan(command, host, runtimePolicy);
    sendCollectedPlan(collectedPlan, host);

    return collectedPlan;
}

async function run(command: SupervisedRunCommand, host: SupervisedChildHost): Promise<void> {
    const wallClock = createWallClock();
    const collectedPlan = await collect(command, host);
    const assignment = await host.receiveAssignment();
    const runtimePolicy = createRuntimePolicy(command, host);
    const execute = createExecute({
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine },
            wallClock
        }),
        wallClock
    });
    host.dropBodyReadPermission(command);
    const testPlan = selectAssignedCases(collectedPlan.testPlan, assignment.assignedCases);
    const result = await execute(testPlan, {
        execution: { mode: executionMode(command) },
        outputRenderer: { render: renderNothing },
        reporters: [ createIpcReporter(host) ],
        resourceBudgets: command.resourceBudgets,
        resourceUsageTracker: createResourceUsageTracker(command, host),
        runtimePolicy,
        runFacts: {},
        startedAt: currentRunStartTime(wallClock),
        timeoutPolicy: {
            hardTimeoutMilliseconds: command.hardTimeoutMilliseconds,
            timeoutMilliseconds: command.timeoutMilliseconds
        }
    });

    host.send({ kind: 'result', result });
}

function sendFailure(error: unknown, host: SupervisedChildHost): void {
    host.send({
        event: {
            error: {
                attributedTo: null,
                cause: error,
                message: error instanceof Error ? error.message : String(error),
                subtype: 'loader'
            },
            kind: 'runner-error'
        },
        kind: 'event'
    });
}

async function runReceivedCommand(command: SupervisedChildCommand, host: SupervisedChildHost): Promise<void> {
    try {
        if (command.kind === 'collect') {
            await collect(command, host);
        } else {
            await run(command, host);
        }

        host.setExitCode(0);
    } catch (error: unknown) {
        sendFailure(error, host);
        host.setExitCode(1);
    } finally {
        host.disconnect();
    }
}

export async function runSupervisedChild(host: SupervisedChildHost): Promise<void> {
    await runReceivedCommand(await host.receiveCommand(), host);
}
