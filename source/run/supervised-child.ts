import { createWallClock } from '@enormora/wall-clock';
import type { Reporter, RunResourceUsageTracker, TestPlan } from '../packages/engine/engine.entry-point.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { discoverRunFiles } from './run-discovery.ts';
import { loadRunTestModules } from './run-test-modules.ts';
import type { SupervisedChildMessage, SupervisedRunCommand } from './supervised-protocol.ts';

function send(message: SupervisedChildMessage): void {
    if (process.send !== undefined) {
        process.send(message);
    }
}

function ignoreLine(): void {
    return undefined;
}

function renderNothing(): string {
    return '';
}

function createIpcReporter(): Reporter {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'supervised-child-ipc',
        onEvent(event) {
            if (event.kind !== 'run-start' && event.kind !== 'run-end') {
                send({ event, kind: 'event' });
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

function createResourceUsageTracker(command: SupervisedRunCommand): RunResourceUsageTracker {
    const tracker = createNodeResourceUsageTracker(createWallClock(), {
        samplingIntervalMilliseconds: command.resourceUsageSamplingIntervalMilliseconds
    });

    return {
        finish: tracker.finish,
        start(onSample) {
            tracker.start(function forwardSample(sample) {
                send({ kind: 'sample', sample });
                onSample?.(sample);
            });
        }
    };
}

async function run(command: SupervisedRunCommand): Promise<void> {
    const wallClock = createWallClock();
    const startedAt = new Date(wallClock.currentTimestampInMilliseconds);
    const execute = createExecute({
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine },
            wallClock
        }),
        wallClock
    });
    const testPlan = selectAssignedCases(await createTestPlan(command), command.assignedCaseKeys);
    const result = await execute(testPlan, {
        execution: { mode: 'concurrent-in-process' },
        outputRenderer: { render: renderNothing },
        reporters: [ createIpcReporter() ],
        resourceBudgets: command.resourceBudgets,
        resourceUsageTracker: createResourceUsageTracker(command),
        runFacts: {},
        startedAt: startedAt.toISOString(),
        timeoutPolicy: {
            hardTimeoutMilliseconds: command.hardTimeoutMilliseconds,
            timeoutMilliseconds: command.timeoutMilliseconds
        }
    });

    send({ kind: 'result', result });
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isChildRunCommand(message: unknown): message is SupervisedRunCommand {
    return isRecord(message) &&
        Object.hasOwn(message, 'kind') &&
        message.kind === 'run';
}

function sendFailure(error: unknown): void {
    send({
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

async function runReceivedCommand(command: SupervisedRunCommand): Promise<void> {
    try {
        await run(command);
        process.exitCode = 0;
    } catch (error: unknown) {
        sendFailure(error);
        process.exitCode = 1;
    } finally {
        if (process.disconnect !== undefined) {
            process.disconnect();
        }
    }
}

async function receiveRunCommand(): Promise<SupervisedRunCommand> {
    return new Promise(function waitForRunCommand(resolve) {
        process.once('message', function receiveCommand(message: unknown) {
            if (isChildRunCommand(message)) {
                resolve(message);
            }
        });
    });
}

await runReceivedCommand(await receiveRunCommand());
