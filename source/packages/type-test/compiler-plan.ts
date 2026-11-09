import {
    createRunResult,
    isCompilerWorkId,
    workIdentityKey,
    type RuntimeId,
    type WorkloadId,
    type TestPlan,
    type RunResult
} from '../engine/engine.entry-point.ts';
import {
    parseAdapterFacts,
    packageVersion,
    type PackageVersion,
    type AdapterPreparation,
    type CollectedAdapterRun,
    type PreparedAdapterRun
} from '../run/run.entry-point.ts';
import { loadProject, verifyFrozenProject, type FrozenProject } from './frozen-project.ts';
import { collectProject } from './native-execution.ts';
import { typeTestSettingsSchema, type TypeTestOptions } from './profile-settings.ts';

const microsecondsPerMillisecond = 1000;
type CompilerPlan = {
    readonly discoveredCases: TestPlan['discoveredCases'];
    readonly cases: ReadonlyMap<string, TestPlan['cases'][number]>;
    readonly projects: ReadonlyMap<string, FrozenProject>;
    readonly requestedCompilers: TypeTestOptions['compiler'];
    readonly versions: { readonly adapter: PackageVersion | null; readonly checker: PackageVersion | null; };
};

function frozenRuntimeIdentity(runtime: RuntimeId): RuntimeId {
    return Object.freeze({
        ...runtime,
        dimensions: Object.freeze({ ...runtime.dimensions }),
        scenarios: Object.freeze({ ...runtime.scenarios })
    });
}

function frozenWorkloadIdentity(workload: WorkloadId | null): WorkloadId | null {
    return workload === null ? null : Object.freeze({ ...workload, params: Object.freeze({ ...workload.params }) });
}

function compilerVariant(testCase: TestPlan['cases'][number], version: string): TestPlan['cases'][number] {
    const id = Object.freeze({ ...testCase.id, suite: Object.freeze(Array.from(testCase.id.suite)) });
    return Object.freeze({
        ...testCase,
        id,
        annotations: Object.freeze({
            ownership: Object.freeze(Array.from(testCase.annotations.ownership)),
            tags: Object.freeze(Array.from(testCase.annotations.tags))
        }),
        controls: Object.freeze({ ...testCase.controls }),
        workId: Object.freeze({
            ...testCase.workId,
            case: id,
            runtimes: Object.freeze(testCase.workId.runtimes.map(frozenRuntimeIdentity)),
            workload: frozenWorkloadIdentity(testCase.workId.workload),
            compiler: Object.freeze({ name: 'typescript' as const, version })
        })
    });
}

function frozenTestPlan(plan: TestPlan): TestPlan {
    Object.freeze(plan.cases);
    Object.freeze(plan.discoveredCases);
    return Object.freeze(plan);
}

function expandedCompilerPlan(plan: TestPlan, projects: CompilerPlan['projects']): TestPlan {
    const variants = new Map<string, TestPlan['cases'][number]>();
    function expand(testCase: TestPlan['cases'][number]): TestPlan['cases'][number][] {
        return Array.from(projects.values(), function variant(project) {
            const result = compilerVariant(testCase, project.compiler.version);
            const key = workIdentityKey(result.workId);
            const existing = variants.get(key);
            if (existing !== undefined) {
                return existing;
            }
            variants.set(key, result);
            return result;
        });
    }
    const cases = plan.cases.flatMap(expand);
    const discovered = plan.discoveredCases.flatMap(expand);
    const first = cases[0];
    const firstDiscovered = discovered[0];
    if (first === undefined || firstDiscovered === undefined) {
        throw new Error('Cannot prepare an empty type-test plan.');
    }
    return frozenTestPlan({
        ...plan,
        cases: [ first, ...cases.slice(1) ],
        discoveredCases: [ firstDiscovered, ...discovered.slice(1) ]
    });
}

function orderedCompilerResults(plan: TestPlan, results: readonly RunResult[]): RunResult['perTest'] {
    const evidence = results.flatMap(function (entry) {
        return entry.perTest;
    });
    const positions = new Map(plan.cases.map(function (entry, index) {
        return [ workIdentityKey(entry.workId), index ];
    }));
    return evidence.toSorted(function plannedOrder(left, right) {
        return (positions.get(workIdentityKey(left.workId)) ?? Number.POSITIVE_INFINITY) -
            (positions.get(workIdentityKey(right.workId)) ?? Number.POSITIVE_INFINITY);
    });
}

async function executeCompilerMatrix(
    plan: TestPlan,
    projects: CompilerPlan['projects'],
    groups: readonly PreparedAdapterRun[]
): Promise<RunResult> {
    const started = performance.now() * microsecondsPerMillisecond;
    const results: RunResult[] = [];
    for (const group of groups) {
        results.push(await group.execute());
    }
    for (const project of projects.values()) {
        await verifyFrozenProject(project, { modules: [], sites: [] });
    }
    const completed = performance.now() * microsecondsPerMillisecond;
    const result = createRunResult(
        plan,
        orderedCompilerResults(plan, results),
        results.flatMap(function (entry) {
            return entry.runnerErrors;
        }),
        {
            startedAtMicroseconds: started,
            completedAtMicroseconds: completed,
            testExecutionWallTimeMicroseconds: completed - started,
            processUsage: null,
            planStatus: 'planned'
        }
    );
    return {
        ...result,
        artifacts: results.flatMap(function (entry) {
            return entry.artifacts;
        })
    };
}

async function collectCompilerGroups(input: CompilerPlan, selected: TestPlan): Promise<readonly CollectedAdapterRun[]> {
    const groups: CollectedAdapterRun[] = [];
    for (const [ version, project ] of input.projects) {
        await verifyFrozenProject(project, { modules: [], sites: [] });
        const cases = selected.cases.filter(function (entry) {
            return isCompilerWorkId(entry.workId) && entry.workId.compiler.version === version;
        });
        const first = cases[0];
        if (first !== undefined) {
            groups.push(await collectProject({ ...selected, cases: [ first, ...cases.slice(1) ] }, project));
        }
    }
    return groups;
}

function assertFrozenSelection(input: CompilerPlan, selected: TestPlan): void {
    if (selected.discoveredCases !== input.discoveredCases) {
        throw new Error('Discovery does not match the frozen project.');
    }
    const seen = new Set<string>();
    for (const entry of selected.cases) {
        const key = workIdentityKey(entry.workId);
        if (seen.has(key)) {
            throw new Error('Duplicate selected compiler work identity.');
        }
        seen.add(key);
        if (input.cases.get(workIdentityKey(entry.workId)) !== entry) {
            throw new Error('Compiler work identity does not match the frozen project.');
        }
    }
}

async function collectCompilerPlan(input: CompilerPlan, selected: TestPlan): Promise<CollectedAdapterRun> {
    assertFrozenSelection(input, selected);
    const groups = await collectCompilerGroups(input, selected);
    const planning = {
        version: 1,
        versions: input.versions,
        requestedCompilers: input.requestedCompilers,
        generatedInputPolicy: { prefix: '.overkill-type-test-', location: 'sibling', preserveExtension: true },
        compilers: groups.map(function (group) {
            return group.facts;
        })
    };
    return {
        facts: parseAdapterFacts(planning),
        async lower() {
            const lowered: PreparedAdapterRun[] = [];
            for (const group of groups) {
                lowered.push(await group.lower());
            }
            return {
                get facts() {
                    return parseAdapterFacts({
                        ...planning,
                        generatedInputs: lowered.map(function (group) {
                            return group.facts;
                        })
                    });
                },
                async execute() {
                    return await executeCompilerMatrix(selected, input.projects, lowered);
                }
            };
        }
    };
}

async function resolveCompilerProjects(options: TypeTestOptions): Promise<ReadonlyMap<string, FrozenProject>> {
    const selections = options.compiler.kind === 'matrix' ? options.compiler.compilers : [ options.compiler ];
    const unique = new Map(selections.map(function (selection) {
        return [ JSON.stringify(selection), selection ];
    }));
    const projects = new Map<string, FrozenProject>();
    for (const selection of unique.values()) {
        const project = await loadProject(options.projectConfigPath, selection);
        if (!projects.has(project.compiler.version)) {
            projects.set(project.compiler.version, project);
        }
    }
    return projects;
}

export async function prepare(plan: TestPlan, settings: unknown): Promise<AdapterPreparation> {
    const options = typeTestSettingsSchema.parse(settings);
    const [ adapter, checker ] = await Promise.all([
        packageVersion(import.meta.url),
        packageVersion(import.meta.resolve('tstyche/api'))
    ]);
    const projects = await resolveCompilerProjects(options);
    const testPlan = expandedCompilerPlan(plan, projects);
    const input: CompilerPlan = {
        discoveredCases: testPlan.discoveredCases,
        cases: new Map(testPlan.cases.map(function (entry) {
            return [ workIdentityKey(entry.workId), entry ];
        })),
        projects,
        requestedCompilers: options.compiler,
        versions: { adapter, checker }
    };
    return {
        testPlan,
        async collect(selected) {
            return await collectCompilerPlan(input, selected);
        }
    };
}
