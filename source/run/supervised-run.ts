import { fork, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OutputRenderer } from '../engine/reporter-output.ts';
import type { Reporter, ReporterEvent } from '../engine/reporter.ts';
import type {
    PerTestResult,
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../engine/run-result.ts';
import { createRunResult } from '../engine/execution-result.ts';
import { caseIdentityKey, formatCaseId } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import type { ResolvedRun, RunOrchestratorDependencies, RunResourceBudgets } from './run-types.ts';
import type { SupervisedChildMessage, SupervisedRunCommand } from './supervised-protocol.ts';

type ResourceBudgetMetric = keyof RunResourceBudgets;

type ResourceBudgetBreach = {
    readonly budget: number;
    readonly metric: ResourceBudgetMetric;
    readonly observed: number;
    readonly sample: ResourceUsageSnapshot;
};

type BudgetValueReader = (
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
) => number;

type SupervisedRunState = {
    readonly activeCases: ReadonlyMap<string, TestPlanCase>;
    readonly addActiveCase: (key: string, testCase: TestPlanCase) => void;
    readonly perTestResults: () => readonly PerTestResult[];
    readonly recordPerTestResult: (key: string, result: PerTestResult) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly recordRunnerErrors: (errors: readonly RunnerError[]) => void;
    readonly recordRuntimePolicyViolation: (capability: string, message: string) => void;
    readonly recordTerminalActiveCases: (verdict: PerTestResult['verdict']) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: () => readonly RunnerError[];
};

type ReporterContext = {
    readonly outputRenderer: OutputRenderer;
    readonly reporters: readonly Reporter[];
};

type ReporterEventQueue = {
    readonly add: (eventReport: Promise<void>) => void;
    readonly wait: () => Promise<void>;
};

type StoredRunValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

type SupervisedHardTimeout = {
    readonly clear: () => void;
    readonly start: () => void;
};

type SupervisedRunRuntimeSeed = {
    readonly cases: ReadonlyMap<string, TestPlanCase>;
    readonly child: ChildProcess;
    readonly completedResult: StoredRunValue<RunResult | null>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly reporterContext: ReporterContext;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

type SupervisedRunRuntime = SupervisedRunRuntimeSeed & {
    readonly timeout: SupervisedHardTimeout;
};

const childEntryPoint = fileURLToPath(new URL('./supervised-child.entry-point.ts', import.meta.url));
const childRuntimeRoot = dirname(childEntryPoint);
const millisecondsPerSecond = 1000;
const resourceBudgetMetrics: readonly ResourceBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

function terminalResult(testCase: TestPlanCase, verdict: PerTestResult['verdict']): PerTestResult {
    return {
        id: testCase.id,
        outcome: null,
        verdict
    };
}

function createStoredRunValue<Value>(initialValue: Value): StoredRunValue<Value> {
    let currentValue = initialValue;

    return {
        read() {
            return currentValue;
        },
        write(value) {
            currentValue = value;
        }
    };
}

function createSupervisedRunState(): SupervisedRunState {
    const activeCases = new Map<string, TestPlanCase>();
    const perTest = new Map<string, PerTestResult>();
    const runnerErrors: RunnerError[] = [];

    return {
        activeCases,
        addActiveCase(key, testCase) {
            activeCases.set(key, testCase);
        },
        perTestResults() {
            return Array.from(perTest.values());
        },
        recordPerTestResult(key, result) {
            perTest.set(key, result);
        },
        recordRunnerError(error) {
            runnerErrors.push(error);
        },
        recordRunnerErrors(errors) {
            runnerErrors.push(...errors);
        },
        recordRuntimePolicyViolation(capability, message) {
            runnerErrors.push(runtimePolicyError(this, capability, message));
            this.recordTerminalActiveCases('runtime-policy');
        },
        recordTerminalActiveCases(verdict) {
            for (const [ key, testCase ] of activeCases) {
                perTest.set(key, terminalResult(testCase, verdict));
            }

            activeCases.clear();
        },
        removeActiveCase(key) {
            activeCases.delete(key);
        },
        runnerErrors() {
            return runnerErrors;
        }
    };
}

function createReporterEventQueue(): ReporterEventQueue {
    const eventReports: Promise<void>[] = [];

    return {
        add(eventReport) {
            eventReports.push(eventReport);
        },
        async wait() {
            await Promise.all(eventReports);
        }
    };
}

function observedResidentSetGrowth(
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    if (previousSample === null) {
        return 0;
    }

    const elapsedMilliseconds = sample.capturedAtMilliseconds - previousSample.capturedAtMilliseconds;

    if (elapsedMilliseconds <= 0) {
        return 0;
    }

    return Math.max(
        0,
        (sample.residentSetBytes - previousSample.residentSetBytes) * millisecondsPerSecond / elapsedMilliseconds
    );
}

const budgetValueReaders: Readonly<Record<ResourceBudgetMetric, BudgetValueReader>> = {
    activeResourceCount(sample) {
        return sample.activeResourceCount;
    },
    javaScriptEngineHeapBytes(sample) {
        return sample.javaScriptEngineHeapBytes;
    },
    residentSetBytes(sample) {
        return sample.residentSetBytes;
    },
    residentSetGrowthBytesPerSecond: observedResidentSetGrowth
};

function observedBudgetValue(
    metric: ResourceBudgetMetric,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    return budgetValueReaders[metric](sample, previousSample);
}

function findResourceBudgetBreach(
    budgets: RunResourceBudgets,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): ResourceBudgetBreach | null {
    for (const metric of resourceBudgetMetrics) {
        const budget = budgets[metric];

        if (budget !== null) {
            const observed = observedBudgetValue(metric, sample, previousSample);

            if (observed > budget) {
                return { budget, metric, observed, sample };
            }
        }
    }

    return null;
}

function activeCaseIds(state: SupervisedRunState): readonly TestPlanCase['id'][] {
    return Array.from(state.activeCases.values(), function toCaseId(testCase) {
        return testCase.id;
    });
}

function resourceExhaustionError(breach: ResourceBudgetBreach, state: SupervisedRunState): RunnerError {
    const activeCases = activeCaseIds(state);
    const [ activeCase = null ] = activeCases;

    return {
        attributedTo: activeCases.length === 1 ? activeCase : null,
        cause: {
            ...breach,
            activeCases,
            enforcement: activeCases.length === 0 ? 'post-test-diagnostic' : 'sampled'
        },
        message: `Resource budget exceeded: ${breach.metric} observed ${breach.observed}, budget ${breach.budget}.`,
        subtype: 'resource-exhaustion'
    };
}

function crashError(state: SupervisedRunState, reason: string): RunnerError {
    const activeCases = activeCaseIds(state);
    const [ activeCase = null ] = activeCases;

    return {
        attributedTo: activeCases.length === 1 ? activeCase : null,
        cause: { activeCases, reason },
        message: reason,
        subtype: 'crash'
    };
}

function runtimePolicyError(state: SupervisedRunState, capability: string, message: string): RunnerError {
    const activeCases = activeCaseIds(state);
    const [ activeCase = null ] = activeCases;

    return {
        attributedTo: activeCases.length === 1 ? activeCase : null,
        cause: {
            activeCases,
            capability,
            phase: activeCases.length === 0 ? 'out-of-test' : 'body',
            strictness: 'observed'
        },
        message,
        subtype: 'runtime-policy'
    };
}

async function recordReporterEventErrors(
    event: ReporterEvent,
    state: SupervisedRunState,
    context: ReporterContext,
    dependencies: RunOrchestratorDependencies
): Promise<void> {
    const errors = await dependencies.reporterDispatcher.reportEvent(
        context.reporters,
        event,
        context.outputRenderer
    );

    if (errors.length > 0) {
        state.recordRunnerErrors(errors);
    }
}

function caseByKey(testPlan: TestPlan): ReadonlyMap<string, TestPlanCase> {
    return new Map(testPlan.cases.map(function toEntry(testCase) {
        return [ caseIdentityKey(testCase.id), testCase ];
    }));
}

function applyEvent(event: ReporterEvent, state: SupervisedRunState, cases: ReadonlyMap<string, TestPlanCase>): void {
    if (event.kind === 'test-start') {
        const testCase = cases.get(caseIdentityKey(event.case));

        if (testCase !== undefined) {
            state.addActiveCase(caseIdentityKey(event.case), testCase);
        }
    } else if (event.kind === 'test-end') {
        const key = caseIdentityKey(event.case);
        state.removeActiveCase(key);
        state.recordPerTestResult(key, {
            id: event.case,
            outcome: event.outcome,
            verdict: event.verdict
        });
    } else if (event.kind === 'runner-error') {
        state.recordRunnerError(event.error);
    }
}

function createPartialRunResult(
    resolvedRun: ResolvedRun,
    state: SupervisedRunState,
    dependencies: RunOrchestratorDependencies,
    startedAtMs: number
): RunResult {
    return createRunResult(
        resolvedRun.testPlan,
        state.perTestResults(),
        state.runnerErrors(),
        {
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    );
}

function kill(child: ChildProcess): void {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
}

function createReporterContext(resolvedRun: ResolvedRun): ReporterContext {
    return {
        outputRenderer: resolvedRun.config.outputRenderer,
        reporters: resolvedRun.reporters
    };
}

function sanitizedChildEnvironment(environmentVariables: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const environment = { ...environmentVariables };

    delete environment.NODE_OPTIONS;
    delete environment.NODE_V8_COVERAGE;
    delete environment.NODE_CONFIG;
    delete environment.NODE_CHANNEL_FD;
    delete environment.NODE_UNIQUE_ID;

    return environment;
}

function readPermissionRoots(resolvedRun: ResolvedRun): readonly string[] {
    return Array.from(new Set([
        realpathSync(resolvedRun.cwd),
        realpathSync(childRuntimeRoot)
    ]));
}

function supervisedChildExecArgv(resolvedRun: ResolvedRun): readonly string[] {
    if (resolvedRun.request.capabilityRestrictions.mode === 'disabled') {
        return [];
    }

    return [
        '--permission',
        '--trace-env',
        '--trace-env-js-stack',
        ...readPermissionRoots(resolvedRun).map(function allowRead(root) {
            return `--allow-fs-read=${root}`;
        })
    ];
}

function startSupervisedChild(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): ChildProcess {
    return fork(childEntryPoint, [], {
        cwd: resolvedRun.cwd,
        env: sanitizedChildEnvironment(dependencies.runtimeCapabilityPolicy.readEnvironment()),
        execArgv: supervisedChildExecArgv(resolvedRun),
        stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
    });
}

function createHardTimeout(runtime: SupervisedRunRuntimeSeed): SupervisedHardTimeout {
    let hardTimeout: ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null = null;

    return {
        clear() {
            if (hardTimeout !== null) {
                runtime.dependencies.wallClock.clearTimeout(hardTimeout);
                hardTimeout = null;
            }
        },
        start() {
            if (hardTimeout !== null || runtime.state.activeCases.size === 0) {
                return;
            }

            hardTimeout = runtime.dependencies.wallClock.setTimeout(function killHardTimedOutChild() {
                runtime.terminalFailure.write(true);
                runtime.state.recordRunnerError(crashError(runtime.state, 'Supervised child exceeded hard timeout.'));
                runtime.state.recordTerminalActiveCases('crashed');
                kill(runtime.child);
            }, runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds);
        }
    };
}

function createRunCommand(resolvedRun: ResolvedRun): SupervisedRunCommand {
    return {
        assignedCaseKeys: resolvedRun.testPlan.cases.map(function toCaseKey(testCase) {
            return formatCaseId(testCase.id);
        }),
        capabilityRestrictions: resolvedRun.request.capabilityRestrictions,
        cwd: resolvedRun.cwd,
        hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
        kind: 'run',
        paths: resolvedRun.request.paths,
        resourceBudgets: resolvedRun.facts.execution.resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resolvedRun
            .facts
            .execution
            .resourceUsagePolicy
            .samplingIntervalMilliseconds,
        scheduling: resolvedRun.facts.execution.scheduling,
        timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
    };
}

function sendRunCommand(runtime: SupervisedRunRuntime): void {
    runtime.child.send(createRunCommand(runtime.resolvedRun));
}

function handleChildEvent(event: ReporterEvent, runtime: SupervisedRunRuntime): void {
    applyEvent(event, runtime.state, runtime.cases);

    if (event.kind === 'test-start') {
        runtime.timeout.start();
    } else if (event.kind === 'test-end' && runtime.state.activeCases.size === 0) {
        runtime.timeout.clear();
    }

    runtime.reporterEvents.add(recordReporterEventErrors(
        event,
        runtime.state,
        runtime.reporterContext,
        runtime.dependencies
    ));
}

function handleResourceBudgetBreach(
    breach: ResourceBudgetBreach,
    runtime: SupervisedRunRuntime
): void {
    runtime.terminalFailure.write(true);
    const error = resourceExhaustionError(breach, runtime.state);
    runtime.state.recordRunnerError(error);
    runtime.reporterEvents.add(recordReporterEventErrors(
        { error, kind: 'runner-error' },
        runtime.state,
        runtime.reporterContext,
        runtime.dependencies
    ));
    runtime.state.recordTerminalActiveCases('resource-exhausted');
    runtime.timeout.clear();
    kill(runtime.child);
}

function handleChildSample(sample: ResourceUsageSnapshot, runtime: SupervisedRunRuntime): void {
    if (runtime.terminalFailure.read()) {
        return;
    }

    const breach = findResourceBudgetBreach(
        runtime.resolvedRun.facts.execution.resourceUsagePolicy.budgets,
        sample,
        runtime.previousSample.read()
    );
    runtime.previousSample.write(sample);

    if (breach !== null) {
        handleResourceBudgetBreach(breach, runtime);
    }
}

function handleCompletedResult(result: RunResult, runtime: SupervisedRunRuntime): void {
    runtime.completedResult.write({
        ...result,
        runnerErrors: [ ...runtime.state.runnerErrors(), ...result.runnerErrors ]
    });
}

function handleChildMessage(message: SupervisedChildMessage, runtime: SupervisedRunRuntime): void {
    if (message.kind === 'event') {
        handleChildEvent(message.event, runtime);
    } else if (message.kind === 'sample') {
        handleChildSample(message.sample, runtime);
    } else {
        handleCompletedResult(message.result, runtime);
    }
}

function observeChildStdout(runtime: SupervisedRunRuntime): void {
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
    const match = /^\[--trace-env\] (?:delete|set) "([^"]+)"/u.exec(line);

    return match?.[1] ?? null;
}

function traceEnvMutation(line: string): string | null {
    const variable = traceEnvMutationVariable(line);

    if (variable !== null && ignoredTraceEnvMutationVariables.has(variable)) {
        return null;
    }

    if (variable !== null && line.startsWith('[--trace-env] set ')) {
        return `Runtime policy violation: process.env value was set: ${variable}.`;
    }

    if (variable !== null && line.startsWith('[--trace-env] delete ')) {
        return `Runtime policy violation: process.env value was deleted: ${variable}.`;
    }

    return null;
}

function observeChildStderr(runtime: SupervisedRunRuntime): void {
    let pending = '';
    let readingTraceEnvStack = false;

    runtime.child.stderr?.on('data', function recordStderrOutput(chunk: Buffer) {
        pending += chunk.toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';

        for (const line of lines) {
            const mutation = traceEnvMutation(line);

            if (mutation !== null) {
                readingTraceEnvStack = true;
                runtime.terminalFailure.write(true);
                runtime.state.recordRuntimePolicyViolation('process-env', mutation);
            } else if (line.startsWith('[--trace-env]')) {
                readingTraceEnvStack = true;
            } else if (
                readingTraceEnvStack &&
                (line.trim() === '' || line === '----- JavaScript stack trace -----' || /^\d+:/u.test(line))
            ) {
                continue;
            } else if (line.trim() !== '') {
                readingTraceEnvStack = false;
                runtime.terminalFailure.write(true);
                runtime.state.recordRuntimePolicyViolation(
                    'raw-stderr',
                    'Runtime policy violation: supervised child wrote to stderr.'
                );
            }
        }
    });
}

async function observeChild(runtime: SupervisedRunRuntime): Promise<void> {
    observeChildStdout(runtime);
    observeChildStderr(runtime);

    return new Promise(function waitForChild(resolve) {
        runtime.child.on('message', function receiveMessage(message: SupervisedChildMessage) {
            handleChildMessage(message, runtime);
        });
        runtime.child.on('error', function recordChildError(error) {
            if (!runtime.terminalFailure.read()) {
                runtime.terminalFailure.write(true);
                runtime.state.recordRunnerError(crashError(runtime.state, error.message));
                runtime.state.recordTerminalActiveCases('crashed');
            }
        });
        runtime.child.on('exit', function resolveExit() {
            resolve();
        });
    });
}

function selectRunResult(runtime: SupervisedRunRuntime, startedAtMs: number): RunResult {
    const completedResult = runtime.completedResult.read();

    if (completedResult === null) {
        return createPartialRunResult(runtime.resolvedRun, runtime.state, runtime.dependencies, startedAtMs);
    }

    return completedResult;
}

async function reportFinalResult(result: RunResult, runtime: SupervisedRunRuntime): Promise<RunResult> {
    const runEndErrors = await runtime.dependencies.reporterDispatcher.reportEvent(
        runtime.reporterContext.reporters,
        { kind: 'run-end', result },
        runtime.reporterContext.outputRenderer
    );
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await runtime.dependencies.reporterDispatcher.reportResult(
        runtime.reporterContext.reporters,
        resultForFinalReporting,
        runtime.reporterContext.outputRenderer
    );
    const disposeErrors = await runtime.dependencies.reporterDispatcher.disposeReporters(
        runtime.reporterContext.reporters
    );

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}

function createRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): SupervisedRunRuntime {
    const runtimeWithoutTimeout = {
        cases: caseByKey(resolvedRun.testPlan),
        child: startSupervisedChild(resolvedRun, dependencies),
        completedResult: createStoredRunValue<RunResult | null>(null),
        dependencies,
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        reporterContext: createReporterContext(resolvedRun),
        reporterEvents: createReporterEventQueue(),
        resolvedRun,
        state: createSupervisedRunState(),
        terminalFailure: createStoredRunValue(false)
    };

    return {
        ...runtimeWithoutTimeout,
        timeout: createHardTimeout(runtimeWithoutTimeout)
    };
}

export async function executeSupervisedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const runtime = createRuntime(resolvedRun, dependencies);
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    await recordReporterEventErrors(
        {
            facts: resolvedRun.facts,
            kind: 'run-start',
            root: resolvedRun.testPlan.root,
            startedAt: dependencies.readStartedAt()
        },
        runtime.state,
        runtime.reporterContext,
        dependencies
    );

    const childFinished = observeChild(runtime);
    sendRunCommand(runtime);
    await childFinished;
    runtime.timeout.clear();
    await runtime.reporterEvents.wait();

    return reportFinalResult(selectRunResult(runtime, startedAtMs), runtime);
}
