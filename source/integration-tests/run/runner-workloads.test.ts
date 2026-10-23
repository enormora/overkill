import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { workIdentityKey, type RunResult } from '../../packages/engine/engine.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type BenchmarkExecution,
    type RunCommand
} from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { durationAdapter } from '../../test-support/benchmark-baseline-fixture.ts';
import { renderResolvedRunList } from '../../run/run-list-renderer.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';

const fixture = 'source/integration-tests/run/fixtures/workloads.bench.test.ts';
const worker: BenchmarkExecution = {
    processModel: 'worker-pool',
    scheduling: 'serial',
    maxConcurrency: 1,
    maxWorkers: 1,
    assignmentPolicy: 'case-count-balanced',
    dispatchPolicy: 'dynamic-lease',
    hedging: { mode: 'off' },
    hostProcess: { kind: 'direct' },
    workDistribution: { mode: 'case' },
    workerLifecycle: 'reuse'
};
const executions: readonly BenchmarkExecution[] = [
    worker,
    { ...worker, workerLifecycle: 'fresh-worker-per-unit' },
    { ...worker, hostProcess: { kind: 'child', nodeArguments: [] } },
    { processModel: 'supervised-process', scheduling: 'serial', maxConcurrency: 1 }
];

function commandForWorkloads(execution: BenchmarkExecution, directory: string): RunCommand {
    const config = normalizeConfig({
        runtimeStateDir: join(directory, 'runtime'),
        profiles: {
            workloads: {
                testFamily: 'benchmark',
                files: { include: [ fixture ] },
                baselines: {
                    directory: join(directory, 'baselines'),
                    adapters: [ durationAdapter(function () {
                        return 0;
                    }) ]
                }
            }
        }
    });
    const profile = config.profiles.workloads;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing workload benchmark profile.');
    }
    return {
        config: { ...config, reporters: [], profiles: { workloads: { ...profile, execution } } },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'workloads', order: 'lexical' })
    };
}

function assertWorkloadArtifacts(scope: TestScope, result: RunResult, count: number): void {
    const artifacts = result.artifacts.filter(function duration(artifact) {
        return artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === 'duration';
    });
    scope.assert.equal(artifacts.length, count);
    for (const artifact of artifacts) {
        scope.assert.true(artifact.id.workload?.name === 'small' || artifact.id.workload?.name === 'large');
        scope.assert.equal(artifact.id.runtimes.length, 1);
    }
}

function assertFixtureLifetimes(scope: TestScope, result: RunResult, count: number): void {
    for (
        const [ name, expected ] of [ [ 'fixture-acquisition', count / 2 ], [ 'fixture-disposal', count / 2 ], [
            'registry-disposal',
            1
        ] ] as const
    ) {
        const artifacts = result.artifacts.filter(function fixtureArtifact(artifact) {
            return artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === name;
        });
        scope.assert.equal(artifacts.length, expected);
    }
}

function assertWorkloadResults(scope: TestScope, result: RunResult, count: number): void {
    scope.assert.equal(result.status, 'passed');
    scope.assert.equal(result.summary.discovered, 4);
    scope.assert.equal(result.summary.planned, count);
    scope.assert.equal(result.summary.passed, count);
    scope.assert.deepEqual(result.runnerErrors, []);
    const identities = new Set(result.perTest.map(function key(entry) {
        return workIdentityKey(entry.workId);
    }));
    scope.assert.equal(identities.size, count);
    assertWorkloadArtifacts(scope, result, count);
    assertFixtureLifetimes(scope, result, count);
}

async function assertWorkloadShards(scope: TestScope, command: RunCommand): Promise<void> {
    const first = await orchestrator.bench.list({
        ...command,
        request: { ...command.request, shard: { index: 1, total: 2 } }
    }, { timing: null });
    const second = await orchestrator.bench.list({
        ...command,
        request: { ...command.request, shard: { index: 2, total: 2 } }
    }, { timing: null });
    const keys = [ ...first.facts.cases, ...second.facts.cases ].map(function key(entry) {
        return workIdentityKey(entry.workId);
    });
    scope.assert.equal(keys.length, 4);
    const identities = new Set(keys);
    scope.assert.equal(identities.size, 4);
}

async function assertWorkloadPlanning(scope: TestScope, command: RunCommand): Promise<void> {
    const listed = await orchestrator.bench.list(command, { timing: null });
    scope.assert.equal(listed.facts.cases.length, 4);
    const identities = new Set(listed.facts.cases.map(function key(entry) {
        return workIdentityKey(entry.workId);
    }));
    scope.assert.equal(identities.size, 4);
    const output = renderResolvedRunList(listed, { withLocations: false, withOrphans: false }).join('\n');
    scope.assert.equal(output.split('[workload=small]').length - 1, 2);
    scope.assert.equal(output.split('[workload=large]').length - 1, 2);
    await assertWorkloadShards(scope, command);
}

async function assertFilteredBaselines(scope: TestScope, command: RunCommand): Promise<void> {
    const apply = await orchestrator.bench.baseline.apply(command, { timing: null });
    scope.assert.equal(apply.changes.length, 0);
    const stored = await orchestrator.bench.baseline.list({
        ...command,
        request: { paths: [], profile: 'workloads' }
    });
    scope.assert.equal(stored.length, 4);
}

async function assertWorkloadExecution(scope: TestScope, command: RunCommand): Promise<void> {
    const filtered: RunCommand = {
        ...command,
        request: {
            ...command.request,
            selection: {
                kind: 'filter',
                filter: { kind: 'equals', field: 'workload', value: 'small' }
            }
        }
    };
    const bootstrap = await orchestrator.bench.baseline.bootstrap(command, { timing: null });
    assertWorkloadResults(scope, bootstrap.result, 4);
    scope.assert.equal(bootstrap.changes.length, 4);
    scope.assert.equal(bootstrap.writeOutcome.kind, 'written');
    const result = await orchestrator.bench.run(filtered, { timing: null });
    assertWorkloadResults(scope, result, 2);
    scope.assert.true(result.perTest.every(function small(entry) {
        return entry.workId.workload?.name === 'small';
    }));
    await assertFilteredBaselines(scope, filtered);
}

export const testNode = suite(
    'workload runner integration',
    executions.map(function scenario(execution, index) {
        return test(`execution ${index + 1}`, async function (scope) {
            await mkdir('target', { recursive: true });
            const directory = await mkdtemp('target/workloads-');
            scope.cleanup(async function () {
                await rm(directory, { recursive: true, force: true });
            });
            const command = commandForWorkloads(execution, directory);
            await assertWorkloadPlanning(scope, command);
            await assertWorkloadExecution(scope, command);
            return scope.assert.collect();
        });
    })
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
