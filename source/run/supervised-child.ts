import { createWallClock } from '@enormora/wall-clock';
import type { Reporter, RunResourceUsageTracker, TestPlan } from '../packages/engine/engine.entry-point.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { discoverRunFiles } from './run-discovery.ts';
import { loadRunTestModules } from './run-test-modules.ts';
import {
    createRuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicy,
    type RuntimeCapabilityPolicyDependencies
} from './capability-policy.ts';
import type { SupervisedChildMessage, SupervisedRunCommand } from './supervised-protocol.ts';

type ChildExecutionMode = 'concurrent-in-process' | 'serial-in-process';

export type SupervisedChildHost = RuntimeCapabilityPolicyDependencies & {
    readonly disconnect: () => void;
    readonly dropBodyReadPermission: (command: SupervisedRunCommand) => void;
    readonly readStartedAt: () => string;
    readonly receiveRunCommand: () => Promise<SupervisedRunCommand>;
    readonly send: (message: SupervisedChildMessage) => void;
    readonly setExitCode: (code: number) => void;
    readonly validatePermissionHost: (command: SupervisedRunCommand) => void;
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

async function createTestPlan(command: SupervisedRunCommand): Promise<TestPlan> {
    const files = await discoverRunFiles({ cwd: command.cwd, paths: command.paths });
    const testFiles = await loadRunTestModules(files, defaultRunEngine);

    return defaultRunEngine.createTestPlanFromTestFiles({
        files: testFiles,
        root: {
            metadata: {},
            name: command.cwd
        }
    });
}

function selectAssignedCases(
    testPlan: TestPlan,
    assignedCaseKeys: readonly string[]
): TestPlan {
    const assigned = new Set(assignedCaseKeys);
    const cases = testPlan.cases.filter(function assignedCase(testCase) {
        return assigned.has(defaultRunEngine.formatCaseId(testCase.id));
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
    command: SupervisedRunCommand,
    host: SupervisedChildHost
): RuntimeCapabilityPolicy | null {
    return command.capabilityRestrictions.mode === 'enabled'
        ? createRuntimeCapabilityPolicy({
            dependencies: {
                readEnvironment: host.readEnvironment,
                readStorage: host.readStorage
            },
            observedStderr: false,
            observedStdout: false
        })
        : null;
}

async function createPolicyCheckedTestPlan(
    command: SupervisedRunCommand,
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
    command: SupervisedRunCommand,
    host: SupervisedChildHost,
    runtimePolicy: RuntimeCapabilityPolicy | null
): Promise<TestPlan> {
    try {
        return await createPolicyCheckedTestPlan(command, runtimePolicy);
    } catch (error: unknown) {
        sendRuntimePolicyErrors(host, runtimePolicy);
        throw error;
    }
}

async function run(command: SupervisedRunCommand, host: SupervisedChildHost): Promise<void> {
    host.validatePermissionHost(command);
    const wallClock = createWallClock();
    const runtimePolicy = createRuntimePolicy(command, host);
    const execute = createExecute({
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine },
            wallClock
        }),
        wallClock
    });
    const collectedTestPlan = await createCollectedTestPlan(command, host, runtimePolicy);
    host.dropBodyReadPermission(command);
    const testPlan = selectAssignedCases(collectedTestPlan, command.assignedCaseKeys);
    const result = await execute(testPlan, {
        execution: { mode: executionMode(command) },
        outputRenderer: { render: renderNothing },
        reporters: [ createIpcReporter(host) ],
        resourceBudgets: command.resourceBudgets,
        resourceUsageTracker: createResourceUsageTracker(command, host),
        runtimePolicy,
        runFacts: {},
        startedAt: host.readStartedAt(),
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

async function runReceivedCommand(command: SupervisedRunCommand, host: SupervisedChildHost): Promise<void> {
    try {
        await run(command, host);
        host.setExitCode(0);
    } catch (error: unknown) {
        sendFailure(error, host);
        host.setExitCode(1);
    } finally {
        host.disconnect();
    }
}

export async function runSupervisedChild(host: SupervisedChildHost): Promise<void> {
    await runReceivedCommand(await host.receiveRunCommand(), host);
}
