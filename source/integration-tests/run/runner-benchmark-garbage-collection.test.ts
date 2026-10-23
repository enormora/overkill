import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import type { RunResult } from '../../packages/engine/engine.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type RunCommand,
    type RunFacts,
    type RunExecutionFacts,
    type BenchmarkGarbageCollectionPolicy
} from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '#test-runner';

const fixture = 'source/integration-tests/run/fixtures/garbage-collection.bench.test.ts';
type Boundary = 'fresh-worker-per-unit' | 'reuse' | 'supervised-process';

async function commandFor(
    scope: TestScope,
    boundary: Boundary,
    garbageCollection: BenchmarkGarbageCollectionPolicy,
    title: string
): Promise<RunCommand> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-gc-'));
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    return {
        config: normalizeConfig({
            runtimeStateDir: directory,
            profiles: {
                bench: {
                    testFamily: 'benchmark',
                    garbageCollection,
                    files: { include: [ fixture ] },
                    execution: boundary === 'supervised-process'
                        ? { processModel: 'supervised-process' }
                        : { processModel: 'worker-pool', workerLifecycle: boundary }
                }
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'bench',
            selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: title } }
        })
    };
}

function assertRequestedHost(scope: TestScope, execution: RunExecutionFacts): void {
    if (execution.processModel !== 'worker-pool') {
        return;
    }
    const host = execution.hostProcess;
    if (host.kind !== 'child') {
        throw new Error('Expected a GC host process.');
    }
    scope.assert.deepEqual(host.nodeArguments, [ '--expose-gc' ]);
    scope.assert.true(host.reasons.includes('forced-garbage-collection'));
}

function assertOriginalHost(scope: TestScope, command: RunCommand): void {
    const profile = command.config.profiles.bench;
    scope.require.defined(profile);
    if (profile.execution.processModel === 'worker-pool') {
        scope.assert.deepEqual(profile.execution.hostProcess, { kind: 'direct' });
    }
}

function assertGarbageCollectionRun(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
    const measured = result.perTest[0]?.benchmark;
    scope.require.defined(measured);
    scope.assert.equal(measured.metrics.exposed?.median, 1);
    scope.assert.partialDeepEqual(measured.lifecycle ?? {}, {
        version: 2,
        policy: { garbageCollection: 'after-sample' },
        garbageCollection: { mode: 'after-sample', completed: 3, failures: 0 }
    });
    const attempted = result.perTest[0]?.attempts[0].benchmark;
    scope.require.defined(attempted);
    scope.assert.deepEqual(attempted, measured);
}

function assertShardHost(scope: TestScope, facts: RunFacts): void {
    const needsGc = facts.cases.some(function (entry) {
        return entry.id.title === 'after-sample';
    });
    const { execution } = facts;
    if (execution.processModel !== 'worker-pool') {
        throw new Error('Expected worker-pool facts.');
    }
    scope.assert.equal(execution.hostProcess.kind, needsGc ? 'child' : 'direct');
}

function assertDisabledCollection(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.passed, 1);
    const evidence = result.perTest[0]?.benchmark?.lifecycle?.garbageCollection;
    scope.require.defined(evidence);
    scope.assert.deepEqual(evidence, { mode: 'off' });
}

async function runExposedGarbageCollectionProbe(): Promise<string> {
    return new Promise(function captureProbeOutput(resolve, reject) {
        execFile(
            process.execPath,
            [
                '--expose-gc',
                'source/integration-tests/run/fixtures/direct-garbage-collection.test.ts'
            ],
            { encoding: 'utf8' },
            function completed(error: Error | null, stdout: string) {
                if (error !== null) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

export const testNode = suite('benchmark GC process boundaries', [
    test('rejects direct engine GC even when the caller explicitly exposes it', async function (scope: TestScope) {
        const stdout = await runExposedGarbageCollectionProbe();
        scope.assert.equal(stdout, JSON.stringify({ exposed: true, requestedSamples: 0, errors: [ 'measurement' ] }));
        return scope.assert.collect();
    }),
    test('derives each shard host from its own selected benchmark work', async function (scope: TestScope) {
        const command = await commandFor(scope, 'reuse', 'off', 'after-sample');
        const listed = await Promise.all([ 1, 2 ].map(async function (index) {
            return await orchestrator.bench.list({
                ...command,
                request: {
                    ...command.request,
                    selection: { kind: 'all' },
                    shard: { index, total: 2 }
                }
            }, { timing: null });
        }));
        for (const shard of listed) {
            assertShardHost(scope, shard.facts);
        }
        const hostedShards = listed.filter(function (shard) {
            const { execution } = shard.facts;
            if (execution.processModel !== 'worker-pool') {
                return false;
            }
            return execution.hostProcess.kind === 'child';
        });
        scope.assert.equal(hostedShards.length, 1);
        return scope.assert.collect();
    }),
    ...([ 'supervised-process', 'reuse', 'fresh-worker-per-unit' ] as const).map(function (boundary) {
        return test(`collects only requested invocations in ${boundary}`, async function (scope: TestScope) {
            const originalGc = globalThis.gc;
            const command = await commandFor(scope, boundary, 'off', 'after-sample');
            const listed = await orchestrator.bench.list(command, { timing: null });
            assertRequestedHost(scope, listed.facts.execution);
            assertOriginalHost(scope, command);
            const result = await orchestrator.bench.run(command, { timing: null });
            assertGarbageCollectionRun(scope, result);
            scope.assert.equal(globalThis.gc, originalGc);
            return scope.assert.collect();
        });
    }),
    test(
        'keeps unselected GC requests out of host resolution and honors an off override',
        async function (scope: TestScope) {
            const command = await commandFor(scope, 'reuse', 'after-sample', 'off');
            const listed = await orchestrator.bench.list(command, { timing: null });
            const { execution } = listed.facts;
            if (execution.processModel !== 'worker-pool') {
                throw new Error('Expected worker-pool facts.');
            }
            scope.assert.deepEqual(execution.hostProcess, { kind: 'direct' });
            const result = await orchestrator.bench.run(command, { timing: null });
            assertDisabledCollection(scope, result);
            return scope.assert.collect();
        }
    ),
    test('passes the profile default through hosted worker commands', async function (scope: TestScope) {
        const command = await commandFor(scope, 'reuse', 'after-sample', 'profile-default');
        const result = await orchestrator.bench.run(command, { timing: null });
        assertGarbageCollectionRun(scope, result);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
