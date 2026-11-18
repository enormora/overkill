import { normalizeConfig } from '../config/config.ts';
import type { CollectedExecutionPlanInput as PlanningInput } from '../run/collected-placement.ts';
import { createCollectedPlan } from './worker-pool-placement.ts';
import { quietHost, definition } from './benchmark-placement-fixture.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';
import { defaultRunRequest } from './run-command-factory.ts';

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
    const profile = config.profiles['sizes'];
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return profile;
}

export function planningInput(): PlanningInput {
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
        projectRoot: '/project',
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

export function mixedMeasurements(input: PlanningInput): PlanningInput['collectedPlan'] {
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

export function mixedLifecycleInput(): PlanningInput {
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
