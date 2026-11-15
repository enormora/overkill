import { currentReplayWire } from './replay-wire.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { validateRecordedFamilyFacts } from './replay-family-validation.ts';
import { validateFrozenFamilyCollection } from './family-resolution.ts';
import type { CollectedFamilyMetadata } from './family-catalog.ts';
import type { RunCollectionSource, ResolvedRun, RunCommand } from './run-types.ts';
import {
    createSupervisedCollectCommand,
    createWorkerPoolCommand,
    type WorkerPoolCommandInput
} from './run-isolated-command.ts';
import { collectSupervisedRun } from './supervised-run-collection.ts';
import { collectWorkerPoolRun } from './worker-pool-run.ts';

type FamilyCollectionPolicy = Pick<
    WorkerPoolCommandInput,
    'benchmarkNormalization' | 'files' | 'profile' | 'projectRoot'
>;
type FamilyCollectionInput = FamilyCollectionPolicy & {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
};

function familySource(family: CollectedFamilyMetadata, cwd: string): RunCollectionSource {
    const { source } = family.definition;
    return source.kind === 'config-file'
        ? {
            kind: 'configured-source',
            source: {
                kind: 'config-file',
                request: { cwd, configPath: source.configPath },
                resolvedPath: source.configPath
            }
        }
        : { kind: 'configured-files' };
}

async function collectSelectedFamily(
    run: ResolvedRun,
    metadata: CollectedFamilyMetadata,
    selection: readonly ResolvedRun['facts']['cases'][number]['workId'][],
    input: FamilyCollectionInput
): Promise<CollectedFamilyMetadata> {
    const source = familySource(metadata, input.command.cwd);
    const family = { ...metadata.definition, selection };
    const collection = run.plan.kind === 'worker-pool'
        ? await collectWorkerPoolRun(
            {
                ...createWorkerPoolCommand({
                    projectRoot: input.projectRoot,
                    command: input.command,
                    profile: input.profile,
                    files: input.files,
                    source,
                    definitionLocationCapture: 'enabled',
                    benchmarkNormalization: input.benchmarkNormalization
                }),
                family
            },
            input.dependencies,
            null
        )
        : await collectSupervisedRun(
            {
                ...createSupervisedCollectCommand(input.command, input.profile, input.files, {
                    projectRoot: input.projectRoot,
                    source,
                    normalization: input.benchmarkNormalization
                }),
                replay: currentReplayWire(),
                family
            },
            input.dependencies,
            null
        );
    const actual = validateFrozenFamilyCollection(metadata, collection.collectedPlan.family, collection.runnerErrors);
    validateRecordedFamilyFacts(actual.facts);
    return actual;
}

export async function resolveSelectedFamilyFacts(
    run: ResolvedRun,
    input: FamilyCollectionInput
): Promise<ResolvedRun> {
    if (run.plan.kind === 'local' || run.plan.collectedPlan.family === null) {
        return run;
    }
    const metadata = run.plan.collectedPlan.family;
    const selection = run.facts.cases.map(function work(testCase) {
        return testCase.workId;
    });
    if (selection.length === 0) {
        return run;
    }
    const actual = await collectSelectedFamily(run, metadata, selection, input);
    return {
        ...run,
        facts: { ...run.facts, family: actual.facts },
        plan: {
            ...run.plan,
            collectedPlan: { ...run.plan.collectedPlan, family: actual }
        }
    };
}
