import { createIsolatedResolvedRun } from '../run/run-isolated-process.ts';
import type { CollectedFamilyMetadata, FamilyResolutionSource } from '../run/family-catalog.ts';
import type { ResolvedRun, RunCommand } from '../run/run-types.ts';
import type { ResolvedRunInput } from '../run/run-input-resolution.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import type { WorkerPoolTask, WorkerPoolCommand } from '../run/worker-pool-protocol.ts';
import { passingIsolatedWorkerRun, type IsolatedWorkerFixture } from './isolated-worker-run.ts';
import { createFakeSupervisedChildProcess } from './fake-supervised-child-process.ts';
import { defaultIntegrationProfile } from './run-command-factory.ts';

export type FamilyCollectionScenario = 'checkpoint' | 'error' | 'missing' | 'pass' | 'preparation';
type IsolatedResolvedRun = ResolvedRun & { readonly plan: Exclude<ResolvedRun['plan'], { readonly kind: 'local'; }>; };
type SelectedFamilyInput = ResolvedRunInput & {
    readonly collectAnalysis: null;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
};
type SelectedFamilyFixture = {
    readonly run: ResolvedRun;
    readonly input: SelectedFamilyInput;
    readonly actual: CollectedFamilyMetadata | null;
    readonly commands: readonly Pick<WorkerPoolCommand, 'family' | 'paths'>[];
};
function isCollectTask(task: unknown): task is Extract<WorkerPoolTask, { readonly kind: 'collect'; }> {
    return task !== null && typeof task === 'object' && Reflect.get(task, 'kind') === 'collect';
}

type SelectedFamilyCatalog = {
    readonly metadata: CollectedFamilyMetadata;
    readonly actual: CollectedFamilyMetadata | null;
};

function selectedFamilyMetadata(
    model: 'supervised' | 'worker-pool',
    source: FamilyResolutionSource,
    scenario: FamilyCollectionScenario
): SelectedFamilyCatalog {
    const metadata: CollectedFamilyMetadata = {
        definition: {
            projectRoot: '/project',
            definitionLocationCapture: 'enabled',
            processModel: model === 'supervised' ? 'supervised-process' : 'worker-pool',
            selection: null,
            checkpoint: null,
            source,
            id: 'unit-family',
            version: '1',
            settings: null
        },
        facts: { id: 'unit-family', version: '1', settings: null, preparation: null, collection: null }
    };
    const actual: CollectedFamilyMetadata | null = scenario === 'missing'
        ? null
        : {
            definition: {
                ...metadata.definition,
                checkpoint: scenario === 'checkpoint'
                    ? { preparation: metadata.facts, catalog: null }
                    : null
            },
            facts: {
                ...metadata.facts,
                preparation: scenario === 'preparation' ? { changed: true } : null,
                collection: { selected: true }
            }
        };
    return { metadata, actual };
}

type FamilyCollectionBackend = {
    readonly dependencies: RunOrchestratorDependencies;
    readonly commands: SelectedFamilyFixture['commands'];
};

async function resolveFamilyPlan(fixture: IsolatedWorkerFixture): Promise<IsolatedResolvedRun> {
    const resolving = createIsolatedResolvedRun(fixture.command, fixture.dependencies, fixture.input, fixture.options);
    if (resolving === null) {
        throw new Error('Missing isolated plan.');
    }
    const resolved = await resolving;
    if (resolved.plan.kind === 'local') {
        throw new Error('Expected an isolated family plan.');
    }
    return { ...resolved, plan: resolved.plan };
}

function familyCollectionBackend(
    original: RunOrchestratorDependencies,
    resolved: IsolatedResolvedRun,
    actual: CollectedFamilyMetadata | null,
    scenario: FamilyCollectionScenario
): FamilyCollectionBackend {
    const plan = { ...resolved.plan.collectedPlan, family: actual };
    const commands: Pick<WorkerPoolCommand, 'family' | 'paths'>[] = [];
    const runnerErrors: ResolvedRun['collectionRunnerErrors'] = scenario === 'error'
        ? [ {
            attributedTo: null,
            attributedToAttempt: null,
            attributedToWork: null,
            cause: null,
            diagnostics: [],
            message: 'family failed',
            subtype: 'loader'
        } ]
        : [];
    const dependencies: RunOrchestratorDependencies = {
        ...original,
        createWorkerPool(options) {
            return {
                options: { maxThreads: options.workerCount, isolateWorkers: true },
                async destroy() {
                    return undefined;
                },
                async run(task) {
                    if (!isCollectTask(task)) {
                        throw new Error('Expected family collection.');
                    }
                    commands.push(task.command);
                    task.port.close();
                    return { collectedPlan: plan, runnerErrors };
                }
            };
        },
        async startSupervisedChild() {
            return createFakeSupervisedChildProcess({
                collect({ command }) {
                    commands.push(command);
                    return { collectedPlan: plan, runnerErrors };
                },
                run() {
                    throw new Error('Family recollection must not run cases.');
                }
            });
        }
    };
    return { dependencies, commands };
}
export async function selectedFamilyCollection(
    model: 'supervised' | 'worker-pool',
    source: FamilyResolutionSource,
    scenario: FamilyCollectionScenario
): Promise<SelectedFamilyFixture> {
    const fixture = passingIsolatedWorkerRun(false, false);
    const resolved = await resolveFamilyPlan(fixture);
    const { metadata, actual } = selectedFamilyMetadata(model, source, scenario);
    const { dependencies, commands } = familyCollectionBackend(fixture.dependencies, resolved, actual, scenario);
    const run: ResolvedRun = {
        ...resolved,
        plan: { kind: model, collectedPlan: { ...resolved.plan.collectedPlan, family: metadata } }
    };
    return {
        run,
        input: {
            collectAnalysis: null,
            ...fixture.input,
            command: fixture.command,
            dependencies,
            profile: defaultIntegrationProfile({
                execution: { processModel: model === 'supervised' ? 'supervised-process' : 'worker-pool' }
            })
        },
        actual,
        commands
    };
}
