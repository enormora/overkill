import { createWallClock } from '@enormora/wall-clock';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type {
    Reporter,
    RunResult,
    RunnerError,
    RunResourceUsageTracker,
    TestPlan
} from '../packages/engine/engine.entry-point.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import {
    collectedRunPlanFromTestPlan,
    collectedRunPlanFromTestPlanCases,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import {
    createRuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicyDependencies
} from './capability-policy.ts';
import { createSupervisedChildTestPlan } from './supervised-child-test-plan.ts';
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

type SupervisedAssignmentExecution = {
    readonly assignment: SupervisedAssignmentCommand;
    readonly collectedPlan: CollectedTestPlan;
    readonly command: SupervisedRunCommand;
    readonly host: SupervisedChildHost;
    readonly startedAtMs: number;
    readonly wallClock: ReturnType<typeof createWallClock>;
};

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

function createEmptyAssignmentResult(
    testPlan: TestPlan,
    wallClock: ReturnType<typeof createWallClock>,
    startedAtMs: number
): RunResult {
    return createRunResultFromCollectedPlan(
        collectedRunPlanFromTestPlanCases(testPlan, []),
        [],
        [],
        {
            resourceUsage: null,
            startedAtMs,
            wallClock
        }
    );
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
        return await createSupervisedChildTestPlan(command);
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

async function readCollectedTestPlan(
    command: SupervisedChildCommand,
    runtimePolicy: RuntimeCapabilityPolicy | null
): Promise<CollectedTestPlan> {
    const testPlan = await createPolicyCheckedTestPlan(command, runtimePolicy);
    const runnerErrors = runtimePolicy?.takeRunErrors() ?? [];

    return { runnerErrors, testPlan };
}

async function createCollectedTestPlan(
    command: SupervisedChildCommand,
    host: SupervisedChildHost,
    runtimePolicy: RuntimeCapabilityPolicy | null
): Promise<CollectedTestPlan> {
    try {
        return await readCollectedTestPlan(command, runtimePolicy);
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

function sendRunResult(host: SupervisedChildHost, result: RunResult): void {
    host.send({
        kind: 'result',
        result
    });
}

function startedAtIso(startedAtMs: number): string {
    const startedAt = new Date(startedAtMs);

    return startedAt.toISOString();
}

async function executeAssignment(input: SupervisedAssignmentExecution): Promise<RunResult> {
    const runtimePolicy = createRuntimePolicy(input.command, input.host);
    const execute = createExecute({
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine },
            wallClock: input.wallClock
        }),
        wallClock: input.wallClock
    });
    input.host.dropBodyReadPermission(input.command);
    const testPlan = selectAssignedCases(input.collectedPlan.testPlan, input.assignment.assignedCases);

    return await execute(testPlan, {
        execution: { mode: executionMode(input.command) },
        outputRenderer: { render: renderNothing },
        reporters: [ createIpcReporter(input.host) ],
        resourceBudgets: input.command.resourceBudgets,
        resourceUsageTracker: createResourceUsageTracker(input.command, input.host),
        runtimePolicy,
        runFacts: {},
        startedAt: startedAtIso(input.startedAtMs),
        timeoutPolicy: {
            hardTimeoutMilliseconds: input.command.hardTimeoutMilliseconds,
            timeoutMilliseconds: input.command.timeoutMilliseconds
        }
    });
}

async function run(command: SupervisedRunCommand, host: SupervisedChildHost): Promise<void> {
    const wallClock = createWallClock();
    const startedAtMs = wallClock.currentTimestampInMilliseconds;
    const collectedPlan = await collect(command, host);
    const assignment = await host.receiveAssignment();

    if (assignment.assignedCases.length === 0) {
        sendRunResult(host, createEmptyAssignmentResult(collectedPlan.testPlan, wallClock, startedAtMs));
        return;
    }

    sendRunResult(
        host,
        await executeAssignment({
            assignment,
            collectedPlan,
            command,
            host,
            startedAtMs,
            wallClock
        })
    );
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

async function completeReceivedCommand(command: SupervisedChildCommand, host: SupervisedChildHost): Promise<void> {
    if (command.kind === 'collect') {
        await collect(command, host);
    } else {
        await run(command, host);
    }

    host.setExitCode(0);
}

async function runReceivedCommand(command: SupervisedChildCommand, host: SupervisedChildHost): Promise<void> {
    try {
        await completeReceivedCommand(command, host);
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
