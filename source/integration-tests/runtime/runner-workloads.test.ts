import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder, defineCompositeAssertion } from '@overkill-dev/test/assert';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { table, suite } from '@overkill-dev/test';
import { executionTitle } from '../../test-support/execution-profile-title.ts';

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

const fixture = 'source/integration-tests/runtime/fixtures/workloads.bench.test.ts';
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

const workloadArtifactsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult,
    count: number
): CompositeAssertionReturn<'assert'> => {
    const artifacts = result.artifacts.filter(function duration(artifact) {
        return artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === 'duration';
    });
    return check.group([
        check.equal(artifacts.length, count),
        ...artifacts.map((artifact) => {
            return check.group([
                check.true(artifact.id.workload?.name === 'small' || artifact.id.workload?.name === 'large'),
                check.equal(artifact.id.runtimes.length, 1)
            ]);
        })
    ]);
};

const fixtureLifetimesChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult,
    count: number
): CompositeAssertionReturn<'assert'> => {
    const [ firstCheck, ...remainingChecks ] =
        ([ [ 'fixture-acquisition', count / 2 ], [ 'fixture-disposal', count / 2 ], [
            'registry-disposal',
            1
        ] ] as const)
            .map(([ name, expected ]) => {
                const artifacts = result.artifacts.filter(function fixtureArtifact(artifact) {
                    return artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === name;
                });
                return check.equal(artifacts.length, expected);
            });
    if (firstCheck === undefined) {
        throw new Error('Expected at least one recorded check.');
    }
    return check.group([ firstCheck, ...remainingChecks ]);
};

const workloadResultsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult,
    count: number
): CompositeAssertionReturn<'assert'> => {
    const initialChecksBeforeNextAction = check.group([
        check.equal(result.status, 'passed'),
        check.equal(result.summary.discovered, 4),
        check.equal(result.summary.planned, count),
        check.equal(result.summary.passed, count),
        check.deepEqual(result.runnerErrors, [])
    ]);
    const identities = new Set(result.perTest.map(function key(entry) {
        return workIdentityKey(entry.workId);
    }));
    return check.group([
        initialChecksBeforeNextAction,
        check.equal(identities.size, count),
        workloadArtifactsChecks(check.annotated('workload artifacts'), result, count),
        fixtureLifetimesChecks(check.annotated('fixture lifetimes'), result, count)
    ]);
};

const workloadShardsChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    command: RunCommand
): Promise<CompositeAssertionReturn<'assert'>> => {
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
    const initialChecks = check.equal(keys.length, 4);
    const identities = new Set(keys);
    return check.group([ initialChecks, check.equal(identities.size, 4) ]);
};

const assertWorkloadPlanning = defineCompositeAssertion({
    name: 'workload planning',
    async assert(check, command: RunCommand) {
        const listed = await orchestrator.bench.list(command, { timing: null });
        const initialChecks = check.equal(listed.facts.cases.length, 4);
        const identities = new Set(listed.facts.cases.map(function key(entry) {
            return workIdentityKey(entry.workId);
        }));
        const intermediateChecks = check.equal(identities.size, 4);
        const output = renderResolvedRunList(listed, { withLocations: false, withOrphans: false }).join('\n');
        return check.group([
            initialChecks,
            intermediateChecks,
            check.equal(
                output
                    .split('[workload=small]')
                    .length - 1,
                2
            ),
            check.equal(output.split('[workload=large]').length - 1, 2),
            await workloadShardsChecks(check.annotated('workload shards'), command)
        ]);
    }
});

const filteredBaselinesChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    command: RunCommand
): Promise<CompositeAssertionReturn<'assert'>> => {
    const apply = await orchestrator.bench.baseline.apply(command, { timing: null });
    const initialChecks = check.equal(apply.changes.length, 0);
    const stored = await orchestrator.bench.baseline.list({
        ...command,
        request: { paths: [], profile: 'workloads' }
    });
    return check.group([ initialChecks, check.equal(stored.length, 4) ]);
};

const assertWorkloadExecution = defineCompositeAssertion({
    name: 'workload execution',
    async assert(check, command: RunCommand) {
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
        const initialChecksBeforeNextAction = check.group([
            workloadResultsChecks(check.annotated('workload results'), bootstrap.result, 4),
            check.equal(bootstrap.changes.length, 4),
            check.equal(bootstrap.writeOutcome.kind, 'written')
        ]);
        const result = await orchestrator.bench.run(filtered, { timing: null });
        return check.group([
            initialChecksBeforeNextAction,
            workloadResultsChecks(check.annotated('workload results'), result, 2),
            check
                .true(result.perTest.every(function small(entry) {
                    return entry.workId.workload?.name === 'small';
                })),
            await filteredBaselinesChecks(check.annotated('filtered baselines'), filtered)
        ]);
    }
});

export const testNode = suite(
    'workload runner integration',
    [ table({
        title: 'executes declared workloads across execution boundaries',
        cases: executions,
        caseTitle: executionTitle,
        async test(scope) {
            const execution = scope.parameters;

            await mkdir('target', { recursive: true });
            const directory = await mkdtemp('target/workloads-');
            scope.cleanup(async function () {
                await rm(directory, { recursive: true, force: true });
            });
            const command = commandForWorkloads(execution, directory);
            await scope.assert(assertWorkloadPlanning, command);
            await scope.assert(assertWorkloadExecution, command);
            return scope.assert.collect();
        }
    }) ]
);
