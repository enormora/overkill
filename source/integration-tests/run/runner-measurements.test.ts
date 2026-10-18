import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createSuite,
    createTestCase,
    defineReporter,
    type ReporterEvent,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type BenchmarkExecution,
    type RunCommand
} from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { canonicalIdentityJson } from '../../canonical-identity.ts';

const fixture = 'source/integration-tests/run/fixtures/measurement.bench.test.ts';
const lifecycleFile = 'target/measurement-lifecycle.txt';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const executions: readonly BenchmarkExecution[] = [
    { processModel: 'supervised-process', maxConcurrency: 1, scheduling: 'serial' },
    {
        assignmentPolicy: 'case-count-balanced',
        dispatchPolicy: 'dynamic-lease',
        hedging: { mode: 'off' },
        hostProcess: { kind: 'direct' },
        maxConcurrency: 1,
        maxWorkers: 2,
        processModel: 'worker-pool',
        scheduling: 'serial',
        workDistribution: { mode: 'case' },
        workerLifecycle: 'reuse'
    }
];

function measurementCommand(
    execution: BenchmarkExecution,
    directory: string,
    record: (event: ReporterEvent) => void
): RunCommand {
    const reporter = defineReporter(function () {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'measurement-observer',
            onFinish: null,
            sinks: [ { kind: 'memory' } ],
            onEvent(event) {
                record(event);
            }
        };
    });
    const config = normalizeConfig({
        profiles: { measurements: { testFamily: 'benchmark', files: { include: [ fixture ] } } },
        reporters: [ reporter ],
        runtimeStateDir: directory
    });
    const profile = config.profiles.measurements;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        config: { ...config, profiles: { measurements: { ...profile, execution } } },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'measurements', order: 'lexical' })
    };
}

async function assertListedMeasurements(
    scope: TestScope,
    command: RunCommand,
    events: readonly ReporterEvent[]
): Promise<void> {
    const listed = await orchestrator.bench.list(command, { timing: null });
    scope.assert.equal(listed.facts.cases.length, 4);
    scope.assert.deepEqual(await readdir(command.config.runtimeStateDir), []);
    scope.assert.equal(events.length, 0);
    await scope.assert.rejects(async function () {
        return readFile(lifecycleFile);
    }, { code: 'ENOENT' });
}

async function assertMeasurementLifecycle(scope: TestScope): Promise<void> {
    const lifecycleText = await readFile(lifecycleFile, 'utf8');
    const lifecycle = lifecycleText.trim().split('\n').toSorted(function (left, right) {
        return left.localeCompare(right);
    });
    scope.assert.deepEqual(lifecycle, [ 'acquire:1', 'acquire:2', 'dispose:1', 'dispose:2' ]);
}

function assertWarmupEvidence(scope: TestScope, result: Awaited<ReturnType<typeof orchestrator.bench.run>>): void {
    for (const test of result.perTest) {
        const lifecycle = test.benchmark?.lifecycle;
        scope.require.defined(lifecycle);
        scope.assert.equal(lifecycle.warmup.samples, 32);
        scope.assert.equal(lifecycle.warmup.rawSamples.status, 'recorded');
        scope.assert.deepEqual(lifecycle.cleanup, { callbacks: 160, failures: 0 });
        const artifact = result.artifacts.find(function warmupArtifact(candidate) {
            return canonicalIdentityJson(candidate.id) ===
                canonicalIdentityJson(JSON.parse(lifecycle.warmup.rawSamples.reference ?? 'null'));
        });
        scope.require.defined(artifact);
        scope.assert.partialDeepEqual(artifact.payload, {
            kind: 'runtime-attachment',
            name: 'benchmark-warmup-samples'
        });
    }
}

function assertMeasurementProgress(scope: TestScope, events: readonly ReporterEvent[]): void {
    scope.assert.equal(
        events
            .filter(function (event) {
                return event.kind === 'benchmark-progress';
            })
            .length,
        16
    );
    scope.assert.equal(
        events
            .filter(function (event) {
                return event.kind === 'test-end' && event.benchmark?.status === 'complete';
            })
            .length,
        4
    );
}

async function assertMeasurements(
    scope: TestScope,
    command: RunCommand,
    events: readonly ReporterEvent[]
): Promise<void> {
    await assertListedMeasurements(scope, command, events);
    const result = await orchestrator.bench.run(command, { timing: null });
    scope.assert.equal(result.summary.passed, 4);
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.true(
        result.perTest.every(function (entry) {
            return entry.benchmark?.samples === 128 && entry.attempts[0].benchmark?.status === 'complete';
        })
    );
    scope.assert.true(result.perTest.every(function (entry) {
        return entry.benchmark?.rawSamples.status === 'recorded';
    }));
    scope.assert.equal(
        result
            .artifacts
            .filter(function (artifact) {
                return artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === 'benchmark-samples';
            })
            .length,
        4
    );
    assertMeasurementProgress(scope, events);
    assertWarmupEvidence(scope, result);
    await assertMeasurementLifecycle(scope);
}

export const testNode = createSuite({
    ...metadata,
    title: 'measurement runner integration',
    children: executions.map(function (execution) {
        return createTestCase({
            ...metadata,
            title: execution.processModel,
            async body(scope: TestScope) {
                const directory = await mkdtemp(join(tmpdir(), 'overkill-measurement-'));
                const events: ReporterEvent[] = [];
                const command = measurementCommand(execution, directory, function (event) {
                    events.push(event);
                });
                await mkdir('target', { recursive: true });
                await rm(lifecycleFile, { force: true });
                try {
                    await assertMeasurements(scope, command, events);
                    return scope.assert.collect();
                } finally {
                    await rm(lifecycleFile, { force: true });
                    await rm(directory, { recursive: true, force: true });
                }
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
