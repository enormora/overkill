import type { JsonValue, ReadonlyDeep } from 'type-fest';
import {
    createRunResult,
    workIdentityKey,
    type FamilyPreparationInput,
    type RuntimeId,
    type WorkloadId,
    type TestPlan,
    type RunResult
} from '../engine/engine.entry-point.ts';
import { parseAdapterFacts } from '../../config/adapter-facts.ts';
import { frozenInputFacts } from './frozen-inputs.ts';
import { packageVersion, type PackageVersion } from '../../package-version.ts';
import {
    checkCompilerCancellation,
    loadProject,
    disposeProject,
    verifyFrozenProject,
    originalProjectFacts,
    fingerprint,
    type FrozenProject
} from './frozen-project.ts';
import { collectProject, type CompilerCheck } from './native-execution.ts';
import { nativeCheckResult } from './native-results.ts';
import {
    typeTestSettingsSchema,
    type TypeTestSettings,
    type CompilerSelection,
    type CompilerPolicy
} from './profile-settings.ts';
import type { CheckerPreparation, CollectedCheckerRun, CheckerExecution } from './checker-plan.ts';

const microsecondsPerMillisecond = 1000;
type CompilerPlan = {
    readonly discoveredCases: TestPlan['discoveredCases'];
    readonly cases: ReadonlyMap<string, TestPlan['cases'][number]>;
    readonly projects: ReadonlyMap<string, FrozenProject>;
    readonly requestedCompilers: TypeTestSettings['compiler'];
    readonly versions: {
        readonly adapter: PackageVersion | null;
    };
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
            familyVariant: Object.freeze({ family: '@overkill-dev/type-test', key: `typescript@${version}` })
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

async function checkGroups(groups: readonly CompilerCheck[], signal: AbortSignal): Promise<{
    readonly results: readonly CheckerExecution[];
    readonly savedValidations: readonly (() => Promise<void>)[];
}> {
    const results: CheckerExecution[] = [];
    const savedValidations: (() => Promise<void>)[] = [];
    for (const group of groups) {
        results.push(
            await group.check(signal, function remember(save) {
                savedValidations.push(save);
            })
        );
    }
    return { results, savedValidations };
}

async function checkCompilerGroups(
    groups: readonly CompilerCheck[],
    verifyInputs: (signal: AbortSignal) => Promise<void>,
    signal: AbortSignal
): Promise<readonly CheckerExecution[]> {
    async function verify(): Promise<void> {
        signal.throwIfAborted();
        await verifyInputs(signal);
        for (const group of groups) {
            await group.verify(signal);
        }
    }
    await verify();
    const { results, savedValidations } = await checkGroups(groups, signal);
    await checkCompilerCancellation(signal);
    await verify();
    signal.throwIfAborted();
    await Promise.all(savedValidations.map(async function persist(save) {
        await save();
    }));
    return results;
}

function completeCompilerMatrix(
    plan: TestPlan,
    results: readonly CheckerExecution[],
    planning: Readonly<Record<string, ReadonlyDeep<JsonValue>>>,
    started: number
): CheckerExecution {
    const completed = performance.now() * microsecondsPerMillisecond;
    const runs = results.map(function (execution) {
        return execution.result;
    });
    const result = createRunResult(
        plan,
        orderedCompilerResults(plan, runs),
        runs.flatMap(function (entry) {
            return entry.runnerErrors;
        }),
        {
            startedAtMicroseconds: started * microsecondsPerMillisecond,
            completedAtMicroseconds: completed,
            testExecutionWallTimeMicroseconds: completed - started * microsecondsPerMillisecond,
            processUsage: null,
            planStatus: 'planned'
        }
    );
    return {
        result,
        facts: parseAdapterFacts({
            ...planning,
            compilers: results.map(function (execution) {
                return execution.facts;
            })
        })
    };
}

type CompilerMatrixExecution = {
    readonly plan: TestPlan;
    readonly groups: readonly CompilerCheck[];
    readonly verifyInputs: (signal: AbortSignal) => Promise<void>;
    readonly planning: Readonly<Record<string, ReadonlyDeep<JsonValue>>>;
    readonly signal: AbortSignal;
};

export async function executeCompilerMatrix(input: CompilerMatrixExecution): Promise<CheckerExecution> {
    const { plan, groups, verifyInputs, planning, signal } = input;
    const started = performance.now();
    try {
        return completeCompilerMatrix(plan, await checkCompilerGroups(groups, verifyInputs, signal), planning, started);
    } catch (error: unknown) {
        signal.throwIfAborted();
        const failure = error instanceof Error
            ? error
            : new Error('Type-test input validation failed.', { cause: error });
        return {
            result: nativeCheckResult({
                plan,
                assertionPlan: { modules: [], sites: [], issues: [] },
                checked: null,
                error: failure,
                started
            }),
            facts: parseAdapterFacts(planning)
        };
    }
}

async function collectCompilerGroups(input: CompilerPlan, selected: TestPlan, signal: AbortSignal): Promise<{
    readonly groups: readonly CompilerCheck[];
    readonly verifyUnselected: (signal: AbortSignal) => Promise<void>;
}> {
    const groups: CompilerCheck[] = [];
    const unselected: FrozenProject[] = [];
    for (const [ version, project ] of input.projects) {
        await verifyFrozenProject(project, [], signal);
        const cases = selected.cases.filter(function (entry) {
            const variant = entry.workId.familyVariant;
            return variant?.family === '@overkill-dev/type-test' && variant.key === `typescript@${version}`;
        });
        const first = cases[0];
        if (first === undefined) {
            unselected.push(project);
        } else {
            groups.push(await collectProject({ ...selected, cases: [ first, ...cases.slice(1) ] }, project, signal));
        }
    }
    return {
        groups,
        async verifyUnselected(checkSignal) {
            for (const project of unselected) {
                await verifyFrozenProject(project, [], checkSignal);
            }
        }
    };
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

async function collectCompilerPlan(
    input: CompilerPlan,
    selected: TestPlan,
    signal: AbortSignal
): Promise<CollectedCheckerRun> {
    assertFrozenSelection(input, selected);
    const { groups, verifyUnselected } = await collectCompilerGroups(input, selected, signal);
    await checkCompilerCancellation(signal);
    const planning = {
        version: 3,
        versions: input.versions,
        requestedCompilers: input.requestedCompilers,
        identities: selected.cases.map(function (testCase) {
            return testCase.workId;
        }),
        compilers: groups.map(function (group) {
            return group.facts;
        })
    };
    return {
        facts: parseAdapterFacts(planning),
        async execute(checkSignal) {
            return await executeCompilerMatrix({
                plan: selected,
                groups,
                verifyInputs: verifyUnselected,
                planning,
                signal: checkSignal
            });
        }
    };
}

function compilerFingerprint(project: FrozenProject): string {
    return JSON.stringify({ packageUrl: project.compiler.packageUrl, files: project.compiler.files });
}

function retainCompilerProject(existing: FrozenProject | undefined, project: FrozenProject): FrozenProject {
    if (existing === undefined) {
        return project;
    }
    if (compilerFingerprint(existing) !== compilerFingerprint(project)) {
        throw new Error('Conflicting compiler implementations claim the same version.');
    }
    return {
        ...existing,
        compiler: {
            ...existing.compiler,
            resolutions: [ ...existing.compiler.resolutions, ...project.compiler.resolutions ]
        }
    };
}

type CompilerProjects = {
    readonly projects: ReadonlyMap<string, FrozenProject>;
    readonly ownership: AsyncDisposableStack;
};
type CompilerResolution = CompilerProjects & {
    readonly options: TypeTestSettings;
    readonly signal: AbortSignal;
    readonly projectRoot: string;
};
async function retainSelectedProject(input: CompilerResolution, selection: CompilerSelection): Promise<FrozenProject> {
    const project = await loadProject(input.options.projectConfigPath, selection, input.projectRoot, input.signal);
    input.ownership.use(project.ownership);
    const retained = retainCompilerProject(input.projects.get(project.compiler.version), project);
    if (retained !== project) {
        await disposeProject(project);
    }
    return retained;
}

async function resolveCompilerProjects(
    options: TypeTestSettings,
    projectRoot: string,
    signal: AbortSignal
): Promise<CompilerProjects> {
    const selections = options.compiler.kind === 'matrix' ? options.compiler.compilers : [ options.compiler ];
    const unique = new Map(selections.map(function selectionKey(selection) {
        return [ JSON.stringify(selection), selection ];
    }));
    await using ownership = new AsyncDisposableStack();
    const projects = new Map<string, FrozenProject>();
    const input = { options, projectRoot, projects, ownership, signal };
    for (const selection of unique.values()) {
        const project = await retainSelectedProject(input, selection);
        projects.set(project.compiler.version, project);
    }
    return { projects, ownership: ownership.move() };
}

type FamilyVariantExpander = FamilyPreparationInput<TypeTestSettings>['expandVariants'];
function expandCompilerWork(
    plan: TestPlan,
    projects: CompilerPlan['projects'],
    expand: FamilyVariantExpander | null
): TestPlan {
    const variants = Array.from(projects.values(), function variant(project) {
        return { key: `typescript@${project.compiler.version}`, facts: { version: project.compiler.version } };
    });
    const [ firstVariant, ...remainingVariants ] = variants;
    if (firstVariant === undefined) {
        throw new TypeError('At least one compiler is required.');
    }
    return expand === null
        ? expandedCompilerPlan(plan, projects)
        : expand([ firstVariant, ...remainingVariants ]);
}

function freezeCompilerPlan(
    testPlan: TestPlan,
    projects: CompilerPlan['projects'],
    requestedCompilers: CompilerPolicy,
    adapter: PackageVersion | null
): CompilerPlan {
    return {
        discoveredCases: testPlan.discoveredCases,
        cases: new Map(testPlan.cases.map(function (entry) {
            return [ workIdentityKey(entry.workId), entry ];
        })),
        projects,
        requestedCompilers,
        versions: { adapter }
    };
}

function compilerPreparationFacts(
    projects: CompilerPlan['projects'],
    requestedCompilers: CompilerPolicy
): CheckerPreparation['facts'] {
    return parseAdapterFacts({
        requestedCompilers,
        compilers: Array.from(projects.values(), function compilerFacts(project) {
            return {
                version: project.compiler.version,
                packageUrl: project.compiler.packageUrl,
                files: project.compiler.files,
                resolutions: project.compiler.resolutions,
                projectConfigPath: project.projectConfigPath,
                projectFingerprint: fingerprint(project.projectText),
                configuration: originalProjectFacts(project),
                inputs: frozenInputFacts(project.inputs)
            };
        })
    });
}

type CompilerPreparationContext = {
    readonly projectRoot: string;
    readonly signal: AbortSignal;
    readonly expandVariants: FamilyVariantExpander | null;
};

function retainCompilerPreparation(
    testPlan: TestPlan,
    input: CompilerPlan,
    ownership: AsyncDisposableStack
): CheckerPreparation {
    const facts = compilerPreparationFacts(input.projects, input.requestedCompilers);
    const retained = ownership.move();
    return {
        testPlan,
        facts,
        async dispose() {
            await retained.disposeAsync();
        },
        async collect(selected, collectionSignal) {
            return await collectCompilerPlan(input, selected, collectionSignal);
        }
    };
}

function validateCaseControls(plan: TestPlan): void {
    for (const testCase of plan.cases) {
        if (
            testCase.execution.kind !== 'skip' && Object.values(testCase.controls).some(function configured(value) {
                return value !== null;
            })
        ) {
            throw new TypeError('Type-test cases do not support runtime execution controls.');
        }
    }
}

export async function prepare(
    plan: TestPlan,
    settings: unknown,
    context: CompilerPreparationContext
): Promise<CheckerPreparation> {
    const { projectRoot, signal, expandVariants } = context;
    const options = typeTestSettingsSchema.parse(settings);
    validateCaseControls(plan);
    const adapter = await packageVersion(import.meta.url);
    const group = await resolveCompilerProjects(options, projectRoot, signal);
    await using ownership = group.ownership;
    const testPlan = expandCompilerWork(plan, group.projects, expandVariants);
    await checkCompilerCancellation(signal);
    const input = freezeCompilerPlan(testPlan, group.projects, options.compiler, adapter);
    return retainCompilerPreparation(testPlan, input, ownership);
}
