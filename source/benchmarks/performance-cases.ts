import type { ProjectWorkerPoolExecution } from '../config/schema.ts';
import type { MicrotestExecution, MicrotestProcessModel } from '../config/types.ts';
import type { BuiltinFamilyId } from '../engine/builtin-test-families.ts';

type Family = BuiltinFamilyId | 'type-test';
type Route = 'cli' | 'engine' | 'runner';
type Execution = MicrotestExecution | ProjectWorkerPoolExecution;
type RuntimeWorkload = 'assertions' | 'async' | 'repeated' | 'resident' | 'resources' | 'straggler';
const cliWorkloads = [
    'list',
    'list-filtered',
    'list-with-locations',
    'report-quiet',
    'report-line',
    'report-dot',
    'report-dot-pty',
    'report-line-progress-pty',
    'report-brief',
    'report-line-failure',
    'report-github-failure',
    'run-control',
    'run-timings',
    'run-coverage'
] as const;
type CliWorkload = typeof cliWorkloads[number];
type Workload = CliWorkload | RuntimeWorkload | 'artifact' | 'compiler' | 'sampling';

type Scenario = {
    readonly id: string;
    readonly execution: Execution;
    readonly workload: Workload;
    readonly hosted: boolean;
};

export type PerformanceCase = {
    readonly id: string;
    readonly family: Family;
    readonly route: Route;
    readonly files: number;
    readonly suitesPerFile: number;
    readonly casesPerSuite: number;
    readonly execution: Execution;
    readonly workload: Workload;
    readonly hosted: boolean;
};

const routes = [ 'engine', 'runner', 'cli' ] as const;
const one = { name: 'one', files: 1, suitesPerFile: 1, casesPerSuite: 1 } as const;
const many = { name: 'many-files', files: 8, suitesPerFile: 1, casesPerSuite: 4 } as const;
const shapes = [ one, { name: 'many-suites', files: 1, suitesPerFile: 8, casesPerSuite: 4 }, many ] as const;
const concurrentCases = 4;
const workers = 2;
const workerPool: ProjectWorkerPoolExecution = {
    processModel: 'worker-pool',
    scheduling: 'serial',
    maxConcurrency: 1,
    maxWorkers: workers,
    workDistribution: { mode: 'file' },
    workerLifecycle: 'reuse',
    dispatchPolicy: 'static-assignment',
    assignmentPolicy: 'stable',
    hedging: { mode: 'off' }
};

function serialProcess(processModel: MicrotestProcessModel): MicrotestExecution {
    return { processModel, scheduling: 'serial', maxConcurrency: 1 };
}

function matrixCase(family: Family, route: Route, shape: typeof shapes[number], scenario: Scenario): PerformanceCase {
    return {
        id: [ family, route, shape.name, scenario.id ].join('-'),
        family,
        route,
        files: shape.files,
        suitesPerFile: shape.suitesPerFile,
        casesPerSuite: shape.casesPerSuite,
        execution: scenario.execution,
        workload: scenario.workload,
        hosted: scenario.hosted
    };
}

function familyCases(family: Family, workload: Workload): PerformanceCase[] {
    return shapes.flatMap(function shapeCases(shape) {
        return routes.map(function (route) {
            const model = route === 'engine' ? 'in-process' : 'supervised-process';
            return matrixCase(family, route, shape, {
                id: 'serial',
                workload,
                execution: serialProcess(model),
                hosted: false
            });
        });
    });
}

function asyncCases(family: 'microtest' | 'property'): PerformanceCase[] {
    const models = [ 'in-process', 'supervised-process' ] as const;
    const schedules = [ 'serial', 'concurrent' ] as const;
    return ([ 'runner', 'cli' ] as const).flatMap(function routeCases(route) {
        return models.flatMap(function modelCases(processModel) {
            return schedules.map(function schedulingCase(scheduling) {
                return matrixCase(family, route, many, {
                    id: `${processModel}-${scheduling}`,
                    workload: 'async',
                    execution: {
                        processModel,
                        scheduling,
                        maxConcurrency: scheduling === 'serial' ? 1 : concurrentCases
                    },
                    hosted: false
                });
            });
        });
    });
}

const integrationScenarios: readonly (Scenario & { readonly route: 'cli' | 'runner'; })[] = [
    {
        id: 'concurrent',
        workload: 'resources',
        route: 'runner',
        hosted: false,
        execution: { processModel: 'supervised-process', scheduling: 'concurrent', maxConcurrency: concurrentCases }
    },
    { id: 'pool-file-reuse', workload: 'resources', route: 'runner', hosted: false, execution: workerPool },
    {
        id: 'pool-resident-memory',
        workload: 'resident',
        route: 'runner',
        hosted: true,
        execution: { ...workerPool, scheduling: 'concurrent', maxConcurrency: concurrentCases }
    },
    {
        id: 'pool-file-fresh',
        workload: 'resources',
        route: 'cli',
        hosted: false,
        execution: { ...workerPool, workerLifecycle: 'fresh-worker-per-unit' }
    },
    {
        id: 'pool-case-fresh',
        workload: 'resources',
        route: 'runner',
        hosted: false,
        execution: {
            ...workerPool,
            workDistribution: { mode: 'case' },
            workerLifecycle: 'fresh-worker-per-unit',
            assignmentPolicy: 'case-count-balanced'
        }
    },
    {
        id: 'hosted-pool-group',
        workload: 'resources',
        route: 'runner',
        hosted: true,
        execution: {
            ...workerPool,
            scheduling: 'concurrent',
            maxConcurrency: concurrentCases,
            dispatchPolicy: 'dynamic-lease',
            workDistribution: {
                mode: 'group',
                unmatched: 'reject',
                groups: [ { name: 'all', fileSets: [ 'cases' ], granularity: 'case' } ]
            }
        }
    },
    {
        id: 'pool-history-hedging',
        workload: 'straggler',
        route: 'runner',
        hosted: false,
        execution: {
            ...workerPool,
            dispatchPolicy: 'dynamic-lease',
            workDistribution: { mode: 'case' },
            assignmentPolicy: 'duration-history-balanced',
            hedging: { mode: 'on', durationMultiplier: 1.5, minimumDelayMilliseconds: 5 }
        }
    }
];

const inProcessCompiler: Scenario = {
    id: 'in-process',
    workload: 'compiler',
    execution: serialProcess('in-process'),
    hosted: false
};

export const performanceCases: readonly PerformanceCase[] = [
    ...familyCases('microtest', 'assertions'),
    ...familyCases('integration', 'resources'),
    ...familyCases('property', 'assertions'),
    ...familyCases('type-test', 'compiler'),
    ...familyCases('benchmark', 'sampling'),
    ...asyncCases('microtest'),
    ...asyncCases('property'),
    ...cliWorkloads.map(function cliCase(workload) {
        return matrixCase('microtest', 'cli', many, {
            id: workload,
            workload,
            execution: serialProcess('in-process'),
            hosted: false
        });
    }),
    ...integrationScenarios.map(function integrationCase(scenario) {
        return matrixCase('integration', scenario.route, many, scenario);
    }),
    matrixCase('microtest', 'engine', many, {
        id: 'warm-batch',
        workload: 'repeated',
        execution: serialProcess('in-process'),
        hosted: false
    }),
    matrixCase('type-test', 'runner', many, inProcessCompiler),
    matrixCase('type-test', 'cli', many, inProcessCompiler),
    matrixCase('benchmark', 'runner', one, {
        id: 'hosted-pool',
        workload: 'sampling',
        execution: workerPool,
        hosted: true
    }),
    matrixCase('benchmark', 'cli', many, {
        id: 'pool-artifact',
        workload: 'artifact',
        execution: workerPool,
        hosted: false
    })
];

export const startupCases = [ 'root-import', 'microtest-cli-startup' ] as const;
