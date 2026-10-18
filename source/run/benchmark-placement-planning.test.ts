import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { quietHost, definition } from '../test-support/benchmark-placement-fixture.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { CollectedExecutionPlanInput } from './collected-placement.ts';
import { createCollectedPlan } from './worker-pool-placement-planning.test.ts';
import { createCollectedExecutionPlan, type CollectedExecutionPlan } from './run-collected-planning.ts';
import { selectedCollectedRunPlan } from './run-selection.ts';
import { RunExecutionPlanError } from './run-errors.ts';

type PlanningInput = CollectedExecutionPlanInput;

function benchmarkProfile(): Extract<PlanningInput['profile'], { readonly testFamily: 'benchmark'; }> {
    const config = normalizeConfig({
        profiles: {
            sizes: {
                testFamily: 'benchmark',
                files: { include: [ '*.bench.ts' ] },
                execution: { processModel: 'worker-pool', maxWorkers: 3, workDistribution: { mode: 'case' } }
            }
        }
    });
    const profile = config.profiles.sizes;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return profile;
}

function planningInput(): PlanningInput {
    const profile = benchmarkProfile();
    const plan = createCollectedPlan();
    const collectedPlan = {
        ...plan,
        files: plan.files.map(function benchmarks(file) {
            return {
                ...file,
                cases: file.cases.map(function benchmark(testCase) {
                    return { ...testCase, benchmark: definition(), testFamily: 'benchmark' as const };
                })
            };
        })
    };
    const files = collectedPlan.files.map(function discovered(file) {
        return { file: file.file, fileSet: null, href: `file:///${file.file}`, path: file.file };
    });
    const [ firstFile, ...remainingFiles ] = files;
    if (firstFile === undefined) {
        throw new Error('Missing benchmark files.');
    }
    return {
        benchmarkHost: quietHost(),
        collectedPlan: { ...collectedPlan, discoveredFiles: collectedPlan.files },
        dependencies: { ...fakeWorkerPoolRuntimeDependencies(), availableParallelism: 8 },
        durationHistoryIndex: null,
        files: [ firstFile, ...remainingFiles ],
        planKind: 'worker-pool',
        profile,
        request: defaultRunRequest({ profile: 'sizes', workers: 4 })
    };
}

function mixedMeasurements(input: PlanningInput): PlanningInput['collectedPlan'] {
    const files = input.collectedPlan.files.map(function mixed(file, index) {
        return {
            ...file,
            cases: file.cases.map(function measurement(testCase) {
                return {
                    ...testCase,
                    benchmark: { ...definition(), kind: index === 0 ? 'bundle-size' : 'runtime' }
                };
            })
        };
    });
    return { ...input.collectedPlan, files, discoveredFiles: files };
}

async function shardPlans(input: PlanningInput): Promise<readonly CollectedExecutionPlan[]> {
    const shards = 8;
    const collectedPlan = mixedMeasurements(input);
    return await Promise.all(Array.from({ length: shards }, async function shardPlan(_value, index) {
        return await createCollectedExecutionPlan({
            ...input,
            collectedPlan,
            request: { ...input.request, shard: { index: index + 1, total: shards } }
        });
    }));
}

function saturatedHost(): PlanningInput['benchmarkHost'] {
    const host = quietHost();
    return {
        ...host,
        snapshot: {
            ...host.snapshot,
            signals: {
                ...host
                    .snapshot
                    .signals,
                cpuBusyPercent: {
                    ...host
                        .snapshot
                        .signals
                        .cpuBusyPercent,
                    availability: 'available',
                    value: 100
                }
            }
        }
    };
}

function mixedLifecycleInput(): PlanningInput {
    const input = planningInput();
    const profile = benchmarkProfile();
    const { execution } = profile;
    if (execution.processModel !== 'worker-pool') {
        throw new Error('Expected worker-pool profile.');
    }
    const [ reuse, fresh ] = input.files;
    if (fresh === undefined) {
        throw new Error('Missing fresh-worker file.');
    }
    return {
        ...input,
        benchmarkHost: saturatedHost(),
        files: [ { ...reuse, fileSet: 'reuse' }, { ...fresh, fileSet: 'fresh' } ],
        profile: {
            ...profile,
            execution: {
                ...execution,
                workDistribution: {
                    mode: 'group',
                    unmatched: 'reject',
                    groups: [
                        {
                            name: 'reuse',
                            fileSets: [ 'reuse' ],
                            granularity: 'case',
                            order: 'profile-default',
                            scheduling: 'profile-default',
                            workerLifecycle: 'reuse'
                        },
                        {
                            name: 'fresh',
                            fileSets: [ 'fresh' ],
                            granularity: 'case',
                            order: 'profile-default',
                            scheduling: 'profile-default',
                            workerLifecycle: 'fresh-worker-per-unit'
                        }
                    ]
                }
            }
        }
    };
}

export const testNode = suite('adaptive benchmark plan integration', [
    test('caps lanes without rewriting request, host or profile facts', async function (scope) {
        const plan = await createCollectedExecutionPlan(planningInput());
        scope.assert.deepEqual<unknown, unknown>(plan.workerCount, {
            requested: 4,
            hostMaximum: 8,
            profileMaximum: 3,
            resolved: 2
        });
        scope.assert.equal(plan.benchmarkPlacement?.maximumWorkers, 7);
        scope.assert.equal(plan.placementPlan?.lanes.length, 2);
        scope.assert.true(
            plan.placementPlan?.units.every(function serial(unit) {
                return unit.scheduling === 'serial';
            })
        );
        return scope.assert.collect();
    }),
    test('does not let filtered sensitive work serialize selected artifact work', async function (scope) {
        const input = planningInput();
        const mixed = mixedMeasurements(input);
        const all = await createCollectedExecutionPlan({ ...input, collectedPlan: mixed });
        const selected = selectedCollectedRunPlan(mixed, {
            kind: 'filter',
            filter: { kind: 'equals', field: 'title', value: 'first' }
        });
        const filtered = await createCollectedExecutionPlan({ ...input, collectedPlan: selected });
        scope.assert.equal(all.benchmarkPlacement?.maximumWorkers, 1);
        scope.assert.equal(filtered.orderedCases.length, 1);
        scope.assert.equal(filtered.benchmarkPlacement?.maximumWorkers, 7);
        return scope.assert.collect();
    }),
    test('ignores timing budgets on an excluded workload of the same benchmark', async function (scope) {
        const input = planningInput();
        const size = definition();
        const collectedPlan = {
            ...input.collectedPlan,
            files: input.collectedPlan.files.map(function workloads(file) {
                return {
                    ...file,
                    cases: file.cases.map(function selectedWorkload(testCase) {
                        return {
                            ...testCase,
                            benchmark: {
                                ...size,
                                workloads: [ ...size.workloads, { name: 'timed', parameters: {} } ],
                                budgets: {
                                    ...size.budgets,
                                    timed: [ {
                                        metric: 'durationMicroseconds',
                                        maximum: 100,
                                        minimum: null,
                                        statistic: { kind: 'observed-maximum' as const }
                                    } ]
                                }
                            },
                            workId: {
                                case: {
                                    file: file.file,
                                    title: testCase.title,
                                    params: testCase.params,
                                    suite: testCase.suitePath.map(function title(suiteEntry) {
                                        return suiteEntry.title;
                                    })
                                },
                                runtimes: [],
                                workload: { name: 'small', params: {} }
                            }
                        };
                    })
                };
            })
        };
        const plan = await createCollectedExecutionPlan({ ...input, collectedPlan });
        scope.assert.equal(plan.benchmarkPlacement?.maximumWorkers, 7);
        scope.assert.equal(plan.workerCount?.resolved, 2);
        return scope.assert.collect();
    }),
    test('evaluates eligibility after work-unit sharding', async function (scope) {
        const plans = await shardPlans(planningInput());
        const artifactShard = plans.find(function onlyArtifactWork(plan) {
            return plan.orderedCases.length === 1 && plan.orderedCases[0]?.testCase.title === 'first';
        });
        scope.assert.equal(artifactShard?.benchmarkPlacement?.maximumWorkers, 7);
        return scope.assert.collect();
    }),
    test('rejects mixed lifecycles that cannot fit the calibrated ceiling', async function (scope) {
        await scope.assert.rejects(async function incompatibleLifecycles() {
            return await createCollectedExecutionPlan(mixedLifecycleInput());
        }, {
            type: RunExecutionPlanError,
            message:
                'Execution plan is incompatible: Worker-pool execution requires 2 lifecycle lanes but only 1 are available.'
        });
        return scope.assert.collect();
    })
]);
