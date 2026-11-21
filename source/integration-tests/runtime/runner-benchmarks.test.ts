import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder, defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, suite } from '@overkill-dev/test';
import { executionTitle } from '../../test-support/execution-profile-title.ts';

import {
    canonicalIdentityJson,
    defineReporter,
    type DefinedReporter,
    type RunResult,
    type ReporterEvent
} from '../../packages/engine/engine.entry-point.ts';

import {
    normalizeConfig,
    orchestrator,
    type RunExecutionFacts,
    type BenchmarkExecution,
    type RunCommand
} from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { createBenchmarkCommands } from '../../run/benchmark-commands.ts';
import { readBenchmarkRunMetadata } from '../../bench/benchmark-run-report.ts';

const lifecycleFile = 'target/benchmark-lifecycle.txt';

const fixture = 'source/integration-tests/runtime/fixtures/benchmark.bench.test.ts';
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

const workerPlacementChecks = (
    check: CompositeCheckBuilder<'assert'>,
    execution: RunExecutionFacts
): CompositeAssertionReturn<'assert'> => {
    if (execution.processModel === 'worker-pool') {
        return check.group([
            check.equal(execution.workerCount.resolved, 1),
            check.equal(execution.workerCount.requested, 4),
            check.equal(execution.workerCount.profileMaximum, 4)
        ]);
    } else {
        return check.equal(execution.processModel, 'supervised-process');
    }
};

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

const listedBenchmarkFactsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    facts: Awaited<ReturnType<typeof orchestrator.bench.list>>['facts']
): CompositeAssertionReturn<'assert'> => {
    const initialChecks = check.group([
        check.equal(facts.execution.testFamily, 'benchmark'),
        check.equal(facts.benchmarkHost, null),
        check.equal(facts.cases.length, 3)
    ]);
    const runtimeCase = facts.cases.find(function passingCase(entry) {
        return entry.id.title === 'passes';
    });
    if (runtimeCase === undefined || runtimeCase === null) {
        return check.group([ initialChecks, check.defined(runtimeCase) ]);
    }
    return check.group([
        initialChecks,
        check.defined(runtimeCase),
        check.deepEqual(
            runtimeCase.workId.runtimes,
            [ { dimensions: { kind: 'fixture' }, name: 'benchmark-runtime', scenarios: {}, variantId: null } ] as const
        )
    ]);
};

const assertBenchmarkList = defineCompositeAssertion({
    name: 'benchmark list',
    async assert(check, command: RunCommand, observer: BenchmarkObserver) {
        const listed = await orchestrator.bench.list(command, { timing: null });
        return check.group([
            listedBenchmarkFactsChecks(check.annotated('listed benchmark facts'), listed.facts),
            check.deepEqual(await readdir(command.config.runtimeStateDir), []),
            check.deepEqual(observer.events.slice(), []),
            check.equal(observer.creations(), 0),
            workerPlacementChecks(check.annotated('worker placement'), listed.facts.execution)
        ]);
    }
});

const assertBenchmarkShards = defineCompositeAssertion({
    name: 'benchmark shards',
    async assert(check, command: RunCommand) {
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
        return check.deepEqual(titles, [ 'fails', 'passes', 'skips' ]);
    }
});

const benchmarkArtifactsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
    const names = new Set(result.artifacts.map(function attachmentName(artifact) {
        return artifact.payload.kind === 'runtime-attachment' ? artifact.payload.name : '';
    }));
    return check.group([
        check.true(names.has('setup')),
        check.true(names.has('teardown')),
        check.true(result.artifacts.some(function capturedOutput(artifact) {
            return artifact.payload.kind === 'captured-output' && artifact.payload.stream === 'stdout' &&
                artifact.payload.text === 'benchmark output\n';
        }))
    ]);
};

const benchmarkHostMetadataChecks = (
    check: CompositeCheckBuilder<'assert'>,
    _result: RunResult,
    observer: BenchmarkObserver
): CompositeAssertionReturn<'assert'> => {
    const start = observer.events.find(function runStart(event) {
        return event.kind === 'run-start';
    });
    if (start?.kind !== 'run-start') {
        throw new Error('Missing benchmark start facts.');
    }
    const runMetadata = readBenchmarkRunMetadata(start.facts);
    if (runMetadata?.host === undefined || runMetadata?.host === null) {
        return check.defined(runMetadata?.host);
    }
    return check.group([
        check.defined(runMetadata?.host),
        check.false(Object.hasOwn(runMetadata, 'version')),
        check.equal(runMetadata.calibration, null),
        check.equal(runMetadata.host.snapshot.version, 1),
        check.equal(canonicalIdentityJson(start.facts.benchmarkHost), canonicalIdentityJson(runMetadata.host)),
        check.equal(
            canonicalIdentityJson(start.facts.benchmarkPlacement),
            canonicalIdentityJson(runMetadata.placement)
        )
    ]);
};

const assertBenchmarkResults = defineCompositeAssertion({
    name: 'benchmark results',
    async assert(check, command: RunCommand, observer: BenchmarkObserver) {
        const delivery = await orchestrator.bench.runWithReporterDelivery(command, { timing: null });
        return check.group([
            check.equal(delivery.result.summary.passed, 1),
            check.equal(delivery.result.summary.failed, 1),
            check.equal(delivery.result.summary.skipped, 1),
            check.equal(observer.creations(), 1),
            check.deepEqual(delivery.result.runnerErrors, []),
            benchmarkHostMetadataChecks(check.annotated('benchmark host metadata'), delivery.result, observer),
            check
                .equal(await readFile(lifecycleFile, 'utf8'), 'acquire\nbody\ndispose\n'),
            check.deepEqual(observer.events.flatMap(caseLifecycle), [
                'start:passes',
                'end:passes',
                'start:fails',
                'end:fails',
                'start:skips',
                'end:skips'
            ]),
            benchmarkArtifactsChecks(check.annotated('benchmark artifacts'), delivery.result)
        ]);
    }
});

const assertBenchmarkEmptySelection = defineCompositeAssertion({
    name: 'benchmark empty selection',
    async assert(check, command: RunCommand) {
        const empty = await orchestrator.bench.run({
            ...command,
            request: {
                ...command.request,
                selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: 'missing' } }
            }
        }, { timing: null });
        return check.group([
            check.equal(empty.summary.planned, 0),
            check.equal(await readFile(lifecycleFile, 'utf8'), 'acquire\nbody\ndispose\n')
        ]);
    }
});

const assertBenchmarkFailureExitCode = defineCompositeAssertion({
    name: 'benchmark failure exit code',
    async assert(check, command: RunCommand) {
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
        return check.group([
            check.equal(failed.exitCode, 1),
            check.equal(failed.runResult?.summary.failed, 1),
            check.deepEqual(failed.fallbackDiagnostics, [])
        ]);
    }
});

export const testNode = suite(
    'benchmark runner integration',
    [ table({
        title: 'executes benchmark strategies across process boundaries',
        cases: executions,
        caseTitle: executionTitle,
        async test(scope) {
            const execution = scope.parameters;

            const directory = await mkdtemp(join(tmpdir(), 'overkill-benchmark-'));
            const observer = createBenchmarkObserver();
            const command = createBenchmarkCommand(execution, directory, observer.reporter);
            await mkdir('target', { recursive: true });
            await rm(lifecycleFile, { force: true });
            try {
                await scope.assert(assertBenchmarkList, command, observer);
                await scope.assert(assertBenchmarkShards, command);
                await scope.assert(assertBenchmarkResults, command, observer);
                await scope.assert(assertBenchmarkEmptySelection, command);
                await scope.assert(assertBenchmarkFailureExitCode, command);
                return scope.assert.collect();
            } finally {
                await rm(lifecycleFile, { force: true });
                await rm(directory, { recursive: true, force: true });
            }
        }
    }) ]
);
