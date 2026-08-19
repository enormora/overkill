import { createWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { Reporter, ReporterEvent } from '../engine/reporter.ts';
import type { ResourceUsageSnapshot, RunResourceUsageTracker, RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { discoverRunFiles } from './run-discovery.ts';
import { loadRunTestModules } from './run-test-modules.ts';
import type { RunResourceBudgets } from './run.ts';

type ChildRunCommand = {
    readonly assignedCaseKeys: readonly string[];
    readonly cwd: string;
    readonly hardTimeoutMilliseconds: number;
    readonly kind: 'run';
    readonly paths: readonly string[];
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly timeoutMilliseconds: number;
};

type ChildMessage =
    | { readonly event: ReporterEvent; readonly kind: 'event'; }
    | { readonly kind: 'result'; readonly result: RunResult; }
    | { readonly kind: 'sample'; readonly sample: ResourceUsageSnapshot; };

function send(message: ChildMessage): void {
    process.send?.(message);
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

async function createTestPlan(command: ChildRunCommand): Promise<TestPlan> {
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

function selectAssignedCases(testPlan: TestPlan, assignedCaseKeys: readonly string[]): TestPlan {
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

function createResourceUsageTracker(command: ChildRunCommand): RunResourceUsageTracker {
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

async function run(command: ChildRunCommand): Promise<void> {
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

function isChildRunCommand(message: unknown): message is ChildRunCommand {
    return typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
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

async function runReceivedCommand(command: ChildRunCommand): Promise<void> {
    try {
        await run(command);
        process.exitCode = 0;
    } catch (error: unknown) {
        sendFailure(error);
        process.exitCode = 1;
    } finally {
        process.disconnect?.();
    }
}

process.on('message', async function receiveCommand(message: unknown) {
    if (isChildRunCommand(message)) {
        await runReceivedCommand(message);
    }
});
