import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createSuite,
    createTestCase,
    defineReporter,
    type TestScope,
    type DefinedReporter,
    type RunResult,
    type ReporterEvent
} from '../../packages/engine/engine.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type BenchmarkExecution,
    type RunCommand,
    type RunExecutionFacts
} from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { createBenchmarkCommands } from '../../run/benchmark-commands.ts';

const lifecycleFile = 'target/benchmark-lifecycle.txt';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const fixture = 'source/integration-tests/run/fixtures/benchmark.bench.test.ts';
const workerExecution: BenchmarkExecution = {
    assignmentPolicy: 'case-count-balanced',
    dispatchPolicy: 'dynamic-lease',
    hedging: { mode: 'off' },
    hostProcess: { kind: 'direct' },
    maxConcurrency: 1,
    maxWorkers: 4,
    processModel: 'worker-pool',
    scheduling: 'serial',
    workDistribution: { mode: 'case' },
    workerLifecycle: 'reuse'
};
const executions: readonly BenchmarkExecution[] = [
    workerExecution,
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } },
    { processModel: 'supervised-process', maxConcurrency: 1, scheduling: 'serial' }
];

function caseLifecycle(event: ReporterEvent): readonly string[] {
    if (event.kind === 'test-start') {
        return [ `start:${event.case.title}` ];
    }
    return event.kind === 'test-end' ? [ `end:${event.case.title}` ] : [];
}

function assertWorkerPlacement(scope: TestScope, execution: RunExecutionFacts): void {
    if (execution.processModel === 'worker-pool') {
        scope.assert.equal(execution.workerCount.resolved, 1);
        scope.assert.equal(execution.workerCount.requested, 4);
        scope.assert.equal(execution.workerCount.profileMaximum, 4);
    }
}

function executionTitle(execution: BenchmarkExecution): string {
    return execution.processModel === 'worker-pool'
        ? `${execution.processModel} ${execution.workerLifecycle} ${execution.hostProcess.kind}`
        : 'supervised-process serial';
}

type BenchmarkObserver = {
    readonly events: readonly ReporterEvent[];
    readonly creations: () => number;
    readonly reporter: DefinedReporter;
};

function createBenchmarkObserver(): BenchmarkObserver {
    const events: ReporterEvent[] = [];
    let creations = 0;
    return {
        events,
        creations() {
            return creations;
        },
        reporter: defineReporter(function createBenchmarkReporter() {
            creations += 1;
            return {
                dispose: null,
                kind: 'real-time',
                name: 'benchmark-observer',
                onFinish: null,
                onEvent(event: ReporterEvent) {
                    events.push(event);
                },
                sinks: [ { kind: 'memory' } ]
            };
        })
    };
}

function createBenchmarkCommand(
    execution: BenchmarkExecution,
    directory: string,
    reporter: DefinedReporter
): RunCommand {
    const config = normalizeConfig({
        profiles: { startup: { testFamily: 'benchmark', files: { include: [ fixture ] } } },
        reporters: [ reporter ],
        runtimeStateDir: directory
    });
    const profile = config.profiles.startup;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        config: { ...config, profiles: { ...config.profiles, startup: { ...profile, execution } } },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'startup',
            order: 'lexical',
            workers: execution.processModel === 'worker-pool' ? 4 : null
        })
    };
}

async function assertBenchmarkList(scope: TestScope, command: RunCommand, observer: BenchmarkObserver): Promise<void> {
    const listed = await orchestrator.bench.list(command, { timing: null });
    scope.assert.equal(listed.facts.execution.testFamily, 'benchmark');
    scope.assert.equal(listed.facts.cases.length, 3);
    const runtimeCase = listed.facts.cases.find(function passingCase(entry) {
        return entry.id.title === 'passes';
    });
    scope.require.defined(runtimeCase);
    scope.assert.deepEqual(
        runtimeCase.workId.runtimes,
        [ { dimensions: { kind: 'fixture' }, name: 'benchmark-runtime', scenarios: {}, variantId: null } ] as const
    );
    scope.assert.deepEqual(await readdir(command.config.runtimeStateDir), []);
    scope.assert.deepEqual(observer.events.slice(), []);
    scope.assert.equal(observer.creations(), 0);
    assertWorkerPlacement(scope, listed.facts.execution);
}

async function assertBenchmarkShards(scope: TestScope, command: RunCommand): Promise<void> {
    const first = await orchestrator.bench.list({
        ...command,
        request: { ...command.request, shard: { index: 1, total: 2 } }
    }, { timing: null });
    const second = await orchestrator.bench.list({
        ...command,
        request: { ...command.request, shard: { index: 2, total: 2 } }
    }, { timing: null });
    const titles = [ ...first.facts.cases, ...second.facts.cases ]
        .map(function caseTitle(entry) {
            return entry.id.title;
        })
        .toSorted(function compareTitles(left, right) {
            return left.localeCompare(right);
        });
    scope.assert.deepEqual(titles, [ 'fails', 'passes', 'skips' ]);
}

function assertBenchmarkArtifacts(scope: TestScope, result: RunResult): void {
    const names = new Set(result.artifacts.map(function attachmentName(artifact) {
        return artifact.payload.kind === 'runtime-attachment' ? artifact.payload.name : '';
    }));
    scope.assert.true(names.has('setup'));
    scope.assert.true(names.has('teardown'));
    scope.assert.true(result.artifacts.some(function capturedOutput(artifact) {
        return artifact.payload.kind === 'captured-output' && artifact.payload.stream === 'stdout' &&
            artifact.payload.text === 'benchmark output\n';
    }));
}

async function assertBenchmarkResults(
    scope: TestScope,
    command: RunCommand,
    observer: BenchmarkObserver
): Promise<void> {
    const delivery = await orchestrator.bench.runWithReporterDelivery(command, { timing: null });
    scope.assert.equal(delivery.result.summary.passed, 1);
    scope.assert.equal(delivery.result.summary.failed, 1);
    scope.assert.equal(delivery.result.summary.skipped, 1);
    scope.assert.equal(observer.creations(), 1);
    scope.assert.deepEqual(delivery.result.runnerErrors, []);
    scope.assert.equal(await readFile(lifecycleFile, 'utf8'), 'acquire\nbody\ndispose\n');
    scope.assert.deepEqual(observer.events.flatMap(caseLifecycle), [
        'start:passes',
        'end:passes',
        'start:fails',
        'end:fails',
        'start:skips',
        'end:skips'
    ]);
    assertBenchmarkArtifacts(scope, delivery.result);
}

async function assertBenchmarkEmptySelection(scope: TestScope, command: RunCommand): Promise<void> {
    const empty = await orchestrator.bench.run({
        ...command,
        request: {
            ...command.request,
            selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: 'missing' } }
        }
    }, { timing: null });
    scope.assert.equal(empty.summary.planned, 0);
    scope.assert.equal(await readFile(lifecycleFile, 'utf8'), 'acquire\nbody\ndispose\n');
}

async function assertBenchmarkFailureExitCode(scope: TestScope, command: RunCommand): Promise<void> {
    const commands = createBenchmarkCommands({
        async createDefaultReporter() {
            throw new Error('Configured reporter must be used.');
        },
        async loadConfig() {
            return { ...command.config, configPath: null };
        },
        orchestrator
    });
    const failed = await commands.runBenchmarks({
        cwd: command.cwd,
        configPath: null,
        runRequest: {
            ...command.request,
            selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: 'fails' } }
        }
    });
    scope.assert.equal(failed.exitCode, 1);
    scope.assert.equal(failed.runResult?.summary.failed, 1);
    scope.assert.deepEqual(failed.fallbackDiagnostics, []);
}

async function assertBenchmarkScenario(
    scope: TestScope,
    command: RunCommand,
    observer: BenchmarkObserver
): Promise<ReturnType<TestScope['assert']['collect']>> {
    await assertBenchmarkList(scope, command, observer);
    await assertBenchmarkShards(scope, command);
    await assertBenchmarkResults(scope, command, observer);
    await assertBenchmarkEmptySelection(scope, command);
    await assertBenchmarkFailureExitCode(scope, command);
    return scope.assert.collect();
}

export const testNode = createSuite({
    ...metadata,
    title: 'benchmark runner integration',
    children: executions.map(function executionScenario(execution) {
        return createTestCase({
            ...metadata,
            title: executionTitle(execution),
            async body(scope: TestScope) {
                const directory = await mkdtemp(join(tmpdir(), 'overkill-benchmark-'));
                const observer = createBenchmarkObserver();
                const command = createBenchmarkCommand(execution, directory, observer.reporter);
                await mkdir('target', { recursive: true });
                await rm(lifecycleFile, { force: true });
                try {
                    return await assertBenchmarkScenario(scope, command, observer);
                } finally {
                    await rm(lifecycleFile, { force: true });
                    await rm(directory, { recursive: true, force: true });
                }
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
