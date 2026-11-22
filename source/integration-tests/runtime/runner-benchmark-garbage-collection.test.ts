import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

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

const fixture = 'source/integration-tests/runtime/fixtures/garbage-collection.bench.test.ts';
type Boundary = 'fresh-worker-per-unit' | 'reuse' | 'supervised-process';

async function commandFor(
    cleanup: TestScope['cleanup'],
    boundary: Boundary,
    garbageCollection: BenchmarkGarbageCollectionPolicy,
    title: string
): Promise<RunCommand> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-gc-'));
    cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    return {
        config: normalizeConfig({
            runtimeStateDir: directory,
            profiles: {
                bench: {
                    testFamily: 'benchmark',
                    timeouts: { collectionMilliseconds: 30_000 },
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

const assertRequestedHost = defineCompositeAssertion({
    name: 'requested host',
    assert(check, execution: RunExecutionFacts) {
        if (execution.processModel !== 'worker-pool') {
            return check.equal(execution.processModel, 'supervised-process');
        }
        const host = execution.hostProcess;
        if (host.kind !== 'child') {
            throw new Error('Expected a GC host process.');
        }
        return check.group([
            check.deepEqual(host.nodeArguments, [ '--expose-gc' ]),
            check.true(host.reasons.includes('forced-garbage-collection'))
        ]);
    }
});

const assertGarbageCollectionRun = defineCompositeAssertion({
    name: 'garbage collection run',
    assert(check, result: RunResult) {
        const tested = result.perTest[0];
        const measured = tested?.benchmark;
        if (measured === undefined || measured === null) {
            return check.group([ check.defined(measured), check.notNull(measured) ]);
        }
        return check.group([
            check.equal(result.summary.passed, 1),
            check.deepEqual(result.runnerErrors, []),
            check.partialDeepEqual(measured, {
                metrics: { exposed: { median: 1 } },
                lifecycle: {
                    policy: { garbageCollection: 'after-sample' },
                    garbageCollection: { mode: 'after-sample', completed: 3, failures: 0 }
                }
            }),
            check.deepEqual({ benchmark: tested?.attempts[0].benchmark }, { benchmark: measured })
        ]);
    }
});

const assertShardHost = defineCompositeAssertion({
    name: 'shard host',
    assert(check, facts: RunFacts) {
        const needsGc = facts.cases.some(function (entry) {
            return entry.id.title === 'after-sample';
        });
        const { execution } = facts;
        if (execution.processModel !== 'worker-pool') {
            throw new Error('Expected worker-pool facts.');
        }
        return check.group([ check.equal(execution.hostProcess.kind, needsGc ? 'child' : 'direct') ]);
    }
});

const assertDisabledCollection = defineCompositeAssertion({
    name: 'disabled collection',
    assert(check, result: RunResult) {
        const initialChecks = check.equal(result.summary.passed, 1);
        const evidence = result.perTest[0]?.benchmark?.lifecycle?.garbageCollection;
        if (evidence === undefined || evidence === null) {
            return check.group([ initialChecks, check.defined(evidence) ]);
        }
        return check.group([ initialChecks, check.defined(evidence), check.deepEqual(evidence, { mode: 'off' }) ]);
    }
});

async function runExposedGarbageCollectionProbe(): Promise<string> {
    return new Promise(function captureProbeOutput(resolve, reject) {
        execFile(
            process.execPath,
            [
                '--expose-gc',
                'source/integration-tests/runtime/fixtures/direct-garbage-collection.test.ts'
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

const directOriginalHost = defineCompositeAssertion({
    name: 'preserves the original direct worker host',
    assert(check, profile: RunCommand['config']['profiles'][string] | undefined) {
        if (profile === undefined) {
            return check.defined(profile);
        }
        return profile.execution.processModel === 'worker-pool'
            ? check.deepEqual(profile.execution.hostProcess, { kind: 'direct' })
            : check.defined(profile);
    }
});
export const testNode = suite('benchmark GC process boundaries', [
    test(
        'rejects direct engine GC even when the caller explicitly exposes it',
        async function (scope) {
            const stdout = await runExposedGarbageCollectionProbe();
            scope.assert.equal(
                stdout,
                JSON.stringify({ exposed: true, requestedSamples: 0, errors: [ 'measurement' ] })
            );
            return scope.assert.collect();
        }
    ),
    test('derives each shard host from its own selected benchmark work', async function (scope) {
        const command = await commandFor(scope.cleanup, 'reuse', 'off', 'after-sample');
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
            scope.assert(assertShardHost, shard.facts);
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
    table({
        title: 'collects only requested invocations across execution boundaries',
        cases: [ 'supervised-process', 'reuse', 'fresh-worker-per-unit' ] as const,
        caseTitle(boundary) {
            return boundary;
        },
        async test(scope) {
            const boundary = scope.parameters;

            const originalGc = globalThis.gc;
            const command = await commandFor(scope.cleanup, boundary, 'off', 'after-sample');
            const listed = await orchestrator.bench.list(command, { timing: null });
            scope.assert(assertRequestedHost, listed.facts.execution);

            scope.assert(directOriginalHost, command.config.profiles.bench);

            const result = await orchestrator.bench.run(command, { timing: null });
            scope.assert(assertGarbageCollectionRun, result);
            scope.assert.equal(globalThis.gc, originalGc);
            return scope.assert.collect();
        }
    }),
    test(
        'keeps unselected GC requests out of host resolution and honors an off override',
        async function (scope) {
            const command = await commandFor(scope.cleanup, 'reuse', 'after-sample', 'off');
            const listed = await orchestrator.bench.list(command, { timing: null });
            const { execution } = listed.facts;
            if (execution.processModel !== 'worker-pool') {
                throw new Error('Expected worker-pool facts.');
            }
            scope.assert.deepEqual(execution.hostProcess, { kind: 'direct' });
            const result = await orchestrator.bench.run(command, { timing: null });
            scope.assert(assertDisabledCollection, result);
            return scope.assert.collect();
        }
    ),
    test('passes the profile default through hosted worker commands', async function (scope) {
        const command = await commandFor(scope.cleanup, 'reuse', 'after-sample', 'profile-default');
        const result = await orchestrator.bench.run(command, { timing: null });
        scope.assert(assertGarbageCollectionRun, result);
        return scope.assert.collect();
    })
]);
